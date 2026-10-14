-- Pasify · Ola 6 · eventos de varios días y recurrentes (series de sesiones).
-- Migración 20261013130000_eventos_recurrentes.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Cada sesión de una serie es un evento de verdad, así que sus ventas, su aforo
-- y su cancelación son independientes. Aquí se comprueba:
--   * create_event_series: crea la serie con todas sus sesiones y tipos de
--     entrada de una vez; es idempotente; rechaza datos malos con un código
--     (sin dejar nada a medias), duplicados, solapes, el tope de sesiones y las
--     fechas pasadas al publicar;
--   * seguridad: otro local no ve ni toca la serie, no se mueve un evento de
--     serie, el público solo ve lo que se publica y sin las columnas internas;
--   * update_event_series: cambios comunes a las sesiones por celebrar (de una
--     fecha en adelante o todas), sin tocar las editadas por separado, las
--     pasadas ni las canceladas; las horas respetan el cambio de hora;
--   * apply_event_tiers_to_series: copia los tipos a las sesiones sin ventas y
--     salta las que ya tienen entradas;
--   * ventas y cancelación por sesión; cancel_event_series: cancela de una vez
--     las sesiones sin ventas y devuelve las que hay que reembolsar.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20261013130000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o6_eventos_recurrentes.sql','-c','ROLLBACK;'); & psql @a

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

-- `_n` sesiones desde `_primera`, una cada `_paso` y de `_dur` de duración.
-- `date` es el día de la serie (reloj de Madrid).
CREATE OR REPLACE FUNCTION pg_temp.sesiones(_n INT, _primera TIMESTAMPTZ, _paso INTERVAL, _dur INTERVAL)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', ((_primera + _paso * i) AT TIME ZONE 'Europe/Madrid')::date,
           'start', _primera + _paso * i,
           'end', _primera + _paso * i + _dur) ORDER BY i), '[]'::jsonb)
    FROM generate_series(0, _n - 1) i
$$;

-- Sesiones de unos días concretos a una hora de reloj de Madrid (si el fin es
-- anterior o igual al inicio, el fin es al día siguiente).
CREATE OR REPLACE FUNCTION pg_temp.sesiones_locales(_dias DATE[], _inicio TIME, _fin TIME)
RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object(
           'date', d,
           'start', (d + _inicio) AT TIME ZONE 'Europe/Madrid',
           'end', CASE WHEN _fin IS NULL THEN NULL
                       ELSE (d + _fin + CASE WHEN _fin <= _inicio THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE 'Europe/Madrid' END)
         ORDER BY d)
    FROM unnest(_dias) d
$$;

-- Crea una serie y devuelve 'ok|<json>' o 'código|hint'.
CREATE OR REPLACE FUNCTION pg_temp.crear(_req UUID, _event JSONB, _tiers JSONB, _sessions JSONB, _kind TEXT DEFAULT 'recurring')
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_hint TEXT; v_res JSONB;
BEGIN
  v_res := public.create_event_series(_req, _kind, '{"frequency":"weekly"}'::jsonb, 'Europe/Madrid', _event, _tiers, _sessions);
  RETURN 'ok|' || v_res::text;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  RETURN SQLERRM || '|' || COALESCE(v_hint, '');
END $$;

