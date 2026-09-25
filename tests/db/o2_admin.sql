-- Pasify · panel de admin, ola 2: liquidaciones (B5-4), pedidos y reembolso
-- desde el admin (B5-7), organizaciones de los locales con su suspensión
-- (B5-3) y baja de un local desde el admin (B3-13).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local, con las migraciones posteriores a 20260925110000 en la misma
-- transacción (el BEGIN de este fichero avisa de que ya hay una abierta y su
-- ROLLBACK deshace también las migraciones):
--   $env:PGPASSWORD='postgres'
--   $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name
--   $a = @('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;')
--   foreach ($f in $m) { $a += @('-f', $f.FullName) }
--   $a += @('-f','tests\db\o2_admin.sql','-c','ROLLBACK;'); & psql @a
--
-- Las columnas suspended_at y suspended_reason de organizations las crea la
-- migración del checkout (Ola 2, otra rama). El apartado 6 las añade dentro
-- de la transacción (IF NOT EXISTS) para probar que se leen bien cuando
-- existan; antes de eso se prueba sin ellas.

BEGIN;

DO $$
DECLARE
  v_admin     UUID := gen_random_uuid();
  v_partner   UUID := gen_random_uuid();  -- dueño de la organización A
  v_partner2  UUID := gen_random_uuid();  -- dueño de la organización B
  v_orgadmin  UUID := gen_random_uuid();  -- admin (miembro) de A: lee liquidaciones
  v_manager   UUID := gen_random_uuid();  -- manager de A: no las lee
  v_client    UUID := gen_random_uuid();  -- comprador
  v_friend    UUID := gen_random_uuid();  -- recibe una entrada transferida
  v_closing   UUID := gen_random_uuid();  -- local sin ventas futuras que se da de baja
  v_org       UUID;
  v_org2      UUID;
  v_org3      UUID;
  v_event     UUID;
  v_event2    UUID;
  v_event3    UUID;
  v_event3b   UUID;
  v_tier      UUID;
  v_tier2     UUID;
  v_o1        RECORD;
  v_o2        RECORD;
  v_ot        RECORD;
  v_ob        RECORD;
  v_t         UUID[];
  v_t2        UUID;
  v_tt        UUID;
  v_qr        UUID;
  v_s1        UUID;
  v_s2        UUID;
  v_s3        UUID;
  v_req       UUID;
  v_req2      UUID;
  v_row       RECORD;
  v_json      JSONB;
  v_text      TEXT;
  v_count     INT;
  v_bigint    BIGINT;
  v_ref       TEXT;
  v_code      TEXT;
  i           INT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_admin,    'o2a-admin-'    || v_admin    || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_partner,  'o2a-partner-'  || v_partner  || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_partner2, 'o2a-partner2-' || v_partner2 || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_orgadmin, 'o2a-orgadmin-' || v_orgadmin || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_manager,  'o2a-manager-'  || v_manager  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,   'o2a-client-'   || v_client   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_friend,   'o2a-friend-'   || v_friend   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_closing,  'o2a-closing-'  || v_closing  || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  -- ------------------------------------------------------------------
  -- Datos: dos locales con un evento cada uno y pedidos pagados
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O2A Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2A Evento', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 2000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'General', 2000, 100, 10) RETURNING id INTO v_tier;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_partner2::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org2 := public.create_organization('O2A Otro Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner2, v_org2, 'O2A Evento B', 'Sevilla', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 3000)
  RETURNING id INTO v_event2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event2, 'Anticipada', 3000, 100, 10) RETURNING id INTO v_tier2;
  RESET ROLE;

  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_orgadmin, 'o2a-orgadmin@pasify.test', 'admin', 'active'),
         (v_org, v_manager, 'o2a-manager@pasify.test', 'manager', 'active');

  -- A: pedido 1 (5 entradas), pedido 2 (1 entrada, se transferirá) y un pago
  -- de prueba (livemode = false, no suma). B: un pedido de 1 entrada.
  SELECT * INTO v_o1 FROM public.create_ticket_order(v_event, v_tier, 5, v_client, 'o2a-client@pasify.test', 'Clara', 'Compradora');
  PERFORM public.set_order_stripe_session(v_o1.order_id, 'cs_test_o2a_1_' || v_o1.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_o2a_1_' || v_o1.order_id, 'pi_o2a_1_' || v_o1.order_id, 10000, 500, TRUE);
  SELECT * INTO v_o2 FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'o2a-client@pasify.test', 'Clara', 'Compradora');
  PERFORM public.set_order_stripe_session(v_o2.order_id, 'cs_test_o2a_2_' || v_o2.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_o2a_2_' || v_o2.order_id, 'pi_o2a_2_' || v_o2.order_id, 2000, 100, TRUE);
  SELECT * INTO v_ot FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'o2a-client@pasify.test', 'Clara', 'Compradora');
  PERFORM public.set_order_stripe_session(v_ot.order_id, 'cs_test_o2a_t_' || v_ot.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_o2a_t_' || v_ot.order_id, 'pi_o2a_t_' || v_ot.order_id, 2000, 100, FALSE);
  SELECT * INTO v_ob FROM public.create_ticket_order(v_event2, v_tier2, 1, v_client, 'o2a-client@pasify.test', 'Clara', 'Compradora');
  PERFORM public.set_order_stripe_session(v_ob.order_id, 'cs_test_o2a_b_' || v_ob.order_id);
  PERFORM public.mark_order_paid_v2('cs_test_o2a_b_' || v_ob.order_id, 'pi_o2a_b_' || v_ob.order_id, 3000, 150, TRUE);

  SELECT array_agg(t.id ORDER BY t.created_at, t.id) INTO v_t FROM public.tickets t WHERE t.order_id = v_o1.order_id;
  IF cardinality(v_t) <> 5 THEN RAISE EXCEPTION 'FAIL el pedido 1 tiene % entradas', cardinality(v_t); END IF;
  SELECT t.id INTO v_t2 FROM public.tickets t WHERE t.order_id = v_o2.order_id;
  SELECT t.id INTO v_tt FROM public.tickets t WHERE t.order_id = v_ot.order_id;

  -- El saldo del que salen las liquidaciones: sin el pago de prueba
  IF NOT public.live_payments_required() THEN RAISE EXCEPTION 'FAIL require_live_payments debería estar activo'; END IF;
  SELECT * INTO v_row FROM public.partner_balance_v WHERE org_id = v_org;
  IF v_row.gross_cents <> 12000 OR v_row.fee_cents <> 600 OR v_row.refunded_cents <> 0 OR v_row.net_cents <> 11400 THEN
    RAISE EXCEPTION 'FAIL saldo de A: %', row_to_json(v_row);
  END IF;

  -- ------------------------------------------------------------------
  -- 1) Permisos: nada de esto es para anon, ni para quien no es admin
  -- ------------------------------------------------------------------
  FOR v_text IN SELECT unnest(ARRAY[
    'public.admin_record_settlement(uuid, integer, timestamp with time zone, text, text, text, boolean)',
    'public.admin_settlement_overview(text, boolean, integer, integer)',
    'public.admin_org_settlements(uuid)',
    'public.admin_partner_orgs(uuid[])',
    'public.admin_search_orders(text, integer)',
    'public.admin_create_refund_request(uuid, text)',
    'public.admin_close_partner_account(uuid)'])
  LOOP
    IF has_function_privilege('anon', v_text, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL anon puede ejecutar %', v_text; END IF;
    IF NOT has_function_privilege('authenticated', v_text, 'EXECUTE') THEN RAISE EXCEPTION 'FAIL authenticated no puede ejecutar %', v_text; END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.admin_org_is_suspended(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL admin_org_is_suspended es una RPC';
  END IF;
  IF has_table_privilege('anon', 'public.partner_settlements', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon puede leer partner_settlements';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 1000, now(), 'TRF-PROPIA');
    RAISE EXCEPTION 'FAIL un local se registra una liquidación';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_settlement_overview();
    RAISE EXCEPTION 'FAIL un local lee el resumen de liquidaciones';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_search_orders('o2a-client@', 10);
    RAISE EXCEPTION 'FAIL un local busca pedidos de toda la plataforma';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_partner_orgs(ARRAY[v_partner]);
    RAISE EXCEPTION 'FAIL un local lista organizaciones';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_close_partner_account(v_partner2);
    RAISE EXCEPTION 'FAIL un local cierra la cuenta de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Tampoco escribe liquidaciones directamente
  BEGIN
    INSERT INTO public.partner_settlements (org_id, amount_cents, bank_reference) VALUES (v_org, 100, 'TRF-DIRECTA');
    RAISE EXCEPTION 'FAIL un local inserta una liquidación';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_create_refund_request(v_t[1], 'Me devuelvo yo la entrada');
    RAISE EXCEPTION 'FAIL un comprador se crea un reembolso aprobado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_org_settlements(v_org);
    RAISE EXCEPTION 'FAIL un comprador lee el historial de liquidaciones';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 2) Registrar liquidaciones
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 0, now(), 'TRF-CERO');
    RAISE EXCEPTION 'FAIL liquidación de 0';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 1000, now(), '   ');
    RAISE EXCEPTION 'FAIL liquidación sin referencia bancaria';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 1000, now() + INTERVAL '3 days', 'TRF-FUTURA');
    RAISE EXCEPTION 'FAIL liquidación con fecha futura';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 1000, now() - INTERVAL '30 days', 'TRF-ANTIGUA');
    RAISE EXCEPTION 'FAIL liquidación anterior a la organización';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_record_settlement(gen_random_uuid(), 1000, now(), 'TRF-NADIE');
    RAISE EXCEPTION 'FAIL liquidación a una organización que no existe';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  -- Más de lo pendiente (11.400), no sin confirmarlo
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 11401, now(), 'TRF-DE-MAS');
    RAISE EXCEPTION 'FAIL se liquida más de lo pendiente sin confirmarlo';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'amount_exceeds_pending' THEN RAISE EXCEPTION 'FAIL esperaba amount_exceeds_pending y llegó %', SQLERRM; END IF;
  END;
  v_s1 := public.admin_record_settlement(v_org, 6000, now() - INTERVAL '1 hour', '  TRF-2026-001  ', 'Primera quincena', 'eur');
  -- La misma transferencia otra vez (doble clic): fuera
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 6000, now() - INTERVAL '1 hour', 'trf-2026-001');
    RAISE EXCEPTION 'FAIL la misma transferencia se apunta dos veces';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  v_s2 := public.admin_record_settlement(v_org, 5400, now(), 'TRF-2026-002');
  -- Pendiente 0: un euro más solo confirmándolo
  BEGIN
    PERFORM public.admin_record_settlement(v_org, 100, now(), 'TRF-2026-003');
    RAISE EXCEPTION 'FAIL se liquida con el pendiente a 0';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v_s3 := public.admin_record_settlement(v_org, 100, now(), 'TRF-2026-003', 'Se transfirió de más', 'EUR', TRUE);
  RESET ROLE;

  SELECT * INTO v_row FROM public.partner_settlements WHERE id = v_s1;
  IF v_row.bank_reference IS DISTINCT FROM 'TRF-2026-001' OR v_row.currency <> 'EUR' OR v_row.created_by IS DISTINCT FROM v_admin
     OR v_row.note IS DISTINCT FROM 'Primera quincena' OR v_row.amount_cents <> 6000 THEN
    RAISE EXCEPTION 'FAIL liquidación mal guardada: %', row_to_json(v_row);
  END IF;
  -- Auditadas y con aviso al dueño
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE target_kind = 'partner_settlements' AND action = 'INSERT_partner_settlements'
     AND actor_user_id = v_admin AND target_id IN (v_s1, v_s2, v_s3);
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL liquidaciones auditadas: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.notifications
   WHERE user_id = v_partner AND kind = 'settlement_recorded' AND payload->>'org_id' = v_org::text;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL avisos de liquidación al dueño: %', v_count; END IF;
  SELECT title INTO v_text FROM public.notifications
   WHERE user_id = v_partner AND kind = 'settlement_recorded' AND payload->>'settlement_id' = v_s1::text;
  IF v_text IS DISTINCT FROM 'Pasify te ha transferido 60,00 €' THEN RAISE EXCEPTION 'FAIL título del aviso: %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- 3) Resumen e historial
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.admin_settlement_overview('O2A', FALSE, 50, 0) o WHERE o.org_id = v_org;
  IF v_row.gross_cents <> 12000 OR v_row.refunded_cents <> 0 OR v_row.fee_cents <> 600 OR v_row.net_cents <> 11400
     OR v_row.settled_cents <> 11500 OR v_row.pending_cents <> -100 OR v_row.settlements_count <> 3
     OR v_row.paid_orders <> 2 OR v_row.org_name IS DISTINCT FROM 'O2A Local' OR v_row.owner_id IS DISTINCT FROM v_partner
     OR v_row.owner_email NOT LIKE 'o2a-partner-%' OR v_row.org_status <> 'active' OR v_row.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL resumen de A: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.admin_settlement_overview('O2A', FALSE, 50, 0) o WHERE o.org_id = v_org2;
  IF v_row.net_cents <> 2850 OR v_row.settled_cents <> 0 OR v_row.pending_cents <> 2850 OR v_row.settlements_count <> 0
     OR v_row.connect_orders <> 0 THEN
    RAISE EXCEPTION 'FAIL resumen de B: %', row_to_json(v_row);
  END IF;
  -- Un pedido cobrado con el Stripe del propio local se señala (ya le llegó)
  RESET ROLE;
  UPDATE public.ticket_orders SET stripe_destination_account = 'acct_o2a_test' WHERE id = v_ob.order_id;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT o.connect_orders INTO v_bigint FROM public.admin_settlement_overview('O2A', FALSE, 50, 0) o WHERE o.org_id = v_org2;
  IF v_bigint IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL pedidos con Stripe del local: %', v_bigint; END IF;
  RESET ROLE;
  UPDATE public.ticket_orders SET stripe_destination_account = NULL WHERE id = v_ob.order_id;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Totales del filtro entero, también con una página de 1. Lo que se debe
  -- no resta lo transferido de más a A.
  SELECT o.total_count, o.total_net_cents, o.total_settled_cents, o.total_pending_cents INTO v_row
    FROM public.admin_settlement_overview('O2A', FALSE, 1, 0) o;
  IF v_row.total_count <> 2 OR v_row.total_net_cents <> 14250 OR v_row.total_settled_cents <> 11500
     OR v_row.total_pending_cents <> 2850 THEN
    RAISE EXCEPTION 'FAIL totales del resumen: %', row_to_json(v_row);
  END IF;
  -- Lo que más se debe, primero
  SELECT o.org_id INTO v_row FROM public.admin_settlement_overview('O2A', FALSE, 1, 0) o;
  IF v_row.org_id IS DISTINCT FROM v_org2 THEN RAISE EXCEPTION 'FAIL orden del resumen'; END IF;
  -- Búsqueda por nombre y por email del dueño; % tal cual
  SELECT count(*) INTO v_count FROM public.admin_settlement_overview('O2A Otro', FALSE, 50, 0);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por nombre: % filas', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.admin_settlement_overview('o2a-partner2-', FALSE, 50, 0);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por email del dueño: % filas', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.admin_settlement_overview('O2A%Local', FALSE, 50, 0);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL %% funciona como comodín en el resumen'; END IF;
  -- Solo con saldo pendiente: A (−100) y B (28,50) cuentan; saldada del todo, no
  SELECT count(*) INTO v_count FROM public.admin_settlement_overview('O2A', TRUE, 50, 0);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL solo pendientes: % filas', v_count; END IF;
  -- Historial, lo último primero, con quién lo apuntó
  SELECT count(*) INTO v_count FROM public.admin_org_settlements(v_org);
  SELECT h.id, h.created_by_name INTO v_row FROM public.admin_org_settlements(v_org) h LIMIT 1;
  IF v_count <> 3 OR v_row.id = v_s1 OR v_row.created_by_name IS NULL THEN
    RAISE EXCEPTION 'FAIL historial: % filas, primera %', v_count, row_to_json(v_row);
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 4) Quién lee las liquidaciones (RLS)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_settlements;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL el dueño ve % liquidaciones de las 3 suyas', v_count; END IF;
  -- No las cambia ni las borra
  UPDATE public.partner_settlements SET amount_cents = 1 WHERE id = v_s1;
  DELETE FROM public.partner_settlements WHERE id = v_s2;
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.partner_settlements WHERE id IN (v_s1, v_s2) AND amount_cents > 1;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el dueño cambia o borra una liquidación'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_orgadmin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orgadmin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_settlements;
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL el admin de la organización ve % liquidaciones', v_count; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_settlements;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un manager ve liquidaciones'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_partner2::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_settlements WHERE org_id = v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro local ve las liquidaciones de A'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_settlements;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un comprador ve liquidaciones'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.partner_settlements;
    RAISE EXCEPTION 'FAIL anon lee partner_settlements';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 5) Organizaciones de los locales (Locales)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.admin_partner_orgs(ARRAY[v_partner, v_partner2, v_client]);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL admin_partner_orgs: % filas', v_count; END IF;
  SELECT * INTO v_row FROM public.admin_partner_orgs(ARRAY[v_partner2]);
  IF v_row.org_id IS DISTINCT FROM v_org2 OR v_row.owner_id IS DISTINCT FROM v_partner2 OR v_row.status <> 'active'
     OR v_row.name IS DISTINCT FROM 'O2A Otro Local' OR v_row.suspended_at IS NOT NULL OR v_row.suspended_reason IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL organización de B: %', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.admin_partner_orgs(ARRAY[]::UUID[]);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL admin_partner_orgs sin ids devuelve filas'; END IF;
  BEGIN
    PERFORM public.admin_partner_orgs(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)));
    RAISE EXCEPTION 'FAIL admin_partner_orgs acepta 201 ids';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RESET ROLE;

  -- Suspendida por estado: no se liquida (D-8); cerrada, sí
  UPDATE public.organizations SET status = 'suspended' WHERE id = v_org2;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_record_settlement(v_org2, 1000, now(), 'TRF-SUSPENDIDO');
    RAISE EXCEPTION 'FAIL se liquida a un local suspendido';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'org_suspended' THEN RAISE EXCEPTION 'FAIL esperaba org_suspended y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.organizations SET status = 'closed' WHERE id = v_org2;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_record_settlement(v_org2, 1000, now(), 'TRF-CERRADO');
  RESET ROLE;
  UPDATE public.organizations SET status = 'active' WHERE id = v_org2;

  -- ------------------------------------------------------------------
  -- 6) Con las columnas de suspensión del checkout
  -- ------------------------------------------------------------------
  ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
  EXECUTE format('UPDATE public.organizations SET suspended_at = now() - INTERVAL %L, suspended_reason = %L WHERE id = %L',
                 '2 hours', 'Ventas sospechosas', v_org2);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.admin_partner_orgs(ARRAY[v_partner2]);
  IF v_row.suspended_at IS NULL OR v_row.suspended_reason IS DISTINCT FROM 'Ventas sospechosas' THEN
    RAISE EXCEPTION 'FAIL admin_partner_orgs no lee la suspensión: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.admin_settlement_overview('O2A', FALSE, 50, 0) o WHERE o.org_id = v_org2;
  IF v_row.suspended_at IS NULL OR v_row.suspended_reason IS DISTINCT FROM 'Ventas sospechosas' THEN
    RAISE EXCEPTION 'FAIL el resumen no lee la suspensión: %', row_to_json(v_row);
  END IF;
  BEGIN
    PERFORM public.admin_record_settlement(v_org2, 500, now(), 'TRF-SUSPENDIDO-2');
    RAISE EXCEPTION 'FAIL se liquida a un local con suspended_at';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  RESET ROLE;
  EXECUTE format('UPDATE public.organizations SET suspended_at = NULL, suspended_reason = NULL WHERE id = %L', v_org2);

  -- ------------------------------------------------------------------
  -- 7) Buscar pedidos
  -- ------------------------------------------------------------------
  -- La entrada del pedido 2 se transfiere a otra persona
  UPDATE public.tickets
     SET transferred_to_user_id = v_friend, transferred_at = now(),
         holder_first_name = 'Fran', holder_last_name = 'Amiga', holder_email = 'o2a-friend@pasify.test'
   WHERE id = v_t2;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.admin_search_orders('ab', 20);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL una búsqueda de 2 caracteres devuelve % filas', v_count; END IF;
  -- Email del pedido: los cuatro del comprador (también el de prueba)
  SELECT count(*) INTO v_count FROM public.admin_search_orders('O2A-CLIENT@pasify', 20) s WHERE s.matched_by = 'email';
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL búsqueda por email del pedido: % filas', v_count; END IF;
  -- Email del titular de una entrada transferida
  SELECT * INTO v_row FROM public.admin_search_orders('o2a-friend@pasify.test', 20);
  IF v_row.order_id IS DISTINCT FROM v_o2.order_id OR v_row.matched_by <> 'email' THEN
    RAISE EXCEPTION 'FAIL búsqueda por email del titular: %', row_to_json(v_row);
  END IF;
  -- Email de la cuenta del comprador
  SELECT count(*) INTO v_count FROM public.admin_search_orders('o2a-client-' || v_client || '@pasify.test', 20);
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL búsqueda por email de la cuenta: % filas', v_count; END IF;
  -- Referencia (como la enseña orderReference) con # y en minúsculas
  v_ref := upper(left(replace(v_o1.order_id::text, '-', ''), 8));
  SELECT * INTO v_row FROM public.admin_search_orders('#' || lower(v_ref), 20) s WHERE s.order_id = v_o1.order_id;
  IF v_row.order_id IS NULL OR v_row.reference <> v_ref OR v_row.matched_by NOT LIKE '%reference%' THEN
    RAISE EXCEPTION 'FAIL búsqueda por referencia %: %', v_ref, row_to_json(v_row);
  END IF;
  IF v_row.status <> 'paid' OR v_row.livemode IS NOT TRUE OR v_row.total_cents <> 10000 OR v_row.fees_cents <> 500
     OR v_row.event_id IS DISTINCT FROM v_event OR v_row.event_title <> 'O2A Evento' OR v_row.org_id IS DISTINCT FROM v_org
     OR v_row.org_name <> 'O2A Local' OR v_row.buyer_user_id IS DISTINCT FROM v_client
     OR v_row.buyer_email <> 'o2a-client@pasify.test' OR v_row.refunded_cents <> 0
     OR v_row.stripe_payment_intent_id <> 'pi_o2a_1_' || v_o1.order_id
     OR jsonb_array_length(v_row.tickets) <> 5 THEN
    RAISE EXCEPTION 'FAIL datos del pedido: %', row_to_json(v_row);
  END IF;
  v_json := v_row.tickets -> 0;
  SELECT qr_token INTO v_qr FROM public.tickets WHERE id = (v_json ->> 'id')::uuid;
  IF v_json ->> 'status' <> 'paid' OR v_json ->> 'tier_name' <> 'General' OR (v_json ->> 'amount_paid_cents')::int <> 2000
     OR v_json ->> 'door_code' <> upper(left(replace(v_qr::text, '-', ''), 8)) OR (v_json ->> 'transferred')::boolean
     OR v_json ->> 'refund_id' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL entrada del pedido: %', v_json;
  END IF;
  -- Más caracteres del id (con guiones o sin ellos): prefijo; los 32, el id
  SELECT count(*) INTO v_count FROM public.admin_search_orders(left(v_o1.order_id::text, 13), 20) s
   WHERE s.order_id = v_o1.order_id AND s.matched_by LIKE '%reference%';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por un prefijo largo de la referencia'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders(upper(replace(v_o1.order_id::text, '-', '')), 20) s
   WHERE s.order_id = v_o1.order_id AND s.matched_by = 'id';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por el id sin guiones'; END IF;
  -- Código de puerta de la entrada transferida
  SELECT qr_token INTO v_qr FROM public.tickets WHERE id = v_t2;
  v_code := upper(left(replace(v_qr::text, '-', ''), 8));
  SELECT * INTO v_row FROM public.admin_search_orders(v_code, 20) s WHERE s.order_id = v_o2.order_id;
  IF v_row.order_id IS NULL OR v_row.matched_by NOT LIKE '%door_code%'
     OR NOT (v_row.tickets -> 0 ->> 'transferred')::boolean OR v_row.tickets -> 0 ->> 'holder_name' <> 'Fran Amiga' THEN
    RAISE EXCEPTION 'FAIL búsqueda por código de puerta %: %', v_code, row_to_json(v_row);
  END IF;
  -- Ids: pedido, entrada, QR completo; Stripe
  SELECT count(*) INTO v_count FROM public.admin_search_orders(v_o1.order_id::text, 20) s WHERE s.order_id = v_o1.order_id AND s.matched_by = 'id';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por id del pedido'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders(upper(v_t[3]::text), 20) s WHERE s.order_id = v_o1.order_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por id de la entrada'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders(v_qr::text, 20) s WHERE s.order_id = v_o2.order_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por QR completo'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders('pi_o2a_1_' || v_o1.order_id, 20) s WHERE s.order_id = v_o1.order_id AND s.matched_by = 'stripe';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por pago de Stripe'; END IF;
  -- Pago de prueba: se encuentra y dice que lo es
  SELECT * INTO v_row FROM public.admin_search_orders('cs_test_o2a_t_' || v_ot.order_id, 20);
  IF v_row.order_id IS DISTINCT FROM v_ot.order_id OR v_row.livemode IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL pedido de prueba: %', row_to_json(v_row);
  END IF;
  -- Nombre del comprador y del titular
  SELECT count(*) INTO v_count FROM public.admin_search_orders('clara compradora', 20);
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL búsqueda por nombre del comprador: % filas', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders('Fran Amiga', 20) s WHERE s.order_id = v_o2.order_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL búsqueda por nombre del titular'; END IF;
  -- % tal cual y límite
  SELECT count(*) INTO v_count FROM public.admin_search_orders('o2a-%@pasify.test', 20);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL %% funciona como comodín en la búsqueda de pedidos'; END IF;
  SELECT count(*) INTO v_count FROM public.admin_search_orders('o2a-client@', 2);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el límite no se respeta: % filas', v_count; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 8) Reembolsar una entrada desde el admin
  -- ------------------------------------------------------------------
  -- Estados previos de algunas entradas: t2 con solicitud pendiente, t3
  -- denegada, t4 fallida en Stripe, t5 ya usada en puerta.
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents, reason, status)
  VALUES (v_t[2], v_o1.order_id, v_event, v_org, v_client, 'o2a-client@pasify.test', 2000, 'No puedo ir', 'pending')
  RETURNING id INTO v_req;
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents,
                                      reason, status, decided_by, decided_at, decision_note)
  VALUES (v_t[3], v_o1.order_id, v_event, v_org, v_client, 'o2a-client@pasify.test', 2000, 'Me he equivocado', 'rejected',
          v_partner, now(), 'Fuera de plazo');
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents,
                                      reason, status, decided_by, decided_at, decision_note,
                                      stripe_refund_id, stripe_refund_status, stripe_failure_reason)
  VALUES (v_t[4], v_o1.order_id, v_event, v_org, v_client, 'o2a-client@pasify.test', 2000, 'Enfermedad', 'failed',
          v_partner, now(), 'Aprobado por el local', 're_o2a_fail', 'failed', 'expired_or_canceled_card')
  RETURNING id INTO v_req2;
  UPDATE public.tickets SET status = 'used', used_at = now() WHERE id = v_t[5];

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_create_refund_request(v_t[1], ' no ');
    RAISE EXCEPTION 'FAIL reembolso sin motivo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_create_refund_request(v_t[5], 'El local lo ha pedido');
    RAISE EXCEPTION 'FAIL se reembolsa una entrada usada';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'ticket_used' THEN RAISE EXCEPTION 'FAIL esperaba ticket_used y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.admin_create_refund_request(v_tt, 'Pago de prueba');
    RAISE EXCEPTION 'FAIL se reembolsa un pago de prueba';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'test_payment' THEN RAISE EXCEPTION 'FAIL esperaba test_payment y llegó %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.admin_create_refund_request(gen_random_uuid(), 'No existe');
    RAISE EXCEPTION 'FAIL reembolso de una entrada que no existe';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  -- Nueva: aprobada, del sistema, con el comprador como solicitante
  v_s1 := public.admin_create_refund_request(v_t[1], '  Cargo duplicado en el banco  ');
  BEGIN
    PERFORM public.admin_create_refund_request(v_t[1], 'Otra vez la misma');
    RAISE EXCEPTION 'FAIL dos reembolsos de la misma entrada';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'refund_in_progress' THEN RAISE EXCEPTION 'FAIL esperaba refund_in_progress y llegó %', SQLERRM; END IF;
  END;
  -- Transferida: el solicitante es quien la tiene ahora
  v_s2 := public.admin_create_refund_request(v_t2, 'El evento cambia de sala');
  -- Pendiente del local: la decide Pasify
  v_s3 := public.admin_create_refund_request(v_t[2], 'Lo resuelve soporte');
  RESET ROLE;

  SELECT * INTO v_row FROM public.refund_requests WHERE id = v_s1;
  IF v_row.status <> 'approved' OR v_row.reason_code <> 'admin_refund' OR v_row.auto_approved
     OR v_row.decided_by IS DISTINCT FROM v_admin OR v_row.decided_at IS NULL
     OR v_row.decision_note IS DISTINCT FROM 'Cargo duplicado en el banco'
     OR v_row.requester_user_id IS DISTINCT FROM v_client OR v_row.requester_email NOT LIKE 'o2a-client-%'
     OR v_row.amount_cents <> 2000 OR v_row.order_id IS DISTINCT FROM v_o1.order_id OR v_row.org_id IS DISTINCT FROM v_org
     OR v_row.event_id IS DISTINCT FROM v_event OR v_row.metadata ->> 'source' <> 'admin' THEN
    RAISE EXCEPTION 'FAIL solicitud del admin: %', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE target_kind = 'refund_requests' AND target_id = v_s1 AND action = 'INSERT_refund_requests' AND actor_user_id = v_admin;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el alta del admin no queda en la auditoría'; END IF;
  SELECT * INTO v_row FROM public.refund_requests WHERE id = v_s2;
  IF v_row.requester_user_id IS DISTINCT FROM v_friend OR v_row.requester_email NOT LIKE 'o2a-friend-%' OR v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'FAIL solicitud de una entrada transferida: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.refund_requests WHERE id = v_s3;
  IF v_s3 IS DISTINCT FROM v_req OR v_row.status <> 'approved' OR v_row.decided_by IS DISTINCT FROM v_admin
     OR v_row.reason IS DISTINCT FROM 'No puedo ir' OR v_row.decision_note IS DISTINCT FROM 'Lo resuelve soporte'
     OR v_row.metadata -> 'admin_refund' ->> 'previous_status' <> 'pending' THEN
    RAISE EXCEPTION 'FAIL solicitud pendiente decidida por el admin: %', row_to_json(v_row);
  END IF;

  -- Denegada por el local: Pasify la corrige; fallida: se reintenta
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_s1 := public.admin_create_refund_request(v_t[3], 'Pasify corrige la denegación');
  v_s2 := public.admin_create_refund_request(v_t[4], 'Segundo intento con Stripe');
  RESET ROLE;
  SELECT * INTO v_row FROM public.refund_requests WHERE id = v_s1;
  IF v_row.status <> 'approved' OR v_row.decision_note IS DISTINCT FROM 'Pasify corrige la denegación'
     OR v_row.metadata -> 'admin_refund' ->> 'previous_status' <> 'rejected' THEN
    RAISE EXCEPTION 'FAIL denegada corregida: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM public.refund_requests WHERE id = v_s2;
  IF v_s2 IS DISTINCT FROM v_req2 OR v_row.status <> 'approved' OR v_row.stripe_refund_id IS NOT NULL
     OR jsonb_array_length(v_row.metadata -> 'retries') <> 1
     OR v_row.metadata -> 'retries' -> 0 ->> 'failure_reason' <> 'expired_or_canceled_card'
     OR v_row.decision_note IS DISTINCT FROM 'Aprobado por el local' THEN
    RAISE EXCEPTION 'FAIL fallida reintentada: %', row_to_json(v_row);
  END IF;

  -- La búsqueda enseña la solicitud de cada entrada
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT s.tickets INTO v_json FROM public.admin_search_orders(v_o1.order_id::text, 20) s;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_json) e WHERE e ->> 'refund_status' = 'approved';
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL la búsqueda no trae las solicitudes: %', v_json; END IF;
  -- Entrada gratis de un pedido pagado: nada que devolver
  RESET ROLE;
  INSERT INTO public.tickets (event_id, order_id, tier_id, buyer_user_id, buyer_email, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_o1.order_id, v_tier, v_client, 'o2a-client@pasify.test', 'paid', 0, now())
  RETURNING id INTO v_t2;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_create_refund_request(v_t2, 'Invitación sin coste');
    RAISE EXCEPTION 'FAIL se reembolsa una entrada gratis';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'nothing_to_refund' THEN RAISE EXCEPTION 'FAIL esperaba nothing_to_refund y llegó %', SQLERRM; END IF;
  END;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 9) Baja de un local desde el admin (delete-user)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_closing::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_closing, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org3 := public.create_organization('O2A Se Va', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_closing, v_org3, 'O2A Futuro sin ventas', 'Bilbao', now() + INTERVAL '10 days', now() + INTERVAL '10 days 5 hours', 'published', 1500)
  RETURNING id INTO v_event3;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_closing, v_org3, 'O2A Borrador', 'Bilbao', now() + INTERVAL '20 days', NULL, 'draft', 1500)
  RETURNING id INTO v_event3b;
  RESET ROLE;
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org3, v_manager, 'o2a-manager@pasify.test', 'manager', 'active');

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Un admin no se cierra
  BEGIN
    PERFORM public.admin_close_partner_account(v_admin);
    RAISE EXCEPTION 'FAIL se cierra la cuenta de un admin';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'target_is_admin' THEN RAISE EXCEPTION 'FAIL esperaba target_is_admin y llegó %', SQLERRM; END IF;
  END;
  -- Con ventas futuras, no
  BEGIN
    PERFORM public.admin_close_partner_account(v_partner);
    RAISE EXCEPTION 'FAIL se cierra un local con ventas futuras';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'partner_has_upcoming_sales' THEN RAISE; END IF;
  END;
  v_json := public.admin_close_partner_account(v_closing);
  RESET ROLE;
  IF (v_json ->> 'closed_orgs')::int <> 1 OR (v_json ->> 'cancelled_events')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL resultado del cierre: %', v_json;
  END IF;
  SELECT status, metadata INTO v_row FROM public.organizations WHERE id = v_org3;
  IF v_row.status <> 'closed' OR v_row.metadata ->> 'closed_by' IS DISTINCT FROM v_admin::text
     OR (v_row.metadata ->> 'closed_by_admin')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL organización cerrada: %', row_to_json(v_row);
  END IF;
  SELECT count(*) INTO v_count FROM public.events
   WHERE id IN (v_event3, v_event3b) AND status = 'cancelled' AND metadata ->> 'cancelled_by' = v_admin::text;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL eventos del local que se va: % cancelados', v_count; END IF;
  SELECT status INTO v_text FROM public.organization_members WHERE org_id = v_org3 AND user_id = v_manager;
  IF v_text <> 'removed' THEN RAISE EXCEPTION 'FAIL el equipo del local que se va sigue activo: %', v_text; END IF;
  -- Las demás organizaciones, intactas
  SELECT count(*) INTO v_count FROM public.organizations WHERE id IN (v_org, v_org2) AND status = 'active';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL el cierre toca otras organizaciones'; END IF;
  SELECT status::text INTO v_text FROM public.events WHERE id = v_event;
  IF v_text <> 'published' THEN RAISE EXCEPTION 'FAIL el cierre toca eventos de otro local'; END IF;
  -- Y la cuenta ya se puede borrar sin arrastrar eventos ni organizaciones
  DELETE FROM auth.users WHERE id = v_closing;
  SELECT count(*) INTO v_count FROM public.events WHERE id IN (v_event3, v_event3b) AND partner_id IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL los eventos del local borrado no quedan sin dueño'; END IF;
  SELECT owner_id INTO v_row FROM public.organizations WHERE id = v_org3;
  IF v_row.owner_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL la organización del local borrado conserva dueño'; END IF;

  RAISE NOTICE 'PASS o2_admin: liquidaciones (registro, límites, RLS, resumen, historial, suspensión), organizaciones de los locales, búsqueda de pedidos, reembolso desde el admin y baja de un local';
END $$;

ROLLBACK;
