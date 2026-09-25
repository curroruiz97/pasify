-- Pasify · tests de la Ola 0 del servidor: pagos de prueba en producción,
-- compras sin cuenta, permisos de funciones, auditoría, soporte y buckets.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Necesita las migraciones 20260925110000, 20260925110100 y 20260925110200.
-- Para probarlas sin aplicarlas, todo en una transacción que acaba en ROLLBACK
-- (el BEGIN de este fichero avisa de que ya hay una abierta y su ROLLBACK
-- deshace también las migraciones):
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -c "BEGIN;" \
--     -f supabase/migrations/20260925110000_scan_result_test_payment.sql \
--     -f supabase/migrations/20260925110100_live_payments_guard.sql \
--     -f supabase/migrations/20260925110200_permissions_hardening.sql \
--     -f tests/db/o0_servidor.sql
--
-- En ese modo el valor 'test_payment' del enum no está confirmado y Postgres
-- no deja usarlo en la misma transacción que lo añade (SQLSTATE 55P04). El
-- test lo detecta: comprueba que el escáner llega a esa rama y la repite
-- entera con un valor ya confirmado en el literal. Con las migraciones ya
-- aplicadas (supabase migration up / db reset) lo comprueba tal cual.

BEGIN;

DO $$
DECLARE
  v_partner    UUID := gen_random_uuid();
  v_client     UUID := gen_random_uuid();
  v_other      UUID := gen_random_uuid();
  v_admin      UUID := gen_random_uuid();
  v_writer     UUID := gen_random_uuid();
  v_promoted   UUID := gen_random_uuid();
  v_org        UUID;
  v_event      UUID;
  v_tier       UUID;
  v_tier_cupo  UUID;
  v_o_test     RECORD;
  v_o_live     RECORD;
  v_o_unknown  RECORD;
  v_paid       RECORD;
  v_scan       RECORD;
  v_bal        RECORD;
  v_rec        RECORD;
  v_t_test     UUID;
  v_t_test2    UUID;
  v_qr_test    UUID;
  v_qr_test2   UUID;
  v_qr_live    UUID;
  v_qr_unknown UUID;
  v_count      INT;
  v_int        INT;
  v_text       TEXT;
  v_bool       BOOLEAN;
  v_toggle1    BOOLEAN;
  v_toggle2    BOOLEAN;
  v_enum_ready BOOLEAN;
  v_expected   TEXT;
  v_users      UUID[];
  v_u          UUID;
  v_live       BOOLEAN;
  v_conv       UUID;
  v_msg        UUID;
  v_code       TEXT;
  v_key        TEXT;
