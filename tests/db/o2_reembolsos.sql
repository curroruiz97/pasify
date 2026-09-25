-- Pasify · Ola 2 · reembolsos (S2): política por tipo y decisión del local
-- (T1), reembolsos hechos en Stripe y disputas (T2), puntos y entradas usadas
-- (T3), referidos con compra y tope (T4) y transferencias (T5).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (las migraciones posteriores a 20260925110000 no están aplicadas: van
-- en la misma transacción; el BEGIN de este fichero avisa de que ya hay una
-- abierta y su ROLLBACK lo deshace todo):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name
--   $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;')
--   foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o2_reembolsos.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  v_partner   UUID := gen_random_uuid();  -- dueño de la organización
  v_manager   UUID := gen_random_uuid();  -- manager activo
  v_door      UUID := gen_random_uuid();  -- portero
  v_other     UUID := gen_random_uuid();  -- otro local
  v_admin     UUID := gen_random_uuid();  -- admin de plataforma
  v_client    UUID := gen_random_uuid();  -- comprador
  v_friend    UUID := gen_random_uuid();  -- recibe transferencias
  v_ref       UUID := gen_random_uuid();  -- invita a amigos
  v_old       UUID := gen_random_uuid();  -- cuenta de hace 40 días
  v_news      UUID[] := ARRAY[]::UUID[];  -- invitados
  v_org       UUID;
  v_event     UUID;  -- a 10 días
  v_event2    UUID;  -- se cancela
  v_event_now UUID;  -- empieza dentro de una hora (puerta)
  v_event_past UUID; -- pasará a 'past'
  v_event4    UUID;  -- se cancela con una transferencia pendiente
  v_tier_null UUID;  -- sin devolución (por defecto)
  v_tier_48   UUID;  -- hasta 48 h antes
  v_tier_300  UUID;  -- hasta 300 h antes: plazo ya cerrado
  v_tier_notr UUID;  -- no transferible
  v_tier2     UUID;
  v_tier_now  UUID;
  v_tier_past UUID;
  v_tier4     UUID;
  v_o         RECORD;
  v_p         RECORD;
  v_q         RECORD;
  v_r         RECORD;
  v_d         RECORD;
  v_l         RECORD;
  v_c         RECORD;
  v_tx        RECORD;
  v_row       RECORD;
  v_scan      RECORD;
  v_t         UUID;
  v_t2        UUID;
  v_t_null    UUID;
  v_t_300     UUID;
  v_t_notr    UUID;
  v_p1        UUID;
  v_p2        UUID;
  v_r1        UUID;
  v_r2        UUID;
  v_r3        UUID;
  v_req       UUID;
  v_req2      UUID;
  v_req3      UUID;
  v_transfer  UUID;
  v_token     UUID;
  v_qr        UUID;
  v_access    UUID;
  v_code      TEXT;
  v_text      TEXT;
  v_json      JSONB;
  v_count     INT;
  v_int       INT;
  v_bool      BOOLEAN;
  v_u         UUID;
  i           INT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o2-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_manager, 'o2-manager-' || v_manager || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_door,    'o2-door-'    || v_door    || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'o2-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,   'o2-admin-'   || v_admin   || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o2-client-'  || v_client  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_friend,  'o2-friend-'  || v_friend  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_ref,     'o2-ref-'     || v_ref     || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_old,     'o2-old-'     || v_old     || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - INTERVAL '40 days', now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  -- ------------------------------------------------------------------
  -- T1 · Los tipos existentes quedan "sin devolución salvo cancelación"
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE refundable_until_hours_before IS NOT NULL;
  IF v_count IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FAIL quedan % tipos con plazo de devolución tras la migración', v_count; END IF;
  SELECT is_nullable, column_default INTO v_row
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'refundable_until_hours_before';
  IF v_row.is_nullable IS DISTINCT FROM 'YES' OR v_row.column_default IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL la columna no admite NULL o tiene valor por defecto: %', row_to_json(v_row);
  END IF;

  -- Local, equipo y eventos
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O2 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento', 'Madrid', now() + INTERVAL '10 days', now() + INTERVAL '10 days 6 hours', 'published', 2500)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento cancelable', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 2500)
  RETURNING id INTO v_event2;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento de hoy', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 2500)
  RETURNING id INTO v_event_now;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento que pasará', 'Madrid', now() + INTERVAL '1 day', now() + INTERVAL '1 day 6 hours', 'published', 2500)
  RETURNING id INTO v_event_past;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento 4', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 2500)
  RETURNING id INTO v_event4;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'Sin devolución', 2500, 100, 50) RETURNING id INTO v_tier_null;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, refundable_until_hours_before)
  VALUES (v_event, 'Flexible', 2500, 100, 50, 48) RETURNING id INTO v_tier_48;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, refundable_until_hours_before)
  VALUES (v_event, 'Plazo largo', 2500, 100, 50, 300) RETURNING id INTO v_tier_300;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, refundable_until_hours_before, transfer_allowed)
  VALUES (v_event, 'Nominal', 2500, 100, 50, 48, FALSE) RETURNING id INTO v_tier_notr;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event2, 'General', 2500, 100, 50) RETURNING id INTO v_tier2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, refundable_until_hours_before)
  VALUES (v_event_now, 'General', 2500, 100, 50, 0) RETURNING id INTO v_tier_now;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event_past, 'General', 2500, 100, 50) RETURNING id INTO v_tier_past;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event4, 'General', 2500, 100, 50) RETURNING id INTO v_tier4;
  RESET ROLE;
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_manager, 'o2-manager-' || v_manager || '@pasify.test', 'manager', 'active'),
         (v_org, v_door,    'o2-door-'    || v_door    || '@pasify.test', 'door_staff', 'active');

  -- Un tipo nuevo nace sin devolución; el plazo no puede ser negativo
  SELECT refundable_until_hours_before INTO v_int FROM public.ticket_tiers WHERE id = v_tier_null;
  IF v_int IS NOT NULL THEN RAISE EXCEPTION 'FAIL un tipo nuevo nace con plazo %', v_int; END IF;
  BEGIN
    UPDATE public.ticket_tiers SET refundable_until_hours_before = -1 WHERE id = v_tier_null;
    RAISE EXCEPTION 'FAIL se aceptó un plazo negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Compras del cliente (1 € = 1 punto, como order-paid.ts)
  SELECT * INTO v_o FROM public.create_ticket_order(v_event, v_tier_48, 2, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_o.order_id, 'cs_o2_' || v_o.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_o.order_id, 'pi_o2_' || v_o.order_id, 5000, 250, TRUE);
  SELECT id INTO v_t FROM public.tickets WHERE order_id = v_o.order_id ORDER BY id LIMIT 1;
  SELECT id INTO v_t2 FROM public.tickets WHERE order_id = v_o.order_id AND id <> v_t LIMIT 1;
  SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier_null, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_t_null FROM public.tickets WHERE order_id = v_c.order_id;
  SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier_300, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_t_300 FROM public.tickets WHERE order_id = v_c.order_id;
  SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier_notr, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_t_notr FROM public.tickets WHERE order_id = v_c.order_id;

  -- ------------------------------------------------------------------
  -- T1 · request_refund según la política del tipo
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.request_refund(v_t_null, 'No puedo ir', NULL);
    RAISE EXCEPTION 'FAIL reembolso pedido en un tipo sin devolución';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'refund_not_allowed' THEN RAISE EXCEPTION 'FAIL política NULL: esperaba refund_not_allowed y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.request_refund(v_t_300, 'No puedo ir', NULL);
    RAISE EXCEPTION 'FAIL reembolso pedido fuera de plazo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'refund_window_closed' THEN RAISE EXCEPTION 'FAIL fuera de plazo: esperaba refund_window_closed y llegó %', SQLERRM; END IF;
  END;
  v_req := public.request_refund(v_t, 'No puedo ir', NULL);
  BEGIN
    PERFORM public.request_refund(v_t, 'Otra vez', NULL);
    RAISE EXCEPTION 'FAIL dos solicitudes para la misma entrada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  SELECT status::text, auto_approved, decided_by, decided_at, org_id INTO v_row FROM public.refund_requests WHERE id = v_req;
  IF v_row.status IS DISTINCT FROM 'pending' OR v_row.auto_approved OR v_row.decided_by IS NOT NULL OR v_row.decided_at IS NOT NULL
     OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'FAIL dentro de plazo la solicitud debía quedar pendiente: %', row_to_json(v_row);
  END IF;
  -- Aviso al dueño y a los owner/admin/manager; no al portero
  SELECT count(*) INTO v_count FROM public.notifications
   WHERE kind = 'refund_requested' AND payload->>'refund_request_id' = v_req::text AND user_id IN (v_partner, v_manager);
  IF v_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL avisos al local = % (esperados 2)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notifications
   WHERE kind = 'refund_requested' AND payload->>'refund_request_id' = v_req::text AND user_id NOT IN (v_partner, v_manager);
  IF v_count IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FAIL aviso de reembolso a quien no gestiona: %', v_count; END IF;

  -- La bandeja: la leen owner y manager; ni el portero ni otro local
  FOREACH v_u IN ARRAY ARRAY[v_partner, v_manager, v_door, v_other] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.refund_requests WHERE id = v_req;
    RESET ROLE;
    v_int := CASE WHEN v_u IN (v_partner, v_manager) THEN 1 ELSE 0 END;
    IF v_count IS DISTINCT FROM v_int THEN
      RAISE EXCEPTION 'FAIL RLS de la bandeja: % ve % filas', v_u, v_count;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- T1 · decide_refund: el local decide; nadie ajeno
  -- ------------------------------------------------------------------
  FOREACH v_u IN ARRAY ARRAY[v_other, v_door, v_client] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.decide_refund(v_req, 'approve', NULL);
      RAISE EXCEPTION 'FAIL % decidió un reembolso ajeno', v_u;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT status::text INTO v_text FROM public.refund_requests WHERE id = v_req;
  IF v_text IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'FAIL una decisión ajena cambió la solicitud: %', v_text; END IF;

  -- El manager deniega: con motivo
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.decide_refund(v_req, 'reject', ' no ');
    RAISE EXCEPTION 'FAIL se denegó sin motivo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.decide_refund(v_req, 'reject', 'Fuera de la política del local');
  RESET ROLE;
  SELECT status::text, decided_by, decision_note INTO v_row FROM public.refund_requests WHERE id = v_req;
  IF v_row.status IS DISTINCT FROM 'rejected' OR v_row.decided_by IS DISTINCT FROM v_manager OR v_row.decision_note IS DISTINCT FROM 'Fuera de la política del local' THEN
    RAISE EXCEPTION 'FAIL denegación del manager: %', row_to_json(v_row);
  END IF;

  -- Se vuelve a pedir (misma fila) y el dueño la aprueba
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req2 := public.request_refund(v_t, 'Lo pido otra vez', NULL);
  RESET ROLE;
  IF v_req2 IS DISTINCT FROM v_req THEN RAISE EXCEPTION 'FAIL la solicitud reabierta no reutiliza la fila'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_refund(v_req, 'approve', NULL);
  RESET ROLE;
  SELECT status::text, decided_by, decision_note, auto_approved INTO v_row FROM public.refund_requests WHERE id = v_req;
  IF v_row.status IS DISTINCT FROM 'approved' OR v_row.decided_by IS DISTINCT FROM v_partner OR v_row.auto_approved THEN
    RAISE EXCEPTION 'FAIL aprobación del dueño: %', row_to_json(v_row);
  END IF;

  -- El admin de plataforma también decide; aprobar una entrada ya usada, no
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req2 := public.request_refund(v_t2, 'Enfermo', NULL);
  RESET ROLE;
  UPDATE public.tickets SET status = 'used', used_at = now() WHERE id = v_t2;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.decide_refund(v_req2, 'approve', NULL);
    RAISE EXCEPTION 'FAIL se aprobó el reembolso de una entrada usada';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM IS DISTINCT FROM 'ticket_not_refundable' THEN RAISE EXCEPTION 'FAIL esperaba ticket_not_refundable y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.tickets SET status = 'paid', used_at = NULL WHERE id = v_t2;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_refund(v_req2, 'approve', 'Aprobado por soporte');
  RESET ROLE;
  SELECT status::text INTO v_text FROM public.refund_requests WHERE id = v_req2;
  IF v_text IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'FAIL el admin no pudo aprobar: %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- T3 · Puntos: se restan en proporción; una entrada usada no se toca
  -- ------------------------------------------------------------------
  -- 50 € → 50 puntos (lo que da order-paid.ts)
  PERFORM public.loyalty_grant_points(v_client, 50, 'Compra de entradas · O2 Evento', 'ticket_purchase', v_event, NULL, v_org);
  PERFORM public.mark_refund_processed('re_o2_t1', 2500, 'pi_o2_' || v_o.order_id, v_req);
  SELECT status::text INTO v_text FROM public.tickets WHERE id = v_t;
  IF v_text IS DISTINCT FROM 'refunded' THEN RAISE EXCEPTION 'FAIL la entrada reembolsada quedó %', v_text; END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_o.order_id;
  IF v_text IS DISTINCT FROM 'partial_refund' THEN RAISE EXCEPTION 'FAIL pedido tras la primera devolución: %', v_text; END IF;
  SELECT COALESCE(sum(change_amount), 0) INTO v_int FROM public.loyalty_points WHERE user_id = v_client AND reason_code = 'ticket_refund';
  IF v_int IS DISTINCT FROM -25 THEN RAISE EXCEPTION 'FAIL puntos restados por media compra: % (esperados -25)', v_int; END IF;
  -- Idempotente
  PERFORM public.mark_refund_processed('re_o2_t1', 2500, 'pi_o2_' || v_o.order_id, v_req);
  SELECT count(*) INTO v_count FROM public.loyalty_points WHERE user_id = v_client AND reason_code = 'ticket_refund';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL la segunda confirmación vuelve a restar puntos (% movimientos)', v_count; END IF;

  -- La segunda entrada se escanea con el reembolso en marcha: sigue 'used'
  UPDATE public.refund_requests SET status = 'processing' WHERE id = v_req2;
  UPDATE public.tickets SET status = 'used', used_at = now() WHERE id = v_t2;
  PERFORM public.mark_refund_processed('re_o2_t2', 2500, 'pi_o2_' || v_o.order_id, v_req2);
  SELECT status::text INTO v_text FROM public.tickets WHERE id = v_t2;
  IF v_text IS DISTINCT FROM 'used' THEN RAISE EXCEPTION 'FAIL una entrada usada pasó a %', v_text; END IF;
  SELECT status::text AS status, (metadata->>'ticket_used_before_refund')::boolean AS used_flag
    INTO v_row FROM public.refund_requests WHERE id = v_req2;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.used_flag IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL solicitud de la entrada usada: %', row_to_json(v_row);
  END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_o.order_id;
  IF v_text IS DISTINCT FROM 'refunded' THEN RAISE EXCEPTION 'FAIL pedido devuelto entero quedó %', v_text; END IF;
  SELECT COALESCE(sum(change_amount), 0) INTO v_int FROM public.loyalty_points WHERE user_id = v_client AND reason_code = 'ticket_refund';
  IF v_int IS DISTINCT FROM -50 THEN RAISE EXCEPTION 'FAIL puntos restados por la compra entera: % (esperados -50)', v_int; END IF;
  IF public.loyalty_balance(v_client) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FAIL saldo tras devolverlo todo: %', public.loyalty_balance(v_client); END IF;

  -- Sin puntos dados por la compra, no se resta nada
  SELECT * INTO v_q FROM public.create_ticket_order(v_event, v_tier_48, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_q.order_id, 'cs_o2_' || v_q.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_q.order_id, 'pi_o2_' || v_q.order_id, 2500, 125, TRUE);
  SELECT id INTO v_u FROM public.tickets WHERE order_id = v_q.order_id;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req3 := public.request_refund(v_u, 'Cambio de planes', NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.decide_refund(v_req3, 'approve', NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.mark_refund_processed('re_o2_q', 2500, 'pi_o2_' || v_q.order_id, v_req3);
  SELECT count(*) INTO v_count FROM public.loyalty_points WHERE user_id = v_client AND reason_code = 'ticket_refund';
  IF v_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL se restaron puntos que no se dieron (% movimientos)', v_count; END IF;

  -- ------------------------------------------------------------------
  -- T1 · Evento cancelado: flujo de cancelación aunque el tipo no admita devolución
  -- ------------------------------------------------------------------
  SELECT * INTO v_c FROM public.create_ticket_order(v_event2, v_tier2, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_u FROM public.tickets WHERE order_id = v_c.order_id;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_json := public.partner_cancel_event(v_event2, 'Suspendido por lluvia');
  RESET ROLE;
  SELECT id, status::text AS status, reason_code, auto_approved INTO v_row FROM public.refund_requests WHERE ticket_id = v_u;
  IF v_row.status IS DISTINCT FROM 'approved' OR v_row.reason_code IS DISTINCT FROM 'event_cancelled' THEN
    RAISE EXCEPTION 'FAIL la cancelación no aprobó el reembolso: %', row_to_json(v_row);
  END IF;
  v_req3 := v_row.id;
  -- Stripe falló: el comprador lo pide y vuelve al flujo de cancelación, automático
  UPDATE public.refund_requests SET status = 'failed', stripe_failure_reason = 'card_expired' WHERE id = v_req3;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req2 := public.request_refund(v_u, 'Quiero mi dinero', NULL);
  RESET ROLE;
  SELECT status::text AS status, reason_code, auto_approved, auto_approve_reason INTO v_row FROM public.refund_requests WHERE id = v_req2;
  IF v_req2 IS DISTINCT FROM v_req3 OR v_row.status IS DISTINCT FROM 'approved' OR v_row.reason_code IS DISTINCT FROM 'event_cancelled'
     OR NOT v_row.auto_approved OR v_row.auto_approve_reason IS DISTINCT FROM 'event_cancelled' THEN
    RAISE EXCEPTION 'FAIL evento cancelado: el reembolso no sigue el flujo de cancelación: % %', v_req2, row_to_json(v_row);
  END IF;
  -- Repetirlo devuelve la misma solicitud, sin error
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.request_refund(v_u, 'Otra vez', NULL) IS DISTINCT FROM v_req3 THEN
    RAISE EXCEPTION 'FAIL repetir en evento cancelado no devuelve la misma solicitud';
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- T2 · Reembolsos hechos en el panel de Stripe
  -- ------------------------------------------------------------------
  -- Pedido de 3 entradas (75 €, 75 puntos): una con solicitud pendiente y otra usada
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO v_r FROM public.create_ticket_order(v_event, v_tier_48, 3, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_r.order_id, 'cs_o2_' || v_r.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_r.order_id, 'pi_o2_' || v_r.order_id, 7500, 375, TRUE);
  PERFORM public.loyalty_grant_points(v_client, 75, 'Compra de entradas · O2 Evento', 'ticket_purchase', v_event, NULL, v_org);
  SELECT id INTO v_r1 FROM public.tickets WHERE order_id = v_r.order_id ORDER BY id LIMIT 1;
  SELECT id INTO v_r2 FROM public.tickets WHERE order_id = v_r.order_id ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_r3 FROM public.tickets WHERE order_id = v_r.order_id ORDER BY id OFFSET 2 LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req := public.request_refund(v_r1, 'Pendiente del local', NULL);
  -- Nadie más que el servidor lo ejecuta
  BEGIN
    PERFORM public.mark_external_refund('pi_o2_' || v_r.order_id, 're_hack', 7500, TRUE, 'stripe_refund');
    RAISE EXCEPTION 'FAIL mark_external_refund ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  UPDATE public.tickets SET status = 'used', used_at = now() WHERE id = v_r2;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Parcial: se anota en el pedido; ninguna entrada cambia
  v_json := public.mark_external_refund('pi_o2_' || v_r.order_id, 're_ext_1', 2500, FALSE, 'stripe_refund');
  IF v_json->>'result' IS DISTINCT FROM 'partial' THEN RAISE EXCEPTION 'FAIL reembolso externo parcial: %', v_json; END IF;
  SELECT status::text, jsonb_array_length(metadata->'external_refunds') AS n INTO v_row FROM public.ticket_orders WHERE id = v_r.order_id;
  IF v_row.status IS DISTINCT FROM 'partial_refund' OR v_row.n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL pedido tras el parcial: %', row_to_json(v_row); END IF;
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_r.order_id AND status = 'refunded';
  IF v_count IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FAIL un parcial reembolsó % entradas', v_count; END IF;
  SELECT COALESCE(sum(change_amount), 0) INTO v_int FROM public.loyalty_points
   WHERE user_id = v_client AND reason_code = 'ticket_refund' AND ticket_id IN (v_r1, v_r2, v_r3);
  IF v_int IS DISTINCT FROM -25 THEN RAISE EXCEPTION 'FAIL puntos del parcial: % (esperados -25)', v_int; END IF;
  v_json := public.mark_external_refund('pi_o2_' || v_r.order_id, 're_ext_1', 2500, FALSE, 'stripe_refund');
  IF v_json->>'result' IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'FAIL el parcial repetido no es duplicate: %', v_json; END IF;

  -- Total: todas con su solicitud 'refunded'; la usada se queda 'used'
  v_json := public.mark_external_refund('pi_o2_' || v_r.order_id, 're_ext_2', 5000, TRUE, 'stripe_refund');
  IF v_json->>'result' IS DISTINCT FROM 'full' OR (v_json->>'requests')::int IS DISTINCT FROM 3 OR (v_json->>'tickets_refunded')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL reembolso externo total: %', v_json;
  END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_r.order_id;
  IF v_text IS DISTINCT FROM 'refunded' THEN RAISE EXCEPTION 'FAIL pedido tras el total: %', v_text; END IF;
  SELECT status::text INTO v_text FROM public.tickets WHERE id = v_r2;
  IF v_text IS DISTINCT FROM 'used' THEN RAISE EXCEPTION 'FAIL el reembolso externo cambió una entrada usada a %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.tickets WHERE id IN (v_r1, v_r3) AND status = 'refunded';
  IF v_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL entradas pagadas sin reembolsar tras el total: %', v_count; END IF;
  SELECT status::text, reason_code, metadata->'external'->>'previous_status' AS prev INTO v_row FROM public.refund_requests WHERE id = v_req;
  IF v_row.status IS DISTINCT FROM 'refunded' OR v_row.prev IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL la solicitud pendiente no se cerró con el reembolso externo: %', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.refund_requests
   WHERE ticket_id IN (v_r2, v_r3) AND status = 'refunded' AND reason_code = 'external_refund'
     AND (metadata->>'system')::boolean AND requester_user_id = v_client AND amount_cents = 2500 AND org_id = v_org;
  IF v_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL solicitudes del sistema = % (esperadas 2)', v_count; END IF;
  SELECT COALESCE(sum(change_amount), 0) INTO v_int FROM public.loyalty_points
   WHERE user_id = v_client AND reason_code = 'ticket_refund' AND ticket_id IN (v_r1, v_r2, v_r3);
  IF v_int IS DISTINCT FROM -75 THEN RAISE EXCEPTION 'FAIL puntos tras el total: % (esperados -75)', v_int; END IF;
  v_json := public.mark_external_refund('pi_o2_' || v_r.order_id, 're_ext_2', 5000, TRUE, 'stripe_refund');
  IF v_json->>'result' IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'FAIL el total repetido no es duplicate: %', v_json; END IF;
  -- Un parcial que llega luego como total se completa sin tocar nada más
  v_json := public.mark_external_refund('pi_o2_' || v_r.order_id, 're_ext_1', 2500, TRUE, 'stripe_refund');
  IF v_json->>'result' IS DISTINCT FROM 'full' OR (v_json->>'requests')::int IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'FAIL parcial → total: %', v_json; END IF;
  SELECT COALESCE(sum(change_amount), 0) INTO v_int FROM public.loyalty_points
   WHERE user_id = v_client AND reason_code = 'ticket_refund' AND ticket_id IN (v_r1, v_r2, v_r3);
  IF v_int IS DISTINCT FROM -75 THEN RAISE EXCEPTION 'FAIL puntos tras completar el parcial: %', v_int; END IF;
  -- Ni un pedido desconocido ni un reembolso de Pasify
  IF public.mark_external_refund('pi_o2_no_existe', 're_x', 100, TRUE, 'stripe_refund')->>'result' IS DISTINCT FROM 'order_not_found' THEN
    RAISE EXCEPTION 'FAIL pago desconocido';
  END IF;
  IF public.mark_external_refund('pi_o2_' || v_o.order_id, 're_o2_t1', 2500, FALSE, 'stripe_refund')->>'result' IS DISTINCT FROM 'pasify_refund' THEN
    RAISE EXCEPTION 'FAIL un reembolso de Pasify tratado como externo';
  END IF;

  -- ------------------------------------------------------------------
  -- T2 · Disputas: abierta bloquea la puerta; ganada la desbloquea; perdida = reembolso
  -- ------------------------------------------------------------------
  SELECT * INTO v_d FROM public.create_ticket_order(v_event_now, v_tier_now, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_d.order_id, 'cs_o2_' || v_d.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_d.order_id, 'pi_o2_' || v_d.order_id, 2500, 125, TRUE);
  SELECT id, qr_token INTO v_u, v_qr FROM public.tickets WHERE order_id = v_d.order_id;
  v_json := public.mark_order_dispute('pi_o2_' || v_d.order_id, 'dp_o2_1', 'open', 2500, 'fraudulent');
  IF v_json->>'result' IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'FAIL apertura de disputa: %', v_json; END IF;
  SELECT dispute_status, stripe_dispute_id, disputed_at IS NOT NULL AS has_at, metadata->'dispute'->>'reason' AS reason
    INTO v_row FROM public.ticket_orders WHERE id = v_d.order_id;
  IF v_row.dispute_status IS DISTINCT FROM 'open' OR v_row.stripe_dispute_id IS DISTINCT FROM 'dp_o2_1' OR NOT v_row.has_at
     OR v_row.reason IS DISTINCT FROM 'fraudulent' THEN
    RAISE EXCEPTION 'FAIL marca de disputa: %', row_to_json(v_row);
  END IF;
  IF public.mark_order_dispute('pi_o2_' || v_d.order_id, 'dp_o2_1', 'open', 2500, 'fraudulent')->>'result' IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'FAIL la apertura repetida no es duplicate';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_door::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_door, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'o2', v_event_now);
  RESET ROLE;
  IF v_scan.success OR v_scan.result::text IS DISTINCT FROM 'not_paid' THEN RAISE EXCEPTION 'FAIL la puerta dejó pasar una entrada en disputa: %', row_to_json(v_scan); END IF;
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_u AND notes = 'order in dispute';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL escaneo en disputa sin registrar'; END IF;
  -- En disputa: ni reembolso ni transferencia
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.request_refund(v_u, 'Ya reclamé al banco', NULL);
    RAISE EXCEPTION 'FAIL reembolso pedido con la disputa abierta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'refund_in_dispute' THEN RAISE EXCEPTION 'FAIL esperaba refund_in_dispute y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.transfer_ticket(v_u, 'o2-friend-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL transferencia con la disputa abierta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ticket_not_transferable' THEN RAISE EXCEPTION 'FAIL esperaba ticket_not_transferable y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.mark_order_dispute('pi_o2_' || v_d.order_id, 'dp_o2_1', 'won', NULL, NULL);
    RAISE EXCEPTION 'FAIL mark_order_dispute ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  -- Ganada: vuelve a valer; una apertura tardía no la reabre
  IF public.mark_order_dispute('pi_o2_' || v_d.order_id, 'dp_o2_1', 'won', 2500, NULL)->>'result' IS DISTINCT FROM 'won' THEN
    RAISE EXCEPTION 'FAIL cierre ganado';
  END IF;
  IF public.mark_order_dispute('pi_o2_' || v_d.order_id, 'dp_o2_1', 'open', 2500, NULL)->>'result' IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'FAIL una apertura tardía reabrió la disputa';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_door::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_door, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'o2', v_event_now);
  RESET ROLE;
  IF NOT v_scan.success OR v_scan.result::text IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'FAIL tras ganar la disputa la entrada no entra: %', row_to_json(v_scan); END IF;
  -- Perdida: reembolso externo total
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO v_l FROM public.create_ticket_order(v_event_now, v_tier_now, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_l.order_id, 'cs_o2_' || v_l.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_l.order_id, 'pi_o2_' || v_l.order_id, 2500, 125, TRUE);
  PERFORM public.mark_order_dispute('pi_o2_' || v_l.order_id, 'dp_o2_2', 'open', 2500, 'product_not_received');
  v_json := public.mark_order_dispute('pi_o2_' || v_l.order_id, 'dp_o2_2', 'lost', 2500, NULL);
  IF v_json->>'result' IS DISTINCT FROM 'lost' OR v_json->'refund'->>'result' IS DISTINCT FROM 'full' THEN RAISE EXCEPTION 'FAIL disputa perdida: %', v_json; END IF;
  SELECT o.status::text AS order_status, o.dispute_status, t.status::text AS ticket_status, r.reason_code, r.status::text AS request_status
    INTO v_row
    FROM public.ticket_orders o
    JOIN public.tickets t ON t.order_id = o.id
    LEFT JOIN public.refund_requests r ON r.ticket_id = t.id
   WHERE o.id = v_l.order_id;
  IF v_row.order_status IS DISTINCT FROM 'refunded' OR v_row.dispute_status IS DISTINCT FROM 'lost' OR v_row.ticket_status IS DISTINCT FROM 'refunded'
     OR v_row.reason_code IS DISTINCT FROM 'dispute_lost' OR v_row.request_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'FAIL disputa perdida sin reembolso: %', row_to_json(v_row);
  END IF;

  -- ------------------------------------------------------------------
  -- T4 · Referidos: pendientes hasta la primera compra de pago, con tope
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_ref::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ref, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_code := public.get_or_create_my_referral_code();
  RESET ROLE;
  -- Una cuenta de hace más de 30 días no canjea
  PERFORM set_config('request.jwt.claim.sub', v_old::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_old, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.redeem_referral_code(v_code);
    RAISE EXCEPTION 'FAIL una cuenta antigua canjeó un código';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.referral_claims WHERE referee_user_id = v_old) THEN
    RAISE EXCEPTION 'FAIL quedó un referido de una cuenta antigua';
  END IF;

  -- Once invitados nuevos: canjean (pendiente, sin puntos) y compran
  FOR i IN 1..11 LOOP
    v_u := gen_random_uuid();
    v_news := v_news || v_u;
    INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
    VALUES (v_u, 'o2-new' || i || '-' || v_u || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
    PERFORM set_config('request.jwt.claim.sub', v_u::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT * INTO v_row FROM public.redeem_referral_code(lower(v_code));
    IF v_row.reward_points IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'FAIL el canje no anuncia los 500 puntos'; END IF;
    IF i = 1 THEN
      BEGIN
        PERFORM public.redeem_referral_code(v_code);
        RAISE EXCEPTION 'FAIL se canjeó dos veces';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
      END;
      BEGIN
        PERFORM public.grant_referral_on_first_purchase(v_u);
        RAISE EXCEPTION 'FAIL grant_referral_on_first_purchase ejecutable por authenticated';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    IF i = 1 THEN
      SELECT status, referrer_rewarded INTO v_row FROM public.referral_claims WHERE referee_user_id = v_u;
      IF v_row.status IS DISTINCT FROM 'pending' OR v_row.referrer_rewarded THEN
        RAISE EXCEPTION 'FAIL el canje no queda pendiente: %', row_to_json(v_row);
      END IF;
      IF public.loyalty_balance(v_u) IS DISTINCT FROM 0 OR public.loyalty_balance(v_ref) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'FAIL el canje dio puntos sin compra';
      END IF;
      -- Sin compra, nada; con una compra de prueba, tampoco
      PERFORM public.grant_referral_on_first_purchase(v_u);
      SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier_48, 1, v_u, 'o2-new1@pasify.test', 'Nuevo', 'Uno');
      PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
      PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, FALSE);
      PERFORM public.grant_referral_on_first_purchase(v_u);
      SELECT status INTO v_text FROM public.referral_claims WHERE referee_user_id = v_u;
      IF v_text IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'FAIL premiado con una compra de prueba o sin compra'; END IF;
    END IF;
    SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier_48, 1, v_u, 'o2-new@pasify.test', 'Nuevo', 'Invitado');
    PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
    PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
    PERFORM public.grant_referral_on_first_purchase(v_u);
    PERFORM public.grant_referral_on_first_purchase(v_u);  -- repetido: nada
    IF i = 1 THEN v_p := v_c; END IF;
    IF public.loyalty_balance(v_u) IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'FAIL invitado % con % puntos', i, public.loyalty_balance(v_u); END IF;
  END LOOP;
  -- Tope: 10 premiados; el undécimo recibe sus puntos y quien invita no
  SELECT count(*) INTO v_count FROM public.loyalty_points WHERE user_id = v_ref AND reason_code = 'referral_referrer';
  IF v_count IS DISTINCT FROM 10 OR public.loyalty_balance(v_ref) IS DISTINCT FROM 5000 THEN
    RAISE EXCEPTION 'FAIL tope de referidos: % premios, saldo %', v_count, public.loyalty_balance(v_ref);
  END IF;
  SELECT status, referrer_rewarded INTO v_row FROM public.referral_claims WHERE referee_user_id = v_news[11];
  IF v_row.status IS DISTINCT FROM 'rewarded' OR v_row.referrer_rewarded THEN RAISE EXCEPTION 'FAIL undécimo invitado: %', row_to_json(v_row); END IF;
  SELECT rewarded_order_id INTO v_u FROM public.referral_claims WHERE referee_user_id = v_news[1];
  IF v_u IS DISTINCT FROM v_p.order_id THEN RAISE EXCEPTION 'FAIL el premio no apunta a la compra de pago'; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_news[1] AND kind = 'referral_rewarded';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL avisos de premio al invitado = %', v_count; END IF;

  -- La compra premiada se devuelve entera: se retiran los puntos y vuelve a pendiente
  v_json := public.mark_external_refund('pi_o2_' || v_p.order_id, 're_o2_ref', 2500, TRUE, 'stripe_refund');
  SELECT status, rewarded_order_id INTO v_row FROM public.referral_claims WHERE referee_user_id = v_news[1];
  IF v_row.status IS DISTINCT FROM 'pending' OR v_row.rewarded_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL referido tras devolver la compra: %', row_to_json(v_row);
  END IF;
  IF public.loyalty_balance(v_news[1]) IS DISTINCT FROM 0 OR public.loyalty_balance(v_ref) IS DISTINCT FROM 4500 THEN
    RAISE EXCEPTION 'FAIL puntos tras devolver la compra premiada: invitado %, invitador %',
      public.loyalty_balance(v_news[1]), public.loyalty_balance(v_ref);
  END IF;

  -- ------------------------------------------------------------------
  -- T5 · Transferencias
  -- ------------------------------------------------------------------
  SELECT * INTO v_tx FROM public.create_ticket_order(v_event, v_tier_48, 2, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_tx.order_id, 'cs_o2_' || v_tx.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_tx.order_id, 'pi_o2_' || v_tx.order_id, 5000, 250, TRUE);
  SELECT id, qr_token, access_url_token INTO v_t, v_qr, v_access FROM public.tickets WHERE order_id = v_tx.order_id ORDER BY id LIMIT 1;
  SELECT id INTO v_t2 FROM public.tickets WHERE order_id = v_tx.order_id AND id <> v_t LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.transfer_ticket(v_t2, 'o2-client-' || v_client || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL transferencia a uno mismo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_to_self' THEN RAISE EXCEPTION 'FAIL esperaba transfer_to_self y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.transfer_ticket(v_t2, 'no-es-un-email', NULL);
    RAISE EXCEPTION 'FAIL transferencia a un email inválido';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'invalid_email' THEN RAISE EXCEPTION 'FAIL esperaba invalid_email y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.transfer_ticket(v_t_notr, 'o2-friend-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL transferencia de un tipo nominal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_not_allowed' THEN RAISE EXCEPTION 'FAIL esperaba transfer_not_allowed y llegó %', SQLERRM; END IF;
  END;
  v_transfer := public.transfer_ticket(v_t, '  O2-Friend-' || v_friend || '@Pasify.test ', 'Disfrútala');
  BEGIN
    PERFORM public.transfer_ticket(v_t, 'otro-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL dos transferencias pendientes de la misma entrada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_pending' THEN RAISE EXCEPTION 'FAIL esperaba transfer_pending y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.request_refund(v_t, 'Me arrepiento', NULL);
    RAISE EXCEPTION 'FAIL reembolso con una transferencia pendiente';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  SELECT to_email, to_user_id, message, invitation_token INTO v_row FROM public.ticket_transfers WHERE id = v_transfer;
  IF v_row.to_email IS DISTINCT FROM 'o2-friend-' || v_friend || '@pasify.test' OR v_row.to_user_id IS DISTINCT FROM v_friend
     OR v_row.message IS DISTINCT FROM 'Disfrútala' THEN
    RAISE EXCEPTION 'FAIL transferencia mal guardada: %', row_to_json(v_row);
  END IF;
  v_token := v_row.invitation_token;
  -- Un tercero no la transfiere ni la anula
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.transfer_ticket(v_t2, 'o2-friend-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL un tercero transfirió una entrada ajena';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'not_ticket_holder' THEN RAISE EXCEPTION 'FAIL esperaba not_ticket_holder y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.cancel_ticket_transfer(v_transfer);
    RAISE EXCEPTION 'FAIL un tercero anuló una transferencia ajena';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_not_found' THEN RAISE EXCEPTION 'FAIL esperaba transfer_not_found y llegó %', SQLERRM; END IF;
  END;
  -- Ni la acepta (no es su email)
  BEGIN
    PERFORM public.accept_ticket_transfer(v_token);
    RAISE EXCEPTION 'FAIL aceptó una transferencia para otro email';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_invalid_or_expired' THEN RAISE EXCEPTION 'FAIL esperaba transfer_invalid_or_expired y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;

  -- Aceptar: QR y enlace nuevos, titular nuevo
  PERFORM set_config('request.jwt.claim.sub', v_friend::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_friend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.accept_ticket_transfer(v_token) IS DISTINCT FROM v_t THEN RAISE EXCEPTION 'FAIL accept no devuelve la entrada'; END IF;
  BEGIN
    PERFORM public.accept_ticket_transfer(v_token);
    RAISE EXCEPTION 'FAIL una transferencia aceptada se aceptó dos veces';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_invalid_or_expired' THEN RAISE EXCEPTION 'FAIL esperaba transfer_invalid_or_expired y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  SELECT qr_token, access_url_token, transferred_to_user_id, holder_email INTO v_row FROM public.tickets WHERE id = v_t;
  IF v_row.qr_token = v_qr OR v_row.access_url_token = v_access OR v_row.transferred_to_user_id IS DISTINCT FROM v_friend
     OR v_row.holder_email IS DISTINCT FROM 'o2-friend-' || v_friend || '@pasify.test' THEN
    RAISE EXCEPTION 'FAIL la entrada no pasó al receptor con QR y enlace nuevos: %', row_to_json(v_row);
  END IF;

  -- Caducada: no se acepta, y deja de bloquear un envío nuevo
  PERFORM set_config('request.jwt.claim.sub', v_friend::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_friend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_transfer := public.transfer_ticket(v_t, 'o2-client-' || v_client || '@pasify.test', NULL);
  RESET ROLE;
  UPDATE public.ticket_transfers SET expires_at = now() - INTERVAL '1 minute' WHERE id = v_transfer;
  SELECT invitation_token INTO v_token FROM public.ticket_transfers WHERE id = v_transfer;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.accept_ticket_transfer(v_token);
    RAISE EXCEPTION 'FAIL se aceptó una transferencia caducada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_invalid_or_expired' THEN RAISE EXCEPTION 'FAIL esperaba transfer_invalid_or_expired y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_friend::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_friend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_transfer := public.transfer_ticket(v_t, 'o2-client-' || v_client || '@pasify.test', NULL);
  -- Anulada por quien la envió: no se acepta
  PERFORM public.cancel_ticket_transfer(v_transfer);
  BEGIN
    PERFORM public.cancel_ticket_transfer(v_transfer);
    RAISE EXCEPTION 'FAIL se anuló dos veces';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_not_pending' THEN RAISE EXCEPTION 'FAIL esperaba transfer_not_pending y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.ticket_transfers WHERE ticket_id = v_t AND status = 'expired';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL la caducada no quedó como expired: %', v_count; END IF;
  SELECT invitation_token INTO v_token FROM public.ticket_transfers WHERE id = v_transfer;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.accept_ticket_transfer(v_token);
    RAISE EXCEPTION 'FAIL se aceptó una transferencia anulada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'transfer_invalid_or_expired' THEN RAISE EXCEPTION 'FAIL esperaba transfer_invalid_or_expired y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;

  -- Evento pasado: no se envía. Evento cancelado tras el envío: no se acepta
  SELECT * INTO v_c FROM public.create_ticket_order(v_event_past, v_tier_past, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_u FROM public.tickets WHERE order_id = v_c.order_id;
  UPDATE public.events SET status = 'past' WHERE id = v_event_past;
  SELECT * INTO v_c FROM public.create_ticket_order(v_event4, v_tier4, 1, v_client, 'o2-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_o2_' || v_c.order_id);
  PERFORM public.mark_order_paid_v2('cs_o2_' || v_c.order_id, 'pi_o2_' || v_c.order_id, 2500, 125, TRUE);
  SELECT id INTO v_t2 FROM public.tickets WHERE order_id = v_c.order_id;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.transfer_ticket(v_u, 'o2-friend-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL transferencia de un evento pasado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'event_not_transferable' THEN RAISE EXCEPTION 'FAIL esperaba event_not_transferable y llegó %', SQLERRM; END IF;
  END;
  v_transfer := public.transfer_ticket(v_t2, 'o2-friend-' || v_friend || '@pasify.test', NULL);
  RESET ROLE;
  UPDATE public.events SET status = 'cancelled' WHERE id = v_event4;
  SELECT invitation_token INTO v_token FROM public.ticket_transfers WHERE id = v_transfer;
  PERFORM set_config('request.jwt.claim.sub', v_friend::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_friend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.accept_ticket_transfer(v_token);
    RAISE EXCEPTION 'FAIL se aceptó una entrada de un evento cancelado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ticket_not_transferable' THEN RAISE EXCEPTION 'FAIL esperaba ticket_not_transferable y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  SELECT transferred_to_user_id INTO v_u FROM public.tickets WHERE id = v_t2;
  IF v_u IS NOT NULL THEN RAISE EXCEPTION 'FAIL la entrada del evento cancelado cambió de titular'; END IF;

  -- ------------------------------------------------------------------
  -- Permisos de las funciones nuevas
  -- ------------------------------------------------------------------
  FOR v_row IN
    SELECT * FROM (VALUES
      ('public.mark_external_refund(text,text,integer,boolean,text)', 'authenticated', FALSE),
      ('public.mark_external_refund(text,text,integer,boolean,text)', 'anon', FALSE),
      ('public.mark_external_refund(text,text,integer,boolean,text)', 'service_role', TRUE),
      ('public.mark_order_dispute(text,text,text,integer,text)', 'authenticated', FALSE),
      ('public.mark_order_dispute(text,text,text,integer,text)', 'service_role', TRUE),
      ('public.grant_referral_on_first_purchase(uuid)', 'authenticated', FALSE),
      ('public.grant_referral_on_first_purchase(uuid)', 'anon', FALSE),
      ('public.grant_referral_on_first_purchase(uuid)', 'service_role', TRUE),
      ('public.loyalty_revoke_refunded_points(uuid,uuid)', 'authenticated', FALSE),
      ('public.referral_revert_for_order(uuid)', 'authenticated', FALSE),
      ('public.mark_refund_processed(text,integer,text,uuid)', 'authenticated', FALSE),
      ('public.request_refund(uuid,text,text)', 'anon', FALSE),
      ('public.request_refund(uuid,text,text)', 'authenticated', TRUE),
      ('public.decide_refund(uuid,text,text)', 'anon', FALSE),
      ('public.decide_refund(uuid,text,text)', 'authenticated', TRUE),
      ('public.transfer_ticket(uuid,text,text)', 'anon', FALSE),
      ('public.transfer_ticket(uuid,text,text)', 'authenticated', TRUE),
      ('public.cancel_ticket_transfer(uuid)', 'anon', FALSE),
      ('public.cancel_ticket_transfer(uuid)', 'authenticated', TRUE),
      ('public.accept_ticket_transfer(uuid)', 'anon', FALSE),
      ('public.redeem_referral_code(text)', 'anon', FALSE),
      ('public.scan_ticket(uuid,text,uuid,boolean,text)', 'anon', FALSE)
    ) AS p(fn, rol, esperado)
  LOOP
    IF has_function_privilege(v_row.rol, v_row.fn, 'execute') IS DISTINCT FROM v_row.esperado THEN
      RAISE EXCEPTION 'FAIL permiso de % para %: esperado %', v_row.rol, v_row.fn, v_row.esperado;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS o2_reembolsos: política por tipo, decisión del local, cancelación, reembolsos externos, disputas, puntos, referidos con tope y transferencias';
END $$;

ROLLBACK;
