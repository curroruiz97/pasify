-- Pasify · 0050 perf: wrap `auth.uid()` con `(SELECT auth.uid())` en RLS
--
-- El advisor 0003 (`auth_rls_initplan`) marca 111 policies (229 totales
-- en `public`, 241 ocurrencias contando qual + with_check) que llaman
-- `auth.uid()` directamente. Postgres re-evalúa esa función por CADA
-- fila comparada → coste lineal sobre tablas grandes (tickets, events,
-- notifications, etc.).
--
-- Fix: wrap en `(SELECT auth.uid())` para que Postgres lo trate como
-- subquery cacheable. Una sola evaluación por query, no por fila.
--
-- Estrategia DRY:
--   1. Iterar `pg_policies` filtrando policies que contengan
--      `auth.uid()` sin estar ya envueltas en `(SELECT auth.uid())`.
--   2. Para cada policy:
--      a. Reescribir `qual` y `with_check` con un replace seguro de
--         doble-wrap (placeholder → replace → restore).
--      b. DROP + CREATE preservando permissive/cmd/roles.
--   3. Tras la migración, re-correr advisor debería bajar el contador.
--
-- Idempotente: el filtro WHERE excluye policies ya migradas, así que
-- re-aplicar es no-op.
--
-- Riesgo: si una policy tiene SQL muy creativo (no estándar), la
-- regeneración podría romper sintaxis. Verificado contra una muestra
-- (user_blocks): policies usan `has_role(auth.uid(), 'admin'::app_role)`
-- y `(col = auth.uid())` — ambos patrones soportados.

DO $$
DECLARE
  r RECORD;
  v_new_qual TEXT;
  v_new_check TEXT;
  v_roles_csv TEXT;
  v_using TEXT;
  v_check TEXT;
  v_permissive TEXT;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      cmd,
      roles,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(SELECT auth.uid())%')
        OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(SELECT auth.uid())%')
      )
  LOOP
    -- Reescribir qual con doble-wrap-safe: placeholder → replace → restore.
    v_new_qual := r.qual;
    IF v_new_qual IS NOT NULL THEN
      v_new_qual := replace(v_new_qual, '(SELECT auth.uid())', '__PASIFY_AUID__');
      v_new_qual := replace(v_new_qual, 'auth.uid()', '(SELECT auth.uid())');
      v_new_qual := replace(v_new_qual, '__PASIFY_AUID__', '(SELECT auth.uid())');
    END IF;

    v_new_check := r.with_check;
    IF v_new_check IS NOT NULL THEN
      v_new_check := replace(v_new_check, '(SELECT auth.uid())', '__PASIFY_AUID__');
      v_new_check := replace(v_new_check, 'auth.uid()', '(SELECT auth.uid())');
      v_new_check := replace(v_new_check, '__PASIFY_AUID__', '(SELECT auth.uid())');
    END IF;

    -- Roles array → "a, b, c" con quote_ident.
    SELECT string_agg(quote_ident(role_name::text), ', ')
      INTO v_roles_csv
      FROM unnest(r.roles) AS role_name;

    -- Construir cláusulas opcionales — Postgres rechaza USING en INSERT
    -- y WITH CHECK en SELECT/DELETE.
    v_using := CASE WHEN v_new_qual IS NOT NULL
                    THEN format(' USING (%s)', v_new_qual)
                    ELSE '' END;
    v_check := CASE WHEN v_new_check IS NOT NULL
                    THEN format(' WITH CHECK (%s)', v_new_check)
                    ELSE '' END;
    v_permissive := r.permissive;

    -- DROP + CREATE.
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      r.policyname, r.schemaname, r.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      r.policyname,
      r.schemaname,
      r.tablename,
      v_permissive,
      r.cmd,
      v_roles_csv,
      v_using,
      v_check
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Policies migrated: %', v_count;
END $$;
