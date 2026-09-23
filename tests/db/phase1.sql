-- Pasify · tests de la Fase 1 (saldo por local, aviso de soporte, código
-- corto en puerta, evento cancelado terminal). Datos sintéticos y ROLLBACK.

BEGIN;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_client  UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_tier    UUID;
  v_order   RECORD;
  v_scan    RECORD;
  v_bal     RECORD;
  v_count   INT;
  v_code    TEXT;
  v_conv    UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'p1-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'p1-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'p1-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('P1 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'P1 Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 2000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'General', 2000, 50) RETURNING id INTO v_tier;
  RESET ROLE;

  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'p1-client@pasify.test', 'Eva', 'Prueba');
  PERFORM public.set_order_stripe_session(v_order.order_id, 'cs_test_p1_' || v_order.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_p1_' || v_order.order_id, 'pi_test_p1', 2000, 0);
  SELECT left(qr_token::text, 8) INTO v_code FROM public.tickets WHERE order_id = v_order.order_id;

  -- Saldo: el local ve su fila; otro local no
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_bal FROM public.partner_balance_v WHERE org_id = v_org;
  IF v_bal.gross_cents IS DISTINCT FROM 2000 OR v_bal.fee_cents IS DISTINCT FROM 100 OR v_bal.net_cents IS DISTINCT FROM 1900 THEN
    RAISE EXCEPTION 'FAIL saldo del local: %', row_to_json(v_bal);
  END IF;

  -- Código corto en puerta
  SELECT * INTO v_scan FROM public.scan_ticket_by_code(upper(v_code), v_event, 'p1');
  IF NOT v_scan.success THEN RAISE EXCEPTION 'FAIL código corto: %', v_scan.result; END IF;
  SELECT * INTO v_scan FROM public.scan_ticket_by_code('00000000', v_event, 'p1');
  IF v_scan.result::text <> 'invalid_ticket' THEN RAISE EXCEPTION 'FAIL código inexistente: %', v_scan.result; END IF;

  -- Evento cancelado: no vuelve a publicarse desde el cliente
  UPDATE public.events SET status = 'cancelled' WHERE id = v_event;
  BEGIN
    UPDATE public.events SET status = 'published' WHERE id = v_event;
    RAISE EXCEPTION 'FAIL se reactivó un evento cancelado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_balance_v WHERE org_id = v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro local ve el saldo ajeno'; END IF;
  SELECT * INTO v_scan FROM public.scan_ticket_by_code(v_code, v_event, 'p1');
  IF v_scan.result::text <> 'forbidden' THEN RAISE EXCEPTION 'FAIL otro local escaneó por código: %', v_scan.result; END IF;
  -- Roles: cada uno ve los suyos y no los de otro usuario
  IF NOT ('partner' = ANY (public.get_user_roles(v_other))) THEN
    RAISE EXCEPTION 'FAIL get_user_roles propios: %', public.get_user_roles(v_other);
  END IF;
  IF cardinality(public.get_user_roles(v_partner)) <> 0 THEN
    RAISE EXCEPTION 'FAIL get_user_roles ajenos visibles';
  END IF;
  RESET ROLE;

  -- Soporte: la respuesta del admin genera aviso in-app
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('client_admin');
  RESET ROLE;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_other, 'admin', 'Hola, ya lo hemos revisado.');
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_client AND kind = 'support_reply';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL aviso de respuesta de soporte = %', v_count; END IF;

  RAISE NOTICE 'PASS phase1: saldo por local, código corto, evento cancelado terminal y aviso de soporte';
END $$;

ROLLBACK;
