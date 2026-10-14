-- Pasify · Ola 7 · las series (20261013130000) junto al lugar que sigue al local
-- (20261013100000), el máximo de 10 entradas por persona y evento
-- (20261013110000) y la categoría de evento (20261013120000).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Cada sesión de una serie es un evento de verdad, así que:
--   * categoría: la serie la lleva a todas sus sesiones, se cambia en bloque y
--     una categoría que no existe se rechaza sin dejar nada a medias;
--   * lugar: cambiar el local de una sola sesión hace que su lugar siga al
--     local nuevo (sin tocar las demás), y cambiar el lugar de toda la serie
--     respeta lo que se manda;
--   * límite: el tope de 10 entradas por persona cuenta por sesión, no por
--     serie, y event_ticket_allowance habla de la sesión por la que se pregunta.

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

CREATE OR REPLACE FUNCTION pg_temp.sesiones(_n INT, _primera TIMESTAMPTZ, _paso INTERVAL, _dur INTERVAL)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', ((_primera + _paso * i) AT TIME ZONE 'Europe/Madrid')::date,
           'start', _primera + _paso * i,
           'end', _primera + _paso * i + _dur) ORDER BY i), '[]'::jsonb)
    FROM generate_series(0, _n - 1) i
$$;

-- Crea una serie y devuelve 'ok|<json>' o 'mensaje|código'.
CREATE OR REPLACE FUNCTION pg_temp.crear(_req UUID, _event JSONB, _tiers JSONB, _sessions JSONB)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_res JSONB;
BEGIN
  v_res := public.create_event_series(_req, 'recurring', '{"frequency":"weekly"}'::jsonb, 'Europe/Madrid', _event, _tiers, _sessions);
  RETURN 'ok|' || v_res::text;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM || '|' || SQLSTATE;
END $$;

