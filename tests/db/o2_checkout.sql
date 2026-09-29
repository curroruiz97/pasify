-- Pasify · checkout, ola 2 (S1): suspensión de un local (T1), disponibilidad
-- y reservas que se liberan (T2), caducidad y lotes de conciliación (T3) y
-- entradas gratis (T4). Migración 20260927110000.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción; el ROLLBACK de este fichero las deshace también):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" -f supabase/migrations/<cada una> \
--     -f tests/db/o2_checkout.sql -c "ROLLBACK;"

BEGIN;

DO $$
DECLARE
  v_partner  UUID := gen_random_uuid();
  v_client   UUID := gen_random_uuid();
  v_client2  UUID := gen_random_uuid();
  v_other    UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();
  v_nobody   UUID := gen_random_uuid();
  v_org      UUID;
  v_event    UUID;   -- publicado, aforo y dos tipos (pago y gratis)
  v_free_ev  UUID;   -- publicado, sin límite
  v_draft    UUID;   -- borrador del mismo local
  v_rec_ev   UUID;   -- pedidos para la caducidad y la conciliación
  v_general  UUID;
  v_gratis   UUID;
  v_libre    UUID;
  v_rec_tier UUID;
  v_order    RECORD;
  v_free     RECORD;
  v_scan     RECORD;
  v_p1       RECORD;
  v_p2       RECORD;
  v_p3       RECORD;
  v_p4       RECORD;
  v_count    INT;
  v_int      INT;
  v_bool     BOOLEAN;
  v_text     TEXT;
  v_ts       TIMESTAMPTZ;
  v_qr       UUID;
  v_ids      UUID[];
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o2-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o2-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client2, 'o2-client2-' || v_client2 || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'o2-other-'   || v_other   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,   'o2-admin-'   || v_admin   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_nobody,  'o2-nobody-'  || v_nobody  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O2 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 0)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order)
  VALUES (v_event, 'General', 1000, 5, 4, 1) RETURNING id INTO v_general;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order)
  VALUES (v_event, 'Gratis', 0, 3, 2, 0) RETURNING id INTO v_gratis;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Libre', 'Madrid', now() + INTERVAL '2 days', now() + INTERVAL '2 days 6 hours', 'published', 0)
  RETURNING id INTO v_free_ev;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_free_ev, 'Libre', 0, NULL, 10) RETURNING id INTO v_libre;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Borrador', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'draft', 1000)
  RETURNING id INTO v_draft;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_draft, 'General', 1000, 10, 4);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2 Conciliación', 'Madrid', now() + INTERVAL '4 days', now() + INTERVAL '4 days 6 hours', 'published', 1000)
  RETURNING id INTO v_rec_ev;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_rec_ev, 'General', 1000, 100, 10) RETURNING id INTO v_rec_tier;
  RESET ROLE;

  -- ==================================================================
  -- Permisos
  -- ==================================================================
  IF NOT (has_function_privilege('anon', 'public.org_can_sell(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.org_can_sell(uuid)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.event_availability(uuid)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.event_availability(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'FAIL org_can_sell / event_availability no las ejecutan anon y authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.admin_set_org_suspension(uuid,boolean,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_set_org_suspension(uuid,boolean,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL permisos de admin_set_org_suspension';
  END IF;
  FOR v_text IN SELECT unnest(ARRAY[
      'public.create_free_ticket_order(uuid,uuid,integer,uuid,text,text,text,text)',
      'public.ticket_seats_held(uuid,uuid,uuid)',
      'public.pending_orders_to_reconcile(integer,uuid[])',
      'public.cron_expire_pending_orders()',
      'public.schedule_reconcile_pending_orders()'])
  LOOP
    IF has_function_privilege('anon', v_text, 'EXECUTE') OR has_function_privilege('authenticated', v_text, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL % la ejecuta un cliente', v_text;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.create_free_ticket_order(uuid,uuid,integer,uuid,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.pending_orders_to_reconcile(integer,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL service_role no ejecuta las RPC internas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.org_can_sell(uuid)'::regprocedure
                   AND prosecdef AND provolatile = 's' AND prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'FAIL org_can_sell no es STABLE SECURITY DEFINER booleana';
  END IF;

  -- ==================================================================
  -- T2 · Disponibilidad: reservas, aforo del evento y liberar plazas
  -- ==================================================================
  -- Aforo = 5 + 3 (trigger de 20260926150000); se baja a 6 para probar que
  -- el del evento también limita.
  SELECT capacity INTO v_int FROM public.events WHERE id = v_event;
  IF v_int IS DISTINCT FROM 8 THEN RAISE EXCEPTION 'FAIL aforo inicial = %', v_int; END IF;
  UPDATE public.events SET capacity = 6 WHERE id = v_event;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL General al empezar: %', v_int; END IF;
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_gratis;
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL Gratis al empezar: %', v_int; END IF;
  -- Orden: sort_order (Gratis 0, General 1)
  SELECT array_agg(tier_id) INTO v_ids FROM public.event_availability(v_event);
  IF v_ids IS DISTINCT FROM ARRAY[v_gratis, v_general] THEN RAISE EXCEPTION 'FAIL orden de tipos: %', v_ids; END IF;
  -- Sin límite: NULL y no agotado
  SELECT count(*) INTO v_count FROM public.event_availability(v_free_ev) WHERE tier_id = v_libre AND remaining IS NULL AND NOT sold_out;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL un tipo sin límite no sale como NULL'; END IF;
  -- Borrador: nada para el público
  SELECT count(*) INTO v_count FROM public.event_availability(v_draft);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve la disponibilidad de un borrador'; END IF;
  RESET ROLE;

  -- Una reserva pendiente ocupa plaza
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 2, v_client, 'o2-client@pasify.test', 'Clara', 'Dos');
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL General con 2 reservadas: %', v_int; END IF;

  -- ==================================================================
  -- T4 · Entradas gratis
  -- ==================================================================
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, NULL, 'o2-invitado@pasify.test');
    RAISE EXCEPTION 'FAIL pedido gratis sin comprador';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'buyer_user_required' THEN RAISE EXCEPTION 'FAIL esperaba buyer_user_required: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_general, 1, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL pedido gratis de un tipo de pago';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'tier_not_free' THEN RAISE EXCEPTION 'FAIL esperaba tier_not_free: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 0, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL cantidad 0';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'invalid_qty' THEN RAISE EXCEPTION 'FAIL esperaba invalid_qty: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_free_ticket_order(v_draft, (SELECT id FROM public.ticket_tiers WHERE event_id = v_draft), 1, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL pedido gratis de un borrador';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'event_not_available' THEN RAISE EXCEPTION 'FAIL esperaba event_not_available: %', SQLERRM; END IF;
  END;

  -- Ventana de venta
  UPDATE public.ticket_tiers SET sale_starts_at = now() + INTERVAL '1 hour' WHERE id = v_gratis;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL gratis antes de abrir la venta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'sale_not_started' THEN RAISE EXCEPTION 'FAIL esperaba sale_not_started: %', SQLERRM; END IF;
  END;
  UPDATE public.ticket_tiers SET sale_starts_at = NULL, sale_ends_at = now() - INTERVAL '1 minute' WHERE id = v_gratis;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL gratis con la venta cerrada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'sale_ended' THEN RAISE EXCEPTION 'FAIL esperaba sale_ended: %', SQLERRM; END IF;
  END;
  UPDATE public.ticket_tiers SET sale_ends_at = NULL WHERE id = v_gratis;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 3, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL gratis por encima del máximo por persona';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'qty_exceeds_per_user_max' THEN RAISE EXCEPTION 'FAIL esperaba qty_exceeds_per_user_max: %', SQLERRM; END IF;
  END;

  -- Pedido gratis: pagado a 0 €, sin comisión ni Stripe, entradas válidas
  SELECT * INTO v_free FROM public.create_free_ticket_order(v_event, v_gratis, 2, v_client, ' O2-Client@Pasify.test ', 'Clara', 'Dos');
  IF v_free.qty <> 2 OR v_free.org_id IS DISTINCT FROM v_org OR v_free.event_id <> v_event THEN
    RAISE EXCEPTION 'FAIL create_free_ticket_order devolvió %', row_to_json(v_free);
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_orders o
   WHERE o.id = v_free.order_id AND o.status = 'paid' AND o.paid_at IS NOT NULL
     AND o.total_cents = 0 AND o.subtotal_cents = 0 AND o.fees_cents = 0
     AND o.livemode IS NULL AND o.stripe_session_id IS NULL AND o.stripe_destination_account IS NULL
     AND o.buyer_email = 'o2-client@pasify.test' AND o.buyer_user_id = v_client
     AND (o.metadata->>'free')::boolean;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el pedido gratis no quedó pagado a 0 €'; END IF;
  SELECT count(*) INTO v_count FROM public.tickets t
   WHERE t.order_id = v_free.order_id AND t.status = 'paid' AND t.paid_at IS NOT NULL
     AND t.amount_paid_cents = 0 AND t.qr_token IS NOT NULL AND t.access_url_token IS NOT NULL
     AND t.tier_id = v_gratis AND t.holder_email = 'o2-client@pasify.test';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL entradas gratis válidas = %', v_count; END IF;
  SELECT sold INTO v_int FROM public.ticket_tiers WHERE id = v_gratis;
  IF v_int <> 2 THEN RAISE EXCEPTION 'FAIL sold del tipo gratis = %', v_int; END IF;
  IF EXISTS (SELECT 1 FROM public.application_fees_ledger WHERE ticket_order_id = v_free.order_id) THEN
    RAISE EXCEPTION 'FAIL un pedido gratis dejó registro de comisión';
  END IF;
  -- Suma lo anterior: ya tiene 2 de 2
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, v_client, 'o2-client@pasify.test');
    RAISE EXCEPTION 'FAIL el máximo por persona no suma lo anterior';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'qty_exceeds_per_user_max' THEN RAISE EXCEPTION 'FAIL esperaba qty_exceeds_per_user_max: %', SQLERRM; END IF;
  END;

  -- Evento 6: 2 reservadas + 2 gratis → quedan 2 en el evento
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'FAIL General limitado por el aforo del evento: %', v_int; END IF;
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_gratis;
  IF v_int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL Gratis tras 2 gratis: %', v_int; END IF;

  -- Cancelar la reserva libera sus plazas (cancel_ticket_order)
  PERFORM public.cancel_ticket_order(v_order.order_id);
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'FAIL General tras cancelar la reserva: %', v_int; END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_order.order_id;
  IF v_text <> 'failed' THEN RAISE EXCEPTION 'FAIL la reserva cancelada quedó %', v_text; END IF;
  -- … y cuenta para el máximo por persona: ya no está
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 4, v_client, 'o2-client@pasify.test', 'Clara', 'Dos');
  PERFORM public.cancel_ticket_order(v_order.order_id);

  -- Una reserva caducada (más de 15 min pasada expires_at) ya no ocupa
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 1, v_client2, 'o2-client2@pasify.test');
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL General con 1 reservada: %', v_int; END IF;
  UPDATE public.ticket_orders SET expires_at = now() - INTERVAL '20 minutes' WHERE id = v_order.order_id;
  SELECT remaining INTO v_int FROM public.event_availability(v_event) WHERE tier_id = v_general;
  IF v_int IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'FAIL una reserva caducada sigue ocupando: %', v_int; END IF;

  -- Agotado: el último gratis
  SELECT * INTO v_p1 FROM public.create_free_ticket_order(v_event, v_gratis, 1, v_client2, 'o2-client2@pasify.test');
  SELECT sold_out, remaining INTO v_bool, v_int FROM public.event_availability(v_event) WHERE tier_id = v_gratis;
  IF NOT v_bool OR v_int <> 0 THEN RAISE EXCEPTION 'FAIL Gratis agotado: % / %', v_bool, v_int; END IF;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, v_other, 'o2-other@pasify.test');
    RAISE EXCEPTION 'FAIL gratis por encima del cupo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'tier_sold_out' THEN RAISE EXCEPTION 'FAIL esperaba tier_sold_out: %', SQLERRM; END IF;
  END;
  -- Aforo del evento: 3 gratis ocupadas; con aforo 3 no entra ni una más
  UPDATE public.ticket_tiers SET capacity = 10 WHERE id = v_gratis;
  UPDATE public.events SET capacity = 3 WHERE id = v_event;
  BEGIN
    PERFORM public.create_free_ticket_order(v_event, v_gratis, 1, v_other, 'o2-other@pasify.test');
    RAISE EXCEPTION 'FAIL gratis por encima del aforo del evento';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'event_sold_out' THEN RAISE EXCEPTION 'FAIL esperaba event_sold_out: %', SQLERRM; END IF;
  END;
  SELECT count(*) INTO v_count FROM public.event_availability(v_event) WHERE sold_out AND remaining = 0;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL con el aforo lleno no salen agotados los dos tipos (%)', v_count; END IF;
  UPDATE public.events SET capacity = 20 WHERE id = v_event;

  -- ==================================================================
  -- T1 · Suspensión de un local
  -- ==================================================================
  IF NOT public.org_can_sell(v_org) OR NOT public.org_can_sell(NULL) OR public.org_can_sell(gen_random_uuid()) THEN
    RAISE EXCEPTION 'FAIL org_can_sell antes de suspender';
  END IF;
  UPDATE public.organizations SET stripe_connect_account_id = 'acct_test_o2_' || left(v_org::text, 8),
                                  stripe_connect_charges_enabled = TRUE
   WHERE id = v_org;
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 1, v_other, 'o2-other@pasify.test');
  IF v_order.stripe_destination_account IS DISTINCT FROM 'acct_test_o2_' || left(v_org::text, 8) THEN
    RAISE EXCEPTION 'FAIL sin destino Connect con el local activo: %', v_order.stripe_destination_account;
  END IF;
  PERFORM public.cancel_ticket_order(v_order.order_id);

  -- Solo un admin de plataforma
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_set_org_suspension(v_org, TRUE, 'Me suspendo');
    RAISE EXCEPTION 'FAIL el dueño pudo suspender';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  -- Ni sin usuario en el JWT (service_role, SQL directo)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.admin_set_org_suspension(v_org, TRUE, 'Servidor');
    RAISE EXCEPTION 'FAIL se suspendió sin usuario admin';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_set_org_suspension(gen_random_uuid(), TRUE, 'No existe');
    RAISE EXCEPTION 'FAIL suspender una organización que no existe';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM <> 'org_not_found' THEN RAISE EXCEPTION 'FAIL esperaba org_not_found: %', SQLERRM; END IF;
  END;
  PERFORM public.admin_set_org_suspension(v_org, TRUE, '  Documentación pendiente  ');
  -- Repetir no vuelve a avisar ni cambia la fecha
  SELECT suspended_at INTO v_ts FROM public.organizations WHERE id = v_org;
  PERFORM public.admin_set_org_suspension(v_org, TRUE, NULL);
  RESET ROLE;

  SELECT count(*) INTO v_count FROM public.organizations
   WHERE id = v_org AND suspended_at = v_ts AND suspended_reason = 'Documentación pendiente';
  IF v_ts IS NULL OR v_count <> 1 THEN RAISE EXCEPTION 'FAIL suspensión mal guardada'; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_partner AND kind = 'org_suspended';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL avisos de suspensión al dueño = %', v_count; END IF;
  IF public.org_can_sell(v_org) THEN RAISE EXCEPTION 'FAIL org_can_sell con el local suspendido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE target_kind = 'organizations' AND target_id = v_org
                   AND after->>'suspended_at' IS NOT NULL AND actor_user_id = v_admin) THEN
    RAISE EXCEPTION 'FAIL la suspensión no queda en audit_logs con el admin';
  END IF;

  -- No vende
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_general, 1, v_other, 'o2-other@pasify.test');
    RAISE EXCEPTION 'FAIL un local suspendido vende';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'org_suspended' THEN RAISE EXCEPTION 'FAIL esperaba org_suspended: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_free_ticket_order(v_free_ev, v_libre, 1, v_other, 'o2-other@pasify.test');
    RAISE EXCEPTION 'FAIL un local suspendido da entradas gratis';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'org_suspended' THEN RAISE EXCEPTION 'FAIL esperaba org_suspended (gratis): %', SQLERRM; END IF;
  END;

  -- El dueño no se la quita editando su organización
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.organizations SET suspended_at = NULL, suspended_reason = NULL, name = 'O2 Local editado' WHERE id = v_org;
  -- No publica: ni un borrador ni un evento nuevo
  BEGIN
    UPDATE public.events SET status = 'published' WHERE id = v_draft;
    RAISE EXCEPTION 'FAIL un local suspendido publica un borrador';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
    VALUES (v_partner, v_org, 'O2 Nuevo', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 1000);
    RAISE EXCEPTION 'FAIL un local suspendido crea un evento publicado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- El panel sigue: ve sus eventos, sus tipos y la disponibilidad
  SELECT count(*) INTO v_count FROM public.events WHERE id IN (v_event, v_draft, v_free_ev);
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL el local suspendido no ve sus eventos (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_availability(v_event);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el local suspendido no ve su disponibilidad'; END IF;
  -- La puerta sigue: entra una entrada gratis pagada
  SELECT qr_token INTO v_qr FROM public.tickets WHERE order_id = v_free.order_id ORDER BY id LIMIT 1;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'o2', v_event);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' THEN
    RAISE EXCEPTION 'FAIL la puerta de un local suspendido: %', v_scan.result;
  END IF;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.organizations
   WHERE id = v_org AND suspended_at IS NOT NULL AND suspended_reason IS NOT NULL AND name = 'O2 Local editado';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el dueño se quitó la suspensión (o no pudo editar el nombre)'; END IF;

  -- Fuera de los listados públicos (y sus tipos)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.events WHERE id IN (v_event, v_free_ev);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve eventos de un local suspendido (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE event_id IN (v_event, v_free_ev);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve tipos de un local suspendido (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_availability(v_event);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve la disponibilidad de un local suspendido'; END IF;
  IF public.org_can_sell(v_org) THEN RAISE EXCEPTION 'FAIL org_can_sell para anon'; END IF;
  RESET ROLE;
  -- Un usuario sin nada de ese evento tampoco (v_other no vale: su reserva
  -- cancelada ya le deja leer el evento, holds_ticket_for_event); quien tiene
  -- entradas, sí (su cartera)
  PERFORM set_config('request.jwt.claim.sub', v_nobody::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un usuario sin entradas ve el evento suspendido'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL quien tiene entradas pierde el evento de su cartera'; END IF;
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_free_ev;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL el comprador ve otro evento del local suspendido'; END IF;
  RESET ROLE;

  -- Reactivar: vuelve todo
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_org_suspension(v_org, FALSE, NULL);
  PERFORM public.admin_set_org_suspension(v_org, FALSE, NULL);
  RESET ROLE;
  IF NOT public.org_can_sell(v_org) THEN RAISE EXCEPTION 'FAIL org_can_sell tras reactivar'; END IF;
  SELECT count(*) INTO v_count FROM public.organizations WHERE id = v_org AND suspended_at IS NULL AND suspended_reason IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la reactivación no limpia la suspensión'; END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE user_id = v_partner AND kind = 'org_reactivated';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL avisos de reactivación = %', v_count; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.events WHERE id IN (v_event, v_free_ev);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL anon no vuelve a ver los eventos al reactivar (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_availability(v_event);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL anon no vuelve a ver la disponibilidad'; END IF;
  RESET ROLE;
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 1, v_other, 'o2-other@pasify.test');
  IF v_order.stripe_destination_account IS NULL THEN RAISE EXCEPTION 'FAIL sin destino Connect tras reactivar'; END IF;
  PERFORM public.cancel_ticket_order(v_order.order_id);
  PERFORM public.create_free_ticket_order(v_free_ev, v_libre, 1, v_other, 'o2-other@pasify.test');
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET status = 'published' WHERE id = v_draft;
  RESET ROLE;

  -- Una organización cerrada tampoco vende
  UPDATE public.organizations SET status = 'closed' WHERE id = v_org;
  IF public.org_can_sell(v_org) THEN RAISE EXCEPTION 'FAIL org_can_sell con la organización cerrada'; END IF;
  UPDATE public.organizations SET status = 'active' WHERE id = v_org;

  -- ==================================================================
  -- T3 · Caducidad (cron) y lotes de conciliación
  -- ==================================================================
  -- P1: con sesión, caducado hace 3 h → no lo anula el cron (lo concilia la edge)
  SELECT * INTO v_p1 FROM public.create_ticket_order(v_rec_ev, v_rec_tier, 1, v_client, 'o2-client@pasify.test');
  PERFORM public.set_order_stripe_session(v_p1.order_id, 'cs_test_o2p1_' || v_p1.order_id);
  UPDATE public.ticket_orders SET created_at = now() - INTERVAL '3 hours 30 minutes', expires_at = now() - INTERVAL '3 hours'
   WHERE id = v_p1.order_id;
  -- P2: sin sesión, caducado hace 3 h → lo anula el cron
  SELECT * INTO v_p2 FROM public.create_ticket_order(v_rec_ev, v_rec_tier, 1, v_client, 'o2-client@pasify.test');
  UPDATE public.ticket_orders SET created_at = now() - INTERVAL '3 hours 30 minutes', expires_at = now() - INTERVAL '3 hours'
   WHERE id = v_p2.order_id;
  -- P3: con sesión y más de 24 h → lo anula el cron
  SELECT * INTO v_p3 FROM public.create_ticket_order(v_rec_ev, v_rec_tier, 1, v_client, 'o2-client@pasify.test');
  PERFORM public.set_order_stripe_session(v_p3.order_id, 'cs_test_o2p3_' || v_p3.order_id);
  UPDATE public.ticket_orders SET created_at = now() - INTERVAL '25 hours', expires_at = now() - INTERVAL '24 hours 30 minutes'
   WHERE id = v_p3.order_id;
  -- P4: con sesión y vigente → nadie lo toca (mientras el local venda)
  SELECT * INTO v_p4 FROM public.create_ticket_order(v_rec_ev, v_rec_tier, 1, v_client, 'o2-client@pasify.test');
  PERFORM public.set_order_stripe_session(v_p4.order_id, 'cs_test_o2p4_' || v_p4.order_id);

  PERFORM public.cron_expire_pending_orders();
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_p1.order_id;
  IF v_text <> 'pending' THEN RAISE EXCEPTION 'FAIL el cron anuló un pedido con sesión de menos de 24 h: %', v_text; END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_p2.order_id;
  IF v_text <> 'expired' THEN RAISE EXCEPTION 'FAIL el cron no anuló el pedido sin sesión: %', v_text; END IF;
  SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_p2.order_id AND status = 'cancelled';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cron no canceló las entradas del pedido sin sesión'; END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_p3.order_id;
  IF v_text <> 'expired' THEN RAISE EXCEPTION 'FAIL el cron no anuló el pedido de más de 24 h: %', v_text; END IF;
  SELECT status::text INTO v_text FROM public.ticket_orders WHERE id = v_p4.order_id;
  IF v_text <> 'pending' THEN RAISE EXCEPTION 'FAIL el cron anuló un pedido vigente: %', v_text; END IF;

  -- Lote: P1 (caducado con sesión); ni P2/P3 (ya anulados) ni P4 (vigente)
  SELECT array_agg(r.order_id) INTO v_ids FROM public.pending_orders_to_reconcile(200, '{}') r
   WHERE r.order_id IN (v_p1.order_id, v_p2.order_id, v_p3.order_id, v_p4.order_id);
  IF v_ids IS DISTINCT FROM ARRAY[v_p1.order_id] THEN RAISE EXCEPTION 'FAIL lote de conciliación: %', v_ids; END IF;
  SELECT reason, stripe_session_id INTO v_text, v_bool
    FROM (SELECT r.reason, r.stripe_session_id = 'cs_test_o2p1_' || v_p1.order_id AS stripe_session_id
            FROM public.pending_orders_to_reconcile(200, '{}') r WHERE r.order_id = v_p1.order_id) x;
  IF v_text <> 'expired' OR NOT v_bool THEN RAISE EXCEPTION 'FAIL fila de P1 en el lote: % / %', v_text, v_bool; END IF;
  SELECT count(*) INTO v_count FROM public.pending_orders_to_reconcile(200, ARRAY[v_p1.order_id]) r WHERE r.order_id = v_p1.order_id;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL _exclude no excluye'; END IF;
  SELECT count(*) INTO v_count FROM public.pending_orders_to_reconcile(1, '{}');
  IF v_count > 1 THEN RAISE EXCEPTION 'FAIL _limit no limita'; END IF;
  -- Local suspendido: su pedido vigente también entra ('org_suspended')
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_set_org_suspension(v_org, TRUE, 'Revisión');
  RESET ROLE;
  SELECT r.reason INTO v_text FROM public.pending_orders_to_reconcile(200, '{}') r WHERE r.order_id = v_p4.order_id;
  IF v_text IS DISTINCT FROM 'org_suspended' THEN RAISE EXCEPTION 'FAIL el pedido abierto de un local suspendido no entra en el lote: %', v_text; END IF;

  -- Sin el secreto en Vault la migración no programa nada
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'pasify_internal_secret')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pasify-reconcile-pending-orders') THEN
    RAISE EXCEPTION 'FAIL se programó la conciliación sin el secreto en Vault';
  END IF;

  RAISE NOTICE 'PASS o2_checkout: suspensión (venta, publicación, listados, cartera, puerta), disponibilidad, reservas liberadas, entradas gratis, caducidad y lotes de conciliación';
END $$;

ROLLBACK;
