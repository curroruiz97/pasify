-- Pasify · regresiones de la revisión de seguridad previa al despliegue
-- (reembolsos, partner_id NULL, transferencias, alta rechazada, reserva).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.

BEGIN;

DO $$
DECLARE
  v_partner  UUID := gen_random_uuid();
  v_client   UUID := gen_random_uuid();
  v_other    UUID := gen_random_uuid();
  v_friend   UUID := gen_random_uuid();
  v_org      UUID;
  v_event    UUID;
  v_tier     UUID;
  v_small    UUID;
  v_order    RECORD;
  v_ticket   UUID;
  v_ticket2  UUID;
  v_req      UUID;
  v_req2     UUID;
  v_scan     RECORD;
  v_count    INT;
  v_text     TEXT;
  v_ok       BOOLEAN;
  v_qr       UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'rf-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'rf-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'rf-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_friend,  'rf-friend-'  || v_friend  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- Local con evento a 10 días (reembolso automático fuera de plazo no aplica)
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('RF Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'RF Evento', 'Madrid', now() + INTERVAL '10 days', now() + INTERVAL '10 days 6 hours', 'published', 3000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'General', 3000, 100) RETURNING id INTO v_tier;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'Cupo 2', 3000, 2) RETURNING id INTO v_small;

  -- El evento se crea a nombre de quien llama: no a nombre de otro local
  BEGIN
    INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents)
    VALUES (v_other, v_org, 'Suplantado', 'Madrid', now() + INTERVAL '3 days', 'draft', 1000);
    RAISE EXCEPTION 'FAIL evento creado a nombre de otro local';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Plazo de reembolso amplio: la solicitud queda pendiente (no automática)
  UPDATE public.ticket_tiers SET refundable_until_hours_before = 1000 WHERE id = v_tier;

  -- Dos entradas pagadas del cliente
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_tier, 2, v_client, 'rf-client@pasify.test', 'Rita', 'Fernández');
  PERFORM public.set_order_stripe_session(v_order.order_id, 'cs_test_rf_' || v_order.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_rf_' || v_order.order_id, 'pi_test_rf', 6000, 300);
  SELECT id INTO v_ticket FROM public.tickets WHERE order_id = v_order.order_id ORDER BY id LIMIT 1;
  SELECT id INTO v_ticket2 FROM public.tickets WHERE order_id = v_order.order_id AND id <> v_ticket LIMIT 1;

  -- ------------------------------------------------------------------
  -- Reembolsos: solo por RPC; el importe y el pedido no se pueden tocar
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents, reason, status)
    VALUES (v_ticket, v_order.order_id, v_event, v_org, v_client, 'x@pasify.test', 999999, 'forjado', 'approved');
    RAISE EXCEPTION 'FAIL INSERT directo en refund_requests';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_req := public.request_refund(v_ticket, 'No puedo ir', NULL);

  -- Con reembolso en curso no se transfiere
  BEGIN
    PERFORM public.transfer_ticket(v_ticket, 'rf-friend-' || v_friend || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL transferencia con reembolso en curso';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;

  -- Con transferencia pendiente no se pide reembolso
  PERFORM public.transfer_ticket(v_ticket2, 'rf-friend-' || v_friend || '@pasify.test', NULL);
  BEGIN
    PERFORM public.request_refund(v_ticket2, 'Me arrepiento', NULL);
    RAISE EXCEPTION 'FAIL reembolso con transferencia pendiente';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- El local (owner) no puede reescribir la solicitud: sin policy de UPDATE
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.refund_requests SET amount_cents = 999999, status = 'approved' WHERE id = v_req;
  RESET ROLE;
  SELECT amount_cents INTO v_count FROM public.refund_requests WHERE id = v_req;
  IF v_count <> 3000 THEN RAISE EXCEPTION 'FAIL el local reescribió el importe: %', v_count; END IF;

  -- Rechazada, se puede volver a pedir (misma fila, UNIQUE ticket_id)
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT status::text INTO v_text FROM public.refund_requests WHERE id = v_req;
  IF v_text <> 'pending' THEN RAISE EXCEPTION 'FAIL la solicitud debía quedar pendiente: %', v_text; END IF;
  PERFORM public.decide_refund(v_req, 'reject', 'Fuera de plazo');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_req2 := public.request_refund(v_ticket, 'Lo intento otra vez', NULL);
  IF v_req2 IS DISTINCT FROM v_req THEN RAISE EXCEPTION 'FAIL la solicitud reabierta no reutiliza la fila'; END IF;
  SELECT status::text INTO v_text FROM public.refund_requests WHERE id = v_req;
  IF v_text <> 'pending' THEN RAISE EXCEPTION 'FAIL la solicitud reabierta no está pendiente: %', v_text; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- partner_id NULL (creador borrado): nadie ajeno pasa las comprobaciones
  -- ------------------------------------------------------------------
  UPDATE public.events SET partner_id = NULL WHERE id = v_event;
  SELECT qr_token INTO v_qr FROM public.tickets WHERE id = v_ticket2;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.partner_event_attendees(v_event);
    RAISE EXCEPTION 'FAIL asistentes visibles con partner_id NULL';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.partner_event_checkin_stats(v_event);
    RAISE EXCEPTION 'FAIL estadísticas visibles con partner_id NULL';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM * FROM public.partner_event_tier_live_stats(v_event);
    RAISE EXCEPTION 'FAIL tipos visibles con partner_id NULL';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'rf', v_event);
  IF v_scan.result::text <> 'forbidden' THEN RAISE EXCEPTION 'FAIL escaneo ajeno con partner_id NULL: %', v_scan.result; END IF;
  SELECT * INTO v_scan FROM public.scan_ticket_by_code(left(v_qr::text, 8), v_event, 'rf');
  IF v_scan.result::text <> 'forbidden' THEN RAISE EXCEPTION 'FAIL código ajeno con partner_id NULL: %', v_scan.result; END IF;
  RESET ROLE;
  IF has_function_privilege('authenticated', 'public.door_scan(uuid)', 'execute') THEN
    RAISE EXCEPTION 'FAIL door_scan sigue abierta a authenticated';
  END IF;
  UPDATE public.events SET partner_id = v_partner WHERE id = v_event;

  -- ------------------------------------------------------------------
  -- Cuenta rechazada: no vuelve a aprobarse ni crea organizaciones
  -- ------------------------------------------------------------------
  UPDATE public.profiles SET account_status = 'rejected' WHERE id = v_other;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.auto_approve_if_allowed('client');
  BEGIN
    PERFORM public.create_organization('RF Rechazado', 'ES', NULL);
    RAISE EXCEPTION 'FAIL una cuenta rechazada creó una organización';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  SELECT account_status::text INTO v_text FROM public.profiles WHERE id = v_other;
  IF v_text <> 'rejected' THEN RAISE EXCEPTION 'FAIL auto_approve deshizo el rechazo: %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- Reserva: la plaza de un pedido pendiente dura 15 min tras caducar
  -- ------------------------------------------------------------------
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_small, 2, v_friend, 'rf-friend@pasify.test', 'Fer', 'Amigo');
  UPDATE public.ticket_orders SET expires_at = now() - INTERVAL '5 minutes' WHERE id = v_order.order_id;
  v_ok := FALSE;
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_small, 1, NULL, 'rf-otro@pasify.test', 'Otro', 'Comprador');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM = 'tier_sold_out';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL se revendió una plaza en el margen de 15 min'; END IF;
  UPDATE public.ticket_orders SET expires_at = now() - INTERVAL '20 minutes' WHERE id = v_order.order_id;
  PERFORM public.create_ticket_order(v_event, v_small, 1, NULL, 'rf-otro@pasify.test', 'Otro', 'Comprador');

  RAISE NOTICE 'PASS review_fixes: reembolsos por RPC, partner_id NULL, transferencias, cuenta rechazada y reserva';
END $$;

ROLLBACK;