-- Ejecuta una sentencia y devuelve 'ok' o 'SQLSTATE|mensaje'.
CREATE OR REPLACE FUNCTION pg_temp.intentar(_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END $$;

-- Pedido de pago de `_qty` entradas de `_tipo`, ya pagado de verdad (livemode = true).
CREATE OR REPLACE FUNCTION pg_temp.comprar_y_pagar(_evento UUID, _tipo UUID, _qty INT, _comprador UUID, _precio INT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE o RECORD;
BEGIN
  SELECT * INTO o FROM public.create_ticket_order(_evento, _tipo, _qty, _comprador, 'o6s-' || _comprador || '@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(o.order_id, 'cs_o6s_' || o.order_id);
  PERFORM public.mark_order_paid_v2('cs_o6s_' || o.order_id, 'pi_o6s_' || o.order_id, _precio * _qty, 0, TRUE);
  RETURN o.order_id;
END $$;

DO $$
DECLARE
  v_p UUID := gen_random_uuid();          -- el local que crea las series
  v_q UUID := gen_random_uuid();          -- otro local
  v_b1 UUID := gen_random_uuid();         -- comprador
  v_b2 UUID := gen_random_uuid();         -- otro comprador
  v_org_p UUID;
  v_org_q UUID;
  v_venue_p UUID;
  v_venue_q UUID;
  v_ev JSONB;                             -- lo común de las sesiones (publicadas)
  v_ev_draft JSONB;                       -- ídem, en borrador
  v_ev_q JSONB;
  v_tiers JSONB := '[
    {"name":"General","description":"Entrada general","price_cents":1000,"capacity":50,"per_user_max":4,"status":"active","sort_order":0},
    {"name":"VIP","price_cents":3000,"capacity":10,"per_user_max":2,"status":"active","sort_order":1}
  ]'::jsonb;
  v_req UUID := gen_random_uuid();
  v_r TEXT;
  v_j JSONB;
  v_s UUID;                               -- serie semanal de 4 sesiones
  v_ids UUID[];
  v_n INT;
  v_x TEXT;
  v_primera TIMESTAMPTZ := date_trunc('day', now()) + INTERVAL '10 days 21 hours';
  v_row RECORD;
  v_dst DATE;
  v_s2 UUID;                              -- serie que cruza el cambio de hora
  v_s3 UUID;                              -- serie con una sesión pasada (borrador)
  v_s5 UUID;                              -- serie de Q
  v_ids2 UUID[];
  v_ids3 UUID[];
  v_q_suelto UUID;                        -- evento suelto de Q
  v_p_suelto UUID;                        -- evento suelto de P
  v_tier UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_p, 'o6s-p-' || v_p || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_q, 'o6s-q-' || v_q || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b1, 'o6s-' || v_b1 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_b2, 'o6s-' || v_b2 || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_org_p := public.create_organization('O6S Series P', 'ES', NULL);
  RESET ROLE;
  PERFORM pg_temp.como(v_q);
  SET LOCAL ROLE authenticated;
  v_org_q := public.create_organization('O6S Series Q', 'ES', NULL);
  RESET ROLE;
  SELECT id INTO v_venue_p FROM public.venues WHERE org_id = v_org_p LIMIT 1;
  SELECT id INTO v_venue_q FROM public.venues WHERE org_id = v_org_q LIMIT 1;
  PERFORM pg_temp.exige(v_venue_p IS NOT NULL AND v_venue_q IS NOT NULL, '0: cada organización tiene su local');

  v_ev := jsonb_build_object('title', 'Noche O6S', 'description', 'Todos los viernes', 'city', 'Madrid',
                             'venue_name', 'Sala Uno', 'address', 'Calle Mayor 1', 'venue_id', v_venue_p,
                             'category', 'discoteca', 'status', 'published');
  v_ev_draft := v_ev || '{"status":"draft"}'::jsonb;
  v_ev_q := jsonb_build_object('title', 'Noche de Q', 'city', 'Madrid', 'venue_id', v_venue_q, 'status', 'published');

  -- ------------------------------------------------------------------
  -- 1) Una serie semanal de 4 sesiones con dos tipos de entrada
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(v_req, v_ev, v_tiers, pg_temp.sesiones(4, v_primera, INTERVAL '7 days', INTERVAL '6 hours'));
  RESET ROLE;
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('1: la serie se crea (%s)', v_r));
  v_j := split_part(v_r, '|', 2)::jsonb;
  v_s := (v_j->>'series_id')::uuid;
  PERFORM pg_temp.exige((v_j->>'already_created')::boolean IS FALSE AND jsonb_array_length(v_j->'event_ids') = 4, '1: 4 eventos en la primera llamada');
  SELECT array_agg(id ORDER BY date_start) INTO v_ids FROM public.events WHERE series_id = v_s;
  PERFORM pg_temp.exige(array_length(v_ids, 1) = 4, '1: 4 sesiones en la base de datos');

  SELECT count(*) INTO v_n FROM public.events e
   WHERE e.series_id = v_s AND e.partner_id = v_p AND e.org_id = v_org_p AND e.title = 'Noche O6S'
     AND e.status = 'published' AND e.category = 'discoteca' AND e.city = 'Madrid' AND e.venue_name = 'Sala Uno'
     AND e.address = 'Calle Mayor 1' AND e.price_cents = 1000 AND e.series_date IS NOT NULL AND NOT e.series_exception;
  PERFORM pg_temp.exige(v_n = 4, format('1: las sesiones llevan lo común y el tenant del local (%s de 4)', v_n));
  SELECT count(DISTINCT series_date) INTO v_n FROM public.events WHERE series_id = v_s;
  PERFORM pg_temp.exige(v_n = 4, '1: un día de serie distinto por sesión');
  -- Cada sesión tiene sus dos tipos y el aforo del evento es la suma de los cupos (50 + 10).
  SELECT count(*) INTO v_n FROM public.events e
   WHERE e.series_id = v_s
     AND (SELECT count(*) FROM public.ticket_tiers t WHERE t.event_id = e.id) = 2
     AND (SELECT count(*) FROM public.ticket_tiers t WHERE t.event_id = e.id AND t.name = 'General' AND t.price_cents = 1000 AND t.capacity = 50 AND t.per_user_max = 4 AND t.description = 'Entrada general') = 1
     AND (SELECT count(*) FROM public.ticket_tiers t WHERE t.event_id = e.id AND t.name = 'VIP' AND t.price_cents = 3000 AND t.capacity = 10 AND t.per_user_max = 2) = 1
     AND e.capacity = 60;
  PERFORM pg_temp.exige(v_n = 4, format('1: cada sesión con sus tipos y su aforo (%s de 4)', v_n));
  SELECT * INTO v_row FROM public.event_series WHERE id = v_s;
  PERFORM pg_temp.exige(v_row.partner_id = v_p AND v_row.org_id = v_org_p AND v_row.kind = 'recurring'
    AND v_row.time_zone = 'Europe/Madrid' AND v_row.status = 'active' AND v_row.request_id = v_req
    AND v_row.start_time = ((v_primera AT TIME ZONE 'Europe/Madrid')::time)
    AND v_row.end_time = (((v_primera + INTERVAL '6 hours') AT TIME ZONE 'Europe/Madrid')::time), '1: la serie guarda su regla y sus horas');

  -- ------------------------------------------------------------------
  -- 2) Idempotencia: el mismo intento no crea otra serie
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(v_req, v_ev, v_tiers, pg_temp.sesiones(4, v_primera, INTERVAL '7 days', INTERVAL '6 hours'));
  RESET ROLE;
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('2: el reintento responde (%s)', v_r));
  v_j := split_part(v_r, '|', 2)::jsonb;
  PERFORM pg_temp.exige((v_j->>'series_id')::uuid = v_s AND (v_j->>'already_created')::boolean IS TRUE AND jsonb_array_length(v_j->'event_ids') = 4,
    '2: mismo series_id y ya creada');
  SELECT count(*) INTO v_n FROM public.event_series WHERE request_id = v_req;
  PERFORM pg_temp.exige(v_n = 1, '2: una sola serie');
  SELECT count(*) INTO v_n FROM public.events WHERE title = 'Noche O6S' AND partner_id = v_p;
  PERFORM pg_temp.exige(v_n = 4, '2: siguen siendo 4 eventos');

  -- ------------------------------------------------------------------
  -- 3) Datos malos: un código y nada a medias
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_x := 'x';
  -- sin título, sin ciudad, estado, tipos y sesiones
  v_r := pg_temp.crear(gen_random_uuid(), v_ev || '{"title":"  "}', v_tiers, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_title_required|%', format('3: título obligatorio (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev || '{"city":""}', v_tiers, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_city_required|%', format('3: ciudad obligatoria (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev || '{"status":"cancelled"}', v_tiers, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_status|%', format('3: solo borrador o publicado (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, '[]'::jsonb, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_tiers|%', format('3: al menos un tipo (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, '[{"name":"","price_cents":1000}]'::jsonb, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_tiers|%', format('3: tipo sin nombre (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, '[{"name":"X","price_cents":-5}]'::jsonb, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_tiers|%', format('3: precio negativo (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, '[{"name":"X","price_cents":1000,"status":"sold_out"}]'::jsonb, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_tiers|%', format('3: estado de tipo desconocido (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, '[{"name":"X","price_cents":30}]'::jsonb, pg_temp.sesiones(2, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE '%0,50%', format('3: el mínimo de 0,50 € lo sigue poniendo ticket_tiers (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers, '[]'::jsonb);
  PERFORM pg_temp.exige(v_r LIKE 'series_no_sessions|%', format('3: sin sesiones (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers, '[{"date":"2030-01-01"}]'::jsonb);
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_sessions|%', format('3: sesión sin comienzo (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers,
    jsonb_build_array(jsonb_build_object('date', '2030-01-01', 'start', '2030-01-01T20:00:00Z', 'end', '2030-01-01T19:00:00Z')));
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_session_times|%', format('3: el fin tiene que ser posterior al comienzo (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers, '{"a":1}'::jsonb);
  PERFORM pg_temp.exige(v_r LIKE 'series_invalid_sessions|%', format('3: las sesiones son una lista (%s)', v_r));
  -- tipo de serie, regla y zona horaria
  BEGIN
    PERFORM public.create_event_series(gen_random_uuid(), 'weekly', '{}'::jsonb, 'Europe/Madrid', v_ev, v_tiers, pg_temp.sesiones(1, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
    RAISE EXCEPTION 'FAIL 3: el tipo de serie tiene que ser multi_day o recurring';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'series_invalid_kind' THEN RAISE EXCEPTION 'FAIL 3: tipo inválido (%)', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_event_series(gen_random_uuid(), 'recurring', '[]'::jsonb, 'Europe/Madrid', v_ev, v_tiers, pg_temp.sesiones(1, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
    RAISE EXCEPTION 'FAIL 3: la regla es un objeto';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'series_invalid_rule' THEN RAISE EXCEPTION 'FAIL 3: regla inválida (%)', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.create_event_series(gen_random_uuid(), 'recurring', '{}'::jsonb, 'Mars/Olympus', v_ev, v_tiers, pg_temp.sesiones(1, v_primera + INTERVAL '30 days', INTERVAL '1 day', INTERVAL '5 hours'));
    RAISE EXCEPTION 'FAIL 3: zona horaria desconocida';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'series_invalid_time_zone' THEN RAISE EXCEPTION 'FAIL 3: zona inválida (%)', SQLERRM; END IF;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE partner_id = v_p;
  PERFORM pg_temp.exige(v_n = 4, format('3: ninguno de los intentos fallidos dejó eventos (%s)', v_n));
  SELECT count(*) INTO v_n FROM public.event_series WHERE partner_id = v_p;
  PERFORM pg_temp.exige(v_n = 1, '3: ni series');

  -- ------------------------------------------------------------------
  -- 4) Duplicados y solapes
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  -- dos sesiones el mismo día de la serie
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers,
    jsonb_build_array(
      jsonb_build_object('date', '2031-05-01', 'start', '2031-05-01T20:00:00Z', 'end', '2031-05-01T23:00:00Z'),
      jsonb_build_object('date', '2031-05-01', 'start', '2031-05-02T20:00:00Z', 'end', '2031-05-02T23:00:00Z')));
  PERFORM pg_temp.exige(v_r = 'series_duplicate_dates|2031-05-01', format('4: fecha repetida con su pista (%s)', v_r));
  -- dos sesiones que se pisan en el tiempo
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers,
    jsonb_build_array(
      jsonb_build_object('date', '2031-05-01', 'start', '2031-05-01T20:00:00Z', 'end', '2031-05-02T03:00:00Z'),
      jsonb_build_object('date', '2031-05-02', 'start', '2031-05-02T01:00:00Z', 'end', '2031-05-02T05:00:00Z')));
  PERFORM pg_temp.exige(v_r LIKE 'series_sessions_overlap|%', format('4: solape rechazado (%s)', v_r));
  -- seguidas sin pisarse (el fin de una es el comienzo de la otra): bien
  v_r := pg_temp.crear(gen_random_uuid(), v_ev_draft, v_tiers,
    jsonb_build_array(
      jsonb_build_object('date', '2031-05-01', 'start', '2031-05-01T20:00:00Z', 'end', '2031-05-02T04:00:00Z'),
      jsonb_build_object('date', '2031-05-02', 'start', '2031-05-02T04:00:00Z', 'end', '2031-05-02T10:00:00Z')),
    'multi_day');
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('4: dos sesiones pegadas no se pisan (%s)', v_r));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.event_series WHERE partner_id = v_p AND kind = 'multi_day';
  PERFORM pg_temp.exige(v_n = 1, '4: el tipo multi_day se guarda');
  -- Directamente sobre la tabla: el índice único y el solape también mandan.
  v_x := pg_temp.intentar(format($f$INSERT INTO public.events (partner_id, series_id, series_date, title, city, date_start, date_end, status)
    VALUES (%L, %L, (SELECT series_date FROM public.events WHERE id = %L), 'Duplicada', 'Madrid', now() + interval '300 days', now() + interval '300 days 3 hours', 'draft')$f$, v_p, v_s, v_ids[1]));
  PERFORM pg_temp.exige(v_x LIKE '23505|%', format('4: una sola sesión por día de serie (%s)', v_x));
  v_x := pg_temp.intentar(format($f$INSERT INTO public.events (partner_id, series_id, series_date, title, city, date_start, date_end, status)
    VALUES (%L, %L, '2099-01-01', 'Pisada', 'Madrid', (SELECT date_start + interval '1 hour' FROM public.events WHERE id = %L), (SELECT date_end + interval '1 hour' FROM public.events WHERE id = %L), 'draft')$f$, v_p, v_s, v_ids[1], v_ids[1]));
  PERFORM pg_temp.exige(v_x LIKE '23P01|%', format('4: no se puede añadir una sesión que pisa otra (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.events SET date_start = date_start + interval '7 days', date_end = date_end + interval '7 days' WHERE id = %L$f$, v_ids[1]));
  PERFORM pg_temp.exige(v_x LIKE '23P01|%', format('4: mover una sesión encima de otra (%s)', v_x));
  v_x := pg_temp.intentar(format($f$INSERT INTO public.events (partner_id, series_id, title, city, date_start, status) VALUES (%L, %L, 'Sin día', 'Madrid', now() + interval '400 days', 'draft')$f$, v_p, v_s));
  PERFORM pg_temp.exige(v_x LIKE '23514|%', format('4: serie sin día de serie (%s)', v_x));

  -- ------------------------------------------------------------------
  -- 5) El tope: 100 sesiones sí, 101 no
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(gen_random_uuid(), v_ev_draft, '[{"name":"Única","price_cents":0}]'::jsonb,
    pg_temp.sesiones(101, now() + INTERVAL '500 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r = 'series_too_many_sessions|100', format('5: 101 sesiones, no (%s)', v_r));
  v_r := pg_temp.crear(gen_random_uuid(), v_ev_draft, '[{"name":"Única","price_cents":0}]'::jsonb,
    pg_temp.sesiones(100, now() + INTERVAL '500 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('5: 100 sesiones, sí (%s)', v_r));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events e JOIN public.event_series s ON s.id = e.series_id
   WHERE s.id = (split_part(v_r, '|', 2)::jsonb->>'series_id')::uuid;
  PERFORM pg_temp.exige(v_n = 100, '5: las 100 sesiones están');

  -- ------------------------------------------------------------------
  -- 6) Fechas pasadas: borrador sí, publicar no
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers, pg_temp.sesiones(2, now() - INTERVAL '40 days', INTERVAL '1 day', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'series_session_in_past|%', format('6: publicar sesiones ya terminadas, no (%s)', v_r));
  -- Una pasada y tres por venir, en borrador: bien (se editan antes de publicar).
  v_r := pg_temp.crear(gen_random_uuid(), v_ev_draft || '{"title":"Con una pasada"}', v_tiers,
    pg_temp.sesiones(1, now() - INTERVAL '40 days', INTERVAL '1 day', INTERVAL '5 hours')
    || pg_temp.sesiones(3, v_primera + INTERVAL '60 days', INTERVAL '7 days', INTERVAL '5 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('6: en borrador vale (%s)', v_r));
  RESET ROLE;
  v_s3 := (split_part(v_r, '|', 2)::jsonb->>'series_id')::uuid;
  SELECT array_agg(id ORDER BY date_start) INTO v_ids3 FROM public.events WHERE series_id = v_s3;
  PERFORM pg_temp.exige(array_length(v_ids3, 1) = 4, '6: 4 sesiones, una pasada');

  -- ------------------------------------------------------------------
  -- 7) Seguridad
  -- ------------------------------------------------------------------
  PERFORM pg_temp.exige(
    NOT has_function_privilege('anon', 'public.create_event_series(uuid, text, jsonb, text, jsonb, jsonb, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.update_event_series(uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.apply_event_tiers_to_series(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.cancel_event_series(uuid, timestamptz, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.create_event_series(uuid, text, jsonb, text, jsonb, jsonb, jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.update_event_series(uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.apply_event_tiers_to_series(uuid, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.cancel_event_series(uuid, timestamptz, text)', 'EXECUTE'),
    '7: las funciones de series son de quien tiene sesión, no de anon');
  PERFORM pg_temp.exige(
    NOT has_function_privilege('authenticated', 'public.events_series_no_overlap()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.events_guard_series()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.events_series_after_cancel()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.events_series_after_cancel()', 'EXECUTE'),
    '7: los triggers no son de la API');

  -- Sin sesión no se crea nada.
  PERFORM pg_temp.como(NULL);
  v_x := pg_temp.intentar(format($f$SELECT public.create_event_series(NULL, 'recurring', '{}', 'Europe/Madrid', %L, %L, %L)$f$, v_ev, v_tiers, pg_temp.sesiones(1, v_primera, INTERVAL '1 day', INTERVAL '1 hour')));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: sin sesión, no (%s)', v_x));

  -- Otro local no ve la serie en privado, no la toca y no cuelga eventos de ella.
  PERFORM pg_temp.como(v_q);
  SET LOCAL ROLE authenticated;
  -- (la serie de P tiene sesiones publicadas, así que Q la ve como cualquier visitante: lo que no puede es tocarla)
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET rule = '{"hackeada":true}' WHERE id = %L$f$, v_s));
  SELECT rule INTO v_j FROM public.event_series WHERE id = v_s;
  PERFORM pg_temp.exige(v_j ? 'frequency', '7: Q no cambia la regla de P');
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET org_id = %L WHERE id = %L$f$, v_org_q, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: nadie cambia el org de una serie (%s)', v_x));
  v_x := pg_temp.intentar(format($f$DELETE FROM public.event_series WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: nadie borra series desde la API (%s)', v_x));
  v_x := pg_temp.intentar(format($f$INSERT INTO public.events (partner_id, series_id, series_date, title, city, date_start, status)
    VALUES (%L, %L, '2090-01-01', 'Colada', 'Madrid', now() + interval '700 days', 'draft')$f$, v_q, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: no se cuelga un evento de la serie de otro (%s)', v_x));
  v_j := public.update_event_series(v_s, NULL, '{"title":"Hackeado"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 0, '7: Q no actualiza ninguna sesión de P');
  v_j := public.apply_event_tiers_to_series(v_ids[1], 'all');
  PERFORM pg_temp.exige((v_j->>'applied')::int = 0, '7: ni sus tipos de entrada');
  v_x := pg_temp.intentar(format($f$SELECT public.cancel_event_series(%L, NULL, 'por gusto')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni la cancela (%s)', v_x));
  -- Q con un evento suyo (sin serie) no lo mete en una serie después.
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status) VALUES (v_q, v_org_q, 'Suelto de Q', 'Madrid', now() + INTERVAL '40 days', 'draft')
    RETURNING id INTO v_q_suelto;
  v_x := pg_temp.intentar(format($f$UPDATE public.events SET series_id = %L, series_date = '2090-02-02' WHERE id = %L$f$, v_s, v_q_suelto));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni se mueve un evento suyo a la serie de otro (%s)', v_x));
  -- La serie de Q es suya y el título de P sigue como estaba.
  v_r := pg_temp.crear(gen_random_uuid(), v_ev_q, '[{"name":"Q","price_cents":500,"capacity":5}]'::jsonb, pg_temp.sesiones(2, v_primera, INTERVAL '1 day', INTERVAL '4 hours'));
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('7: Q crea la suya (%s)', v_r));
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND title = 'Noche O6S';
  PERFORM pg_temp.exige(v_n = 4, '7: las sesiones de P no cambiaron');

  -- P no cambia a qué serie pertenece uno de sus eventos, ni su día de serie.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_x := pg_temp.intentar(format($f$UPDATE public.events SET series_id = NULL, series_date = NULL WHERE id = %L$f$, v_ids[2]));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: una sesión no sale de su serie (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.events SET series_date = '2090-03-03' WHERE id = %L$f$, v_ids[2]));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni cambia su día de serie (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET org_id = NULL WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni su dueño cambia el org de la serie (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET partner_id = %L WHERE id = %L$f$, v_q, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni a quién pertenece (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET status = 'cancelled' WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni su estado, que lo pone el trigger de cancelar (%s)', v_x));
  -- Sí puede marcar una sesión como editada por separado.
  v_x := pg_temp.intentar(format($f$UPDATE public.events SET series_exception = TRUE WHERE id = %L$f$, v_ids[2]));
  PERFORM pg_temp.exige(v_x = 'ok', format('7: marcar una sesión como editada por separado (%s)', v_x));
  UPDATE public.events SET series_exception = FALSE WHERE id = v_ids[2];
  RESET ROLE;

  -- El público: las sesiones publicadas y la serie, sin las columnas internas.
  PERFORM pg_temp.como(NULL);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s;
  PERFORM pg_temp.exige(v_n = 4, format('7: anon ve las 4 sesiones publicadas (%s)', v_n));
  SELECT count(*) INTO v_n FROM public.event_series WHERE id = v_s;
  PERFORM pg_temp.exige(v_n = 1, '7: y la serie');
  v_x := pg_temp.intentar(format($f$SELECT kind, rule, time_zone, start_time, end_time, status FROM public.event_series WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x = 'ok', format('7: anon lee lo que enseña la página (%s)', v_x));
  v_x := pg_temp.intentar(format($f$SELECT partner_id FROM public.event_series WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: pero no quién la creó (%s)', v_x));
  v_x := pg_temp.intentar(format($f$SELECT request_id FROM public.event_series WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni la clave de idempotencia (%s)', v_x));
  v_x := pg_temp.intentar(format($f$UPDATE public.event_series SET status = 'cancelled' WHERE id = %L$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '42501|%', format('7: ni escribe (%s)', v_x));
  -- Una serie solo en borrador no se ve.
  SELECT count(*) INTO v_n FROM public.event_series WHERE id = v_s3;
  PERFORM pg_temp.exige(v_n = 0, '7: la serie en borrador no la ve el público');
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s3;
  PERFORM pg_temp.exige(v_n = 0, '7: ni sus sesiones');
  RESET ROLE;
  PERFORM pg_temp.como(v_q);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.event_series WHERE id = v_s3;
  PERFORM pg_temp.exige(v_n = 0, '7: ni otro local');
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 8) update_event_series
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  -- Toda la serie: lo común cambia en las 4.
  v_j := public.update_event_series(v_s, NULL, '{"title":"Noche renovada","description":"Nueva descripción","category":"bar"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 4 AND (v_j->>'skipped_exceptions')::int = 0, format('8: las 4 sesiones se actualizan (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND title = 'Noche renovada' AND description = 'Nueva descripción' AND category = 'bar'
    AND venue_name = 'Sala Uno' AND city = 'Madrid';
  PERFORM pg_temp.exige(v_n = 4, '8: lo que no viene en el cambio no se toca');
  -- De una fecha en adelante: las dos últimas.
  v_j := public.update_event_series(v_s, (SELECT date_start FROM public.events WHERE id = v_ids[3]), '{"title":"Solo las dos últimas"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 2, format('8: de la tercera en adelante (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND title = 'Solo las dos últimas' AND id = ANY (v_ids[3:4]);
  PERFORM pg_temp.exige(v_n = 2, '8: las dos últimas');
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND title = 'Noche renovada' AND id = ANY (v_ids[1:2]);
  PERFORM pg_temp.exige(v_n = 2, '8: las dos primeras, como estaban');
  -- Una sesión editada por separado se salta (salvo que se pida).
  UPDATE public.events SET series_exception = TRUE, title = 'Especial de aniversario' WHERE id = v_ids[2];
  v_j := public.update_event_series(v_s, NULL, '{"title":"Noche para todas"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 3 AND (v_j->>'skipped_exceptions')::int = 1, format('8: 3 cambian y 1 se respeta (%s)', v_j));
  SELECT title INTO v_x FROM public.events WHERE id = v_ids[2];
  PERFORM pg_temp.exige(v_x = 'Especial de aniversario', '8: el aniversario sigue como estaba');
  v_j := public.update_event_series(v_s, NULL, '{"title":"Noche para todas"}'::jsonb, TRUE);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 4, format('8: incluyendo las editadas por separado (%s)', v_j));
  UPDATE public.events SET series_exception = FALSE WHERE id = v_ids[2];
  -- Errores
  v_x := pg_temp.intentar(format($f$SELECT public.update_event_series(%L, NULL, '{"title":" "}')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '%series_title_required', format('8: el título no se vacía (%s)', v_x));
  v_x := pg_temp.intentar(format($f$SELECT public.update_event_series(%L, NULL, '{"city":""}')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '%series_city_required', format('8: ni la ciudad (%s)', v_x));
  v_x := pg_temp.intentar(format($f$SELECT public.update_event_series(%L, NULL, '[1]')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '%series_invalid_patch', format('8: el cambio es un objeto (%s)', v_x));
  v_x := pg_temp.intentar(format($f$SELECT public.update_event_series(%L, NULL, '{"start_time":""}')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '%series_invalid_patch', format('8: la hora de comienzo no se vacía (%s)', v_x));
  v_x := pg_temp.intentar($f$SELECT public.update_event_series(gen_random_uuid(), NULL, '{"title":"x"}')$f$);
  PERFORM pg_temp.exige(v_x LIKE '%series_not_found', format('8: serie que no existe (%s)', v_x));
  RESET ROLE;

  -- Las pasadas y las canceladas no se tocan.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.update_event_series(v_s3, NULL, '{"title":"Con una pasada (renovada)"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 3, format('8: la pasada no se toca (%s)', v_j));
  SELECT title INTO v_x FROM public.events WHERE id = v_ids3[1];
  PERFORM pg_temp.exige(v_x = 'Con una pasada', '8: sigue con su título');
  RESET ROLE;

  -- El cambio de hora: una serie de tres noches alrededor del próximo cambio.
  -- El primer día (dentro de un año) cuyo mediodía y el del siguiente no distan 24 h: ahí cambia la hora.
  SELECT x.d INTO v_dst
    FROM (SELECT current_date + 40 + i AS d FROM generate_series(0, 400) i) x
   WHERE (((x.d + 1) + TIME '12:00') AT TIME ZONE 'Europe/Madrid') - ((x.d + TIME '12:00') AT TIME ZONE 'Europe/Madrid') <> INTERVAL '24 hours'
   ORDER BY x.d LIMIT 1;
  PERFORM pg_temp.exige(v_dst IS NOT NULL, '8: hay un cambio de hora en el próximo año');
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.crear(gen_random_uuid(), v_ev, v_tiers, pg_temp.sesiones_locales(ARRAY[v_dst - 1, v_dst, v_dst + 1], TIME '23:30', TIME '05:00'), 'multi_day');
  PERFORM pg_temp.exige(v_r LIKE 'ok|%', format('8: una serie que cruza el cambio de hora se crea (%s)', v_r));
  v_s2 := (split_part(v_r, '|', 2)::jsonb->>'series_id')::uuid;
  SELECT array_agg(id ORDER BY date_start) INTO v_ids2 FROM public.events WHERE series_id = v_s2;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s2
     AND (date_start AT TIME ZONE 'Europe/Madrid')::time = TIME '23:30' AND (date_end AT TIME ZONE 'Europe/Madrid')::time = TIME '05:00';
  PERFORM pg_temp.exige(v_n = 3, '8: las tres a las 23:30 de Madrid, con el cambio de hora entre medias');
  -- El cambio de hora está de verdad entre la 1.ª y la 3.ª: no distan 48 h en UTC.
  SELECT count(*) INTO v_n FROM public.events a, public.events b
   WHERE a.id = v_ids2[1] AND b.id = v_ids2[3] AND b.date_start - a.date_start <> INTERVAL '48 hours';
  PERFORM pg_temp.exige(v_n = 1, '8: la serie cruza de verdad un cambio de hora');
  -- Mover el comienzo a las 22:00 en toda la serie: las tres a las 22:00 de Madrid y el fin sigue a las 05:00.
  v_j := public.update_event_series(v_s2, NULL, '{"start_time":"22:00"}'::jsonb);
  PERFORM pg_temp.exige((v_j->>'updated')::int = 3, format('8: las tres sesiones cambian de hora (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s2
     AND (date_start AT TIME ZONE 'Europe/Madrid')::time = TIME '22:00' AND (date_end AT TIME ZONE 'Europe/Madrid')::time = TIME '05:00'
     AND date_end > date_start AND (date_start AT TIME ZONE 'Europe/Madrid')::date = series_date;
  PERFORM pg_temp.exige(v_n = 3, '8: 22:00 → 05:00 en las tres, cada una en su día de serie');
  SELECT start_time, end_time INTO v_row FROM public.event_series WHERE id = v_s2;
  PERFORM pg_temp.exige(v_row.start_time = TIME '22:00' AND v_row.end_time = TIME '05:00', '8: la serie recuerda las horas nuevas');
  -- Quitar la hora de fin y ponerla de nuevo (a las 03:15 del día siguiente).
  v_j := public.update_event_series(v_s2, NULL, '{"end_time":""}'::jsonb);
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s2 AND date_end IS NULL;
  PERFORM pg_temp.exige(v_n = 3, '8: sin hora de fin');
  v_j := public.update_event_series(v_s2, NULL, '{"start_time":"23:30","end_time":"03:15"}'::jsonb);
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s2
     AND (date_start AT TIME ZONE 'Europe/Madrid')::time = TIME '23:30' AND (date_end AT TIME ZONE 'Europe/Madrid')::time = TIME '03:15'
     AND (date_end AT TIME ZONE 'Europe/Madrid')::date = (date_start AT TIME ZONE 'Europe/Madrid')::date + 1;
  PERFORM pg_temp.exige(v_n = 3, '8: 23:30 → 03:15 del día siguiente, en las tres');
  -- Un fin posterior al comienzo el mismo día (de 18:00 a 21:00).
  v_j := public.update_event_series(v_s2, NULL, '{"start_time":"18:00","end_time":"21:00"}'::jsonb);
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s2
     AND (date_end AT TIME ZONE 'Europe/Madrid')::date = (date_start AT TIME ZONE 'Europe/Madrid')::date AND date_end - date_start IN (INTERVAL '3 hours');
  PERFORM pg_temp.exige(v_n = 3, '8: 18:00 → 21:00 el mismo día');
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 9) apply_event_tiers_to_series
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  -- La primera sesión cambia sus tipos: General a 12 €, cupo 80, y un tipo nuevo "Mesa".
  UPDATE public.ticket_tiers SET price_cents = 1200, capacity = 80 WHERE event_id = v_ids[1] AND name = 'General';
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order) VALUES (v_ids[1], 'Mesa', 5000, 6, 6, 2);
  RESET ROLE;
  -- Un tipo agotado en el origen se copia como activo.
  UPDATE public.ticket_tiers SET status = 'sold_out' WHERE event_id = v_ids[1] AND name = 'VIP';
  -- La tercera sesión ya tiene una venta: no se toca.
  SELECT id INTO v_tier FROM public.ticket_tiers WHERE event_id = v_ids[3] AND name = 'General';
  PERFORM pg_temp.comprar_y_pagar(v_ids[3], v_tier, 2, v_b1, 1000);
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.apply_event_tiers_to_series(v_ids[1], 'following');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'applied')::int = 2 AND (v_j->>'skipped_with_sales')::int = 1, format('9: 2 sesiones cambian y 1 se salta (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events e WHERE e.id IN (v_ids[2], v_ids[4])
     AND (SELECT count(*) FROM public.ticket_tiers t WHERE t.event_id = e.id) = 3
     AND EXISTS (SELECT 1 FROM public.ticket_tiers t WHERE t.event_id = e.id AND t.name = 'General' AND t.price_cents = 1200 AND t.capacity = 80)
     AND EXISTS (SELECT 1 FROM public.ticket_tiers t WHERE t.event_id = e.id AND t.name = 'Mesa' AND t.price_cents = 5000 AND t.capacity = 6)
     AND EXISTS (SELECT 1 FROM public.ticket_tiers t WHERE t.event_id = e.id AND t.name = 'VIP' AND t.status = 'active')
     AND e.capacity = 80 + 10 + 6;
  PERFORM pg_temp.exige(v_n = 2, format('9: las sesiones 2 y 4 con los tipos nuevos y su aforo (%s)', v_n));
  SELECT count(*) INTO v_n FROM public.ticket_tiers WHERE event_id = v_ids[3] AND name = 'General' AND price_cents = 1000 AND capacity = 50;
  PERFORM pg_temp.exige(v_n = 1, '9: la sesión con ventas conserva sus tipos');
  -- 'following' no toca las anteriores a la de origen.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.apply_event_tiers_to_series(v_ids[2], 'following');
  PERFORM pg_temp.exige((v_j->>'applied')::int = 1 AND (v_j->>'skipped_with_sales')::int = 1, format('9: desde la 2.ª: 1 y 1 saltada (%s)', v_j));
  v_j := public.apply_event_tiers_to_series(v_ids[2], 'all');
  PERFORM pg_temp.exige((v_j->>'applied')::int = 2 AND (v_j->>'skipped_with_sales')::int = 1, format('9: a todas: la 1.ª, la 4.ª y 1 saltada (%s)', v_j));
  v_x := pg_temp.intentar(format($f$SELECT public.apply_event_tiers_to_series(%L, 'algunas')$f$, v_ids[1]));
  PERFORM pg_temp.exige(v_x LIKE '%series_invalid_scope', format('9: alcance inválido (%s)', v_x));
  v_x := pg_temp.intentar($f$SELECT public.apply_event_tiers_to_series(gen_random_uuid(), 'all')$f$);
  PERFORM pg_temp.exige(v_x LIKE '%series_not_found', format('9: evento que no existe (%s)', v_x));
  -- Un evento suelto no es de ninguna serie.
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status) VALUES (v_p, v_org_p, 'Suelto de P', 'Madrid', now() + INTERVAL '41 days', 'draft')
    RETURNING id INTO v_p_suelto;
  v_x := pg_temp.intentar(format($f$SELECT public.apply_event_tiers_to_series(%L, 'all')$f$, v_p_suelto));
  PERFORM pg_temp.exige(v_x LIKE '%series_not_found', format('9: un evento suelto no tiene serie (%s)', v_x));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 10) Las ventas son de cada sesión; cancelar una no toca las demás
  -- ------------------------------------------------------------------
  -- Un tipo de 2 plazas en dos sesiones: se agota en una y en la otra sigue entero.
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ids[1], 'Dos plazas', 800, 2, 2);
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max) VALUES (v_ids[2], 'Dos plazas', 800, 2, 2);
  SELECT id INTO v_tier FROM public.ticket_tiers WHERE event_id = v_ids[1] AND name = 'Dos plazas';
  PERFORM pg_temp.comprar_y_pagar(v_ids[1], v_tier, 2, v_b1, 800);
  -- La sesión 1 se agota para cualquiera...
  v_x := pg_temp.intentar(format($f$SELECT public.create_ticket_order(%L, %L, 1, %L, 'o6s-x@pasify.test', 'Ana', 'Sol')$f$, v_ids[1], v_tier, v_b2));
  PERFORM pg_temp.exige(v_x LIKE '%tier_sold_out', format('10: la sesión 1 se agota (%s)', v_x));
  -- ...y la 2.ª sigue con sus 2 plazas.
  SELECT id INTO v_tier FROM public.ticket_tiers WHERE event_id = v_ids[2] AND name = 'Dos plazas';
  PERFORM pg_temp.comprar_y_pagar(v_ids[2], v_tier, 2, v_b2, 800);
  SELECT count(*) INTO v_n FROM public.tickets WHERE event_id = v_ids[1] AND status = 'paid';
  PERFORM pg_temp.exige(v_n = 2, '10: 2 entradas de la sesión 1');
  SELECT count(*) INTO v_n FROM public.tickets WHERE event_id = v_ids[2] AND status = 'paid' AND buyer_user_id = v_b2;
  PERFORM pg_temp.exige(v_n = 2, '10: 2 entradas de la sesión 2, de otra persona');
  -- Cancelar la sesión 4 (sin ventas) no cambia las demás.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  PERFORM public.partner_cancel_event(v_ids[4], 'Cancelada por una avería');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND status = 'published';
  PERFORM pg_temp.exige(v_n = 3, '10: las otras tres siguen publicadas');
  SELECT status::text INTO v_x FROM public.event_series WHERE id = v_s;
  PERFORM pg_temp.exige(v_x = 'active', '10: la serie sigue activa');
  -- Su día de serie no se reutiliza: una cancelada ocupa su fecha.
  v_x := pg_temp.intentar(format($f$INSERT INTO public.events (partner_id, series_id, series_date, title, city, date_start, status)
    VALUES (%L, %L, (SELECT series_date FROM public.events WHERE id = %L), 'Repetida', 'Madrid', now() + interval '900 days', 'draft')$f$, v_p, v_s, v_ids[4]));
  PERFORM pg_temp.exige(v_x LIKE '23505|%', format('10: una fecha cancelada no se repite (%s)', v_x));
  -- Cancelada, una sesión ya no cuenta para los solapes.
  UPDATE public.events SET date_start = (SELECT date_start FROM public.events WHERE id = v_ids[3]) + INTERVAL '1 hour',
                           date_end = (SELECT date_end FROM public.events WHERE id = v_ids[3]) WHERE id = v_ids[4];
  PERFORM pg_temp.exige(true, '10: mover una cancelada encima de otra no molesta');

  -- ------------------------------------------------------------------
  -- 11) cancel_event_series
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_x := pg_temp.intentar(format($f$SELECT public.cancel_event_series(%L, NULL, ' ')$f$, v_s));
  PERFORM pg_temp.exige(v_x LIKE '%cancel_reason_required', format('11: hace falta un motivo (%s)', v_x));
  v_x := pg_temp.intentar($f$SELECT public.cancel_event_series(gen_random_uuid(), NULL, 'Motivo de prueba')$f$);
  PERFORM pg_temp.exige(v_x LIKE '%series_not_found', format('11: serie que no existe (%s)', v_x));
  -- La serie de P: la 1.ª tiene 2 entradas, la 2.ª también, la 3.ª una venta, la 4.ª ya está cancelada → ninguna se cancela aquí.
  v_j := public.cancel_event_series(v_s, NULL, 'El local cierra por obras');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 0 AND jsonb_array_length(v_j->'needs_refunds') = 3, format('11: las 3 con ventas se devuelven para reembolsar (%s)', v_j));
  SELECT count(*) INTO v_n FROM public.events WHERE series_id = v_s AND status = 'published';
  PERFORM pg_temp.exige(v_n = 3, '11: y siguen publicadas (las cancela la edge function)');
  -- La serie del cambio de hora: la sesión del medio la compra alguien.
  SELECT id INTO v_tier FROM public.ticket_tiers WHERE event_id = v_ids2[2] AND name = 'General';
  PERFORM pg_temp.comprar_y_pagar(v_ids2[2], v_tier, 1, v_b1, 1000);
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  -- De la segunda en adelante: la 2.ª tiene venta (se devuelve) y la 3.ª no (se cancela).
  v_j := public.cancel_event_series(v_s2, (SELECT date_start FROM public.events WHERE id = v_ids2[2]), 'Cambio de planes');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 1 AND (v_j->'needs_refunds') = to_jsonb(ARRAY[v_ids2[2]]), format('11: de la 2.ª en adelante: 1 cancelada y 1 a reembolsar (%s)', v_j));
  SELECT status::text INTO v_x FROM public.events WHERE id = v_ids2[3];
  PERFORM pg_temp.exige(v_x = 'cancelled', '11: la 3.ª cancelada');
  SELECT status::text INTO v_x FROM public.events WHERE id = v_ids2[1];
  PERFORM pg_temp.exige(v_x = 'published', '11: la 1.ª sigue');
  SELECT metadata->>'cancel_reason' INTO v_x FROM public.events WHERE id = v_ids2[3];
  PERFORM pg_temp.exige(v_x = 'Cambio de planes', '11: con su motivo');
  -- La serie completa sin ventas: queda cancelada del todo.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.cancel_event_series(v_s3, NULL, 'Ya no se hace');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 3 AND jsonb_array_length(v_j->'needs_refunds') = 0, format('11: 3 por celebrar canceladas; la pasada no (%s)', v_j));
  SELECT status::text INTO v_x FROM public.events WHERE id = v_ids3[1];
  PERFORM pg_temp.exige(v_x = 'draft', '11: la pasada se queda como estaba');
  SELECT status::text INTO v_x FROM public.event_series WHERE id = v_s3;
  PERFORM pg_temp.exige(v_x = 'active', '11: la serie aún tiene una sesión sin cancelar (la pasada)');
  -- Repetir no hace nada más.
  PERFORM pg_temp.como(v_p);
  SET LOCAL ROLE authenticated;
  v_j := public.cancel_event_series(v_s3, NULL, 'Ya no se hace');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 0, format('11: repetirlo no hace nada (%s)', v_j));
  -- Cancelada la última sesión viva, la serie queda cancelada.
  PERFORM pg_temp.como(v_q);
  SET LOCAL ROLE authenticated;
  SELECT s.id INTO v_s5 FROM public.event_series s WHERE s.partner_id = v_q LIMIT 1;
  v_j := public.cancel_event_series(v_s5, NULL, 'Cerramos esta noche');
  RESET ROLE;
  PERFORM pg_temp.exige((v_j->>'cancelled')::int = 2, format('11: las 2 de Q (%s)', v_j));
  SELECT status::text INTO v_x FROM public.event_series WHERE id = v_s5;
  PERFORM pg_temp.exige(v_x = 'cancelled', '11: sin sesiones vivas, la serie queda cancelada');

  RAISE NOTICE 'o6_eventos_recurrentes: OK';
END $$;

ROLLBACK;
