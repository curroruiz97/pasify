-- Pasify · cancelar un evento con reembolso a los compradores (WP2.3).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.

BEGIN;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_client  UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_ghost   UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_tier    UUID;
  v_a       RECORD;
  v_b       RECORD;
  v_c       RECORD;
  v_g       RECORD;
  v_x       RECORD;
  v_res     JSONB;
  v_res2    JSONB;
  v_ids     UUID[];
  v_used    UUID;
  v_count   INT;
  v_text    TEXT;
  v_req     UUID;
  v_stale   UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'ce-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'ce-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'ce-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_ghost,   'ce-ghost-'   || v_ghost   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('CE Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'CE Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '6 hours', 'published', 2500)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'General', 2500, 100) RETURNING id INTO v_tier;
  RESET ROLE;

  -- Pedido A (2 entradas, una se usa), pedido B (1), invitado G (1),
  -- reserva C sin pagar del cliente y reserva X abandonada de otro usuario
  SELECT * INTO v_a FROM public.create_ticket_order(v_event, v_tier, 2, v_client, 'ce-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_a.order_id, 'cs_test_ce_a_' || v_a.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_ce_a_' || v_a.order_id, 'pi_test_ce_a', 5000, 250);
  SELECT * INTO v_b FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'ce-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_b.order_id, 'cs_test_ce_b_' || v_b.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_ce_b_' || v_b.order_id, 'pi_test_ce_b', 2500, 125);
  SELECT * INTO v_g FROM public.create_ticket_order(v_event, v_tier, 1, NULL, 'invitado@pasify.test', 'Gus', 'Invitado');
  PERFORM public.set_order_stripe_session(v_g.order_id, 'cs_test_ce_g_' || v_g.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_ce_g_' || v_g.order_id, 'pi_test_ce_g', 2500, 125);
  SELECT * INTO v_c FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'ce-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_c.order_id, 'cs_test_ce_c_' || v_c.order_id);
  SELECT * INTO v_x FROM public.create_ticket_order(v_event, v_tier, 1, v_ghost, 'ce-ghost@pasify.test', 'Ghost', 'Abandona');
  PERFORM public.cancel_ticket_order(v_x.order_id);
  SELECT id INTO v_used FROM public.tickets WHERE order_id = v_a.order_id ORDER BY id LIMIT 1;
  UPDATE public.tickets SET status = 'used', used_at = now() WHERE id = v_used;

  -- Nadie ajeno cancela; tampoco quien lo creó si no gestiona la organización
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.partner_cancel_event(v_event, 'Lluvia');
    RAISE EXCEPTION 'FAIL otro local canceló el evento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_cancellation_refund_requests(v_event, v_other, NULL, NULL);
    RAISE EXCEPTION 'FAIL create_cancellation_refund_requests ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  UPDATE public.events SET partner_id = v_other WHERE id = v_event;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.partner_cancel_event(v_event, 'Lo creé yo');
    RAISE EXCEPTION 'FAIL el creador ajeno a la organización canceló el evento';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  UPDATE public.events SET partner_id = v_partner WHERE id = v_event;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.partner_cancel_event(v_event, '  ');
    RAISE EXCEPTION 'FAIL cancelación sin motivo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;

  v_res := public.partner_cancel_event(v_event, 'Problema con la licencia');
  RESET ROLE;

  SELECT status::text INTO v_text FROM public.events WHERE id = v_event;
  IF v_text <> 'cancelled' THEN RAISE EXCEPTION 'FAIL el evento no quedó cancelado: %', v_text; END IF;
  SELECT array_agg(x::uuid) INTO v_ids FROM jsonb_array_elements_text(v_res->'refund_request_ids') x;
  IF cardinality(v_ids) <> 3 THEN RAISE EXCEPTION 'FAIL solicitudes de reembolso = % (esperadas 3)', cardinality(v_ids); END IF;
  SELECT count(*) INTO v_count FROM public.refund_requests
   WHERE id = ANY (v_ids) AND status = 'approved' AND reason_code = 'event_cancelled' AND amount_cents = 2500;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL solicitudes mal creadas: %', v_count; END IF;
  -- El invitado: sin usuario y con el email del pedido
  SELECT count(*) INTO v_count FROM public.refund_requests
   WHERE id = ANY (v_ids) AND requester_user_id IS NULL AND requester_email = 'invitado@pasify.test';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la entrada del invitado no tiene solicitud'; END IF;
  IF (v_res->>'tickets_without_account')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL entradas sin solicitud: %', v_res->>'tickets_without_account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE ticket_id = v_used) THEN
    RAISE EXCEPTION 'FAIL se pidió reembolso de una entrada ya usada';
  END IF;
  IF jsonb_array_length(v_res->'pending_session_ids') < 1 THEN
    RAISE EXCEPTION 'FAIL sesiones pendientes a caducar: %', v_res->'pending_session_ids';
  END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_c.order_id;
  IF v_text <> 'failed' THEN RAISE EXCEPTION 'FAIL la reserva sin pagar sigue: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_client AND kind = 'event_cancelled';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL avisos de cancelación = %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_ghost AND kind = 'event_cancelled';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL se avisó a quien solo abandonó un pago'; END IF;

  -- Una solicitud atascada en proceso se devuelve para retomarla
  SELECT id INTO v_stale FROM public.refund_requests WHERE id = ANY (v_ids) AND order_id = v_b.order_id;
  UPDATE public.refund_requests SET status = 'processing' WHERE id = v_stale;
  -- set_updated_at reescribe updated_at: sin triggers para fecharla atrás.
  SET LOCAL session_replication_role = replica;
  UPDATE public.refund_requests SET updated_at = now() - INTERVAL '20 minutes' WHERE id = v_stale;
  SET LOCAL session_replication_role = origin;

  -- Repetir es seguro: mismas solicitudes, motivo original, sin nuevos avisos
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_res2 := public.partner_cancel_event(v_event, 'Reintento de reembolsos');
  -- Y no se puede volver a publicar
  BEGIN
    UPDATE public.events SET status = 'published' WHERE id = v_event;
    RAISE EXCEPTION 'FAIL se republicó un evento cancelado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF NOT (v_res2->>'already_cancelled')::boolean THEN RAISE EXCEPTION 'FAIL la segunda llamada no lo ve cancelado'; END IF;
  IF jsonb_array_length(v_res2->'refund_request_ids') <> 2 THEN
    RAISE EXCEPTION 'FAIL aprobadas en el reintento: %', v_res2->'refund_request_ids';
  END IF;
  IF NOT (v_res2->'stale_refund_request_ids') @> to_jsonb(ARRAY[v_stale::text]) THEN
    RAISE EXCEPTION 'FAIL la atascada no se devuelve para retomarla: %', v_res2->'stale_refund_request_ids';
  END IF;
  IF jsonb_array_length(v_res2->'pending_session_ids') < 1 THEN
    RAISE EXCEPTION 'FAIL el reintento ya no caduca las sesiones';
  END IF;
  SELECT count(*) INTO v_count FROM public.refund_requests WHERE event_id = v_event;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL solicitudes duplicadas: %', v_count; END IF;
  SELECT decision_note INTO v_text FROM public.refund_requests WHERE id = v_ids[1];
  IF v_text IS DISTINCT FROM 'Problema con la licencia' THEN RAISE EXCEPTION 'FAIL el reintento cambió el motivo: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_client AND kind = 'event_cancelled';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL avisos repetidos: %', v_count; END IF;

  -- Stripe confirma un reembolso: se casa por el id de la solicitud aunque
  -- haya varias en proceso del mismo pedido
  UPDATE public.refund_requests SET status = 'processing' WHERE id = ANY (v_ids);
  SELECT r.id INTO v_req FROM public.refund_requests r WHERE r.id = ANY (v_ids) AND r.order_id = v_a.order_id;
  PERFORM public.mark_refund_processed('re_test_ce_1', 2500, 'pi_test_ce_a', v_req);
  SELECT status::text INTO v_text FROM public.refund_requests WHERE id = v_req;
  IF v_text <> 'refunded' THEN RAISE EXCEPTION 'FAIL el reembolso no se cerró: %', v_text; END IF;
  SELECT status::text INTO v_text FROM public.tickets WHERE id = (SELECT ticket_id FROM public.refund_requests WHERE id = v_req);
  IF v_text <> 'refunded' THEN RAISE EXCEPTION 'FAIL la entrada no quedó reembolsada: %', v_text; END IF;
  -- Idempotente
  PERFORM public.mark_refund_processed('re_test_ce_1', 2500, 'pi_test_ce_a', v_req);
  IF has_function_privilege('authenticated', 'public.mark_refund_processed(text, integer, text, uuid)', 'execute') THEN
    RAISE EXCEPTION 'FAIL mark_refund_processed ejecutable por authenticated';
  END IF;

  RAISE NOTICE 'PASS cancel_event: permisos, invitados, reservas, avisos, reintento, atascadas y cierre por metadatos';
END $$;

ROLLBACK;
