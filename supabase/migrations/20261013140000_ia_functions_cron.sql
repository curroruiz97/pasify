-- Pasify · IA y mantenimiento: lo que necesitan las funciones reales + su cron
--
--   1) Capacidad «moderation» y su interruptor (ai_kill_switches), para que
--      moderate-content se pueda parar desde el mismo sitio que el resto de la IA.
--   2) cleanup_media_candidates(bucket, edad mínima, tope): qué ficheros de los
--      buckets públicos de imágenes no usa ninguna fila de la base de datos.
--      Es la parte delicada de cleanup-media (supabase/functions/cleanup-media),
--      que solo borra lo que esta función devuelve.
--   3) Trabajos de pg_cron (con el mismo patrón y el mismo secreto de Vault que
--      reconcile-pending-orders, dispatch-notification o health-check):
--        pasify-ai-anomaly-detector      cada día  06:30 UTC  ai-anomaly-detector
--        pasify-industry-benchmarks      cada día  03:30 UTC  industry-benchmarks-recompute
--        pasify-cleanup-media            domingos  05:30 UTC  cleanup-media (EN MODO PRUEBA)
--
-- cleanup-media NACE EN MODO PRUEBA: el cron manda {"dry_run": true}, así que la
-- función solo cuenta y registra qué borraría (log y audit_logs con action
-- 'storage_cleanup_dry_run'). Cuando esos candidatos sean de verdad huérfanos:
--        SELECT public.schedule_cleanup_media(false);
-- (vuelve a programar el mismo trabajo con {"dry_run": false}).
--
-- Esta migración es segura aplicada en cualquier momento: sin el secreto de Vault
-- crea las funciones pero NO programa ningún trabajo (avisa con un NOTICE); con el
-- secreto, los programa. Para la parte manual:
--   1. Secretos de las edge functions: OPENAI_API_KEY (sin ella ai-concierge-reply y
--      moderate-content responden 503) y PASIFY_INTERNAL_SECRET (32+ caracteres).
--   2. El mismo valor de PASIFY_INTERNAL_SECRET en Vault:
--        SELECT vault.create_secret('<mismo valor>', 'pasify_internal_secret');
--   3. SELECT public.schedule_ia_functions();
-- Repetirlas no duplica nada (cron.schedule reemplaza el trabajo del mismo nombre).
-- Para parar uno: SELECT cron.unschedule('<nombre>').

