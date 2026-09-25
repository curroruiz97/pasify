-- Pasify · Ola 3 · avisos que salen de verdad (migración 20260928160000):
-- cola de envíos y su reparto (T1), enlaces y ráfagas de soporte, purga,
-- aviso al admin de soporte por pg_net (T2), monitorización (T4),
-- reembolsos atascados (T5) y local nuevo (T6).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción; el ROLLBACK de este fichero las deshace también):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" -f supabase/migrations/<cada una> \
--     -f tests/db/o3_avisos.sql -c "ROLLBACK;"
--
-- Crea secretos de prueba en Vault dentro de la transacción (si ya hay
-- pasify_internal_secret, usa ese) y mira las peticiones que pg_net deja en
-- net.http_request_queue: con el ROLLBACK no sale ninguna.

BEGIN;

DO $$
DECLARE
  v_client    UUID := gen_random_uuid();
  v_client2   UUID := gen_random_uuid();
  v_partner   UUID := gen_random_uuid();
  v_admin     UUID := gen_random_uuid();
  v_admin2    UUID := gen_random_uuid();
  v_org       UUID;
  v_event     UUID;
  v_n1        UUID;
  v_n2        UUID;
  v_n3        UUID;
  v_n4        UUID;
  v_n5        UUID;
  v_n6        UUID;
  v_conv      UUID;
  v_pconv     UUID;
  v_cpconv    UUID;
  v_msg       UUID;
  v_t         UUID[];
  v_r         UUID[] := ARRAY[]::UUID[];
  v_ids       UUID[];
  v_count     INT;
  v_int       INT;
  v_text      TEXT;
  v_rec       RECORD;
  v_secret    TEXT;
  v_base      TEXT;
  v_had_secret BOOLEAN;
  v_had_url   BOOLEAN;
  v_req       BIGINT;
  v_cmd       TEXT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_client,  'o3-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client2, 'o3-client2-' || v_client2 || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_partner, 'o3-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,   'o3-admin-'   || v_admin   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin2,  'o3-admin2-'  || v_admin2  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin'), (v_admin2, 'admin') ON CONFLICT DO NOTHING;

  v_had_secret := EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret');
  v_had_url := EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_project_url');

  -- ==================================================================
  -- Permisos
  -- ==================================================================
  FOR v_text IN SELECT unnest(ARRAY[
      'public.pasify_functions_base_url()',
      'public.pasify_internal_post(text,jsonb)',
      'public.pasify_schedule_internal_call(text,text,text,jsonb,text)',
      'public.claim_notification_dispatches(integer,uuid,integer,integer)',
      'public.schedule_dispatch_notifications()',
      'public.schedule_health_check()',
      'public.schedule_retake_stale_refunds()',
      'public.record_service_status(jsonb)',
      'public.refunds_to_retake(integer,uuid[])',
      'public.cron_cleanup_old_notifications()',
      'public.notifications_queue_dispatch()',
      'public.support_notify_reply()',
      'public.support_notify_admin()',
      'public.organizations_notify_new_partner()'])
  LOOP
    IF has_function_privilege('anon', v_text, 'EXECUTE') OR has_function_privilege('authenticated', v_text, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL % la ejecuta un cliente', v_text;
    END IF;
  END LOOP;
  FOR v_text IN SELECT unnest(ARRAY[
      'public.claim_notification_dispatches(integer,uuid,integer,integer)',
      'public.record_service_status(jsonb)',
      'public.refunds_to_retake(integer,uuid[])',
      'public.cron_cleanup_old_notifications()'])
  LOOP
    IF NOT has_function_privilege('service_role', v_text, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL service_role no ejecuta %', v_text;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM pg_proc
   WHERE prosecdef
     AND oid IN ('public.notifications_queue_dispatch()'::regprocedure,
                 'public.support_notify_admin()'::regprocedure,
                 'public.organizations_notify_new_partner()'::regprocedure,
                 'public.support_notify_reply()'::regprocedure);
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL los triggers nuevos no son SECURITY DEFINER (%)', v_count; END IF;

  -- ==================================================================
  -- T1 · Cada aviso nuevo deja sus envíos pendientes
  -- ==================================================================
  v_n1 := public.enqueue_notification(v_client, 'tickets', 'o3_test', 'Aviso normal', 'Cuerpo', '/#/client-dashboard', '{}'::jsonb, 'normal');
  SELECT array_agg(d.channel::text ORDER BY d.channel::text) INTO v_text
    FROM public.notification_dispatches d
   WHERE d.notification_id = v_n1 AND d.status = 'pending' AND d.attempt_count = 0 AND d.next_retry_at <= now();
  IF v_text IS DISTINCT FROM '{email}' THEN RAISE EXCEPTION 'FAIL aviso normal sin dispositivos: %', v_text; END IF;

  -- Con un dispositivo, también push
  INSERT INTO public.user_fcm_tokens (user_id, fcm_token, platform) VALUES (v_client2, 'o3-token-' || v_client2, 'android');
  v_n2 := public.enqueue_notification(v_client2, 'events', 'o3_test', 'Con push', NULL, NULL, '{}'::jsonb, 'normal');
  SELECT array_agg(d.channel::text ORDER BY d.channel::text) INTO v_text
    FROM public.notification_dispatches d WHERE d.notification_id = v_n2 AND d.status = 'pending';
  IF v_text IS DISTINCT FROM '{email,push}' THEN RAISE EXCEPTION 'FAIL aviso con dispositivo: %', v_text; END IF;

  -- Crítico: también SMS
  v_n3 := public.enqueue_notification(v_client, 'security', 'o3_test', 'Crítico', NULL, NULL, '{}'::jsonb, 'critical');
  SELECT array_agg(d.channel::text ORDER BY d.channel::text) INTO v_text
    FROM public.notification_dispatches d WHERE d.notification_id = v_n3 AND d.status = 'pending';
  IF v_text IS DISTINCT FROM '{email,sms}' THEN RAISE EXCEPTION 'FAIL aviso crítico: %', v_text; END IF;

  -- Un INSERT directo (admin, edge function) también entra en la cola
  INSERT INTO public.notifications (user_id, category, kind, title) VALUES (v_client2, 'system', 'o3_test', 'Directo')
  RETURNING id INTO v_n4;
  IF NOT EXISTS (SELECT 1 FROM public.notification_dispatches WHERE notification_id = v_n4 AND channel = 'email' AND status = 'pending') THEN
    RAISE EXCEPTION 'FAIL un INSERT directo no deja su envío pendiente';
  END IF;

  -- ==================================================================
  -- T1 · Reparto: cada envío a una sola ejecución
  -- ==================================================================
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(1, v_n2, 300, 6);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el límite por pasada no se respeta (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n2, 300, 6);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la segunda pasada no se lleva el envío que quedaba (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n2, 300, 6);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un envío apartado se reparte dos veces (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notification_dispatches
   WHERE notification_id = v_n2 AND status = 'pending' AND attempt_count = 1
     AND next_retry_at > now() + INTERVAL '250 seconds' AND next_retry_at <= now() + INTERVAL '300 seconds';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el reparto no suma el intento ni aparta el envío (%)', v_count; END IF;

  -- Lo que devuelve: id del envío, aviso, canal e intento
  SELECT * INTO v_rec FROM public.claim_notification_dispatches(10, v_n1, 120, 6);
  IF v_rec.notification_id IS DISTINCT FROM v_n1 OR v_rec.channel IS DISTINCT FROM 'email' OR v_rec.attempt_count IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM public.notification_dispatches WHERE id = v_rec.dispatch_id AND next_retry_at <= now() + INTERVAL '120 seconds') THEN
    RAISE EXCEPTION 'FAIL resultado del reparto: %', row_to_json(v_rec);
  END IF;

  -- Reintento pendiente: no antes de su hora; a su hora, con un intento más
  UPDATE public.notification_dispatches SET attempt_count = 2, next_retry_at = now() + INTERVAL '5 minutes', error_message = 'Resend send failed: 503'
   WHERE notification_id = v_n4;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n4, 300, 6);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un reintento se adelanta a su next_retry_at'; END IF;
  UPDATE public.notification_dispatches SET next_retry_at = now() - INTERVAL '1 second' WHERE notification_id = v_n4;
  SELECT attempt_count INTO v_int FROM public.claim_notification_dispatches(10, v_n4, 300, 6);
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL el reintento vencido no se reparte con su intento (%)', v_int; END IF;

  -- Intentos agotados (la ejecución se cortó): 'failed', no se reparte
  UPDATE public.notification_dispatches SET attempt_count = 6, next_retry_at = now() - INTERVAL '1 second' WHERE notification_id = v_n4;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n4, 300, 6);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL se reparte un envío con los intentos agotados'; END IF;
  SELECT status::text || '|' || error_message INTO v_text FROM public.notification_dispatches WHERE notification_id = v_n4;
  IF v_text IS DISTINCT FROM 'failed|Resend send failed: 503 · max_attempts' THEN RAISE EXCEPTION 'FAIL envío agotado: %', v_text; END IF;

  -- Caducado: un aviso de hace 3 días que no salió ya no se manda
  v_n5 := public.enqueue_notification(v_client, 'tickets', 'o3_test', 'Viejo', NULL, NULL, '{}'::jsonb, 'normal');
  UPDATE public.notifications SET created_at = now() - INTERVAL '3 days' WHERE id = v_n5;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n5, 300, 6);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL se reparte un aviso caducado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_dispatches WHERE notification_id = v_n5 AND status = 'skipped' AND error_message = 'expired' AND next_retry_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL el aviso caducado no queda como skipped/expired';
  END IF;
  -- Y uno con expires_at vencido, tampoco
  v_n6 := public.enqueue_notification(v_client, 'tickets', 'o3_test', 'Expira', NULL, NULL, '{}'::jsonb, 'normal');
  UPDATE public.notifications SET expires_at = now() - INTERVAL '1 minute' WHERE id = v_n6;
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(10, v_n6, 300, 6);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL se reparte un aviso con expires_at vencido'; END IF;

  -- Sin aviso concreto reparte de todos (el lote del cron): email y push
  -- (client2 tiene un dispositivo)
  v_n6 := public.enqueue_notification(v_client2, 'tickets', 'o3_test', 'Del lote', NULL, NULL, '{}'::jsonb, 'normal');
  SELECT count(*) INTO v_count FROM public.claim_notification_dispatches(200, NULL, 300, 6) c WHERE c.notification_id = v_n6;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el lote sin aviso concreto no reparte (%)', v_count; END IF;

  -- ==================================================================
  -- T2 · Soporte sin secreto en Vault: el mensaje se guarda y no llama a nadie
  -- ==================================================================
  INSERT INTO public.support_conversations (client_id, kind, status) VALUES (v_client, 'client_admin', 'open') RETURNING id INTO v_conv;
  IF NOT v_had_secret THEN
    SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
    INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
    VALUES (v_conv, v_client, 'client', 'Hola, sin secreto') RETURNING id INTO v_msg;
    IF v_msg IS NULL THEN RAISE EXCEPTION 'FAIL el mensaje sin secreto no se guardó'; END IF;
    IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
      RAISE EXCEPTION 'FAIL sin secreto se llamó a una edge function';
    END IF;
    IF public.pasify_internal_post('notify-admin-message', '{}'::jsonb) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL pasify_internal_post sin secreto devolvió una petición';
    END IF;
    -- Sin secreto no se programa nada
    BEGIN
      PERFORM public.schedule_dispatch_notifications();
      RAISE EXCEPTION 'FAIL schedule_dispatch_notifications sin secreto no falló';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Falta el secreto pasify_internal_secret%' THEN
        RAISE EXCEPTION 'FAIL error inesperado sin secreto: %', SQLERRM;
      END IF;
    END;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('pasify-dispatch-notifications', 'pasify-health-check', 'pasify-retake-stale-refunds')) THEN
      RAISE EXCEPTION 'FAIL la migración programó trabajos sin el secreto';
    END IF;
    -- Se vuelve a empezar: contador del admin a cero
    UPDATE public.support_conversations SET unread_for_admin = 0 WHERE id = v_conv;

    PERFORM vault.create_secret('o3-test-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'pasify_internal_secret');
  END IF;
  IF NOT v_had_url THEN
    PERFORM vault.create_secret('https://o3-test.supabase.co/', 'pasify_project_url');
  END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret' LIMIT 1;
  v_base := public.pasify_functions_base_url();
  IF NOT v_had_url AND v_base IS DISTINCT FROM 'https://o3-test.supabase.co/functions/v1/' THEN
    RAISE EXCEPTION 'FAIL URL de las edge functions: %', v_base;
  END IF;

  -- Nombre de función raro: nada
  IF public.pasify_internal_post('../rest/v1', '{}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL pasify_internal_post aceptó un nombre de función no válido';
  END IF;

  -- ==================================================================
  -- T2 · Mensaje de un usuario con el contador del admin de 0 a 1
  -- ==================================================================
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_client, 'client', 'Tengo un problema con mi entrada') RETURNING id INTO v_msg;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req
     AND q.method = 'POST'
     AND q.url = v_base || 'notify-admin-message'
     AND q.headers->>'x-pasify-internal' = v_secret
     AND convert_from(q.body, 'UTF8')::jsonb = jsonb_build_object('message_id', v_msg);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el primer mensaje sin leer no avisa al admin (%)', v_count; END IF;

  -- Segundo mensaje sin leer (contador 2): sin otro email
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_client, 'client', 'Os lo cuento mejor');
  IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
    RAISE EXCEPTION 'FAIL cada mensaje manda un email al admin';
  END IF;

  -- La respuesta del admin no avisa al admin; avisa al cliente, con enlace a su Soporte
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_admin, 'admin', 'Hola, lo miramos ahora mismo');
  IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
    RAISE EXCEPTION 'FAIL la respuesta del admin llamó a notify-admin-message';
  END IF;
  SELECT count(*), max(link) INTO v_count, v_text FROM public.notifications
   WHERE user_id = v_client AND kind = 'support_reply' AND payload->>'conversation_id' = v_conv::text;
  IF v_count <> 1 OR v_text IS DISTINCT FROM '/#/client-dashboard/support' THEN
    RAISE EXCEPTION 'FAIL aviso de respuesta al cliente: % · %', v_count, v_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_dispatches d JOIN public.notifications n ON n.id = d.notification_id
                  WHERE n.user_id = v_client AND n.kind = 'support_reply' AND d.channel = 'email' AND d.status = 'pending') THEN
    RAISE EXCEPTION 'FAIL la respuesta de soporte no queda pendiente de envío';
  END IF;

  -- Ráfaga: otra respuesta en menos de 10 minutos no es otro aviso
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_admin, 'admin', 'Ya está: te hemos reenviado la entrada');
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_client AND kind = 'support_reply';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL cada respuesta seguida es un aviso (%)', v_count; END IF;
  -- Pasados 10 minutos, sí
  UPDATE public.notifications SET created_at = now() - INTERVAL '11 minutes' WHERE user_id = v_client AND kind = 'support_reply';
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_admin, 'admin', '¿Te ha llegado?');
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_client AND kind = 'support_reply';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL tras 10 minutos la respuesta no avisa (%)', v_count; END IF;

  -- El admin lo lee (contador a 0) y el usuario vuelve a escribir: otro email
  UPDATE public.support_conversations SET unread_for_admin = 0 WHERE id = v_conv;
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_client, 'client', 'Gracias, ya la tengo') RETURNING id INTO v_msg;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req AND q.url = v_base || 'notify-admin-message'
     AND convert_from(q.body, 'UTF8')::jsonb->>'message_id' = v_msg::text;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL tras leerlo el admin, el siguiente mensaje no avisa (%)', v_count; END IF;

  -- Local ↔ Pasify: también avisa; la respuesta lleva al Soporte del local
  INSERT INTO public.support_conversations (client_id, kind, partner_id, status)
  VALUES (v_partner, 'partner_admin', v_partner, 'open') RETURNING id INTO v_pconv;
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_pconv, v_partner, 'client', 'Duda sobre una liquidación');
  SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_req AND url = v_base || 'notify-admin-message';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el mensaje del local no avisa al admin (%)', v_count; END IF;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_pconv, v_admin, 'admin', 'Te lo explicamos');
  SELECT link INTO v_text FROM public.notifications WHERE user_id = v_partner AND kind = 'support_reply';
  IF v_text IS DISTINCT FROM '/#/partner-dashboard/soporte' THEN RAISE EXCEPTION 'FAIL enlace del aviso al local: %', v_text; END IF;

  -- Cliente ↔ local: no es cosa del admin
  INSERT INTO public.support_conversations (client_id, kind, partner_id, status)
  VALUES (v_client2, 'client_partner', v_partner, 'open') RETURNING id INTO v_cpconv;
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_cpconv, v_client2, 'client', '¿A qué hora abrís?');
  IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
    RAISE EXCEPTION 'FAIL una conversación cliente-local avisa al admin de Pasify';
  END IF;

  -- ==================================================================
  -- T1 · pg_cron: dispatch-notification cada minuto, solo si hay algo
  -- ==================================================================
  v_text := public.schedule_dispatch_notifications();
  SELECT j.schedule, j.command INTO v_rec FROM cron.job j WHERE j.jobname = 'pasify-dispatch-notifications';
  IF v_rec.schedule IS DISTINCT FROM '* * * * *'
     OR v_rec.command NOT LIKE '%' || v_base || 'dispatch-notification%'
     OR v_rec.command NOT LIKE '%x-pasify-internal%'
     OR v_rec.command NOT LIKE '%pasify_internal_secret%'
     OR v_rec.command NOT LIKE '%notification_dispatches%'
     OR position(v_secret IN v_rec.command) > 0 THEN
    RAISE EXCEPTION 'FAIL trabajo de dispatch-notification: % · %', v_rec.schedule, v_rec.command;
  END IF;
  v_cmd := v_rec.command;
  -- Con envíos vencidos, llama con la cabecera interna
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_cmd;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req AND q.url = v_base || 'dispatch-notification'
     AND q.headers->>'x-pasify-internal' = v_secret
     AND convert_from(q.body, 'UTF8')::jsonb->>'mode' = 'batch';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cron con envíos pendientes no llama (%)', v_count; END IF;
  -- Sin nada vencido, no gasta una invocación
  UPDATE public.notification_dispatches SET next_retry_at = now() + INTERVAL '1 hour' WHERE status = 'pending';
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_cmd;
  IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
    RAISE EXCEPTION 'FAIL el cron llama sin nada pendiente';
  END IF;
  -- Repetirlo no duplica el trabajo
  PERFORM public.schedule_dispatch_notifications();
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'pasify-dispatch-notifications';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL trabajos duplicados (%)', v_count; END IF;

  -- ==================================================================
  -- Purga: leídos a los 90 días, todos a los 180
  -- ==================================================================
  INSERT INTO public.notifications (user_id, category, kind, title, read_at, created_at) VALUES
    (v_client2, 'system', 'o3_purga', 'leido-100', now() - INTERVAL '99 days', now() - INTERVAL '100 days'),
    (v_client2, 'system', 'o3_purga', 'sinleer-100', NULL, now() - INTERVAL '100 days'),
    (v_client2, 'system', 'o3_purga', 'sinleer-200', NULL, now() - INTERVAL '200 days'),
    (v_client2, 'system', 'o3_purga', 'leido-10', now() - INTERVAL '9 days', now() - INTERVAL '10 days');
  PERFORM public.cron_cleanup_old_notifications();
  SELECT string_agg(title, ',' ORDER BY title) INTO v_text FROM public.notifications WHERE user_id = v_client2 AND kind = 'o3_purga';
  IF v_text IS DISTINCT FROM 'leido-10,sinleer-100' THEN RAISE EXCEPTION 'FAIL purga de avisos: %', v_text; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cron_runs WHERE job_name = 'cleanup_old_notifications' AND status = 'success' AND started_at = now()) THEN
    RAISE EXCEPTION 'FAIL la purga no deja su cron_runs';
  END IF;

  -- ==================================================================
  -- T4 · Estado de los servicios y health-check cada 15 minutos
  -- ==================================================================
  SELECT count(*) INTO v_count FROM public.record_service_status(
    '[{"service":"o3_a","status":"operational","latency_ms":12},{"service":"o3_b","status":"degraded","message":"status_401"}]'::jsonb) r
   WHERE r.previous_status IS NULL AND r.previous_at IS NULL AND r.service IN ('o3_a', 'o3_b');
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL primera pasada: estado anterior inesperado (%)', v_count; END IF;
  SELECT string_agg(r.service || '=' || r.previous_status, ',' ORDER BY r.service) INTO v_text
    FROM public.record_service_status(
      '[{"service":"o3_a","status":"major_outage","latency_ms":"x"},{"service":"o3_b","status":"operational"}]'::jsonb) r;
  IF v_text IS DISTINCT FROM 'o3_a=operational,o3_b=degraded' THEN RAISE EXCEPTION 'FAIL segunda pasada: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.service_status_snapshots WHERE service IN ('o3_a', 'o3_b');
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL snapshots guardados: %', v_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_status_snapshots WHERE service = 'o3_b' AND status = 'degraded' AND message = 'status_401')
     OR NOT EXISTS (SELECT 1 FROM public.service_status_snapshots WHERE service = 'o3_a' AND status = 'major_outage' AND latency_ms IS NULL) THEN
    RAISE EXCEPTION 'FAIL contenido de los snapshots';
  END IF;
  BEGIN
    PERFORM public.record_service_status('{"service":"o3_a"}'::jsonb);
    RAISE EXCEPTION 'FAIL record_service_status aceptó algo que no es una lista';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  PERFORM public.schedule_health_check();
  SELECT j.schedule, j.command INTO v_rec FROM cron.job j WHERE j.jobname = 'pasify-health-check';
  IF v_rec.schedule IS DISTINCT FROM '*/15 * * * *' OR v_rec.command NOT LIKE '%' || v_base || 'health-check%' THEN
    RAISE EXCEPTION 'FAIL trabajo de health-check: % · %', v_rec.schedule, v_rec.command;
  END IF;
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_rec.command;
  SELECT count(*) INTO v_count FROM net.http_request_queue q
   WHERE q.id > v_req AND q.url = v_base || 'health-check' AND q.headers->>'x-pasify-internal' = v_secret;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cron de health-check no llama en modo interno (%)', v_count; END IF;

  -- ==================================================================
  -- T5 · Reembolsos atascados
  -- ==================================================================
  INSERT INTO public.events (partner_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, 'O3 Evento', 'Madrid', now() + INTERVAL '2 days', now() + INTERVAL '2 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event;
  WITH t AS (
    INSERT INTO public.tickets (event_id, buyer_user_id, buyer_email, status, amount_paid_cents)
    SELECT v_event, v_client, 'o3-client@pasify.test', 'paid', 1000 FROM generate_series(1, 6)
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_t FROM t;
  -- r1 processing hace 20 min · r2 processing ahora · r3 approved hace 30 min
  -- r4 approved hace 3 días · r5 processing con reembolso de Stripe · r6 failed
  FOR v_int IN 1..6 LOOP
    INSERT INTO public.refund_requests (ticket_id, event_id, requester_user_id, requester_email, amount_cents, reason, status, stripe_refund_id, updated_at)
    VALUES (v_t[v_int], v_event, v_client, 'o3-client@pasify.test', 1000, 'o3',
            (ARRAY['processing', 'processing', 'approved', 'approved', 'processing', 'failed'])[v_int]::public.refund_request_status_t,
            CASE WHEN v_int = 5 THEN 're_o3_' || v_t[v_int] END,
            now() - (ARRAY[INTERVAL '20 minutes', INTERVAL '0 minutes', INTERVAL '30 minutes', INTERVAL '3 days', INTERVAL '1 hour', INTERVAL '1 hour'])[v_int])
    RETURNING id INTO v_msg;
    v_r := v_r || v_msg;
  END LOOP;
  SELECT array_agg(x.request_id ORDER BY x.ord) INTO v_ids
    FROM (SELECT request_id, row_number() OVER () AS ord FROM public.refunds_to_retake(50)) x
   WHERE x.request_id = ANY (v_r);
  IF v_ids IS DISTINCT FROM ARRAY[v_r[3], v_r[1]] THEN RAISE EXCEPTION 'FAIL reembolsos a retomar: %', v_ids; END IF;
  SELECT array_agg(x.status ORDER BY x.status) INTO v_text
    FROM public.refunds_to_retake(50) x WHERE x.request_id = ANY (v_r);
  IF v_text IS DISTINCT FROM '{approved,processing}' THEN RAISE EXCEPTION 'FAIL estados a retomar: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.refunds_to_retake(50, ARRAY[v_r[3]]) x WHERE x.request_id = ANY (v_r);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL _exclude no aparta los ya vistos (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.refunds_to_retake(1);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el límite del lote no se respeta (%)', v_count; END IF;

  PERFORM public.schedule_retake_stale_refunds();
  SELECT j.schedule, j.command INTO v_rec FROM cron.job j WHERE j.jobname = 'pasify-retake-stale-refunds';
  IF v_rec.schedule IS DISTINCT FROM '*/10 * * * *' OR v_rec.command NOT LIKE '%' || v_base || 'retake-stale-refunds%'
     OR v_rec.command NOT LIKE '%refunds_to_retake%' THEN
    RAISE EXCEPTION 'FAIL trabajo de retake-stale-refunds: % · %', v_rec.schedule, v_rec.command;
  END IF;
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_rec.command;
  SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_req AND url = v_base || 'retake-stale-refunds';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cron con reembolsos atascados no llama (%)', v_count; END IF;
  -- Retomadas (updated_at al día): sin nada que hacer, no llama
  UPDATE public.refund_requests SET stripe_failure_reason = stripe_failure_reason
   WHERE id IN (SELECT request_id FROM public.refunds_to_retake(50));
  SELECT COALESCE(max(id), 0) INTO v_req FROM net.http_request_queue;
  EXECUTE v_rec.command;
  IF EXISTS (SELECT 1 FROM net.http_request_queue WHERE id > v_req AND url LIKE '%/functions/v1/%') THEN
    RAISE EXCEPTION 'FAIL el cron de reembolsos llama sin nada atascado';
  END IF;

  -- ==================================================================
  -- T6 · Local nuevo → aviso a cada admin de plataforma
  -- ==================================================================
  UPDATE public.profiles SET business_city = 'Sevilla', business_category = 'discoteca' WHERE id = v_partner;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O3 Sala Nueva', 'ES', NULL);
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.notifications
   WHERE kind = 'partner_registered' AND payload->>'org_id' = v_org::text AND user_id IN (v_admin, v_admin2)
     AND category = 'system' AND link = '/#/admin'
     AND title = 'Nuevo local en Pasify: O3 Sala Nueva'
     AND body LIKE 'discoteca · Sevilla · o3-partner-%@pasify.test. Ya puede publicar eventos y vender.%';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL avisos de local nuevo a los admins (%)', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'partner_registered' AND user_id = v_partner) THEN
    RAISE EXCEPTION 'FAIL el propio local recibe el aviso de local nuevo';
  END IF;
  SELECT count(*) INTO v_count FROM public.notification_dispatches d
    JOIN public.notifications n ON n.id = d.notification_id
   WHERE n.kind = 'partner_registered' AND n.payload->>'org_id' = v_org::text AND n.user_id IN (v_admin, v_admin2)
     AND d.channel = 'email' AND d.status = 'pending';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el aviso de local nuevo no queda pendiente de email (%)', v_count; END IF;

  RAISE NOTICE 'PASS o3_avisos: cola de envíos (reparto, reintentos, caducidad), soporte (admin 0→1, enlaces, ráfagas), purga, cron con Vault, estado de servicios, reembolsos atascados y local nuevo';
END $$;

ROLLBACK;