-- Pide `_qty` entradas de `_tipo` y devuelve 'ok' o 'error|hint'.
CREATE OR REPLACE FUNCTION pg_temp.pedir(_evento UUID, _tipo UUID, _qty INT, _comprador UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE o RECORD; v_hint TEXT;
BEGIN
  SELECT * INTO o FROM public.create_ticket_order(_evento, _tipo, _qty, _comprador, 'o7-' || _comprador || '@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(o.order_id, 'cs_o7_' || o.order_id);
  PERFORM public.mark_order_paid_v2('cs_o7_' || o.order_id, 'pi_o7_' || o.order_id, 1000 * _qty, 0, TRUE);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  RETURN SQLERRM || '|' || COALESCE(v_hint, '');
END $$;

DO $$
DECLARE
  v_p UUID := gen_random_uuid();          -- el local que crea la serie
  v_b UUID := gen_random_uuid();          -- comprador
  v_org UUID;
  v_venue1 UUID;                          -- su local por defecto
  v_venue2 UUID;                          -- un segundo local de la misma organización
  v_ev JSONB;
  v_tiers JSONB := '[
    {"name":"General","price_cents":1000,"capacity":100,"per_user_max":10,"status":"active","sort_order":0},
    {"name":"VIP","price_cents":2000,"capacity":50,"per_user_max":10,"status":"active","sort_order":1}
  ]'::jsonb;
  v_req UUID := gen_random_uuid();
  v_r TEXT;
  v_j JSONB;
  v_s UUID;
  v_ids UUID[];
  v_n INT;
  v_ta1 UUID;                             -- General y VIP de la primera fecha
  v_tb1 UUID;
  v_ta2 UUID;                             -- ídem, de la segunda
  v_tb2 UUID;
  v_primera TIMESTAMPTZ := date_trunc('day', now()) + INTERVAL '10 days 21 hours';
  v_row RECORD;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_p, 'o7-p-' || v_p || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b, 'o7-' || v_b || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O7 Series', 'ES', NULL);
  RESET ROLE;
  SELECT id INTO v_venue1 FROM public.venues WHERE org_id = v_org LIMIT 1;
  PERFORM pg_temp.exige(v_venue1 IS NOT NULL, '0: la organización tiene su local');
  -- Un segundo local de la misma organización, con su propio lugar.
  INSERT INTO public.venues (org_id, brand_id, slug, name, address, city, timezone)
  SELECT org_id, brand_id, 'sala-dos-' || substr(gen_random_uuid()::text, 1, 8), 'Sala Dos', 'Calle Segunda 2', 'Valencia', timezone
    FROM public.venues WHERE id = v_venue1
  RETURNING id INTO v_venue2;

  v_ev := jsonb_build_object('title', 'Noche O7', 'city', 'Madrid', 'venue_name', 'Sala Uno', 'address', 'Calle Mayor 1',
                             'venue_id', v_venue1, 'category', 'festival', 'status', 'published');

  -- ------------------------------------------------------------------
  -- 1) Categoría: la serie la lleva a todas sus sesiones
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(v_req, v_ev, v_tiers, pg_temp.sesiones(3, v_primera, INTERVAL '7 days', INTERVAL '6 hours'));
  RESET ROLE;
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('1: la serie se crea (%s)', v_r));
  v_s := (split_part(v_r, '|', 2)::jsonb->>'series_id')::uuid;
  SELECT array_agg(id ORDER BY date_start) INTO v_ids FROM public.events WHERE series_id = v_s;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND category = 'festival';
  PERFORM pg_temp.exige(v_n = 3, format('1: las 3 sesiones son de festival (%s)', v_n));

  -- Una categoría que no existe se rechaza y no deja una serie a medias.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(gen_random_uuid(), v_ev || '{"category":"karaoke","title":"Noche mala"}',
                       v_tiers, pg_temp.sesiones(2, v_primera + INTERVAL '40 days', INTERVAL '1 day', INTERVAL '5 hours'));
  RESET ROLE;
  PERFORM pg_temp.exige(v_r LIKE '%|23514', format('1: una categoría inventada la rechaza el CHECK (%s)', v_r));
  SELECT count(*) INTO v_n FROM public.events WHERE title = 'Noche mala';
  PERFORM pg_temp.exige(v_n = 0, '1: del intento fallido no queda ninguna sesión');
  SELECT count(*) INTO v_n FROM public.event_series WHERE org_id = v_org;
  PERFORM pg_temp.exige(v_n = 1, '1: ni una serie vacía');

  -- Sin categoría (NULL) vale: los eventos anteriores no la tienen.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(gen_random_uuid(), (v_ev - 'category') || '{"title":"Noche sin clasificar"}',
                       v_tiers, pg_temp.sesiones(2, v_primera + INTERVAL '50 days', INTERVAL '1 day', INTERVAL '5 hours'));
  RESET ROLE;
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('1: sin categoría se crea (%s)', v_r));
  SELECT count(*) INTO v_n FROM public.events WHERE title = 'Noche sin clasificar' AND category IS NULL;
  PERFORM pg_temp.exige(v_n = 2, '1: y quedan sin clasificar, como los eventos anteriores');

  -- ------------------------------------------------------------------
  -- 2) Cambiar la categoría de la serie entera
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.update_event_series(v_s, NULL, '{"category":"bar"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 3, format('2: las 3 sesiones cambian (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND category = 'bar';
  PERFORM pg_temp.exige(v_n = 3, '2: ahora son de bar');
  -- Una categoría inventada no entra por el cambio en bloque y no cambia nada.
  BEGIN
    PERFORM public.update_event_series(v_s, NULL, '{"category":"karaoke"}'::jsonb);
    RAISE EXCEPTION 'FAIL 2: una categoría inventada no puede entrar por update_event_series';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND category = 'bar';
  PERFORM pg_temp.exige(v_n = 3, '2: tras el rechazo siguen siendo de bar');
  -- Quitarla (cadena vacía) la deja sin clasificar.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.update_event_series(v_s, NULL, '{"category":""}'::jsonb);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND category IS NULL;
  PERFORM pg_temp.exige(v_n = 3, '2: una cadena vacía la quita');
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_event_series(v_s, NULL, '{"category":"festival"}'::jsonb);
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 3) Lugar: cambiar el local de UNA sesión hace que su lugar siga al local
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue2 WHERE id = v_ids[2];
  RESET ROLE;
  SELECT * INTO v_row FROM public.events WHERE id = v_ids[2];
  PERFORM pg_temp.exige(v_row.venue_id = v_venue2 AND v_row.venue_name = 'Sala Dos' AND v_row.city = 'Valencia' AND v_row.address = 'Calle Segunda 2',
    format('3: la sesión toma el lugar del local nuevo (%s · %s · %s)', v_row.venue_name, v_row.city, v_row.address));
  PERFORM pg_temp.exige(v_row.series_id = v_s, '3: y sigue siendo de la serie');
  SELECT count(*) INTO v_n FROM public.events WHERE id IN (v_ids[1], v_ids[3]) AND venue_id = v_venue1 AND venue_name = 'Sala Uno' AND city = 'Madrid';
  PERFORM pg_temp.exige(v_n = 2, '3: las otras dos siguen en su local y con su lugar');

  -- Cambiar el lugar de toda la serie (local y lugar a la vez): se respeta lo que se manda.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.update_event_series(v_s, NULL, jsonb_build_object('venue_id', v_venue2, 'venue_name', 'Sala Dos', 'city', 'Valencia', 'address', 'Calle Segunda 2'), TRUE);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND venue_id = v_venue2 AND venue_name = 'Sala Dos' AND city = 'Valencia' AND address = 'Calle Segunda 2';
  PERFORM pg_temp.exige(v_n = 3, format('3: las 3 sesiones, en el local nuevo con su lugar (%s)', v_n));

  -- ------------------------------------------------------------------
  -- 4) Límite de 10 entradas por persona: por sesión, no por serie
  -- ------------------------------------------------------------------
  SELECT id INTO v_ta1 FROM public.ticket_tiers WHERE event_id = v_ids[1] AND name = 'General';
  SELECT id INTO v_tb1 FROM public.ticket_tiers WHERE event_id = v_ids[1] AND name = 'VIP';
  SELECT id INTO v_ta2 FROM public.ticket_tiers WHERE event_id = v_ids[2] AND name = 'General';
  SELECT id INTO v_tb2 FROM public.ticket_tiers WHERE event_id = v_ids[2] AND name = 'VIP';
  PERFORM pg_temp.como(v_b);
  -- 6 + 4 en dos tipos de la primera fecha: bien; la 11.ª, no.
  PERFORM pg_temp.exige(pg_temp.pedir(v_ids[1], v_ta1, 6, v_b) = 'ok', '4: 6 generales de la primera fecha');
  PERFORM pg_temp.exige(pg_temp.pedir(v_ids[1], v_tb1, 4, v_b) = 'ok', '4: 4 VIP de la primera fecha');
  v_r := pg_temp.pedir(v_ids[1], v_ta1, 1, v_b);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('4: la 11.ª de la misma fecha no cabe (%s)', v_r));
  -- Otra fecha de la misma serie es otro evento: 10 más.
  PERFORM pg_temp.exige(pg_temp.pedir(v_ids[2], v_ta2, 6, v_b) = 'ok', '4: 6 generales de la segunda fecha');
  PERFORM pg_temp.exige(pg_temp.pedir(v_ids[2], v_tb2, 4, v_b) = 'ok', '4: 4 VIP de la segunda fecha');
  v_r := pg_temp.pedir(v_ids[2], v_tb2, 1, v_b);
  PERFORM pg_temp.exige(v_r = 'qty_exceeds_event_limit|0', format('4: y la 11.ª de la segunda tampoco (%s)', v_r));
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ids[3], v_b) = 0, '4: de la tercera no lleva ninguna');
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ids[1], v_b) = 10 AND public.ticket_buyer_event_held(v_ids[2], v_b) = 10, '4: cada fecha cuenta las suyas');

  -- Lo que ve el selector de entradas es de la fecha por la que se pregunta.
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.event_ticket_allowance(v_ids[1]);
  PERFORM pg_temp.exige(v_row.max_per_buyer = 10 AND v_row.held = 10 AND v_row.remaining = 0, '4: en la primera fecha ya no le caben más');
  SELECT * INTO v_row FROM public.event_ticket_allowance(v_ids[3]);
  PERFORM pg_temp.exige(v_row.max_per_buyer = 10 AND v_row.held = 0 AND v_row.remaining = 10, '4: en la tercera le caben 10');
  RESET ROLE;

  -- Cancelar una fecha no libera ni toca las de otra: sus entradas siguen contando donde están.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.cancel_event_series(v_s, (SELECT date_start FROM public.events WHERE id = v_ids[3]), 'Prueba de integración');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 1, format('4: se cancela solo la tercera fecha (%s)', v_j));
  PERFORM pg_temp.exige(public.ticket_buyer_event_held(v_ids[1], v_b) = 10, '4: cancelar otra fecha no cambia lo de la primera');

  RAISE NOTICE 'o7_series_integracion: OK';
END $$;

ROLLBACK;
