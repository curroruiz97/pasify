-- Pasify · IA y mantenimiento (migración 20261013140000_ia_functions_cron):
-- capacidad «moderation», cleanup_media_candidates (qué ficheros de Storage no
-- usa nadie) y los trabajos de pg_cron de ai-anomaly-detector,
-- industry-benchmarks-recompute y cleanup-media.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción; el ROLLBACK de este fichero las deshace también):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" -f supabase/migrations/<cada una> \
--     -f tests/db/o5_ia_functions.sql -c "ROLLBACK;"
--
-- Crea secretos de prueba en Vault dentro de la transacción (si ya hay
-- pasify_internal_secret, usa ese) y mira las peticiones que pg_net deja en
-- net.http_request_queue: con el ROLLBACK no sale ninguna. Los ficheros de
-- Storage que inserta se deshacen con el ROLLBACK (la API de Storage no
-- interviene: el test solo comprueba la consulta SQL).

BEGIN;

DO $$
DECLARE
  v_a          UUID := gen_random_uuid();
  v_b          UUID := gen_random_uuid();
  v_url        TEXT := 'https://o5-test.supabase.co/storage/v1/object/public/avatars/';
  v_r          JSONB;
  v_names      TEXT[];
  v_rec        RECORD;
  v_count      INT;
  v_before     INT;
  v_text       TEXT;
  v_cmd        TEXT;
  v_req        BIGINT;
  v_secret     TEXT;
  v_base       TEXT;
  v_had_secret BOOLEAN;
  v_had_url    BOOLEAN;