-- ============================================================================
-- 1) Capacidad «moderation»
-- ============================================================================
INSERT INTO public.ai_capabilities (code, name, description, status, provider)
VALUES (
  'moderation',
  'Moderación de contenido',
  'Clasifica texto de usuarios con la API de moderación de OpenAI; si no puede comprobar, el contenido pasa',
  'active',
  'openai'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_kill_switches (capability_code, killed)
VALUES ('moderation', FALSE)
ON CONFLICT (capability_code) DO NOTHING;

-- ============================================================================
-- 2) cleanup_media_candidates
-- ============================================================================
-- Devuelve, para UN bucket público de imágenes, los ficheros huérfanos más
-- antiguos (hasta _max_candidates) y los totales para que la edge function
-- juzgue si el resultado es creíble:
--   { bucket, total_objects, eligible_objects, candidates_total,
--     candidates_bytes, candidates: [{ name, size, created_at, updated_at }] }
--
-- Qué es «elegible»: nombre «<uuid>/tramo/…/fichero» con tramos de
-- [A-Za-z0-9._-] que empiezan por letra o número (como los sube la app; no pasan
-- «..», placeholders de carpeta ni nombres hechos a mano) y sin tocar desde hace
-- al menos _min_age_days días.
--
-- Qué es «referenciado»: su ruta «<uuid>/…» aparece en CUALQUIER columna text,
-- varchar, citext, text[], json o jsonb de las tablas de public (o dominios sobre
-- esos tipos), o en los
-- metadatos de auth.users. No importa en cuál: vale una URL pública completa, una
-- URL firmada o la ruta sola. Se compara sin distinguir mayúsculas y sin los
-- signos finales (.-_/) que pueda arrastrar un texto («…/a.jpg.»). Tomar por
-- usado algo que no lo es solo retrasa un borrado; lo contrario rompería una
-- imagen en uso, así que la búsqueda es deliberadamente amplia y una columna
-- nueva con URLs queda cubierta sin tocar nada.
--
-- Fail-closed: con row_security desactivada, una política RLS que afectara a la
-- lectura da error en lugar de ocultar filas (y con ellas, referencias).
-- Cualquier error aborta la función y la edge function no borra nada.
--
-- Solo service_role. Los buckets privados no están permitidos.
CREATE OR REPLACE FUNCTION public.cleanup_media_candidates(
  _bucket TEXT,
  _min_age_days INTEGER DEFAULT 30,
  _max_candidates INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c_uuid  CONSTANT TEXT := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  c_token CONSTANT TEXT := '(' || c_uuid || '/[A-Za-z0-9._/-]+)';
  c_name  CONSTANT TEXT := '^' || c_uuid || '/([A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*$';
  v_sources TEXT;
  v_result  JSONB;
BEGIN
  IF _bucket IS NULL OR _bucket NOT IN ('avatars', 'event-images', 'partner-branding', 'partner-galleries') THEN
    RAISE EXCEPTION 'cleanup_media_candidates: bucket no permitido (%)', _bucket USING ERRCODE = '22023';
  END IF;
  IF _min_age_days IS NULL OR _min_age_days < 7 THEN
    RAISE EXCEPTION 'cleanup_media_candidates: la edad mínima es de 7 días' USING ERRCODE = '22023';
  END IF;
  IF _max_candidates IS NULL OR _max_candidates < 1 OR _max_candidates > 1000 THEN
    RAISE EXCEPTION 'cleanup_media_candidates: el tope va de 1 a 1000' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('row_security', 'off', true);

  -- Una consulta por columna candidata a llevar URLs; todas en un UNION ALL. Se
  -- enumeran con pg_catalog (no con information_schema, que oculta lo que el
  -- rol no puede leer): una tabla ilegible hace fallar el SELECT, no se salta.
  -- Dominios sobre texto incluidos; las particiones cuentan por su tabla madre.
  SELECT pg_catalog.string_agg(
           pg_catalog.format('SELECT %I::pg_catalog.text AS v FROM %I.%I', a.attname, n.nspname, c.relname),
           E'\n UNION ALL '
         )
    INTO v_sources
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    JOIN pg_catalog.pg_type bt ON bt.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relispartition
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND bt.typname IN ('text', 'varchar', 'bpchar', 'citext', 'json', 'jsonb', '_text', '_varchar', '_bpchar', '_citext');

  IF v_sources IS NULL THEN
    RAISE EXCEPTION 'cleanup_media_candidates: no se encontraron columnas que revisar';
  END IF;
  -- Los metadatos de usuario también pueden guardar la URL de un avatar.
  v_sources := v_sources
    || E'\n UNION ALL SELECT raw_user_meta_data::pg_catalog.text FROM auth.users'
    || E'\n UNION ALL SELECT raw_app_meta_data::pg_catalog.text FROM auth.users';

  EXECUTE pg_catalog.format($q$
    WITH refs AS (
      SELECT DISTINCT pg_catalog.lower(pg_catalog.rtrim(x.m[1], './-_')) AS ref
        FROM (
          SELECT pg_catalog.regexp_matches(s.v, %1$L, 'g') AS m
            FROM (%2$s) s
        ) x
    ),
    objs AS (
      SELECT o.name,
             o.created_at,
             COALESCE(o.updated_at, o.created_at) AS touched_at,
             COALESCE((o.metadata ->> 'size')::pg_catalog.int8, 0) AS size
        FROM storage.objects o
       WHERE o.bucket_id = %3$L
    ),
    eligible AS (
      SELECT * FROM objs
       WHERE name ~ %4$L
         AND touched_at < pg_catalog.now() - pg_catalog.make_interval(days => %5$s)
    ),
    orphans AS (
      SELECT e.* FROM eligible e
       WHERE NOT EXISTS (SELECT 1 FROM refs r WHERE r.ref = pg_catalog.lower(e.name))
    )
    SELECT pg_catalog.jsonb_build_object(
      'bucket', %3$L,
      'total_objects', (SELECT pg_catalog.count(*) FROM objs),
      'eligible_objects', (SELECT pg_catalog.count(*) FROM eligible),
      'candidates_total', (SELECT pg_catalog.count(*) FROM orphans),
      'candidates_bytes', (SELECT COALESCE(pg_catalog.sum(size), 0) FROM orphans),
      'candidates', COALESCE((
        SELECT pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object('name', l.name, 'size', l.size, 'created_at', l.created_at, 'updated_at', l.touched_at)
                 ORDER BY l.touched_at, l.name)
          FROM (SELECT * FROM orphans ORDER BY touched_at, name LIMIT %6$s) l
      ), '[]'::pg_catalog.jsonb)
    )
  $q$, c_token, v_sources, _bucket, c_name, _min_age_days, _max_candidates)
  INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cleanup_media_candidates(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_media_candidates(TEXT, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- 3) Trabajos de pg_cron (usan pasify_schedule_internal_call, 20260928160000)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.schedule_ai_anomaly_detector()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-ai-anomaly-detector',
    '30 6 * * *',
    'ai-anomaly-detector',
    '{}'::jsonb,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_industry_benchmarks()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-industry-benchmarks',
    '30 3 * * *',
    'industry-benchmarks-recompute',
    '{}'::jsonb,
    NULL
  );
