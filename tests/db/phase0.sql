-- Pasify · tests de la Fase 0 (seguridad, flujo de entradas y escáner)
--
-- Crea usuarios, organización, evento y pedidos sintéticos, comprueba el
-- comportamiento como cada rol y lo deshace todo con ROLLBACK. Cualquier
-- incumplimiento lanza RAISE EXCEPTION 'FAIL …' y aborta.
--
-- Local:  psql postgresql://postgres:postgres@localhost:54322/postgres -v ON_ERROR_STOP=1 -f tests/db/phase0.sql

BEGIN;

DO $$
DECLARE
  v_partner   UUID := gen_random_uuid();
  v_client    UUID := gen_random_uuid();
  v_other     UUID := gen_random_uuid();
  v_org       UUID;
  v_other_org UUID;
  v_event     UUID;
  v_event2    UUID;
  v_tier      UUID;
  v_tier_vip  UUID;
  v_order     RECORD;
  v_order2    RECORD;
  v_paid      RECORD;
  v_scan      RECORD;
  v_count     INT;
  v_text      TEXT;
  v_text2     TEXT;
  v_t1        UUID;
  v_t2        UUID;
  v_qr1       UUID;
  v_qr2       UUID;
  v_qr2_new   UUID;
  v_token     UUID;
  v_proposal  UUID;
  v_json      JSONB;