BEGIN
  -- ==================================================================
  -- 1) Capacidad «moderation» y su interruptor
  -- ==================================================================
  IF NOT EXISTS (SELECT 1 FROM public.ai_capabilities WHERE code = 'moderation' AND provider = 'openai') THEN
    RAISE EXCEPTION 'FAIL falta la capacidad moderation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_kill_switches WHERE capability_code = 'moderation' AND killed = FALSE) THEN
    RAISE EXCEPTION 'FAIL falta el interruptor de moderation (o nace parado)';
  END IF;

  -- ==================================================================
  -- 2) Permisos: solo service_role ejecuta cleanup_media_candidates;
  --    los schedule_* no son de anon ni de authenticated
  -- ==================================================================
  IF has_function_privilege('anon', 'public.cleanup_media_candidates(text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cleanup_media_candidates(text,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cleanup_media_candidates(text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL permisos de cleanup_media_candidates';
  END IF;
  FOR v_text IN SELECT unnest(ARRAY[
    'public.schedule_ia_functions()', 'public.schedule_ai_anomaly_detector()',
    'public.schedule_industry_benchmarks()', 'public.schedule_cleanup_media(boolean)'
  ]) LOOP
    IF has_function_privilege('anon', v_text, 'EXECUTE') OR has_function_privilege('authenticated', v_text, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL % es ejecutable por anon o authenticated', v_text;
    END IF;
  END LOOP;

  -- ==================================================================
  -- 3) cleanup_media_candidates
  -- ==================================================================
  -- Referenciados de formas distintas (la función mira todas las columnas de texto y JSON)
  INSERT INTO public.audit_logs (action, after)
  VALUES ('o5_ref_url', jsonb_build_object('url', v_url || v_a || '/avatar-ref-url.jpg?t=1'));
  INSERT INTO public.audit_logs (action, before)
  VALUES ('o5_ref_ruta', jsonb_build_object('path', v_a || '/avatar-ref-ruta.jpg'));
  INSERT INTO public.moderation_flags (target_kind, reason, details)
  VALUES ('o5', 'prueba', 'mirad ' || v_url || upper(v_a::text) || '/avatar-ref-texto.jpg. Gracias');

  INSERT INTO storage.objects (bucket_id, name, created_at, updated_at, metadata) VALUES
    ('avatars', v_a || '/avatar-ref-url.jpg',      now() - INTERVAL '60 days', now() - INTERVAL '60 days', '{"size": 100}'),
    ('avatars', v_a || '/avatar-ref-ruta.jpg',     now() - INTERVAL '60 days', now() - INTERVAL '60 days', '{"size": 100}'),
    ('avatars', v_a || '/avatar-ref-texto.jpg',    now() - INTERVAL '60 days', now() - INTERVAL '60 days', '{"size": 100}'),
    ('avatars', v_a || '/avatar-huerfano.jpg',     now() - INTERVAL '60 days', now() - INTERVAL '60 days', '{"size": 2048}'),
    ('avatars', v_b || '/logo/170-abc.webp',       now() - INTERVAL '45 days', now() - INTERVAL '45 days', '{"size": 4096}'),
    ('avatars', v_a || '/avatar-reciente.jpg',     now() - INTERVAL '10 days', now() - INTERVAL '10 days', '{"size": 100}'),
    ('avatars', 'o5-sin-uuid-' || v_a || '.png',   now() - INTERVAL '90 days', now() - INTERVAL '90 days', '{"size": 100}'),
    ('event-images', v_a || '/evento-huerfano.jpg', now() - INTERVAL '60 days', now() - INTERVAL '60 days', '{"size": 100}');
  SELECT count(*) INTO v_before FROM storage.objects;

  v_r := public.cleanup_media_candidates('avatars', 30, 1000);
  IF v_r->>'bucket' IS DISTINCT FROM 'avatars' THEN RAISE EXCEPTION 'FAIL bucket de la respuesta: %', v_r->>'bucket'; END IF;
  -- Solo miramos los ficheros de este test (la base puede traer otros)
  SELECT array_agg(c->>'name' ORDER BY c->>'name') INTO v_names
    FROM jsonb_array_elements(v_r->'candidates') c
   WHERE (c->>'name') LIKE v_a || '/%' OR (c->>'name') LIKE v_b || '/%' OR (c->>'name') LIKE '%' || v_a || '%';
  IF v_names IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[v_a || '/avatar-huerfano.jpg', v_b || '/logo/170-abc.webp']::TEXT[]) x) THEN
    RAISE EXCEPTION 'FAIL candidatos: %', v_names;
  END IF;
  IF (v_r->>'candidates_total')::INT < 2 OR (v_r->>'eligible_objects')::INT < 5 OR (v_r->>'total_objects')::INT < 7 THEN
    RAISE EXCEPTION 'FAIL totales: %', v_r - 'candidates';
  END IF;
  IF (SELECT (c->>'size')::INT FROM jsonb_array_elements(v_r->'candidates') c WHERE c->>'name' = v_a || '/avatar-huerfano.jpg') <> 2048 THEN
    RAISE EXCEPTION 'FAIL tamaño del candidato';
  END IF;

  -- Con 7 días entra el de 10 días; el tope recorta la lista pero no el total
  v_r := public.cleanup_media_candidates('avatars', 7, 1000);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'candidates') c WHERE c->>'name' = v_a || '/avatar-reciente.jpg') THEN
    RAISE EXCEPTION 'FAIL con 7 días no entra el de 10';
  END IF;
  v_r := public.cleanup_media_candidates('avatars', 30, 1);
  IF jsonb_array_length(v_r->'candidates') <> 1 OR (v_r->>'candidates_total')::INT < 2 THEN
    RAISE EXCEPTION 'FAIL tope de candidatos: %', v_r - 'candidates';
  END IF;

  -- Otro bucket permitido
  v_r := public.cleanup_media_candidates('event-images', 30, 1000);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'candidates') c WHERE c->>'name' = v_a || '/evento-huerfano.jpg') THEN
    RAISE EXCEPTION 'FAIL event-images';
  END IF;

  -- Una URL nueva en cualquier columna protege el fichero
  INSERT INTO public.audit_logs (action, after)
  VALUES ('o5_ref_nueva', jsonb_build_object('url', v_url || v_a || '/avatar-huerfano.jpg'));
  v_r := public.cleanup_media_candidates('avatars', 30, 1000);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_r->'candidates') c WHERE c->>'name' = v_a || '/avatar-huerfano.jpg') THEN
    RAISE EXCEPTION 'FAIL un fichero referenciado sigue saliendo como huérfano';
  END IF;

  -- Parámetros no válidos y buckets privados
  FOR v_rec IN SELECT * FROM (VALUES
    ('tickets', 30, 500), ('avatars', 6, 500), ('avatars', 30, 0), ('avatars', 30, 1001)
  ) AS t(b, d, m) LOOP
    BEGIN
      PERFORM public.cleanup_media_candidates(v_rec.b, v_rec.d, v_rec.m);
      RAISE EXCEPTION 'FAIL cleanup_media_candidates(%, %, %) no falló', v_rec.b, v_rec.d, v_rec.m;
    EXCEPTION WHEN invalid_parameter_value THEN
      NULL;
    END;
  END LOOP;

  -- La función no borra nada
  IF (SELECT count(*) FROM storage.objects) <> v_before THEN
    RAISE EXCEPTION 'FAIL cleanup_media_candidates modificó storage.objects';
  END IF;

  -- ==================================================================
  -- 4) pg_cron: sin secreto no programa; con secreto, tres trabajos
  -- ==================================================================
  v_had_secret := EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret');
  v_had_url := EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_project_url');
  IF NOT v_had_secret THEN
    BEGIN
      PERFORM public.schedule_ia_functions();
      RAISE EXCEPTION 'FAIL schedule_ia_functions sin secreto no falló';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Falta el secreto pasify_internal_secret%' THEN
        RAISE EXCEPTION 'FAIL error inesperado sin secreto: %', SQLERRM;
      END IF;
    END;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('pasify-ai-anomaly-detector', 'pasify-industry-benchmarks', 'pasify-cleanup-media')) THEN
      RAISE EXCEPTION 'FAIL la migración programó trabajos sin el secreto';
    END IF;
    PERFORM vault.create_secret('o5-test-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'pasify_internal_secret');
  END IF;
  IF NOT v_had_url THEN
    PERFORM vault.create_secret('https://o5-test.supabase.co/', 'pasify_project_url');
  END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret' LIMIT 1;
  v_base := public.pasify_functions_base_url();

  v_text := public.schedule_ia_functions();
  IF array_length(string_to_array(v_text, E'\n'), 1) <> 3 THEN
    RAISE EXCEPTION 'FAIL schedule_ia_functions devolvió: %', v_text;
  END IF;

  FOR v_rec IN SELECT * FROM (VALUES
    ('pasify-ai-anomaly-detector',  '30 6 * * *', 'ai-anomaly-detector'),
    ('pasify-industry-benchmarks',  '30 3 * * *', 'industry-benchmarks-recompute'),
    ('pasify-cleanup-media',        '30 5 * * 0', 'cleanup-media')
  ) AS t(jobname, schedule, fn) LOOP
    SELECT count(*) INTO v_count FROM cron.job j
     WHERE j.jobname = v_rec.jobname AND j.schedule = v_rec.schedule
       AND j.command LIKE '%' || v_base || v_rec.fn || '%'
       AND j.command LIKE '%x-pasify-internal%'
       AND j.command LIKE '%pasify_internal_secret%'
       AND position(v_secret IN j.command) = 0;
    IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL trabajo % (%)', v_rec.jobname, v_count; END IF;
  END LOOP;

  -- cleanup-media nace en modo prueba y la petición lleva la cabecera interna
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'pasify-cleanup-media';
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_cmd;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req AND q.url = v_base || 'cleanup-media'
     AND q.headers->>'x-pasify-internal' = v_secret
     AND (convert_from(q.body, 'UTF8')::jsonb->>'dry_run') = 'true';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cron de cleanup-media no llama en modo prueba (%)', v_count; END IF;

  -- schedule_cleanup_media(false) lo pasa a borrar de verdad, sin duplicar el trabajo
  PERFORM public.schedule_cleanup_media(false);
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'pasify-cleanup-media';
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_cmd;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req AND q.url = v_base || 'cleanup-media'
     AND (convert_from(q.body, 'UTF8')::jsonb->>'dry_run') = 'false';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL schedule_cleanup_media(false) no cambia el cuerpo (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'pasify-cleanup-media';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL trabajos de cleanup-media duplicados (%)', v_count; END IF;

  -- Sin argumento, o con NULL, vuelve a prueba; schedule_ia_functions también
  PERFORM public.schedule_cleanup_media(NULL);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pasify-cleanup-media' AND command LIKE '%"dry_run": true%') THEN
    RAISE EXCEPTION 'FAIL schedule_cleanup_media(NULL) no vuelve a modo prueba';
  END IF;
  PERFORM public.schedule_cleanup_media(false);
  PERFORM public.schedule_ia_functions();
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pasify-cleanup-media' AND command LIKE '%"dry_run": true%') THEN
    RAISE EXCEPTION 'FAIL schedule_ia_functions no deja cleanup-media en modo prueba';
  END IF;
  SELECT count(*) INTO v_count FROM cron.job
   WHERE jobname IN ('pasify-ai-anomaly-detector', 'pasify-industry-benchmarks', 'pasify-cleanup-media');
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL trabajos duplicados tras repetir (%)', v_count; END IF;

  RAISE NOTICE 'OK o5_ia_functions';
END $$;

ROLLBACK;