BEGIN
  -- ------------------------------------------------------------------
  -- ¿'test_payment' ya está confirmado en scan_result_t?
  -- ------------------------------------------------------------------
  BEGIN
    PERFORM 'test_payment'::public.scan_result_t;
    v_enum_ready := TRUE;
  EXCEPTION WHEN SQLSTATE '55P04' THEN
    v_enum_ready := FALSE;
  END;
  RAISE NOTICE 'o0_servidor: test_payment %', CASE WHEN v_enum_ready THEN 'confirmado (prueba completa)' ELSE 'sin confirmar (migraciones en esta transacción)' END;

  -- ------------------------------------------------------------------
  -- Usuarios, local, evento
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner,  'o0-partner-'  || v_partner  || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,   'o0-client-'   || v_client   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,    'o0-other-'    || v_other    || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,    'o0-admin-'    || v_admin    || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_writer,   'o0-writer-'   || v_writer   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_promoted, 'o0-promoted-' || v_promoted || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O0 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O0 Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'General', 1000, 50, 10) RETURNING id INTO v_tier;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'Dos por persona', 1000, 50, 2) RETURNING id INTO v_tier_cupo;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- B1-08: sin comprador no hay pedido; con comprador, máximo por persona
  -- ------------------------------------------------------------------
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_tier, 1, NULL, 'o0-invitado@pasify.test');
    RAISE EXCEPTION 'FAIL create_ticket_order aceptó un pedido sin comprador';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'buyer_user_required' THEN RAISE EXCEPTION 'FAIL esperaba buyer_user_required y llegó %', SQLERRM; END IF;
  END;
  PERFORM public.create_ticket_order(v_event, v_tier_cupo, 2, v_client, 'o0-client@pasify.test');
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_tier_cupo, 1, v_client, 'o0-client@pasify.test');
    RAISE EXCEPTION 'FAIL no saltó el máximo por persona';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    IF SQLERRM <> 'qty_exceeds_per_user_max' THEN RAISE EXCEPTION 'FAIL esperaba qty_exceeds_per_user_max y llegó %', SQLERRM; END IF;
  END;

  -- ------------------------------------------------------------------
  -- B1-01: mark_order_paid_v2 guarda livemode
  -- ------------------------------------------------------------------
  IF to_regprocedure('public.mark_order_paid_v2(text,text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.mark_order_paid_v2(text,text,integer,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'FAIL mark_order_paid_v2 no tiene la firma nueva (o conserva la antigua)';
  END IF;

  -- Pagado en modo prueba (2 entradas, 20 € de los que 1 € es comisión)
  SELECT * INTO v_o_test FROM public.create_ticket_order(v_event, v_tier, 2, v_client, 'o0-client@pasify.test', 'Tea', 'Prueba');
  SELECT livemode INTO v_bool FROM public.ticket_orders WHERE id = v_o_test.order_id;
  IF v_bool IS NOT NULL THEN RAISE EXCEPTION 'FAIL un pedido nuevo nace con livemode %', v_bool; END IF;
  PERFORM public.set_order_stripe_session(v_o_test.order_id, 'cs_test_o0t_' || v_o_test.order_id);
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_o0t_' || v_o_test.order_id, 'pi_test_o0t', 2000, 100, FALSE);
  IF NOT v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL el pago de prueba no es newly_paid'; END IF;
  SELECT livemode INTO v_bool FROM public.ticket_orders WHERE id = v_o_test.order_id;
  IF v_bool IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'FAIL livemode del pago de prueba = %', v_bool; END IF;
  SELECT t.id, t.qr_token INTO v_t_test, v_qr_test FROM public.tickets t WHERE t.order_id = v_o_test.order_id ORDER BY t.id LIMIT 1;
  SELECT t.id, t.qr_token INTO v_t_test2, v_qr_test2 FROM public.tickets t WHERE t.order_id = v_o_test.order_id AND t.id <> v_t_test LIMIT 1;

  -- Pagado de verdad (10 €, 0,50 € de comisión)
  SELECT * INTO v_o_live FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'o0-client@pasify.test', 'Tea', 'Prueba');
  PERFORM public.set_order_stripe_session(v_o_live.order_id, 'cs_live_o0l_' || v_o_live.order_id);
  PERFORM public.mark_order_paid_v2(
    _session_id => 'cs_live_o0l_' || v_o_live.order_id, _payment_intent_id => 'pi_live_o0l',
    _amount_total_cents => 1000, _application_fee_cents => 50, _livemode => TRUE);
  SELECT livemode INTO v_bool FROM public.ticket_orders WHERE id = v_o_live.order_id;
  IF v_bool IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL livemode del pago real = %', v_bool; END IF;
  SELECT qr_token INTO v_qr_live FROM public.tickets WHERE order_id = v_o_live.order_id;

  -- Llamada antigua (cuatro parámetros): sigue valiendo y el modo queda NULL
  SELECT * INTO v_o_unknown FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'o0-client@pasify.test', 'Tea', 'Prueba');
  PERFORM public.set_order_stripe_session(v_o_unknown.order_id, 'cs_test_o0u_' || v_o_unknown.order_id);
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_o0u_' || v_o_unknown.order_id, 'pi_test_o0u', 1000, 50);
  IF NOT v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL la llamada antigua no marca el pedido'; END IF;
  SELECT livemode INTO v_bool FROM public.ticket_orders WHERE id = v_o_unknown.order_id;
  IF v_bool IS NOT NULL THEN RAISE EXCEPTION 'FAIL la llamada antigua dejó livemode %', v_bool; END IF;
  SELECT qr_token INTO v_qr_unknown FROM public.tickets WHERE order_id = v_o_unknown.order_id;
  -- mark_order_paid (v1) delega en la v2 nueva
  IF public.mark_order_paid('cs_test_o0u_' || v_o_unknown.order_id, 'pi_test_o0u', 1000, 50) IS DISTINCT FROM v_o_unknown.order_id THEN
    RAISE EXCEPTION 'FAIL mark_order_paid (v1) ya no llega a la v2';
  END IF;

  -- Una entrada del pago de prueba, reembolsada (10 €)
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents, reason, status)
  VALUES (v_t_test2, v_o_test.order_id, v_event, v_org, v_client, 'o0-client@pasify.test', 1000, 'O0 reembolso', 'refunded');

  -- ------------------------------------------------------------------
  -- Ajuste require_live_payments y live_payments_required()
  -- ------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'require_live_payments' AND jsonb_typeof(value) = 'boolean') THEN
    RAISE EXCEPTION 'FAIL falta el ajuste booleano require_live_payments';
  END IF;
  IF NOT v_enum_ready
     AND (SELECT value FROM public.app_settings WHERE key = 'require_live_payments') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'FAIL la migración no deja require_live_payments = true';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'require_live_payments';
  IF public.live_payments_required() THEN RAISE EXCEPTION 'FAIL live_payments_required con el ajuste a false'; END IF;
  UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'require_live_payments';
  IF NOT public.live_payments_required() THEN RAISE EXCEPTION 'FAIL live_payments_required con el ajuste a true'; END IF;

  -- Claves de prueba: una pública (public.%) y una privada
  INSERT INTO public.app_settings (key, value) VALUES ('public.o0_test', 'true'::jsonb), ('o0_private_test', '"secreto"'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  -- anon: el booleano sí; la clave y los ajustes privados no
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  IF NOT public.live_payments_required() THEN RAISE EXCEPTION 'FAIL anon no obtiene live_payments_required'; END IF;
  SELECT count(*) INTO v_count FROM public.app_settings WHERE key = 'require_live_payments';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon lee la fila require_live_payments'; END IF;
  IF public.get_app_setting_text('o0_private_test') IS NOT NULL
     OR public.get_app_setting_text('application_fee_pct') IS NOT NULL
     OR public.get_app_setting_text('support_phone') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL anon lee ajustes privados con get_app_setting_text';
  END IF;
  IF public.get_app_setting_bool('public.o0_test') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL anon ya no lee un ajuste público';
  END IF;
  SELECT count(*) INTO v_count FROM public.partner_balance_v;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve saldos'; END IF;
  RESET ROLE;

  -- Cliente: igual que anon con los ajustes
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.get_app_setting_text('o0_private_test') IS NOT NULL THEN RAISE EXCEPTION 'FAIL un cliente lee ajustes privados'; END IF;
  RESET ROLE;

  -- Admin (RLS app_settings_admin_all) y servidor (BYPASSRLS): todas
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.get_app_setting_text('o0_private_test') IS DISTINCT FROM '"secreto"' THEN RAISE EXCEPTION 'FAIL el admin no lee ajustes privados'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  IF public.get_app_setting_text('o0_private_test') IS DISTINCT FROM '"secreto"' THEN RAISE EXCEPTION 'FAIL service_role no lee ajustes privados'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------
  -- partner_balance_v: fuera los pagos de prueba (y sus reembolsos)
  -- ------------------------------------------------------------------
  UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'require_live_payments';
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_bal FROM public.partner_balance_v WHERE org_id = v_org;
  RESET ROLE;
  IF v_bal.paid_orders IS DISTINCT FROM 3::bigint OR v_bal.gross_cents IS DISTINCT FROM 4000::bigint
     OR v_bal.refunded_cents IS DISTINCT FROM 1000::bigint OR v_bal.fee_cents IS DISTINCT FROM 200::bigint
     OR v_bal.net_cents IS DISTINCT FROM 2800::bigint THEN
    RAISE EXCEPTION 'FAIL saldo con el ajuste a false: %', row_to_json(v_bal);
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'require_live_payments';
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_bal FROM public.partner_balance_v WHERE org_id = v_org;
  RESET ROLE;
  IF v_bal.paid_orders IS DISTINCT FROM 2::bigint OR v_bal.gross_cents IS DISTINCT FROM 2000::bigint
     OR v_bal.refunded_cents IS DISTINCT FROM 0::bigint OR v_bal.fee_cents IS DISTINCT FROM 100::bigint
     OR v_bal.net_cents IS DISTINCT FROM 1900::bigint THEN
    RAISE EXCEPTION 'FAIL saldo con el ajuste a true: %', row_to_json(v_bal);
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_balance_v WHERE org_id = v_org;
  RESET ROLE;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro local ve el saldo ajeno'; END IF;

  -- Cada usuario (locales, miembros, compradores, solicitantes y los de este
  -- test) ve lo mismo que con la definición anterior: idéntico con el ajuste
  -- a false y, con true, lo anterior menos los pagos de prueba.
  SELECT array_agg(DISTINCT u) INTO v_users FROM (
    SELECT unnest(ARRAY[v_partner, v_client, v_other, v_admin]) AS u
    UNION SELECT owner_id FROM public.organizations WHERE owner_id IS NOT NULL
    UNION SELECT user_id FROM public.organization_members WHERE user_id IS NOT NULL
    UNION SELECT buyer_user_id FROM public.ticket_orders WHERE buyer_user_id IS NOT NULL
    UNION SELECT requester_user_id FROM public.refund_requests WHERE requester_user_id IS NOT NULL
  ) s
  WHERE u IS NOT NULL;

  FOREACH v_live IN ARRAY ARRAY[FALSE, TRUE] LOOP
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE public.app_settings SET value = to_jsonb(v_live) WHERE key = 'require_live_payments';
    FOREACH v_u IN ARRAY v_users LOOP
      PERFORM set_config('request.jwt.claim.sub', v_u::text, true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      WITH paid AS (
        SELECT o.org_id,
               count(*) AS paid_orders,
               COALESCE(sum(o.total_cents), 0) AS gross_cents,
               COALESCE(sum(o.fees_cents), 0) AS fee_cents
        FROM public.ticket_orders o
        WHERE o.org_id IS NOT NULL
          AND o.status IN ('paid', 'partial_refund', 'refunded')
          AND NOT (v_live AND o.livemode IS FALSE)
        GROUP BY o.org_id
      ),
      refunded AS (
        SELECT r.org_id, COALESCE(sum(r.amount_cents), 0) AS refunded_cents
        FROM public.refund_requests r
        WHERE r.org_id IS NOT NULL AND r.status = 'refunded'
          AND NOT (v_live AND EXISTS (SELECT 1 FROM public.ticket_orders t WHERE t.id = r.order_id AND t.livemode IS FALSE))
        GROUP BY r.org_id
      ),
      antes AS (
        SELECT p.org_id, p.paid_orders, p.gross_cents,
               COALESCE(r.refunded_cents, 0) AS refunded_cents,
               p.fee_cents,
               p.gross_cents - COALESCE(r.refunded_cents, 0) - p.fee_cents AS net_cents
        FROM paid p
        LEFT JOIN refunded r ON r.org_id = p.org_id
      )
      SELECT count(*) INTO v_count FROM (
        (SELECT * FROM antes EXCEPT SELECT * FROM public.partner_balance_v)
        UNION ALL
        (SELECT * FROM public.partner_balance_v EXCEPT SELECT * FROM antes)
      ) d;
      RESET ROLE;
      IF v_count <> 0 THEN
        RAISE EXCEPTION 'FAIL el saldo que ve % (ajuste %) no cuadra con la definición anterior: % filas', v_u, v_live, v_count;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'o0_servidor: saldo comparado para % usuarios', cardinality(v_users);

  -- ------------------------------------------------------------------
  -- Escáner: 'test_payment' con el ajuste a true
  -- ------------------------------------------------------------------
  -- (el ajuste quedó a true en la última vuelta)
  IF NOT public.live_payments_required() THEN RAISE EXCEPTION 'FAIL el ajuste debía seguir a true'; END IF;

  -- Otro local: 'forbidden' antes que nada
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr_test, 'o0', v_event);
  RESET ROLE;
  IF v_scan.result::text <> 'forbidden' THEN RAISE EXCEPTION 'FAIL otro local con una entrada de prueba: %', v_scan.result; END IF;

  IF v_enum_ready THEN
    v_expected := 'test_payment';
  ELSE
    -- El escáner real llega a la rama: falla justo al usar el valor nuevo.
    PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      SELECT * INTO v_scan FROM public.scan_ticket(v_qr_test, 'o0', v_event);
      RAISE EXCEPTION 'FAIL el escáner no llegó a la rama test_payment: %', v_scan.result;
    EXCEPTION WHEN SQLSTATE '55P04' THEN
      IF SQLERRM NOT LIKE '%test_payment%' THEN RAISE EXCEPTION 'FAIL error inesperado del escáner: %', SQLERRM; END IF;
    END;
    RESET ROLE;
    -- Y la rama entera con un valor ya confirmado en el literal (solo en
    -- esta transacción): el local tiene permiso, así que 'forbidden' solo
    -- puede salir de ahí.
    EXECUTE replace(pg_get_functiondef('public.scan_ticket(uuid,text,uuid,boolean,text)'::regprocedure),
                    '''test_payment''', '''forbidden''');
    v_expected := 'forbidden';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr_test, 'o0', v_event);
  IF v_scan.success OR v_scan.result::text <> v_expected OR v_scan.forced
     OR v_scan.ticket_id IS NOT NULL OR v_scan.event_id IS NOT NULL OR v_scan.event_title IS NOT NULL
     OR v_scan.buyer_first_name IS NOT NULL OR v_scan.buyer_last_name IS NOT NULL
     OR v_scan.buyer_email IS NOT NULL OR v_scan.tier_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL escaneo de una entrada de prueba: %', row_to_json(v_scan);
  END IF;
  -- Por código corto (scan_ticket_by_code delega en scan_ticket)
  SELECT * INTO v_scan FROM public.scan_ticket_by_code(upper(left(v_qr_test2::text, 8)), v_event, 'o0');
  IF v_scan.success OR v_scan.result::text <> v_expected OR v_scan.buyer_first_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL código corto de una entrada de prueba: %', row_to_json(v_scan);
  END IF;
  -- Pago real y pago de modo desconocido: entran
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr_live, 'o0', v_event);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' THEN RAISE EXCEPTION 'FAIL escaneo de un pago real: %', v_scan.result; END IF;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr_unknown, 'o0', v_event);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' THEN RAISE EXCEPTION 'FAIL escaneo con livemode NULL: %', v_scan.result; END IF;
  RESET ROLE;

  SELECT count(*) INTO v_count FROM public.tickets WHERE id IN (v_t_test, v_t_test2) AND status = 'paid' AND used_at IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL una entrada de prueba quedó marcada como usada'; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs
   WHERE ticket_id IN (v_t_test, v_t_test2) AND result::text = v_expected AND notes = 'order livemode = false'
     AND scanned_by_user_id = v_partner AND org_id = v_org;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL registro de escaneos de prueba = %', v_count; END IF;

  -- Con el ajuste a false, como antes: la entrada de prueba entra
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.app_settings SET value = 'false'::jsonb WHERE key = 'require_live_payments';
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr_test, 'o0', v_event);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' OR v_scan.buyer_first_name IS DISTINCT FROM 'Tea' THEN
    RAISE EXCEPTION 'FAIL con el ajuste a false la entrada de prueba no entra: %', row_to_json(v_scan);
  END IF;
  RESET ROLE;

  -- Una confirmación repetida completa el modo que faltaba, sin pisar uno conocido
  SELECT * INTO v_paid FROM public.mark_order_paid_v2('cs_test_o0u_' || v_o_unknown.order_id, 'pi_test_o0u', 1000, 50, TRUE);
  IF v_paid.newly_paid THEN RAISE EXCEPTION 'FAIL la confirmación repetida es newly_paid'; END IF;
  PERFORM public.mark_order_paid_v2('cs_test_o0u_' || v_o_unknown.order_id, 'pi_test_o0u', 1000, 50, FALSE);
  SELECT livemode INTO v_bool FROM public.ticket_orders WHERE id = v_o_unknown.order_id;
  IF v_bool IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL livemode tras confirmar de nuevo = %', v_bool; END IF;

  -- ------------------------------------------------------------------
  -- B6-06: funciones con _user_id (uno mismo, admin o servidor)
  -- ------------------------------------------------------------------
  -- Puntos de quien invita: loyalty_grant_points ya no depende de
  -- loyalty_balance (que no contesta por otro usuario).
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.loyalty_grant_points(v_partner, 100, 'O0 saldo inicial', 'o0_test');
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_code := public.get_or_create_my_referral_code();
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.redeem_referral_code(v_code);
  RESET ROLE;
  -- Ola 2 (o2_reembolsos): el canje deja el referido pendiente y los puntos
  -- llegan con la primera compra de pago (v_client ya tiene pedidos pagados),
  -- como hace order-paid.ts desde el servidor.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.grant_referral_on_first_purchase(v_client);
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Como cliente
  IF NOT public.has_role(v_client, 'client') THEN RAISE EXCEPTION 'FAIL has_role propio'; END IF;
  IF public.has_role(v_partner, 'partner') OR public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'FAIL has_role contesta por otro usuario';
  END IF;
  IF public.has_role(NULL, 'client') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'FAIL has_role(NULL) no es false'; END IF;
  IF public.get_user_role(v_client) IS DISTINCT FROM 'client' THEN RAISE EXCEPTION 'FAIL get_user_role propio: %', public.get_user_role(v_client); END IF;
  IF public.get_user_role(v_partner) IS NOT NULL THEN RAISE EXCEPTION 'FAIL get_user_role contesta por otro usuario'; END IF;
  IF public.loyalty_balance(v_client) IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'FAIL loyalty_balance propio = %', public.loyalty_balance(v_client); END IF;
  IF public.loyalty_balance(v_partner) IS NOT NULL THEN RAISE EXCEPTION 'FAIL loyalty_balance contesta por otro usuario'; END IF;
  IF public.is_super_admin(v_admin) THEN RAISE EXCEPTION 'FAIL is_super_admin contesta por otro usuario'; END IF;
  RESET ROLE;

  SELECT balance_after INTO v_int FROM public.loyalty_points WHERE user_id = v_partner AND reason_code = 'referral_referrer';
  IF v_int IS DISTINCT FROM 600 THEN RAISE EXCEPTION 'FAIL saldo de quien invita tras el canje = %', v_int; END IF;

  -- Como admin
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT public.has_role(v_partner, 'partner') THEN RAISE EXCEPTION 'FAIL el admin no ve roles ajenos'; END IF;
  IF public.get_user_role(v_partner) IS DISTINCT FROM 'partner' THEN RAISE EXCEPTION 'FAIL get_user_role para el admin'; END IF;
  -- Orden de producción: con admin y client, 'admin'
  IF public.get_user_role(v_admin) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL get_user_role no da el rol más alto: %', public.get_user_role(v_admin); END IF;
  IF public.loyalty_balance(v_partner) IS DISTINCT FROM 600 THEN RAISE EXCEPTION 'FAIL loyalty_balance para el admin'; END IF;
  RESET ROLE;

  -- Servidor: SQL directo y service_role
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT public.has_role(v_partner, 'partner') OR public.get_user_role(v_partner) IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'FAIL el servidor (SQL) no ve roles';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  IF NOT public.has_role(v_partner, 'partner') OR public.loyalty_balance(v_client) IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION 'FAIL service_role no ve roles o saldos';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------
  -- B5-9: auditoría en tablas sin columna id
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_app_setting('o0_test_setting', '1'::jsonb);
  PERFORM public.set_app_setting('o0_test_setting', '2'::jsonb);
  DELETE FROM public.app_settings WHERE key = 'o0_test_setting';
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE action IN ('UPDATE_app_settings', 'DELETE_app_settings') AND actor_user_id = v_admin
     AND target_id IS NULL AND COALESCE(after, before)->>'key' = 'o0_test_setting';
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL auditoría de app_settings = % filas', v_count; END IF;

  SELECT capability_code, killed INTO v_key, v_bool FROM public.ai_kill_switches ORDER BY capability_code LIMIT 1;
  IF v_key IS NULL THEN RAISE EXCEPTION 'FAIL no hay kill-switches de IA que probar'; END IF;
  SET LOCAL ROLE authenticated;
  v_toggle1 := public.toggle_ai_kill_switch(v_key, 'O0 prueba');
  v_toggle2 := public.toggle_ai_kill_switch(v_key, 'O0 prueba');
  RESET ROLE;
  IF v_toggle1 IS DISTINCT FROM (NOT v_bool) OR v_toggle2 IS DISTINCT FROM v_bool THEN
    RAISE EXCEPTION 'FAIL toggle_ai_kill_switch: % y %', v_toggle1, v_toggle2;
  END IF;
  SELECT count(*) INTO v_count FROM public.audit_logs
   WHERE action = 'UPDATE_ai_kill_switches' AND actor_user_id = v_admin AND after->>'capability_code' = v_key;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL auditoría del kill-switch = % filas', v_count; END IF;

  -- Clave primaria UUID sin columna id: target_id = org_id
  INSERT INTO public.whitelabel_configs (org_id) VALUES (v_org);
  UPDATE public.whitelabel_configs SET primary_color = '#101010' WHERE org_id = v_org;
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE action = 'UPDATE_whitelabel_configs' AND target_id = v_org;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL auditoría de whitelabel_configs = %', v_count; END IF;
  INSERT INTO public.feature_flags (code, name) VALUES ('o0_test_flag', 'O0 prueba');
  UPDATE public.feature_flags SET enabled = TRUE WHERE code = 'o0_test_flag';
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE action = 'UPDATE_feature_flags' AND after->>'code' = 'o0_test_flag';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL auditoría de feature_flags = %', v_count; END IF;
  -- Y las tablas con id siguen como antes
  UPDATE public.events SET title = 'O0 Evento (editado)' WHERE id = v_event;
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE action = 'UPDATE_events' AND target_id = v_event;
  IF v_count < 1 THEN RAISE EXCEPTION 'FAIL auditoría de events sin target_id'; END IF;

  -- ------------------------------------------------------------------
  -- B6-10: borrar a quien escribió en una conversación ajena
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_conv := public.open_conversation('client_admin');
  RESET ROLE;
  INSERT INTO public.support_messages (conversation_id, sender_id, sender_kind, body)
  VALUES (v_conv, v_writer, 'admin', 'O0 respuesta de soporte') RETURNING id INTO v_msg;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_writer;
  SELECT count(*) INTO v_count FROM public.support_messages WHERE id = v_msg AND sender_id IS NULL AND conversation_id = v_conv;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el mensaje no sobrevive a la cuenta borrada'; END IF;

  -- ------------------------------------------------------------------
  -- B3-06: check_rate_limit con ventana máxima de 24 h
  -- ------------------------------------------------------------------
  v_key := 'o0:clamp:' || gen_random_uuid();
  IF NOT public.check_rate_limit(v_key, 5, 999999999) THEN RAISE EXCEPTION 'FAIL check_rate_limit rechazó la primera llamada'; END IF;
  SELECT count(*) INTO v_count FROM public.rate_limits WHERE key = v_key AND expires_at - window_start <= INTERVAL '1 day';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la ventana no se limitó a 24 h'; END IF;
  SELECT count(*) INTO v_count FROM public.rate_limits
   WHERE expires_at > now() + INTERVAL '1 day' OR expires_at - window_start > INTERVAL '1 day';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL quedan % bloqueos de más de 24 h', v_count; END IF;

  -- ------------------------------------------------------------------
  -- B3-08: set_admin_by_email solo desde el servidor
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  IF public.set_admin_by_email('O0-PROMOTED-' || v_promoted || '@pasify.test') IS DISTINCT FROM v_promoted THEN
    RAISE EXCEPTION 'FAIL set_admin_by_email desde service_role';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_promoted AND role = 'admin') THEN
    RAISE EXCEPTION 'FAIL set_admin_by_email no dio el rol';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_admin_by_email('o0-client-' || v_client || '@pasify.test');
    RAISE EXCEPTION 'FAIL un admin con sesión sigue creando admins';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------
  -- B6-16: buckets con límite de tamaño y tipo
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM storage.buckets
   WHERE id IN ('support-attachments', 'marketing-assets')
     AND file_size_limit = 10485760
     AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf']
     AND allowed_mime_types <@ ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'];
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL buckets sin límites: % de 2', v_count; END IF;

  -- ------------------------------------------------------------------
  -- Catálogo: EXECUTE de cada función tocada
  -- ------------------------------------------------------------------
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('public.check_rate_limit(text,integer,integer)', 'anon', FALSE),
      ('public.check_rate_limit(text,integer,integer)', 'authenticated', FALSE),
      ('public.check_rate_limit(text,integer,integer)', 'service_role', TRUE),
      ('public.get_app_setting_bool(text)', 'anon', TRUE),
      ('public.get_app_setting_bool(text)', 'authenticated', TRUE),
      ('public.get_app_setting_int(text)', 'anon', TRUE),
      ('public.get_app_setting_int(text)', 'authenticated', TRUE),
      ('public.get_app_setting_text(text)', 'anon', TRUE),
      ('public.get_app_setting_text(text)', 'service_role', TRUE),
      ('public.has_role(uuid,app_role)', 'anon', FALSE),
      ('public.has_role(uuid,app_role)', 'authenticated', TRUE),
      ('public.has_role(uuid,app_role)', 'service_role', TRUE),
      ('public.get_user_role(uuid)', 'anon', FALSE),
      ('public.get_user_role(uuid)', 'authenticated', TRUE),
      ('public.loyalty_balance(uuid)', 'anon', FALSE),
      ('public.loyalty_balance(uuid)', 'authenticated', TRUE),
      ('public.loyalty_grant_points(uuid,integer,text,text,uuid,uuid,uuid,timestamp with time zone)', 'authenticated', FALSE),
      ('public.loyalty_grant_points(uuid,integer,text,text,uuid,uuid,uuid,timestamp with time zone)', 'service_role', TRUE),
      ('public.is_super_admin(uuid)', 'anon', FALSE),
      ('public.is_super_admin(uuid)', 'authenticated', TRUE),
      ('public.accept_invitation(uuid)', 'anon', FALSE),
      ('public.accept_invitation(uuid)', 'authenticated', FALSE),
      ('public.accept_invitation(uuid)', 'service_role', TRUE),
      ('public.accept_ticket_transfer(uuid)', 'anon', FALSE),
      ('public.accept_ticket_transfer(uuid)', 'authenticated', TRUE),
      ('public.global_search(text,integer)', 'anon', FALSE),
      ('public.global_search(text,integer)', 'authenticated', FALSE),
      ('public.set_admin_by_email(text)', 'anon', FALSE),
      ('public.set_admin_by_email(text)', 'authenticated', FALSE),
      ('public.set_admin_by_email(text)', 'service_role', TRUE),
      ('public.live_payments_required()', 'anon', TRUE),
      ('public.live_payments_required()', 'authenticated', TRUE),
      ('public.live_payments_required()', 'service_role', TRUE),
      ('public.mark_order_paid_v2(text,text,integer,integer,boolean)', 'anon', FALSE),
      ('public.mark_order_paid_v2(text,text,integer,integer,boolean)', 'authenticated', FALSE),
      ('public.mark_order_paid_v2(text,text,integer,integer,boolean)', 'service_role', TRUE),
      ('public.create_ticket_order(uuid,uuid,integer,uuid,text,text,text,text,numeric,integer)', 'anon', FALSE),
      ('public.create_ticket_order(uuid,uuid,integer,uuid,text,text,text,text,numeric,integer)', 'authenticated', FALSE),
      ('public.create_ticket_order(uuid,uuid,integer,uuid,text,text,text,text,numeric,integer)', 'service_role', TRUE),
      ('public.scan_ticket(uuid,text,uuid,boolean,text)', 'anon', FALSE),
      ('public.scan_ticket(uuid,text,uuid,boolean,text)', 'authenticated', TRUE),
      ('public.audit_changes()', 'anon', FALSE),
      ('public.audit_changes()', 'authenticated', FALSE)
    ) AS t(fn, rol, esperado)
  LOOP
    IF has_function_privilege(v_rec.rol, v_rec.fn, 'EXECUTE') IS DISTINCT FROM v_rec.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre %: esperaba %', v_rec.rol, v_rec.fn, v_rec.esperado;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosecdef AND oid IN (
       'public.get_app_setting_bool(text)'::regprocedure,
       'public.get_app_setting_int(text)'::regprocedure,
       'public.get_app_setting_text(text)'::regprocedure)) THEN
    RAISE EXCEPTION 'FAIL get_app_setting_* siguen siendo SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.live_payments_required()'::regprocedure
                   AND prosecdef AND provolatile = 's' AND prorettype = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'FAIL live_payments_required no es STABLE SECURITY DEFINER booleana';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.partner_balance_v'::regclass
                   AND 'security_invoker=true' = ANY (reloptions)) THEN
    RAISE EXCEPTION 'FAIL partner_balance_v dejó de ser security_invoker';
  END IF;
  -- rls_auto_enable solo existe en producción
  FOR v_rec IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  LOOP
    IF has_function_privilege('anon', v_rec.oid, 'EXECUTE') OR has_function_privilege('authenticated', v_rec.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL rls_auto_enable sigue abierta';
    END IF;
  END LOOP;

  -- Lista blanca: exactamente estas SECURITY DEFINER de public para anon
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.oid NOT IN ('public.get_feature_flag(text,uuid)'::regprocedure,
                      'public.public_partner_rows()'::regprocedure,
                      'public.resolve_whitelabel_host(text)'::regprocedure,
                      'public.live_payments_required()'::regprocedure);
  IF v_text IS NOT NULL THEN RAISE EXCEPTION 'FAIL SECURITY DEFINER ejecutables por anon fuera de la lista blanca: %', v_text; END IF;
  IF NOT (has_function_privilege('anon', 'public.get_feature_flag(text,uuid)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.public_partner_rows()', 'EXECUTE')
          AND has_function_privilege('anon', 'public.resolve_whitelabel_host(text)', 'EXECUTE')
          AND has_function_privilege('anon', 'public.live_payments_required()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'FAIL anon perdió una función de la lista blanca';
  END IF;

  -- ------------------------------------------------------------------
  -- Pedidos anteriores a la migración: todos livemode = false (solo si la
  -- migración corre en esta transacción; después puede haber pedidos nuevos)
  -- ------------------------------------------------------------------
  IF NOT v_enum_ready THEN
    SELECT count(*) INTO v_count FROM public.ticket_orders WHERE created_at < now() AND livemode IS DISTINCT FROM FALSE;
    IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL % pedidos anteriores sin livemode = false', v_count; END IF;
  END IF;

  RAISE NOTICE 'PASS o0_servidor: pagos de prueba (%), compra con cuenta, saldo, permisos, auditoría, soporte, rate limit y buckets',
    CASE WHEN v_enum_ready THEN 'test_payment' ELSE 'rama test_payment con valor sustituto' END;
END $$;

ROLLBACK;