BEGIN
  -- ------------------------------------------------------------------
  -- Usuarios: el trigger de alta da el rol y aprueba la cuenta
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'p0-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'p0-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'p0-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  SELECT account_status::text INTO v_text FROM public.profiles WHERE id = v_partner;
  IF v_text IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'FAIL alta de local no aprobada: %', v_text; END IF;
  IF NOT public.has_role(v_partner, 'partner') THEN RAISE EXCEPTION 'FAIL el local no tiene rol partner'; END IF;
  IF NOT public.has_role(v_client, 'client') THEN RAISE EXCEPTION 'FAIL el cliente no tiene rol client'; END IF;

  -- ------------------------------------------------------------------
  -- Local: organización (con plan gratuito automático) y evento
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_org := public.create_organization('P0 Local de prueba', 'ES', NULL);
  UPDATE public.profiles SET business_name = 'P0 Local de prueba' WHERE id = v_partner;

  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents, capacity)
  VALUES (v_partner, v_org, 'P0 Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 1000, 3)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'P0 Otro evento', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'General', 1000, 2, 4) RETURNING id INTO v_tier;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'VIP', 2500, 5, 4) RETURNING id INTO v_tier_vip;

  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.partner_subscriptions WHERE org_id = v_org AND status = 'active' AND plan_code = 'free';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la organización nueva no tiene plan gratuito'; END IF;
  SELECT price_cents INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 1000 THEN RAISE EXCEPTION 'FAIL precio desde del evento = %', v_count; END IF;

  -- Otro local con su organización
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_other_org := public.create_organization('P0 Otro local', 'ES', NULL);
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- Compra: reserva con bloqueo, sin sobreventa
  -- ------------------------------------------------------------------
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_tier, 2, v_client, 'P0-Client@Pasify.test', 'Ana', 'Prueba', NULL, 5, 30);
  IF v_order.qty <> 2 OR v_order.subtotal_cents <> 2000 OR v_order.fee_cents <> 100 OR v_order.timezone IS NULL THEN
    RAISE EXCEPTION 'FAIL create_ticket_order devolvió %', row_to_json(v_order);
  END IF;

  BEGIN
    PERFORM public.create_ticket_order(v_event, v_tier, 1, v_client, 'p0-client@pasify.test');
    RAISE EXCEPTION 'FAIL no saltó tier_sold_out';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'tier_sold_out' THEN RAISE EXCEPTION 'FAIL esperaba tier_sold_out y llegó %', SQLERRM; END IF;
  END;

  PERFORM public.set_order_stripe_session(v_order.order_id, 'cs_test_p0a_' || v_order.order_id);
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_p0a_' || v_order.order_id, 'pi_test_p0a', 2000, 0);
  IF NOT v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL el primer pago no es newly_paid'; END IF;
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_p0a_' || v_order.order_id, 'pi_test_p0a', 2000, 0);
  IF v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL el segundo pago no debe ser newly_paid'; END IF;

  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_order.order_id AND status = 'paid';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL entradas pagadas = %', v_count; END IF;
  SELECT sold INTO v_count FROM public.ticket_tiers WHERE id = v_tier;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL tier.sold = %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.application_fees_ledger WHERE ticket_order_id = v_order.order_id AND amount_cents = 100;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL registro de comisión = % filas', v_count; END IF;

  SELECT t.id, t.qr_token INTO v_t1, v_qr1 FROM public.tickets t WHERE t.order_id = v_order.order_id ORDER BY t.id LIMIT 1;
  SELECT t.id, t.qr_token INTO v_t2, v_qr2 FROM public.tickets t WHERE t.order_id = v_order.order_id AND t.id <> v_t1 LIMIT 1;

  -- Aforo del evento (3): queda 1 plaza aunque el VIP tenga cupo 5
  SELECT * INTO v_order2 FROM public.create_ticket_order(v_event, v_tier_vip, 1, v_client, 'p0-client@pasify.test');
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_tier_vip, 1, v_other, 'p0-other@pasify.test');
    RAISE EXCEPTION 'FAIL no saltó event_sold_out';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'event_sold_out' THEN RAISE EXCEPTION 'FAIL esperaba event_sold_out y llegó %', SQLERRM; END IF;
  END;

  -- Pedido que caduca mientras se paga: el pago lo revive
  PERFORM public.set_order_stripe_session(v_order2.order_id, 'cs_test_p0b_' || v_order2.order_id);
  PERFORM public.expire_ticket_order('cs_test_p0b_' || v_order2.order_id);
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_order2.order_id AND status = 'cancelled';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la caducidad no canceló la entrada'; END IF;
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_p0b_' || v_order2.order_id, 'pi_test_p0b', 2500, 0);
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_order2.order_id AND status = 'paid';
  IF v_count <> 1 OR NOT v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL el pago tras caducar no revivió la entrada'; END IF;

  -- ------------------------------------------------------------------
  -- Cliente: lee sus entradas, no ejecuta RPC de servicio, no toca columnas
  -- protegidas, transfiere una entrada
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count FROM public.tickets;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL el cliente ve % entradas (esperaba 3)', v_count; END IF;

  BEGIN
    PERFORM public.mark_order_paid('x', 'y', 1, 0);
    RAISE EXCEPTION 'FAIL mark_order_paid ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.enqueue_notification(v_partner, 'system', 'x', 'x');
    RAISE EXCEPTION 'FAIL enqueue_notification ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.cashless_topup(gen_random_uuid(), 100, 'card'::public.cashless_topup_source_t, NULL);
    RAISE EXCEPTION 'FAIL cashless_topup ejecutable por authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_partner_free_plan();
    RAISE EXCEPTION 'FAIL un cliente pudo reclamar plan de local';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.create_organization('Org de cliente', 'ES', NULL);
    RAISE EXCEPTION 'FAIL un cliente pudo crear una organización';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.profiles SET account_status = 'rejected', email = 'hack@pasify.test', first_name = 'Ana' WHERE id = v_client;
  SELECT account_status::text, email INTO v_text, v_text2 FROM public.profiles WHERE id = v_client;
  IF v_text <> 'approved' OR v_text2 = 'hack@pasify.test' THEN
    RAISE EXCEPTION 'FAIL columnas protegidas modificables: % / %', v_text, v_text2;
  END IF;

  PERFORM public.transfer_ticket(v_t2, 'p0-other-' || v_other || '@pasify.test', NULL);
  RESET ROLE;

  -- Un tercero no puede transferir ni pedir reembolso de una entrada ajena
  -- (antes el NULL de transferred_to_user_id saltaba el control)
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.transfer_ticket(v_t1, 'p0-other-' || v_other || '@pasify.test', NULL);
    RAISE EXCEPTION 'FAIL un tercero pudo transferir una entrada ajena';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.request_refund(v_t1, 'robo', NULL);
    RAISE EXCEPTION 'FAIL un tercero pudo pedir reembolso de una entrada ajena';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- Acepta la transferencia: QR nuevo, titular nuevo; el comprador deja de verla
  SELECT invitation_token INTO v_token FROM public.ticket_transfers WHERE ticket_id = v_t2 AND status = 'pending';
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.accept_ticket_transfer(v_token);
  SELECT qr_token INTO v_qr2_new FROM public.tickets WHERE id = v_t2;
  IF v_qr2_new IS NULL OR v_qr2_new = v_qr2 THEN RAISE EXCEPTION 'FAIL el QR no se regeneró al transferir'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.tickets WHERE id = v_t2;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL el comprador original sigue viendo la entrada transferida'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- Escáner
  -- ------------------------------------------------------------------
  -- Otro local: forbidden y sin datos personales
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr1, 'p0', NULL);
  IF v_scan.result::text <> 'forbidden' OR v_scan.buyer_email IS NOT NULL OR v_scan.buyer_first_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL scan de otro local: % (email %)', v_scan.result, v_scan.buyer_email;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT * INTO v_scan FROM public.scan_ticket(v_qr1, 'p0', v_event);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' OR v_scan.tier_name <> 'General' THEN
    RAISE EXCEPTION 'FAIL escaneo válido: % %', v_scan.result, v_scan.tier_name;
  END IF;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr1, 'p0', v_event);
  IF v_scan.result::text <> 'already_used' THEN RAISE EXCEPTION 'FAIL doble escaneo: %', v_scan.result; END IF;

  SELECT * INTO v_scan FROM public.scan_ticket(v_qr2, 'p0', v_event);
  IF v_scan.result::text <> 'invalid_ticket' THEN RAISE EXCEPTION 'FAIL el QR anterior a la transferencia sigue valiendo: %', v_scan.result; END IF;

  SELECT * INTO v_scan FROM public.scan_ticket(v_qr2_new, 'p0', v_event2);
  IF v_scan.result::text <> 'wrong_event' OR v_scan.event_id <> v_event THEN
    RAISE EXCEPTION 'FAIL entrada de otro evento: %', v_scan.result;
  END IF;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr2_new, 'p0', v_event2, TRUE, NULL);
  IF v_scan.result::text <> 'wrong_event' THEN RAISE EXCEPTION 'FAIL se forzó sin motivo'; END IF;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr2_new, 'p0', v_event2, TRUE, 'Error de taquilla');
  IF NOT v_scan.success OR NOT v_scan.forced THEN RAISE EXCEPTION 'FAIL forzar con motivo: %', v_scan.result; END IF;

  -- Asistentes: sin qr_token en el resultado (la función ya no lo devuelve)
  SELECT count(*) INTO v_count FROM public.partner_event_attendees(v_event);
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL asistentes = %', v_count; END IF;

  -- No puede mover su evento a otra organización
  BEGIN
    UPDATE public.events SET org_id = v_other_org WHERE id = v_event;
    RAISE EXCEPTION 'FAIL se pudo mover el evento a otra organización';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- No puede cerrar la cuenta con eventos futuros con ventas
  BEGIN
    PERFORM public.partner_close_account();
    RAISE EXCEPTION 'FAIL cerró la cuenta con ventas pendientes';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'partner_has_upcoming_sales' THEN RAISE EXCEPTION 'FAIL esperaba partner_has_upcoming_sales: %', SQLERRM; END IF;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- Pricing: una propuesta no puede cambiar un tipo de otro evento
  -- ------------------------------------------------------------------
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event2, v_tier_vip, 2500, 50, 'pending')
  RETURNING id INTO v_proposal;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.apply_pricing_proposal(v_proposal);
    RAISE EXCEPTION 'FAIL una propuesta cambió el precio de un tipo de otro evento';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
  PERFORM public.reject_pricing_proposal(v_proposal, 'no');
  RESET ROLE;
  SELECT status INTO v_text FROM public.pricing_proposals WHERE id = v_proposal;
  IF v_text <> 'rejected' THEN RAISE EXCEPTION 'FAIL reject_pricing_proposal dejó %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- Tipo de entrada cerrado: lo lee quien tiene una entrada de ese tipo
  -- ------------------------------------------------------------------
  UPDATE public.ticket_tiers SET status = 'closed' WHERE id = v_tier_vip;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE id = v_tier_vip;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el titular no ve el tipo cerrado de su entrada'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE id = v_tier_vip;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro usuario ve un tipo cerrado ajeno'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- Anónimo: perfil público sin datos personales
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.profiles WHERE id = v_partner;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon lee la fila de profiles del local'; END IF;
  SELECT count(*) INTO v_count FROM public.public_partners WHERE id = v_partner;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL public_partners no enseña al local aprobado'; END IF;
  RESET ROLE;

  RAISE NOTICE 'PASS phase0: seguridad, compra, pago, caducidad, transferencia, escáner, pricing y perfil público';
END $$;

ROLLBACK;
