-- Pasify · Ola 3 · plataforma: índices de las claves foráneas (B6-15), la
-- lista de tablas publicadas en Realtime y el SQL muerto que se borra (B6-14).
-- Migración 20260928110000. Solo lee el catálogo (y una consulta como anon y
-- como authenticated); ROLLBACK igualmente. Un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260928110000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o3_plataforma.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  r         record;
  v_rel     regclass;
  v_att     smallint;
  v_text    text;
  v_tablas  text[];
  -- Las tablas que la app escucha con postgres_changes. Si una tabla nueva
  -- necesita Realtime, se añade a la publicación en su migración y aquí.
  v_esperadas CONSTANT text[] := ARRAY[
    'ai_kill_switches', 'refund_requests', 'support_conversations',
    'support_messages', 'ticket_orders', 'tickets'
  ];
BEGIN
  -- ------------------------------------------------------------------
  -- 1) Índices de las 6 claves foráneas que señalaban los asesores
  -- ------------------------------------------------------------------
  -- Vale cualquier índice válido que empiece por la columna: la migración no
  -- crea el suyo (idx_…) si ya hay uno así.
  FOR r IN
    SELECT * FROM (VALUES
      ('crm_activities',   'org_id'),
      ('crm_contact_tags', 'tag_id'),
      ('crm_notes',        'org_id'),
      ('referral_claims',  'referral_code'),
      ('rrpp_payouts',     'org_id'),
      ('team_shifts',      'member_id')
    ) AS t(tabla, columna)
  LOOP
    v_rel := to_regclass(format('public.%I', r.tabla));
    IF v_rel IS NULL THEN RAISE EXCEPTION 'FAIL no existe public.%', r.tabla; END IF;
    v_att := NULL;
    SELECT attnum INTO v_att FROM pg_attribute
     WHERE attrelid = v_rel AND attname = r.columna AND NOT attisdropped;
    IF v_att IS NULL THEN RAISE EXCEPTION 'FAIL public.% no tiene la columna %', r.tabla, r.columna; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i
                    WHERE i.indrelid = v_rel AND i.indkey[0] = v_att AND i.indisvalid) THEN
      RAISE EXCEPTION 'FAIL %(%) sigue sin índice', r.tabla, r.columna;
    END IF;
  END LOOP;

  -- Y ninguna otra clave foránea de public sin un índice que empiece por
  -- sus columnas (lo que mide el asesor unindexed_foreign_keys).
  SELECT string_agg(format('%s(%s)', c.conrelid::regclass, cols.lista), ', '
                    ORDER BY c.conrelid::regclass::text, cols.lista)
    INTO v_text
    FROM pg_constraint c
    CROSS JOIN LATERAL (
      SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS lista
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    ) cols
   WHERE c.contype = 'f'
     AND c.connamespace = 'public'::regnamespace
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
          AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
     );
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL claves foráneas sin índice: %', v_text;
  END IF;

  -- ------------------------------------------------------------------
  -- 2) Realtime publica exactamente lo que escucha la app
  -- ------------------------------------------------------------------
  SELECT coalesce(array_agg(tablename::text ORDER BY tablename), '{}')
    INTO v_tablas
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
  IF v_tablas IS DISTINCT FROM v_esperadas THEN
    RAISE EXCEPTION 'FAIL supabase_realtime publica % y se esperaba %', v_tablas, v_esperadas;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname <> 'public') THEN
    RAISE EXCEPTION 'FAIL supabase_realtime publica tablas fuera de public';
  END IF;

  -- ------------------------------------------------------------------
  -- 3) SQL muerto fuera; lo que se queda, sin anon
  -- ------------------------------------------------------------------
  IF to_regclass('public.v_partner_kpis_daily') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sigue la vista v_partner_kpis_daily';
  END IF;
  IF to_regclass('public.v_event_revenue_summary') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL sigue la vista v_event_revenue_summary';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND proname IN ('mark_ticket_used', 'cashless_pay')) THEN
    RAISE EXCEPTION 'FAIL siguen mark_ticket_used o cashless_pay';
  END IF;

  -- door_scan se queda (tests/db/review_fixes.sql la nombra), sin clientes.
  IF to_regprocedure('public.door_scan(uuid)') IS NOT NULL
     AND (has_function_privilege('anon', 'public.door_scan(uuid)', 'execute')
          OR has_function_privilege('authenticated', 'public.door_scan(uuid)', 'execute')) THEN
    RAISE EXCEPTION 'FAIL door_scan se puede ejecutar desde el cliente';
  END IF;

  -- La portada del admin sigue leyendo v_admin_platform_kpis; anon no.
  IF to_regclass('public.v_admin_platform_kpis') IS NULL THEN
    RAISE EXCEPTION 'FAIL ha desaparecido v_admin_platform_kpis (la usa el admin)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.v_admin_platform_kpis', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL authenticated ya no puede leer v_admin_platform_kpis';
  END IF;
  IF has_table_privilege('anon', 'public.v_admin_platform_kpis', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon sigue pudiendo leer v_admin_platform_kpis';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM * FROM public.v_admin_platform_kpis;
  RESET ROLE;

  v_text := NULL;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.v_admin_platform_kpis;
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  RESET ROLE;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN
    RAISE EXCEPTION 'FAIL anon lee v_admin_platform_kpis';
  END IF;

  RAISE NOTICE 'PASS o3_plataforma: 6 índices de FK (y ninguna FK sin índice), Realtime con las 6 tablas que escucha la app, vistas y funciones muertas fuera, v_admin_platform_kpis sin anon';
END $$;

ROLLBACK;
