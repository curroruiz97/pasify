-- Pasify · Ola 6 · máximo de 10 entradas por persona y evento.
-- Migración 20261013110000_limite_entradas_por_evento.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Una persona no puede tener más de 10 entradas por evento, entre todos los
-- tipos y sumando pagadas, usadas y reservas en curso:
--   * 6 + 4 en dos tipos distintos: bien; la 11.ª, `qty_exceeds_event_limit`
--     con HINT = cuántas puede añadir (0);
--   * pedidos seguidos (5 + 5 + 1), de pago y gratis mezclados: igual;
--   * otra persona y otro evento no se ven afectados;
--   * devoluciones, anulaciones y reservas caducadas liberan cupo; las
--     reservas vigentes lo ocupan; pasar entradas a otra persona NO lo libera;
--   * el código de error anterior (por tipo, por pedido) no cambia;
--   * event_ticket_allowance (lo que ve el selector) y los permisos.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20261013110000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o6_limite_entradas.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _uid IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.exige(_ok BOOLEAN, _msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', _msg; END IF;
END $$;

-- Pedido de pago de `_qty` entradas de `_tier`, ya pagado de verdad (livemode = true).
CREATE OR REPLACE FUNCTION pg_temp.comprar_y_pagar(_evento UUID, _tipo UUID, _qty INT, _comprador UUID, _precio INT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  SELECT * INTO o FROM public.create_ticket_order(_evento, _tipo, _qty, _comprador, 'o6-' || _comprador || '@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(o.order_id, 'cs_o6_' || o.order_id);
  PERFORM public.mark_order_paid_v2('cs_o6_' || o.order_id, 'pi_o6_' || o.order_id, _precio * _qty, 0, TRUE);
  RETURN o.order_id;
END $$;

-- Intenta un pedido de pago y devuelve 'ok' o 'código|hint'.
CREATE OR REPLACE FUNCTION pg_temp.intentar(_evento UUID, _tipo UUID, _qty INT, _comprador UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_hint TEXT;
BEGIN
  PERFORM public.create_ticket_order(_evento, _tipo, _qty, _comprador, 'o6-' || _comprador || '@pasify.test', 'Clara', 'Ena');
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  RETURN SQLERRM || '|' || COALESCE(v_hint, '');
END $$;

CREATE OR REPLACE FUNCTION pg_temp.intentar_gratis(_evento UUID, _tipo UUID, _qty INT, _comprador UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_hint TEXT;
BEGIN
  PERFORM public.create_free_ticket_order(_evento, _tipo, _qty, _comprador, 'o6-' || _comprador || '@pasify.test', 'Clara', 'Ena');
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  RETURN SQLERRM || '|' || COALESCE(v_hint, '');
END $$;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_b1      UUID := gen_random_uuid();   -- compra 6 + 4, y el resto de escenarios
  v_b2      UUID := gen_random_uuid();   -- otra persona: no se ve afectada
  v_b3      UUID := gen_random_uuid();   -- mezcla gratis y de pago
  v_b4      UUID := gen_random_uuid();   -- pedidos seguidos 5 + 5 + 1
  v_org     UUID;
  v_ev      UUID;
  v_ev2     UUID;
  v_ta      UUID;                        -- tipo A, de pago
  v_tb      UUID;                        -- tipo B, de pago
  v_tc      UUID;                        -- tipo C, de pago (sin compras previas: solo manda el límite por evento)
  v_tf      UUID;                        -- tipo gratis
  v_t2      UUID;                        -- tipo del otro evento
  v_t2b     UUID;                        -- segundo tipo del otro evento
  v_o       UUID;
  v_n       INT;
  v_r       TEXT;
  v_row     RECORD;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o6-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b1, 'o6-' || v_b1 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b2, 'o6-' || v_b2 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b3, 'o6-' || v_b3 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b4, 'o6-' || v_b4 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O6 Límite', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O6 Evento', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 1000)
  RETURNING id INTO v_ev;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O6 Otro evento', 'Madrid', now() + INTERVAL '6 days', now() + INTERVAL '6 days 6 hours', 'published', 1000)
  RETURNING id INTO v_ev2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev, 'A', 1000, 200, 10) RETURNING id INTO v_ta;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev, 'B', 2000, 200, 10) RETURNING id INTO v_tb;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev, 'C', 1500, 200, 10) RETURNING id INTO v_tc;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev, 'Gratis', 0, 200, 10) RETURNING id INTO v_tf;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev2, 'A2', 1000, 200, 10) RETURNING id INTO v_t2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ev2, 'B2', 1000, 200, 10) RETURNING id INTO v_t2b;
  RESET ROLE;
  PERFORM pg_temp.como(NULL);

  -- ------------------------------------------------------------------
  -- 0) El tope, en un solo sitio
  -- ------------------------------------------------------------------
  PERFORM pg_temp.exige(public.max_tickets_per_buyer_event() = 10, '0: el tope es 10');

  -- ------------------------------------------------------------------
  -- 1) 6 + 4 en dos tipos: bien. La 11.ª, no (con hint 0).
  -- ------------------------------------------------------------------
  PERFORM pg_temp.comprar_y_pagar(v_ev, v_ta, 6, v_b1, 1000);
  PERFORM pg_temp.comprar_y_pagar(v_ev, v_tb, 4, v_b1, 2000);
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 10, '1: lleva 10');
  v_r := pg_temp.intentar(v_ev, v_ta, 1, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('1: la 11.ª de un tipo (%s)', v_r));
  v_r := pg_temp.intentar(v_ev, v_tb, 1, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('1: la 11.ª de otro tipo (%s)', v_r));
  v_r := pg_temp.intentar_gratis(v_ev, v_tf, 1, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('1: la 11.ª gratis (%s)', v_r));
  -- Nada se ha creado con los rechazos.
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 10, '1: los rechazos no reservan nada');

  -- ------------------------------------------------------------------
  -- 2) Otra persona y otro evento no se ven afectados
  -- ------------------------------------------------------------------
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev, v_ta, 10, v_b2) = 'ok', '2: otra persona compra 10 en el mismo evento');
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev2, v_t2, 10, v_b1) = 'ok', '2: la misma persona compra 10 en otro evento');
  -- (con otro tipo del otro evento: el máximo por tipo no interviene, solo el del evento)
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev2, v_t2b, 1, v_b1) = 'qty_exceeds_event_limit|0', '2: y en el otro evento también topa');

  -- ------------------------------------------------------------------
  -- 3) Una devolución libera cupo (y solo ese)
  -- ------------------------------------------------------------------
  UPDATE public.tickets SET status = 'refunded'
   WHERE id IN (SELECT id FROM public.tickets WHERE buyer_user_id = v_b1 AND event_id = v_ev AND status = 'paid' ORDER BY id LIMIT 3);
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 7, '3: tras devolver 3 lleva 7');
  v_r := pg_temp.intentar(v_ev, v_tc, 4, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|3', format('3: 7 + 4 no cabe y dice que caben 3 (%s)', v_r));
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev, v_tc, 3, v_b1) = 'ok', '3: 7 + 3 sí');

  -- ------------------------------------------------------------------
  -- 4) La reserva vigente ocupa cupo; la caducada lo libera
  -- ------------------------------------------------------------------
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 10, '4: con la reserva pendiente lleva 10');
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev, v_tc, 1, v_b1) = 'qty_exceeds_event_limit|0', '4: la reserva pendiente cuenta');
  UPDATE public.ticket_orders SET expires_at = now() - INTERVAL '1 hour'
   WHERE buyer_user_id = v_b1 AND event_id = v_ev AND status = 'pending';
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 7, '4: caducada, la reserva no cuenta');
  -- (otras dos devueltas: lleva 5)
  UPDATE public.tickets SET status = 'refunded'
   WHERE id IN (SELECT id FROM public.tickets WHERE buyer_user_id = v_b1 AND event_id = v_ev AND status = 'paid' ORDER BY id LIMIT 2);
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 5, '4: lleva 5');

  -- ------------------------------------------------------------------
  -- 5) Pasar entradas a otra persona NO libera cupo del comprador
  -- ------------------------------------------------------------------
  UPDATE public.tickets SET transferred_to_user_id = v_b2
   WHERE buyer_user_id = v_b1 AND event_id = v_ev AND status = 'paid';
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ev, v_b1) = 5, '5: transferir no cambia lo que compró');
  v_r := pg_temp.intentar(v_ev, v_tc, 6, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|5', format('5: 5 + 6 no cabe (%s)', v_r));

  -- ------------------------------------------------------------------
  -- 6) Pedidos seguidos (5 + 5 + 1) y mezcla de gratis y de pago
  -- ------------------------------------------------------------------
  PERFORM pg_temp.comprar_y_pagar(v_ev, v_ta, 5, v_b4, 1000);
  PERFORM pg_temp.comprar_y_pagar(v_ev, v_tb, 5, v_b4, 2000);
  v_r := pg_temp.intentar(v_ev, v_tc, 1, v_b4);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('6: 5 + 5 + 1 (%s)', v_r));

  PERFORM pg_temp.exige(pg_temp.intentar_gratis(v_ev, v_tf, 5, v_b3) = 'ok', '6: 5 gratis');
  PERFORM pg_temp.comprar_y_pagar(v_ev, v_tb, 5, v_b3, 2000);
  v_r := pg_temp.intentar_gratis(v_ev, v_tf, 1, v_b3);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('6: 5 gratis + 5 de pago + 1 gratis (%s)', v_r));
  v_r := pg_temp.intentar(v_ev, v_tb, 1, v_b3);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('6: 5 gratis + 5 de pago + 1 de pago (%s)', v_r));

  -- ------------------------------------------------------------------
  -- 7) Los errores anteriores no cambian de código
  -- ------------------------------------------------------------------
  -- Un pedido de 11 sigue siendo invalid_qty.
  PERFORM pg_temp.exige(pg_temp.intentar(v_ev2, v_t2, 11, v_b2) = 'invalid_qty|', '7: pedido de 11');
  -- El máximo por tipo manda antes (mismo comprador, tipo con tope de 2).
  UPDATE public.ticket_tiers SET per_user_max = 2 WHERE id = v_t2;
  v_r := pg_temp.intentar(v_ev2, v_t2, 1, v_b1);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_per_user_max|', format('7: el máximo por tipo conserva su código (%s)', v_r));
  UPDATE public.ticket_tiers SET per_user_max = 10 WHERE id = v_t2;

  -- ------------------------------------------------------------------
  -- 8) Lo que ve el selector: event_ticket_allowance
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_b4);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.event_ticket_allowance(v_ev);
  RESET ROLE;
  PERFORM pg_temp.exige(v_row.max_per_buyer = 10 AND v_row.held = 10 AND v_row.remaining = 0, format('8: comprador con 10 (%s)', v_row));

  PERFORM pg_temp.como(v_b1);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.event_ticket_allowance(v_ev);
  RESET ROLE;
  PERFORM pg_temp.exige(v_row.max_per_buyer = 10 AND v_row.held = 5 AND v_row.remaining = 5, format('8: comprador con 5 (%s)', v_row));

  -- Sin sesión no se llega a ella: el selector solo se abre con sesión y anon
  -- no ejecuta funciones SECURITY DEFINER que no necesita.
  PERFORM pg_temp.como(NULL);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.event_ticket_allowance(v_ev);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 8: anon no debería poder llamar a event_ticket_allowance';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  -- Un evento que no existe: nada que enseñar.
  PERFORM pg_temp.como(v_b4);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.event_ticket_allowance(gen_random_uuid());
  RESET ROLE;
  PERFORM pg_temp.exige(v_row.held = 0 AND v_row.remaining = 10, '8: evento inexistente');

  -- ------------------------------------------------------------------
  -- 9) Permisos
  -- ------------------------------------------------------------------
  PERFORM pg_temp.exige(
    NOT has_function_privilege('authenticated', 'public.ticket_buyer_event_held(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.ticket_buyer_event_held(uuid, uuid)', 'EXECUTE'),
    '9: ticket_buyer_event_held no es de la API');
  PERFORM pg_temp.exige(
    NOT has_function_privilege('authenticated', 'public.max_tickets_per_buyer_event()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.max_tickets_per_buyer_event()', 'EXECUTE'),
    '9: max_tickets_per_buyer_event no es de la API');
  PERFORM pg_temp.exige(
    has_function_privilege('authenticated', 'public.event_ticket_allowance(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.event_ticket_allowance(uuid)', 'EXECUTE'),
    '9: event_ticket_allowance es de la API solo con sesión');
  PERFORM pg_temp.exige(
    NOT has_function_privilege('authenticated', 'public.create_ticket_order(uuid, uuid, int, uuid, text, text, text, text, numeric, int)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.create_free_ticket_order(uuid, uuid, int, uuid, text, text, text, text)', 'EXECUTE'),
    '9: las funciones de pedido siguen sin ser de la API');

  RAISE NOTICE 'o6_limite_entradas: OK';
END $$;

ROLLBACK;
