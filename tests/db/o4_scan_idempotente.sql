-- Pasify · Ola 4 · puerta: reintentos de escaneo idempotentes (WP8, parte SQL).
-- Migración 20260929130000_scan_ticket_idempotente.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- scan_ticket y scan_ticket_by_code con y sin _request_id: el mismo request_id
-- dos veces da éxito las dos y un solo log; otro request_id, otro usuario u
-- otra entrada dan already_used; sin request_id, como antes. También: lo que
-- queda en ticket_scan_logs.metadata, que el resto de resultados no cambia,
-- que no hay sobrecargas (PGRST203) y los permisos de las firmas nuevas.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260929130000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o4_scan_idempotente.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

-- Entra como `_uid` (JWT de usuario autenticado). Sin _uid, como anon.
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

-- Falla con 'FAIL …' si la condición no es verdadera (NULL cuenta como fallo).
CREATE OR REPLACE FUNCTION pg_temp.exige(_ok BOOLEAN, _msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', _msg; END IF;
END $$;

-- scan_ticket como `_uid`, con argumentos con nombre (como lo llama PostgREST).
-- Devuelve la fila como JSON.
CREATE OR REPLACE FUNCTION pg_temp.escanear(
  _uid UUID, _qr UUID, _evento UUID, _rid UUID DEFAULT NULL, _forzar BOOLEAN DEFAULT FALSE, _motivo TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.como(_uid);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM public.scan_ticket(
    _qr_token => _qr, _device_info => 'o4', _event_id => _evento,
    _force => _forzar, _force_reason => _motivo, _request_id => _rid);
  RESET ROLE;
  RETURN to_jsonb(r);
END $$;

-- scan_ticket_by_code como `_uid`, también con argumentos con nombre.
CREATE OR REPLACE FUNCTION pg_temp.escanear_codigo(
  _uid UUID, _codigo TEXT, _evento UUID, _rid UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  PERFORM pg_temp.como(_uid);
  SET LOCAL ROLE authenticated;
  SELECT * INTO r FROM public.scan_ticket_by_code(
    _code => _codigo, _event_id => _evento, _device_info => 'o4', _request_id => _rid);
  RESET ROLE;
  RETURN to_jsonb(r);
END $$;

DO $$
DECLARE
  v_partner  UUID := gen_random_uuid();  -- dueño de la organización: gestiona el evento
  v_door     UUID := gen_random_uuid();  -- portero (door_staff)
  v_door2    UUID := gen_random_uuid();  -- otro portero del mismo local
  v_other    UUID := gen_random_uuid();  -- otro local: sin permiso en este evento
  v_client   UUID := gen_random_uuid();  -- comprador
  v_org      UUID;
  v_event    UUID;                       -- empieza dentro de una hora: la puerta está abierta
  v_event2   UUID;                       -- dentro de 10 días: «otro evento» del mismo local
  v_tier     UUID;
  v_o        RECORD;
  v_row      RECORD;
  v_qr       UUID[];                     -- QR de 8 entradas pagadas
  v_tk       UUID[];                     -- ids de esas entradas (mismo orden)
  v_qr_pend  UUID;                       -- QR de una entrada sin pagar
  v_tk_pend  UUID;
  v_rid      UUID[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 10));
  v_r        JSONB;
  v_r2       JSONB;
  v_count    INT;
  v_code     TEXT;
  v_text     TEXT;
  v_used_at  TIMESTAMPTZ;
BEGIN
  -- ------------------------------------------------------------------
  -- 0) Usuarios, local con dos porteros, eventos y entradas
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o4-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_door,    'o4-door-'    || v_door    || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_door2,   'o4-door2-'   || v_door2   || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'o4-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o4-client-'  || v_client  || '@pasify.test', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O4 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O4 Evento', 'Madrid', now() + INTERVAL '1 hour', now() + INTERVAL '7 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O4 Otro evento', 'Madrid', now() + INTERVAL '10 days', now() + INTERVAL '10 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event2;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max)
  VALUES (v_event, 'General', 1000, 50, 10) RETURNING id INTO v_tier;
  RESET ROLE;
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_door,  'o4-door-'  || v_door  || '@pasify.test', 'door_staff', 'active'),
         (v_org, v_door2, 'o4-door2-' || v_door2 || '@pasify.test', 'door_staff', 'active');

  -- 8 entradas pagadas de verdad (livemode = true) y una sin pagar
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT * INTO v_o FROM public.create_ticket_order(v_event, v_tier, 8, v_client, 'o4-client@pasify.test', 'Clara', 'Ena');
  PERFORM public.set_order_stripe_session(v_o.order_id, 'cs_o4_' || v_o.order_id);
  PERFORM public.mark_order_paid_v2('cs_o4_' || v_o.order_id, 'pi_o4_' || v_o.order_id, 8000, 400, TRUE);
  SELECT array_agg(t.qr_token ORDER BY t.id), array_agg(t.id ORDER BY t.id) INTO v_qr, v_tk
    FROM public.tickets t WHERE t.order_id = v_o.order_id AND t.status = 'paid';
  IF cardinality(v_qr) IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'FAIL esperaba 8 entradas pagadas y hay %', cardinality(v_qr);
  END IF;
  SELECT * INTO v_o FROM public.create_ticket_order(v_event, v_tier, 1, v_client, 'o4-client@pasify.test', 'Clara', 'Ena');
  SELECT t.qr_token, t.id INTO v_qr_pend, v_tk_pend FROM public.tickets t WHERE t.order_id = v_o.order_id;

  -- ------------------------------------------------------------------
  -- 1) Firmas: una sola de cada, con _request_id opcional; sin sobrecargas
  -- ------------------------------------------------------------------
  IF to_regprocedure('public.scan_ticket(uuid,text,uuid,boolean,text)') IS NOT NULL
     OR to_regprocedure('public.scan_ticket_by_code(text,uuid,text,boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL siguen existiendo las firmas antiguas (dos sobrecargas darían PGRST203)';
  END IF;
  IF to_regprocedure('public.scan_ticket(uuid,text,uuid,boolean,text,uuid)') IS NULL
     OR to_regprocedure('public.scan_ticket_by_code(text,uuid,text,boolean,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL faltan las firmas nuevas con _request_id';
  END IF;
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('scan_ticket', 'scan_ticket_by_code');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL hay % funciones scan_ticket* en public (esperadas 2, sin sobrecargas)', v_count;
  END IF;

  -- Seis parámetros: _request_id es opcional y los demás siguen como antes (cinco con
  -- DEFAULT en scan_ticket, cuatro en scan_ticket_by_code); SECURITY DEFINER con search_path fijo
  SELECT p.pronargs, p.pronargdefaults, p.prosecdef, p.proconfig INTO v_row
    FROM pg_proc p WHERE p.oid = 'public.scan_ticket(uuid,text,uuid,boolean,text,uuid)'::regprocedure;
  IF v_row.pronargs <> 6 OR v_row.pronargdefaults <> 5 OR NOT v_row.prosecdef
     OR v_row.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'FAIL scan_ticket: args=% con DEFAULT=% security definer=% config=%',
      v_row.pronargs, v_row.pronargdefaults, v_row.prosecdef, v_row.proconfig;
  END IF;
  SELECT p.pronargs, p.pronargdefaults, p.prosecdef, p.proconfig INTO v_row
    FROM pg_proc p WHERE p.oid = 'public.scan_ticket_by_code(text,uuid,text,boolean,text,uuid)'::regprocedure;
  IF v_row.pronargs <> 6 OR v_row.pronargdefaults <> 4 OR NOT v_row.prosecdef
     OR v_row.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'FAIL scan_ticket_by_code: args=% con DEFAULT=% security definer=% config=%',
      v_row.pronargs, v_row.pronargdefaults, v_row.prosecdef, v_row.proconfig;
  END IF;

  -- Permisos: authenticated y service_role sí; anon (ni PUBLIC) no
  FOR v_row IN
    SELECT * FROM (VALUES
      ('public.scan_ticket(uuid,text,uuid,boolean,text,uuid)', 'anon', FALSE),
      ('public.scan_ticket(uuid,text,uuid,boolean,text,uuid)', 'authenticated', TRUE),
      ('public.scan_ticket(uuid,text,uuid,boolean,text,uuid)', 'service_role', TRUE),
      ('public.scan_ticket_by_code(text,uuid,text,boolean,text,uuid)', 'anon', FALSE),
      ('public.scan_ticket_by_code(text,uuid,text,boolean,text,uuid)', 'authenticated', TRUE),
      ('public.scan_ticket_by_code(text,uuid,text,boolean,text,uuid)', 'service_role', TRUE)
    ) AS p(fn, rol, esperado)
  LOOP
    IF has_function_privilege(v_row.rol, v_row.fn, 'EXECUTE') IS DISTINCT FROM v_row.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre %: esperaba %', v_row.rol, v_row.fn, v_row.esperado;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 2) Mismo _request_id dos veces: éxito las dos y un solo log
  -- ------------------------------------------------------------------
  v_r := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[1]);
  PERFORM pg_temp.exige(
    v_r->>'success' = 'true' AND v_r->>'result' = 'success' AND v_r->>'forced' = 'false'
    AND v_r->>'ticket_id' = v_tk[1]::text AND v_r->>'event_id' = v_event::text
    AND v_r->>'event_title' = 'O4 Evento' AND v_r->>'tier_name' = 'General'
    AND v_r->>'buyer_first_name' = 'Clara' AND v_r->>'buyer_last_name' = 'Ena'
    AND v_r->>'buyer_email' IS NULL          -- el portero no ve el email
    AND v_r->>'already_used_at' IS NULL,
    'primer escaneo con _request_id: ' || v_r::text);
  SELECT t.status::text, t.used_at INTO v_text, v_used_at FROM public.tickets t WHERE t.id = v_tk[1];
  PERFORM pg_temp.exige(v_text = 'used' AND v_used_at IS NOT NULL, 'la entrada no quedó usada: ' || COALESCE(v_text, '?'));

  v_r2 := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[1]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'el reintento con el mismo _request_id no repite la respuesta: ' || v_r::text || ' <> ' || v_r2::text);
  v_r2 := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[1]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'la tercera lectura con el mismo _request_id no repite la respuesta: ' || v_r2::text);

  -- Un solo log (el del éxito original, con su request_id) y la entrada intacta
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[1];
  PERFORM pg_temp.exige(v_count = 1, 'logs de la entrada tras 3 lecturas con el mismo _request_id = ' || v_count || ' (esperado 1)');
  SELECT * INTO v_row FROM public.ticket_scan_logs WHERE ticket_id = v_tk[1];
  PERFORM pg_temp.exige(
    v_row.result::text = 'success' AND v_row.scanned_by_user_id = v_door AND v_row.org_id = v_org
    AND v_row.metadata = jsonb_build_object('request_id', v_rid[1]),
    'log del éxito: ' || row_to_json(v_row)::text);
  PERFORM pg_temp.exige(
    (SELECT t.status::text = 'used' AND t.used_at = v_used_at AND t.used_by_partner_id = v_door
       FROM public.tickets t WHERE t.id = v_tk[1]),
    'el reintento cambió la entrada');

  -- ------------------------------------------------------------------
  -- 3) Otro _request_id sobre la entrada ya usada: already_used
  -- ------------------------------------------------------------------
  v_r2 := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[9]);
  PERFORM pg_temp.exige(
    v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used' AND v_r2->>'forced' = 'false'
    AND (v_r2->>'already_used_at')::timestamptz = v_used_at AND v_r2->>'buyer_first_name' = 'Clara',
    'otro _request_id sobre una entrada usada: ' || v_r2::text);
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[1] AND result = 'already_used';
  PERFORM pg_temp.exige(v_count = 1, 'logs already_used tras un _request_id distinto = ' || v_count || ' (esperado 1)');
  -- El reintento legítimo sigue valiendo después, sin otro log de éxito
  v_r2 := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[1]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'el reintento legítimo dejó de valer tras un intento con otro _request_id: ' || v_r2::text);
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[1] AND result = 'success';
  PERFORM pg_temp.exige(v_count = 1, 'logs de éxito = ' || v_count || ' (esperado 1)');

  -- La respuesta repetida lleva la hora del escaneo original (la del log), no la del reintento
  UPDATE public.ticket_scan_logs SET scanned_at = scanned_at - INTERVAL '3 minutes'
   WHERE ticket_id = v_tk[1] AND result = 'success';
  v_r2 := pg_temp.escanear(v_door, v_qr[1], v_event, v_rid[1]);
  PERFORM pg_temp.exige(
    v_r2->>'success' = 'true' AND v_r2->>'result' = 'success'
    AND (v_r2->>'scanned_at')::timestamptz = (v_r->>'scanned_at')::timestamptz - INTERVAL '3 minutes',
    'el reintento no devuelve la hora del escaneo original: ' || v_r2::text);

  -- ------------------------------------------------------------------
  -- 4) Mismo _request_id pero otro usuario: already_used (o forbidden sin permiso)
  -- ------------------------------------------------------------------
  v_r := pg_temp.escanear(v_door, v_qr[5], v_event, v_rid[5]);
  PERFORM pg_temp.exige(v_r->>'success' = 'true' AND v_r->>'result' = 'success', 'escaneo del portero: ' || v_r::text);

  v_r2 := pg_temp.escanear(v_door2, v_qr[5], v_event, v_rid[5]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'otro portero con el _request_id del primero: ' || v_r2::text);
  v_r2 := pg_temp.escanear(v_partner, v_qr[5], v_event, v_rid[5]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'quien gestiona el evento con el _request_id del portero: ' || v_r2::text);
  v_r2 := pg_temp.escanear(v_other, v_qr[5], v_event, v_rid[5]);
  PERFORM pg_temp.exige(
    v_r2->>'success' = 'false' AND v_r2->>'result' = 'forbidden'
    AND v_r2->>'ticket_id' IS NULL AND v_r2->>'event_title' IS NULL
    AND v_r2->>'buyer_first_name' IS NULL AND v_r2->>'buyer_email' IS NULL,
    'otro local con el _request_id del portero: ' || v_r2::text);
  v_r2 := pg_temp.escanear(v_door, v_qr[5], v_event, v_rid[5]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'el portero original ya no repite su éxito: ' || v_r2::text);

  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[5];
  PERFORM pg_temp.exige(v_count = 4, 'logs de la entrada 5 = ' || v_count || ' (esperados 4)');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs
   WHERE ticket_id = v_tk[5] AND result = 'success' AND scanned_by_user_id = v_door;
  PERFORM pg_temp.exige(v_count = 1, 'logs de éxito de la entrada 5 = ' || v_count || ' (esperado 1)');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs
   WHERE ticket_id = v_tk[5] AND result = 'already_used' AND scanned_by_user_id IN (v_door2, v_partner);
  PERFORM pg_temp.exige(v_count = 2, 'logs already_used de la entrada 5 = ' || v_count || ' (esperados 2)');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs
   WHERE ticket_id = v_tk[5] AND result = 'forbidden' AND scanned_by_user_id = v_other;
  PERFORM pg_temp.exige(v_count = 1, 'logs forbidden de la entrada 5 = ' || v_count || ' (esperado 1)');

  -- ------------------------------------------------------------------
  -- 5) Sin _request_id: como hasta ahora
  -- ------------------------------------------------------------------
  v_r := pg_temp.escanear(v_door, v_qr[2], v_event);
  PERFORM pg_temp.exige(v_r->>'success' = 'true' AND v_r->>'result' = 'success', 'escaneo sin _request_id: ' || v_r::text);
  SELECT * INTO v_row FROM public.ticket_scan_logs WHERE ticket_id = v_tk[2] AND result = 'success';
  PERFORM pg_temp.exige(v_row.metadata = '{}'::jsonb AND v_row.notes IS NULL,
    'sin _request_id el metadata del éxito debía quedar vacío: ' || row_to_json(v_row)::text);

  v_r2 := pg_temp.escanear(v_door, v_qr[2], v_event);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'segunda lectura sin _request_id: ' || v_r2::text);
  -- El _request_id de otra entrada ya usada no vale aquí
  v_r2 := pg_temp.escanear(v_door, v_qr[2], v_event, v_rid[1]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'el _request_id de otra entrada reabrió esta: ' || v_r2::text);
  -- Un _request_id nuevo tampoco: el primer escaneo no lo llevaba
  v_r2 := pg_temp.escanear(v_door, v_qr[2], v_event, v_rid[2]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'un _request_id nuevo sobre una entrada usada sin él: ' || v_r2::text);
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[2] AND result = 'success';
  PERFORM pg_temp.exige(v_count = 1, 'logs de éxito de la entrada 2 = ' || v_count || ' (esperado 1)');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[2] AND result = 'already_used';
  PERFORM pg_temp.exige(v_count = 3, 'logs already_used de la entrada 2 = ' || v_count || ' (esperados 3)');

  -- ------------------------------------------------------------------
  -- 6) Éxito forzado con _request_id (y sin él)
  -- ------------------------------------------------------------------
  -- El portero no puede forzar: wrong_event aunque lo pida
  v_r := pg_temp.escanear(v_door, v_qr[4], v_event2, v_rid[4], TRUE, 'Error de taquilla');
  PERFORM pg_temp.exige(v_r->>'success' = 'false' AND v_r->>'result' = 'wrong_event', 'el portero forzó: ' || v_r::text);
  v_r := pg_temp.escanear(v_partner, v_qr[4], v_event2, v_rid[4]);
  PERFORM pg_temp.exige(v_r->>'success' = 'false' AND v_r->>'result' = 'wrong_event', 'sin forzar: ' || v_r::text);
  -- Lo denegado no se recuerda: el mismo _request_id, ahora con motivo, deja pasar
  v_r := pg_temp.escanear(v_partner, v_qr[4], v_event2, v_rid[4], TRUE, 'Error de taquilla');
  PERFORM pg_temp.exige(v_r->>'success' = 'true' AND v_r->>'result' = 'success' AND v_r->>'forced' = 'true',
    'escaneo forzado con _request_id: ' || v_r::text);
  SELECT * INTO v_row FROM public.ticket_scan_logs WHERE ticket_id = v_tk[4] AND result = 'success';
  PERFORM pg_temp.exige(
    v_row.notes = 'forced: Error de taquilla'
    AND v_row.metadata = jsonb_build_object('forced', TRUE, 'original_result', 'wrong_event',
                                            'selected_event_id', v_event2, 'request_id', v_rid[4]),
    'log del éxito forzado: ' || row_to_json(v_row)::text);
  -- Reintento con los mismos argumentos: éxito (forced = false: esta llamada no fuerza nada), sin otro log
  v_r2 := pg_temp.escanear(v_partner, v_qr[4], v_event2, v_rid[4], TRUE, 'Error de taquilla');
  PERFORM pg_temp.exige(v_r2->>'success' = 'true' AND v_r2->>'result' = 'success' AND v_r2->>'forced' = 'false'
    AND v_r2->>'ticket_id' = v_r->>'ticket_id' AND v_r2->>'buyer_email' = v_r->>'buyer_email',
    'reintento del escaneo forzado: ' || v_r2::text);
  v_r2 := pg_temp.escanear(v_partner, v_qr[4], v_event2, v_rid[4]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'true' AND v_r2->>'result' = 'success',
    'reintento del escaneo forzado sin repetir el motivo: ' || v_r2::text);
  -- Otro usuario con ese _request_id: usada
  v_r2 := pg_temp.escanear(v_door, v_qr[4], v_event, v_rid[4]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'otro usuario sobre el escaneo forzado: ' || v_r2::text);
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[4] AND result = 'success';
  PERFORM pg_temp.exige(v_count = 1, 'logs de éxito de la entrada 4 = ' || v_count || ' (esperado 1)');

  -- Forzado sin _request_id: el metadata es el de siempre, sin la clave nueva
  v_r := pg_temp.escanear(v_partner, v_qr[6], v_event2, NULL, TRUE, 'Sin request id');
  PERFORM pg_temp.exige(v_r->>'success' = 'true' AND v_r->>'forced' = 'true', 'forzado sin _request_id: ' || v_r::text);
  SELECT * INTO v_row FROM public.ticket_scan_logs WHERE ticket_id = v_tk[6] AND result = 'success';
  PERFORM pg_temp.exige(
    v_row.notes = 'forced: Sin request id'
    AND v_row.metadata = jsonb_build_object('forced', TRUE, 'original_result', 'wrong_event', 'selected_event_id', v_event2),
    'log del forzado sin _request_id: ' || row_to_json(v_row)::text);
  v_r2 := pg_temp.escanear(v_partner, v_qr[6], v_event2, NULL, TRUE, 'Sin request id');
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used',
    'segundo forzado sin _request_id: ' || v_r2::text);

  -- ------------------------------------------------------------------
  -- 7) scan_ticket_by_code con _request_id
  -- ------------------------------------------------------------------
  v_code := upper(left(v_qr[3]::text, 8));
  v_r := pg_temp.escanear_codigo(v_door, v_code, v_event, v_rid[3]);
  PERFORM pg_temp.exige(
    v_r->>'success' = 'true' AND v_r->>'result' = 'success' AND v_r->>'ticket_id' = v_tk[3]::text,
    'escaneo por código con _request_id: ' || v_r::text);
  v_r2 := pg_temp.escanear_codigo(v_door, v_code, v_event, v_rid[3]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'el reintento por código con el mismo _request_id no repite la respuesta: ' || v_r2::text);
  -- Sin _request_id, usada
  v_r2 := pg_temp.escanear_codigo(v_door, v_code, v_event);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used', 'por código sin _request_id: ' || v_r2::text);
  -- La misma petición por QR (mismo usuario y entrada): éxito
  v_r2 := pg_temp.escanear(v_door, v_qr[3], v_event, v_rid[3]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'true' AND v_r2->>'result' = 'success', 'por QR con el _request_id del código: ' || v_r2::text);
  -- Otro portero por código con ese _request_id: usada
  v_r2 := pg_temp.escanear_codigo(v_door2, v_code, v_event, v_rid[3]);
  PERFORM pg_temp.exige(v_r2->>'success' = 'false' AND v_r2->>'result' = 'already_used', 'otro portero por código: ' || v_r2::text);
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[3] AND result = 'success';
  PERFORM pg_temp.exige(v_count = 1, 'logs de éxito de la entrada 3 = ' || v_count || ' (esperado 1)');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs
   WHERE ticket_id = v_tk[3] AND result = 'success' AND metadata = jsonb_build_object('request_id', v_rid[3]);
  PERFORM pg_temp.exige(v_count = 1, 'el éxito por código no guardó el request_id');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk[3] AND result = 'already_used';
  PERFORM pg_temp.exige(v_count = 2, 'logs already_used de la entrada 3 = ' || v_count || ' (esperados 2)');

  -- ------------------------------------------------------------------
  -- 8) El resto de resultados no cambia con un _request_id
  -- ------------------------------------------------------------------
  v_r := pg_temp.escanear(v_door, gen_random_uuid(), v_event, v_rid[10]);
  PERFORM pg_temp.exige(v_r->>'success' = 'false' AND v_r->>'result' = 'invalid_ticket', 'QR desconocido con _request_id: ' || v_r::text);
  FOR i IN 1..2 LOOP
    v_r := pg_temp.escanear(v_door, v_qr_pend, v_event, v_rid[10]);
    PERFORM pg_temp.exige(v_r->>'success' = 'false' AND v_r->>'result' = 'not_paid', 'entrada sin pagar con _request_id: ' || v_r::text);
  END LOOP;
  PERFORM pg_temp.exige((SELECT t.status::text = 'pending' FROM public.tickets t WHERE t.id = v_tk_pend), 'la entrada sin pagar cambió de estado');
  SELECT count(*) INTO v_count FROM public.ticket_scan_logs WHERE ticket_id = v_tk_pend AND result = 'success';
  PERFORM pg_temp.exige(v_count = 0, 'hay un log de éxito para una entrada sin pagar');

  -- ------------------------------------------------------------------
  -- 9) Llamadas de antes (QRScanner actual): sin _request_id, con nombre o posicionales
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_door);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.scan_ticket(_qr_token => v_qr[7], _device_info => 'o4');
  RESET ROLE;
  PERFORM pg_temp.exige(v_row.success AND v_row.result::text = 'success', 'llamada con nombre sin _request_id: ' || row_to_json(v_row)::text);
  PERFORM pg_temp.como(v_door);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.scan_ticket(v_qr[7], 'o4', v_event, FALSE, NULL);
  RESET ROLE;
  PERFORM pg_temp.exige(NOT v_row.success AND v_row.result::text = 'already_used', 'llamada posicional de cinco argumentos: ' || row_to_json(v_row)::text);
  PERFORM pg_temp.como(v_door);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_row FROM public.scan_ticket_by_code(upper(left(v_qr[7]::text, 8)), v_event, 'o4');
  RESET ROLE;
  PERFORM pg_temp.exige(NOT v_row.success AND v_row.result::text = 'already_used', 'por código con tres posicionales: ' || row_to_json(v_row)::text);
  SELECT * INTO v_row FROM public.ticket_scan_logs WHERE ticket_id = v_tk[7] AND result = 'success';
  PERFORM pg_temp.exige(v_row.metadata = '{}'::jsonb, 'el éxito sin _request_id guardó metadata: ' || row_to_json(v_row)::text);

  -- ------------------------------------------------------------------
  -- 10) Quien gestiona el evento: el reintento también lleva el email del titular
  -- ------------------------------------------------------------------
  v_r := pg_temp.escanear(v_partner, v_qr[8], v_event, v_rid[8]);
  PERFORM pg_temp.exige(
    v_r->>'success' = 'true' AND v_r->>'buyer_email' = 'o4-client@pasify.test',
    'escaneo de quien gestiona el evento: ' || v_r::text);
  v_r2 := pg_temp.escanear(v_partner, v_qr[8], v_event, v_rid[8]);
  PERFORM pg_temp.exige(v_r2 = v_r, 'el reintento de quien gestiona el evento no repite la respuesta: ' || v_r2::text);

  RAISE NOTICE 'PASS o4_scan_idempotente: mismo _request_id = éxito y un solo log; otro request_id, usuario o entrada = already_used; sin _request_id como antes; forzados, código corto, firmas y permisos';
END $$;

ROLLBACK;