END;
$$;

-- _dry_run = TRUE (por defecto): la función solo registra qué borraría.
-- schedule_cleanup_media(false) la pasa a borrar de verdad.
CREATE OR REPLACE FUNCTION public.schedule_cleanup_media(_dry_run BOOLEAN DEFAULT TRUE)
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-cleanup-media',
    '30 5 * * 0',
    'cleanup-media',
    jsonb_build_object('dry_run', COALESCE(_dry_run, TRUE)),
    NULL
  );
END;
$$;

-- Los tres de golpe. cleanup-media siempre en modo prueba: si ya lo habías pasado a
-- borrar de verdad, vuelve a prueba (el lado seguro); repite schedule_cleanup_media(false).
CREATE OR REPLACE FUNCTION public.schedule_ia_functions()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN concat_ws(E'\n',
    public.schedule_ai_anomaly_detector(),
    public.schedule_industry_benchmarks(),
    public.schedule_cleanup_media(TRUE)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_ai_anomaly_detector() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_industry_benchmarks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_cleanup_media(BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_ia_functions() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4) Programarlos si Vault ya tiene el secreto
-- ============================================================================
DO $$
DECLARE
  v_ready BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret') INTO v_ready;
  EXCEPTION WHEN OTHERS THEN
    v_ready := FALSE;
  END;

  IF v_ready AND to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    v_ready := FALSE;
    RAISE NOTICE 'pg_cron no está instalada: los trabajos de IA y mantenimiento quedan sin programar.';
  ELSIF v_ready THEN
    RAISE NOTICE '%', public.schedule_ia_functions();
  ELSE
    RAISE NOTICE 'IA y mantenimiento sin programar: falta el secreto pasify_internal_secret en Vault. Tras crearlo: SELECT public.schedule_ia_functions(); (cleanup-media empieza en modo prueba; para borrar de verdad: SELECT public.schedule_cleanup_media(false);)';
  END IF;
END $$;
