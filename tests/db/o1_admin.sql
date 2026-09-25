-- Pasify · panel de admin, ola 1: flag admin_showcase (B5-10), listados
-- paginados (B5-6), cola de reembolsos y reintento (B5-5), soporte que se
-- entera (B5-8, B5-1), una conversación abierta por usuario (B5-16) y la
-- auditoría de roles sin falsas escaladas (B5-13).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones de la rama base y la 20260926160000 en la misma
-- transacción):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" \
--     -f supabase/migrations/20260925110100_live_payments_guard.sql \
--     -f supabase/migrations/20260925110200_permissions_hardening.sql \
--     -f supabase/migrations/20260926150000_o1_local_eventos_y_tipos.sql \
--     -f supabase/migrations/20260926160000_o1_admin_panel_y_soporte.sql \
--     -f tests/db/o1_admin.sql -c "ROLLBACK;"

BEGIN;

DO $$
DECLARE
  v_admin    UUID := gen_random_uuid();
  v_admin2   UUID := gen_random_uuid();  -- admin que además tiene rol client
  v_admin3   UUID := gen_random_uuid();  -- admin que se borra
  v_client   UUID := gen_random_uuid();
  v_client2  UUID := gen_random_uuid();
  v_client3  UUID := gen_random_uuid();
  v_client4  UUID := gen_random_uuid();
  v_partner  UUID := gen_random_uuid();
  v_org      UUID;
  v_org2     UUID;
  v_event    UUID;
  v_t        UUID[] := ARRAY[]::UUID[];
  v_r        UUID[] := ARRAY[]::UUID[];
  v_tmp      UUID;
  v_c1       UUID;
  v_c2       UUID;
  v_c3       UUID;
  v_c4       UUID;
  v_c5       UUID;
  v_conv     UUID;
  v_conv2    UUID;
  v_count    INT;
  v_bool     BOOLEAN;
  v_text     TEXT;
  v_json     JSONB;
  v_row      RECORD;
  i          INT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_admin,   'o1adm-admin-'   || v_admin   || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin2,  'o1adm-admin2-'  || v_admin2  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin3,  'o1adm-admin3-'  || v_admin3  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o1adm-client-'  || v_client  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client2, 'o1adm-client2-' || v_client2 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client3, 'o1adm-client3-' || v_client3 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client4, 'o1adm-client4-' || v_client4 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_partner, 'o1adm-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- ------------------------------------------------------------------
  -- 7) Auditoría de roles (B5-13): el alta la hace el sistema, no un 'anon'
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM public.audit_logs a
   WHERE a.target_kind = 'user_roles'
     AND a.after->>'user_id' IN (v_client::text, v_partner::text);
  IF v_count < 2 THEN RAISE EXCEPTION 'FAIL el alta no deja rastro en audit_logs: %', v_count; END IF;
  SELECT count(*) INTO v_count
    FROM public.audit_logs a
   WHERE a.target_kind = 'user_roles'
     AND a.after->>'user_id' IN (v_client::text, v_partner::text)
     AND (a.actor_user_id IS NOT NULL OR a.actor_role IS DISTINCT FROM 'system');
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL el alta no sale como actor system (% filas)', v_count; END IF;

  -- Roles de admin (como el servidor: sin usuario en el JWT)
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin'), (v_admin3, 'admin');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin2, 'admin') ON CONFLICT DO NOTHING;
  IF NOT public.has_role(v_admin2, 'client') OR NOT public.has_role(v_admin2, 'admin') THEN
    RAISE EXCEPTION 'FAIL admin2 debería tener client y admin';
  END IF;

  -- admin2 (client + admin) da el rol de local a client3: actor 'admin', no un rol al azar
  PERFORM set_config('request.jwt.claim.sub', v_admin2::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_grant_partner_access(v_client3);
  RESET ROLE;
  SELECT a.actor_role INTO v_text
    FROM public.audit_logs a
   WHERE a.target_kind = 'user_roles' AND a.action = 'INSERT_user_roles'
     AND a.after->>'user_id' = v_client3::text AND a.after->>'role' = 'partner';
  IF v_text IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL el admin con varios roles sale como %', v_text; END IF;
  -- Quitárselo: DELETE también auditado con el admin como actor
  PERFORM set_config('request.jwt.claim.sub', v_admin2::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_revoke_partner_access(v_client3);
  RESET ROLE;
  SELECT a.actor_role INTO v_text
    FROM public.audit_logs a
   WHERE a.target_kind = 'user_roles' AND a.action = 'DELETE_user_roles'
     AND a.before->>'user_id' = v_client3::text;
  IF v_text IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL DELETE de rol auditado como %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- 1) Flag admin_showcase (B5-10): apagado, se enciende por admin
  -- ------------------------------------------------------------------
  SELECT enabled, tenant_overrides INTO v_bool, v_json FROM public.feature_flags WHERE code = 'admin_showcase';
  IF v_bool IS DISTINCT FROM FALSE OR v_json IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL admin_showcase no nace apagado: % %', v_bool, v_json;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.get_feature_flag('admin_showcase', v_admin) THEN RAISE EXCEPTION 'FAIL admin_showcase encendido sin override'; END IF;
  -- Un admin lo enciende para sí mismo (auditado: audit_changes ya no falla)
  UPDATE public.feature_flags
     SET tenant_overrides = tenant_overrides || jsonb_build_object(v_admin::text, true)
   WHERE code = 'admin_showcase';
  IF NOT public.get_feature_flag('admin_showcase', v_admin) THEN RAISE EXCEPTION 'FAIL el override por uid no enciende el flag'; END IF;
  IF public.get_feature_flag('admin_showcase', v_admin2) THEN RAISE EXCEPTION 'FAIL el override de un admin enciende el de otro'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 2) Listados del admin (B5-6): paginados y filtrados en el servidor
  -- ------------------------------------------------------------------
  UPDATE public.profiles SET city = 'Zaragoza-O1A', business_category = 'discoteca-o1a', phone = '+34600000000'
   WHERE id = v_partner;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.admin_list_users('o1adm-client-' || v_client, 'client', NULL, 25, 0);
  IF v_row.id IS DISTINCT FROM v_client OR v_row.total_count <> 1 OR v_row.role IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'FAIL admin_list_users por email: % % %', v_row.id, v_row.total_count, v_row.role;
  END IF;
  -- El rol que se enseña es el más alto (antes LIMIT 1 sin orden)
  SELECT role INTO v_text FROM public.admin_list_users('o1adm-admin2-' || v_admin2, NULL, NULL, 25, 0);
  IF v_text IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL rol de admin2 = %', v_text; END IF;
  -- Filtros de ciudad y categoría, con teléfono y categoría en la fila
  SELECT * INTO v_row FROM public.admin_list_users(NULL, 'partner', NULL, 25, 0, 'Zaragoza-O1A', 'discoteca-o1a');
  IF v_row.id IS DISTINCT FROM v_partner OR v_row.phone IS DISTINCT FROM '+34600000000'
     OR v_row.business_category IS DISTINCT FROM 'discoteca-o1a' OR v_row.total_count <> 1 THEN
    RAISE EXCEPTION 'FAIL filtros de ciudad y categoría: %', row_to_json(v_row);
  END IF;
  -- Un % tecleado se busca tal cual (no es un comodín)
  SELECT count(*) INTO v_count FROM public.admin_list_users('o1adm-%-' || v_client, NULL, NULL, 25, 0);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL %% funciona como comodín en la búsqueda'; END IF;
  -- Paginación: total estable y páginas sin solaparse
  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.admin_list_users('o1adm-', NULL, NULL, 3, 0)
    UNION
    SELECT id FROM public.admin_list_users('o1adm-', NULL, NULL, 3, 3)
    UNION
    SELECT id FROM public.admin_list_users('o1adm-', NULL, NULL, 3, 6)
  ) s;
  SELECT total_count INTO i FROM public.admin_list_users('o1adm-', NULL, NULL, 3, 0) LIMIT 1;
  IF v_count <> 8 OR i <> 8 THEN RAISE EXCEPTION 'FAIL paginación: % filas distintas, total %', v_count, i; END IF;
  SELECT cities INTO v_json FROM (SELECT to_jsonb(f.cities) AS cities FROM public.admin_user_facets('partner') f) s;
  IF NOT v_json ? 'Zaragoza-O1A' THEN RAISE EXCEPTION 'FAIL admin_user_facets sin la ciudad del local: %', v_json; END IF;
  RESET ROLE;
  -- Un cliente no lista usuarios
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_list_users(NULL, NULL, NULL, 5, 0);
    RAISE EXCEPTION 'FAIL un cliente lista usuarios';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 3) Reembolsos (B5-5)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O1A Local', 'ES', NULL);
  v_org2 := public.create_organization('O1A Local 2', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1A Evento', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event;
  RESET ROLE;

  -- Nueve entradas pagadas con su solicitud, una por estado de la cola
  FOR i IN 1..9 LOOP
    INSERT INTO public.tickets (event_id, buyer_user_id, buyer_email, status, amount_paid_cents, paid_at)
    VALUES (v_event, v_client, 'o1adm-client@pasify.test', 'paid', 1000, now())
    RETURNING id INTO v_tmp;
    v_t := v_t || v_tmp;
    INSERT INTO public.refund_requests (ticket_id, event_id, org_id, requester_user_id, requester_email, amount_cents, reason, status)
    VALUES (v_tmp, v_event, v_org, v_client, 'o1adm-client@pasify.test', 1000, 'O1A motivo ' || i, 'pending')
    RETURNING id INTO v_tmp;
    v_r := v_r || v_tmp;
  END LOOP;
  -- 1 pending · 2 failed · 3 approved reciente · 4 approved de hace 5 min ·
  -- 5 processing sin reembolso de hace 20 min · 6 processing con reembolso ·
  -- 7 processing reciente · 8 refunded · 9 rejected
  SET LOCAL session_replication_role = replica;  -- sin triggers: updated_at a mano
  UPDATE public.refund_requests SET status = 'failed', stripe_refund_id = 're_o1a_fail_' || v_r[2],
         stripe_refund_status = 'failed', stripe_failure_reason = 'insufficient_funds', updated_at = now() WHERE id = v_r[2];
  UPDATE public.refund_requests SET status = 'approved', updated_at = now() - INTERVAL '30 seconds' WHERE id = v_r[3];
  UPDATE public.refund_requests SET status = 'approved', updated_at = now() - INTERVAL '5 minutes' WHERE id = v_r[4];
  UPDATE public.refund_requests SET status = 'processing', updated_at = now() - INTERVAL '20 minutes' WHERE id = v_r[5];
  UPDATE public.refund_requests SET status = 'processing', stripe_refund_id = 're_o1a_ok_' || v_r[6],
         stripe_refund_status = 'pending', updated_at = now() - INTERVAL '20 minutes' WHERE id = v_r[6];
  UPDATE public.refund_requests SET status = 'processing', updated_at = now() - INTERVAL '1 minute' WHERE id = v_r[7];
  UPDATE public.refund_requests SET status = 'refunded', processed_at = now(), updated_at = now() WHERE id = v_r[8];
  UPDATE public.refund_requests SET status = 'rejected', decision_note = 'No procede', updated_at = now() WHERE id = v_r[9];
  SET LOCAL session_replication_role = origin;

  FOR i IN 1..9 LOOP
    SELECT public.admin_refund_bucket(r.status, r.stripe_refund_id, r.updated_at) INTO v_text
      FROM public.refund_requests r WHERE r.id = v_r[i];
    IF v_text IS DISTINCT FROM (ARRAY['pending','attention','in_progress','attention','attention','in_progress','in_progress','done','done'])[i] THEN
      RAISE EXCEPTION 'FAIL solicitud % en la cola % ', i, v_text;
    END IF;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Con incidencia: el fallido (con su motivo) y los dos atascados
  SELECT count(*) INTO v_count FROM public.admin_refund_queue('attention', 100, 0) q WHERE q.id = ANY (v_r);
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL "con incidencia" tiene % de las 3', v_count; END IF;
  SELECT q.stripe_failure_reason, q.event_title, q.queue INTO v_row
    FROM public.admin_refund_queue('attention', 100, 0) q WHERE q.id = v_r[2];
  IF v_row.stripe_failure_reason IS DISTINCT FROM 'insufficient_funds' OR v_row.event_title IS DISTINCT FROM 'O1A Evento' THEN
    RAISE EXCEPTION 'FAIL la cola no trae el motivo del fallo o el evento: %', row_to_json(v_row);
  END IF;
  -- Los contadores cuadran con la propia cola
  SELECT total INTO v_count FROM public.admin_refund_queue_counts() c WHERE c.queue = 'attention';
  SELECT count(*) INTO i FROM public.admin_refund_queue('attention', 100, 0);
  IF v_count IS DISTINCT FROM i THEN RAISE EXCEPTION 'FAIL contador de incidencias % vs % filas', v_count, i; END IF;
  -- Paginación de la cola: total_count es el de la cola entera
  SELECT q.total_count INTO v_count FROM public.admin_refund_queue('done', 1, 0) q;
  SELECT count(*) INTO i FROM public.refund_requests WHERE status IN ('refunded', 'rejected');
  IF v_count IS DISTINCT FROM i THEN RAISE EXCEPTION 'FAIL total del histórico % vs %', v_count, i; END IF;

  -- Denegar exige motivo, y se guarda recortado
  BEGIN
    PERFORM public.decide_refund(v_r[1], 'reject', NULL);
    RAISE EXCEPTION 'FAIL se deniega sin motivo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.decide_refund(v_r[1], 'reject', '   ok ');
    RAISE EXCEPTION 'FAIL se deniega con un motivo vacío';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.decide_refund(v_r[1], 'reject', '  Fuera de plazo del local  ');
  RESET ROLE;
  SELECT status::text, decision_note INTO v_row FROM public.refund_requests WHERE id = v_r[1];
  IF v_row.status <> 'rejected' OR v_row.decision_note IS DISTINCT FROM 'Fuera de plazo del local' THEN
    RAISE EXCEPTION 'FAIL denegación: %', row_to_json(v_row);
  END IF;

  -- Reintentar: solo un fallido, y solo un admin
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_retry_refund(v_r[2]);
    RAISE EXCEPTION 'FAIL un cliente reintenta un reembolso';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_refund_queue('pending', 10, 0);
    RAISE EXCEPTION 'FAIL un cliente lee la cola de reembolsos';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_retry_refund(v_r[4]);
    RAISE EXCEPTION 'FAIL se reintenta uno que no ha fallado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.admin_retry_refund(v_r[2]);
  RESET ROLE;
  SELECT status::text, stripe_refund_id, stripe_failure_reason, metadata INTO v_row FROM public.refund_requests WHERE id = v_r[2];
  IF v_row.status <> 'approved' OR v_row.stripe_refund_id IS NOT NULL OR v_row.stripe_failure_reason IS NOT NULL
     OR v_row.metadata->'retries'->0->>'failure_reason' IS DISTINCT FROM 'insufficient_funds'
     OR v_row.metadata->'retries'->0->>'stripe_refund_id' IS DISTINCT FROM 're_o1a_fail_' || v_r[2]
     OR v_row.metadata->'retries'->0->>'by' IS DISTINCT FROM v_admin::text THEN
    RAISE EXCEPTION 'FAIL reintento: %', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE target_kind = 'refund_requests' AND target_id = v_r[2] AND actor_user_id = v_admin;
  IF v_count < 1 THEN RAISE EXCEPTION 'FAIL el reintento no queda en la auditoría'; END IF;
  -- Recién reintentado: "en curso" (process-refund lo tramita), no "con incidencia"
  SELECT public.admin_refund_bucket(r.status, r.stripe_refund_id, r.updated_at) INTO v_text
    FROM public.refund_requests r WHERE r.id = v_r[2];
  IF v_text <> 'in_progress' THEN RAISE EXCEPTION 'FAIL reintentado en la cola %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- 4) Soporte (B5-16): duplicados abiertos → uno; open_conversation idempotente
  -- ------------------------------------------------------------------
  -- Como antes de la migración: sin índice y con duplicados abiertos
  DROP INDEX public.support_conv_one_open_per_user;
  INSERT INTO public.support_conversations (client_id, kind, status, created_at)
  VALUES (v_client, 'client_admin', 'open', now() - INTERVAL '3 hours') RETURNING id INTO v_c1;
  INSERT INTO public.support_conversations (client_id, kind, status, created_at)
  VALUES (v_client, 'client_admin', 'open', now() - INTERVAL '2 hours') RETURNING id INTO v_c2;
  INSERT INTO public.support_conversations (client_id, kind, status, created_at)
  VALUES (v_client, 'client_admin', 'open', now() - INTERVAL '1 minute') RETURNING id INTO v_c3;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c2, v_client, 'client', 'Hola, tengo un problema con mi entrada');
  INSERT INTO public.support_conversations (client_id, kind, status, created_at)
  VALUES (v_client2, 'client_admin', 'open', now() - INTERVAL '1 day') RETURNING id INTO v_c4;
  INSERT INTO public.support_conversations (client_id, kind, status, created_at)
  VALUES (v_client2, 'client_admin', 'open', now() - INTERVAL '1 hour') RETURNING id INTO v_c5;
  -- Un local con dos organizaciones: una conversación por organización, no son duplicados
  INSERT INTO public.support_conversations (client_id, partner_id, org_id, kind, status)
  VALUES (v_partner, v_partner, v_org, 'partner_admin', 'open'),
         (v_partner, v_partner, v_org2, 'partner_admin', 'open');

  v_count := public.support_close_duplicate_open_conversations();
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL se cierran % duplicados (esperados 3)', v_count; END IF;
  SELECT string_agg(status, ',' ORDER BY created_at) INTO v_text FROM public.support_conversations WHERE client_id = v_client;
  IF v_text <> 'closed,open,closed' THEN RAISE EXCEPTION 'FAIL se queda abierta la que no tiene mensajes: %', v_text; END IF;
  SELECT subject INTO v_text FROM public.support_conversations WHERE id = v_c3;
  IF v_text IS NULL THEN RAISE EXCEPTION 'FAIL el duplicado cerrado no dice por qué'; END IF;
  SELECT status INTO v_text FROM public.support_conversations WHERE id = v_c5;
  IF v_text <> 'open' THEN RAISE EXCEPTION 'FAIL sin mensajes, se queda la más reciente: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.support_conversations WHERE client_id = v_partner AND status = 'open';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL las conversaciones de dos organizaciones se tratan como duplicadas'; END IF;
  -- Los mensajes siguen donde estaban
  SELECT count(*) INTO v_count FROM public.support_messages WHERE conversation_id = v_c2;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL se han movido o borrado mensajes'; END IF;

  CREATE UNIQUE INDEX support_conv_one_open_per_user
    ON public.support_conversations (client_id, kind, (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    WHERE status = 'open'
      AND kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t);

  -- El cliente recibe siempre su conversación abierta, sin crear otra
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('client_admin');
  v_conv2 := public.open_conversation('client_admin');
  IF v_conv IS DISTINCT FROM v_c2 OR v_conv2 IS DISTINCT FROM v_c2 THEN
    RAISE EXCEPTION 'FAIL open_conversation no devuelve la abierta: % %', v_conv, v_conv2;
  END IF;
  -- Un cliente no abre conversaciones de local, ni por la RPC ni con un INSERT directo
  BEGIN
    PERFORM public.open_conversation('partner_admin');
    RAISE EXCEPTION 'FAIL un cliente abre una conversación de local';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.support_conversations (client_id, partner_id, kind) VALUES (v_client, v_client, 'partner_admin');
    RAISE EXCEPTION 'FAIL INSERT directo de una conversación de local';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Ni una segunda abierta, ni una con contadores inventados
  BEGIN
    INSERT INTO public.support_conversations (client_id, kind) VALUES (v_client, 'client_admin');
    RAISE EXCEPTION 'FAIL segunda conversación abierta del mismo usuario';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client4::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client4, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.support_conversations (client_id, kind, unread_for_admin, last_message_preview)
    VALUES (v_client4, 'client_admin', 9, 'Mensaje inventado');
    RAISE EXCEPTION 'FAIL INSERT directo con contadores inventados';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Las versiones antiguas de la app (INSERT "en blanco") siguen funcionando
  INSERT INTO public.support_conversations (client_id, kind) VALUES (v_client4, 'client_admin') RETURNING id INTO v_conv;
  IF public.open_conversation('client_admin') IS DISTINCT FROM v_conv THEN
    RAISE EXCEPTION 'FAIL open_conversation no reutiliza la creada por un INSERT directo';
  END IF;
  RESET ROLE;
  -- Usuario sin conversaciones: la crea al escribir y no duplica
  PERFORM set_config('request.jwt.claim.sub', v_client3::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client3, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('client_admin');
  v_conv2 := public.open_conversation('client_admin');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.support_conversations WHERE client_id = v_client3 AND status = 'open';
  IF v_conv IS NULL OR v_conv IS DISTINCT FROM v_conv2 OR v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL open_conversation duplica: % % (% abiertas)', v_conv, v_conv2, v_count;
  END IF;

  -- El local: la suya por organización, y nunca la de una organización ajena
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('partner_admin', NULL, v_org);
  IF v_conv IS DISTINCT FROM (SELECT id FROM public.support_conversations WHERE client_id = v_partner AND org_id = v_org AND status = 'open') THEN
    RAISE EXCEPTION 'FAIL open_conversation del local no reutiliza la de su organización';
  END IF;
  v_conv2 := public.open_conversation('partner_admin');
  IF v_conv2 IS NULL OR v_conv2 = v_conv THEN RAISE EXCEPTION 'FAIL sin organización debería ser otra conversación'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_tmp := public.create_organization('O1A Ajena', 'ES', NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.open_conversation('partner_admin', NULL, v_tmp);
    RAISE EXCEPTION 'FAIL el local abre conversación con una organización ajena';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 5) Leído de verdad (B5-8): read_at y contadores
  -- ------------------------------------------------------------------
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c2, v_admin, 'admin', 'Hola, te ayudamos');
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c2, v_client, 'client', 'Gracias');
  SELECT unread_for_admin, unread_for_client INTO v_row FROM public.support_conversations WHERE id = v_c2;
  IF v_row.unread_for_admin <> 2 OR v_row.unread_for_client <> 1 THEN
    RAISE EXCEPTION 'FAIL contadores: %', row_to_json(v_row);
  END IF;
  -- Otro usuario no marca nada
  PERFORM set_config('request.jwt.claim.sub', v_client2::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.mark_conversation_read(v_c2, 'client');
  PERFORM public.mark_conversation_read(v_c2, 'admin');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.support_messages WHERE conversation_id = v_c2 AND read_at IS NOT NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un tercero marca mensajes como leídos'; END IF;
  -- El cliente lee: sus mensajes siguen sin leer por Pasify
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.mark_conversation_read(v_c2, 'client');
  PERFORM public.mark_conversation_read(v_c2, 'admin');  -- un cliente no puede leer como admin
  RESET ROLE;
  SELECT count(*) FILTER (WHERE sender_kind = 'admin' AND read_at IS NOT NULL),
         count(*) FILTER (WHERE sender_kind <> 'admin' AND read_at IS NOT NULL)
    INTO v_count, i
    FROM public.support_messages WHERE conversation_id = v_c2;
  IF v_count <> 1 OR i <> 0 THEN RAISE EXCEPTION 'FAIL lectura del cliente: % admin leídos, % cliente leídos', v_count, i; END IF;
  SELECT unread_for_admin, unread_for_client INTO v_row FROM public.support_conversations WHERE id = v_c2;
  IF v_row.unread_for_client <> 0 OR v_row.unread_for_admin <> 2 THEN RAISE EXCEPTION 'FAIL contadores tras leer el cliente: %', row_to_json(v_row); END IF;
  -- Pasify lee: doble check para el cliente
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.mark_conversation_read(v_c2, 'admin');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.support_messages WHERE conversation_id = v_c2 AND read_at IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL quedan % mensajes sin read_at', v_count; END IF;
  SELECT unread_for_admin INTO v_count FROM public.support_conversations WHERE id = v_c2;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL unread_for_admin tras leer = %', v_count; END IF;

  -- ------------------------------------------------------------------
  -- 6) Cerrar y reabrir (B5-1)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.assign_admin_to_conversation(v_c2, v_admin);
  UPDATE public.support_conversations SET status = 'closed' WHERE id = v_c2;
  RESET ROLE;
  SELECT assigned_admin_id INTO v_tmp FROM public.support_conversations WHERE id = v_c2;
  IF v_tmp IS DISTINCT FROM v_admin THEN RAISE EXCEPTION 'FAIL asignarme no asigna'; END IF;
  -- El cliente vuelve a escribir en la cerrada: se reabre
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c2, v_client, 'client', 'Sigue sin funcionar');
  RESET ROLE;
  SELECT status, unread_for_admin INTO v_row FROM public.support_conversations WHERE id = v_c2;
  IF v_row.status <> 'open' OR v_row.unread_for_admin <> 1 THEN RAISE EXCEPTION 'FAIL no se reabre: %', row_to_json(v_row); END IF;
  -- Cerrada y con otra abierta: el mensaje entra, la cerrada no se reabre
  UPDATE public.support_conversations SET status = 'closed' WHERE id = v_c2;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('client_admin');
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c2, v_client, 'client', 'Otro mensaje');
  RESET ROLE;
  SELECT status, unread_for_admin INTO v_row FROM public.support_conversations WHERE id = v_c2;
  IF v_conv = v_c2 OR v_row.status <> 'closed' OR v_row.unread_for_admin <> 2 THEN
    RAISE EXCEPTION 'FAIL con otra abierta: % %', v_conv, row_to_json(v_row);
  END IF;

  -- ------------------------------------------------------------------
  -- 8) Mensaje de una cuenta borrada: sender_id NULL, nada se rompe
  -- ------------------------------------------------------------------
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_c5, v_admin3, 'admin', 'Mensaje de un admin que se va');
  DELETE FROM auth.users WHERE id = v_admin3;
  SELECT count(*) INTO v_count FROM public.support_messages WHERE conversation_id = v_c5 AND sender_id IS NULL AND sender_kind = 'admin';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el mensaje del admin borrado no queda con sender_id NULL'; END IF;

  -- ------------------------------------------------------------------
  -- 9) Kill-switch de IA: la RPC funciona y queda auditada
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT killed INTO v_bool FROM public.ai_kill_switches WHERE capability_code = 'concierge';
  IF public.toggle_ai_kill_switch('concierge', 'O1A prueba') IS DISTINCT FROM NOT v_bool THEN
    RAISE EXCEPTION 'FAIL toggle_ai_kill_switch no cambia el estado';
  END IF;
  PERFORM public.toggle_ai_kill_switch('concierge', 'O1A prueba');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE target_kind = 'ai_kill_switches' AND actor_user_id = v_admin AND after->>'capability_code' = 'concierge';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el kill-switch no queda auditado (% filas)', v_count; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.toggle_ai_kill_switch('concierge', NULL);
    RAISE EXCEPTION 'FAIL un cliente toca el kill-switch';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  RAISE NOTICE 'PASS o1_admin: flag de demo, listados paginados, cola y reintento de reembolsos, soporte (duplicados, leído, reabrir) y auditoría de roles';
END $$;

ROLLBACK;
