-- Pasify · panel de local, ola 1: aforo del evento = suma de los cupos de
-- todos los tipos (B4-02), precio mínimo de 0,50 € (B4-03), 'past' terminal
-- (WP1.3) y la puerta con un evento retirado de la venta (B4-04).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con la migración 20260926150000 aplicada en la misma transacción):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" -f supabase/migrations/20260926150000_o1_local_eventos_y_tipos.sql -f tests/db/o1_local.sql -c "ROLLBACK;"

BEGIN;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_client  UUID := gen_random_uuid();
  v_client2 UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_early   UUID;
  v_general UUID;
  v_door    UUID;
  v_manual  UUID;
  v_legacy  UUID;
  v_old     UUID;
  v_past    UUID;
  v_retired UUID;
  v_future  UUID;
  v_tier    UUID;
  v_order   RECORD;
  v_scan    RECORD;
  v_cap     INT;
  v_count   INT;
  v_text    TEXT;
  v_qr      UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o1-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o1-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client2, 'o1-client2-' || v_client2 || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,   'o1-admin-'   || v_admin   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  -- ------------------------------------------------------------------
  -- 1) Aforo = suma de los cupos de TODOS los tipos (B4-02)
  -- ------------------------------------------------------------------
  -- Como el editor nuevo: el evento se crea sin aforo y los tipos después,
  -- todos en un mismo INSERT.
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O1 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1 Evento', 'Madrid', now() + INTERVAL '2 hours', now() + INTERVAL '8 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order)
  VALUES (v_event, 'Early', 1000, 2, 10, 0), (v_event, 'General', 1500, 3, 10, 1);
  RESET ROLE;
  SELECT id INTO v_early FROM public.ticket_tiers WHERE event_id = v_event AND name = 'Early';
  SELECT id INTO v_general FROM public.ticket_tiers WHERE event_id = v_event AND name = 'General';
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL aforo al crear = % (esperado 5)', v_cap; END IF;

  -- Early se agota (2 pagadas)
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_early, 2, v_client, 'o1-client@pasify.test', 'Olga', 'Uno');
  UPDATE public.tickets SET status = 'paid', paid_at = now() WHERE order_id = v_order.order_id;
  UPDATE public.ticket_orders SET status = 'paid' WHERE id = v_order.order_id;

  -- Se oculta Early: el aforo no cambia
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ticket_tiers SET status = 'hidden' WHERE id = v_early;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL ocultar un tipo cambió el aforo a %', v_cap; END IF;

  -- El editor de las apps publicadas escribe la suma de los activos (3) y
  -- después guarda cada tipo con su cupo: el aforo vuelve a 5.
  UPDATE public.events SET capacity = 3 WHERE id = v_event;
  UPDATE public.ticket_tiers SET name = 'Early', capacity = 2, status = 'hidden', sort_order = 0 WHERE id = v_early;
  UPDATE public.ticket_tiers SET name = 'General', capacity = 3, status = 'active', sort_order = 1 WHERE id = v_general;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'FAIL el guardado del editor antiguo dejó el aforo en %', v_cap; END IF;
  RESET ROLE;

  -- General vende su cupo entero (antes: event_sold_out con 1 vendida) y
  -- lo que corta la venta es el cupo del tipo, no el del evento.
  SELECT * INTO v_order FROM public.create_ticket_order(v_event, v_general, 3, v_client2, 'o1-client2@pasify.test', 'Oto', 'Dos');
  IF v_order.qty <> 3 THEN RAISE EXCEPTION 'FAIL General no vendió su cupo: %', row_to_json(v_order); END IF;
  v_text := NULL;
  BEGIN
    PERFORM public.create_ticket_order(v_event, v_general, 1, NULL, 'o1-otro@pasify.test', 'Otro', 'Más');
  EXCEPTION WHEN raise_exception THEN
    v_text := SQLERRM;
  END;
  IF v_text IS DISTINCT FROM 'tier_sold_out' THEN
    RAISE EXCEPTION 'FAIL esperaba tier_sold_out y llegó %', COALESCE(v_text, 'una venta');
  END IF;

  -- Cambiar un cupo, añadir un tipo sin límite, ponerle límite y borrarlo
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ticket_tiers SET capacity = 4 WHERE id = v_general;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'FAIL aforo tras subir un cupo = % (esperado 6)', v_cap; END IF;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, sort_order)
  VALUES (v_event, 'Taquilla', 2000, NULL, 2) RETURNING id INTO v_door;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS NOT NULL THEN RAISE EXCEPTION 'FAIL un tipo sin límite debía dejar el evento sin límite: %', v_cap; END IF;
  UPDATE public.ticket_tiers SET capacity = 10 WHERE id = v_door;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'FAIL aforo con tres tipos = % (esperado 16)', v_cap; END IF;
  DELETE FROM public.ticket_tiers WHERE id = v_door;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_event;
  IF v_cap IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'FAIL aforo tras borrar un tipo = % (esperado 6)', v_cap; END IF;

  -- Evento sin tipos: su aforo manual no se toca; al quitarle el último
  -- tipo se queda el que tenía.
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents, capacity)
  VALUES (v_partner, v_org, 'O1 Aforo manual', 'Madrid', now() + INTERVAL '5 days', 'draft', 0, 250)
  RETURNING id INTO v_manual;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_manual;
  IF v_cap IS DISTINCT FROM 250 THEN RAISE EXCEPTION 'FAIL aforo manual sin tipos = %', v_cap; END IF;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_manual, 'General', 1000, 100) RETURNING id INTO v_tier;
  DELETE FROM public.ticket_tiers WHERE id = v_tier;
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_manual;
  IF v_cap IS DISTINCT FROM 100 THEN RAISE EXCEPTION 'FAIL sin tipos el aforo debía quedarse en 100: %', v_cap; END IF;

  -- Entradas antiguas sin tipo: cuentan en el aforo
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents)
  VALUES (v_partner, v_org, 'O1 Antiguo', 'Madrid', now() + INTERVAL '6 days', 'published', 1000)
  RETURNING id INTO v_legacy;
  RESET ROLE;
  INSERT INTO public.tickets (event_id, buyer_email, status, amount_paid_cents, paid_at)
  VALUES (v_legacy, 'o1-antiguo@pasify.test', 'paid', 1000, now());
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_legacy, 'General', 1000, 2);
  SELECT capacity INTO v_cap FROM public.events WHERE id = v_legacy;
  IF v_cap IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'FAIL la entrada sin tipo no cuenta en el aforo: %', v_cap; END IF;
  RESET ROLE;

  -- La función de recálculo no la ejecuta un cliente
  IF has_function_privilege('authenticated', 'public.event_capacity_from_tiers(uuid)', 'execute') THEN
    RAISE EXCEPTION 'FAIL event_capacity_from_tiers ejecutable por authenticated';
  END IF;

  -- ------------------------------------------------------------------
  -- 2) Precio: 0 € o al menos 0,50 € (B4-03)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'Céntimos', 30, 5);
    RAISE EXCEPTION 'FAIL se creó un tipo de 0,30 €';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ticket_tiers SET price_cents = 49 WHERE id = v_general;
    RAISE EXCEPTION 'FAIL se cambió un precio a 0,49 €';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.ticket_tiers SET price_cents = 50 WHERE id = v_general;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'Invitación', 0, 5);
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE event_id = v_event AND price_cents IN (0, 50);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL precios de 0 € y 0,50 € rechazados'; END IF;
  RESET ROLE;

  -- Un tipo antiguo de 0,30 € se sigue pudiendo editar sin tocar su precio
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_manual, 'Antiguo', 30, 5) RETURNING id INTO v_old;
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ticket_tiers SET name = 'Antiguo (editado)', price_cents = 30 WHERE id = v_old;
  SELECT name INTO v_text FROM public.ticket_tiers WHERE id = v_old;
  IF v_text IS DISTINCT FROM 'Antiguo (editado)' THEN RAISE EXCEPTION 'FAIL no se pudo editar un tipo antiguo de 0,30 €'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 3) Un evento pasado no cambia de estado desde el cliente (WP1.3)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1 Pasado', 'Madrid', now() - INTERVAL '2 days', now() - INTERVAL '1 day 18 hours', 'published', 1000)
  RETURNING id INTO v_past;
  RESET ROLE;
  -- Lo marca el servidor, como cron_mark_past_events
  UPDATE public.events SET status = 'past' WHERE id = v_past;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.events SET status = 'published' WHERE id = v_past;
    RAISE EXCEPTION 'FAIL se volvió a publicar un evento pasado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.events SET status = 'draft' WHERE id = v_past;
    RAISE EXCEPTION 'FAIL un evento pasado volvió a borrador';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Editar sus datos sí (sin tocar el estado)
  UPDATE public.events SET title = 'O1 Pasado (editado)', status = 'past' WHERE id = v_past;
  SELECT title INTO v_text FROM public.events WHERE id = v_past;
  IF v_text IS DISTINCT FROM 'O1 Pasado (editado)' THEN RAISE EXCEPTION 'FAIL no se pudo editar un evento pasado'; END IF;
  -- El cancelado sigue igual de protegido
  UPDATE public.events SET status = 'cancelled' WHERE id = v_manual;
  BEGIN
    UPDATE public.events SET status = 'draft' WHERE id = v_manual;
    RAISE EXCEPTION 'FAIL un evento cancelado volvió a borrador';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Un admin sí puede
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET status = 'draft' WHERE id = v_past;
  RESET ROLE;
  SELECT status::text INTO v_text FROM public.events WHERE id = v_past;
  IF v_text IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'FAIL el admin no pudo sacar el evento de past: %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- 4) Puerta: evento de esta noche retirado de la venta (B4-04)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1 Esta noche', 'Madrid', now() - INTERVAL '1 hour', now() + INTERVAL '5 hours', 'published', 1000)
  RETURNING id INTO v_retired;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_retired, 'General', 1000, 100) RETURNING id INTO v_tier;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1 Próximo', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 1000)
  RETURNING id INTO v_future;
  RESET ROLE;
  -- Una entrada pagada (sin pasar por Stripe: solo importa la puerta)
  INSERT INTO public.tickets (event_id, tier_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_retired, v_tier, 'o1-puerta@pasify.test', 'Pau', 'paid', 1000, now())
  RETURNING qr_token INTO v_qr;

  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- "Retirar de la venta": publicado → borrador
  UPDATE public.events SET status = 'draft' WHERE id = v_retired;
  -- La lista del panel lo sigue teniendo, con sus vendidas (la puerta lo elige por eso)
  SELECT tickets_sold INTO v_count FROM public.events WHERE id = v_retired AND status = 'draft';
  IF v_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL el evento retirado no enseña sus vendidas: %', v_count; END IF;
  -- Con el evento futuro en la puerta: wrong_event con el id del evento real
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'o1', v_future);
  IF v_scan.success OR v_scan.result::text <> 'wrong_event' OR v_scan.event_id IS DISTINCT FROM v_retired THEN
    RAISE EXCEPTION 'FAIL wrong_event sin el evento real: % %', v_scan.result, v_scan.event_id;
  END IF;
  -- "Cambiar a ese evento": con el evento retirado en la puerta, entra
  SELECT * INTO v_scan FROM public.scan_ticket(v_qr, 'o1', v_scan.event_id);
  IF NOT v_scan.success OR v_scan.result::text <> 'success' THEN
    RAISE EXCEPTION 'FAIL la entrada del evento retirado no vale en la puerta: %', v_scan.result;
  END IF;
  RESET ROLE;

  RAISE NOTICE 'PASS o1_local: aforo = suma de todos los tipos, precio mínimo 0,50 €, past terminal y puerta con evento retirado';
END $$;

ROLLBACK;
