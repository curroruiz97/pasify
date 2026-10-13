-- Pasify · Ola 6 · el lugar de un evento sigue a su local.
-- Migración 20261013100000_events_lugar_sigue_al_local.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Al cambiar events.venue_id sin tocar city / venue_name / address, el lugar
-- pasa a ser el del local nuevo (antes se quedaba el del anterior); si el
-- UPDATE toca alguna de las tres columnas manda el cliente; brand_id sigue al
-- local nuevo (de la misma organización); un UPDATE que no cambia venue_id no
-- cambia nada; y la función del trigger no se puede llamar desde la API.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20261013100000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o6_lugar_evento.sql','-c','ROLLBACK;'); & psql @a

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

DO $$
DECLARE
  v_partner  UUID := gen_random_uuid();
  v_other    UUID := gen_random_uuid();
  v_org      UUID;
  v_org2     UUID;
  v_brand    UUID;
  v_brand_b  UUID;
  v_brand2   UUID;
  v_venue1   UUID;                       -- «Principal», el local por defecto de la cuenta
  v_venue2   UUID;                       -- «Sala Norte», Bilbao
  v_venue3   UUID;                       -- otra marca de la misma organización
  v_venue_x  UUID;                       -- local de OTRA organización
  v_venue4   UUID;                       -- local sin dirección
  v_event    UUID;
  r          public.events%ROWTYPE;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o6-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'o6-other-'   || v_other   || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- Dos organizaciones (la segunda para comprobar que no se mezclan marcas).
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O6 Local', 'ES', NULL);
  RESET ROLE;
  PERFORM pg_temp.como(v_other);
  SET LOCAL ROLE authenticated;
  v_org2 := public.create_organization('O6 Otro local', 'ES', NULL);
  RESET ROLE;

  SELECT id INTO v_brand FROM public.brands WHERE org_id = v_org;
  SELECT id INTO v_venue1 FROM public.venues WHERE org_id = v_org AND slug = 'principal';
  SELECT id INTO v_brand2 FROM public.brands WHERE org_id = v_org2;
  SELECT id INTO v_venue_x FROM public.venues WHERE org_id = v_org2;
  PERFORM pg_temp.exige(v_venue1 IS NOT NULL AND v_venue_x IS NOT NULL, 'fixture: locales por defecto');

  INSERT INTO public.brands (org_id, slug, name) VALUES (v_org, 'o6-marca-b', 'O6 Marca B') RETURNING id INTO v_brand_b;
  INSERT INTO public.venues (brand_id, org_id, slug, name, city, address, country)
  VALUES (v_brand, v_org, 'o6-norte', 'Sala Norte', 'Bilbao', 'Gran Vía 1', 'ES') RETURNING id INTO v_venue2;
  INSERT INTO public.venues (brand_id, org_id, slug, name, city, address, country)
  VALUES (v_brand_b, v_org, 'o6-marca-b', 'Sala B', 'Sevilla', 'Calle Sierpes 3', 'ES') RETURNING id INTO v_venue3;
  INSERT INTO public.venues (brand_id, org_id, slug, name, city, country)
  VALUES (v_brand, v_org, 'o6-sin-dir', 'Sala Sin Dirección', 'Valencia', 'ES') RETURNING id INTO v_venue4;

  -- El evento, en el local por defecto: «Principal · Madrid · Calle Vieja 1».
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.events (partner_id, org_id, venue_id, title, city, venue_name, address, date_start, status, price_cents)
  VALUES (v_partner, v_org, v_venue1, 'O6 Evento', 'Madrid', 'Principal', 'Calle Vieja 1', now() + INTERVAL '10 days', 'draft', 1000)
  RETURNING id INTO v_event;
  RESET ROLE;

  -- 1) Cambiar solo el local: el lugar sigue al local nuevo.
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue2 WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.venue_id = v_venue2, '1: venue_id');
  PERFORM pg_temp.exige(r.city = 'Bilbao' AND r.venue_name = 'Sala Norte' AND r.address = 'Gran Vía 1',
    format('1: el lugar no sigue al local (%s / %s / %s)', r.city, r.venue_name, r.address));
  PERFORM pg_temp.exige(r.brand_id = v_brand, '1: brand_id sigue siendo la de la organización');

  -- 2) Un UPDATE que no cambia venue_id no toca el lugar (aunque difiera del local).
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET address = 'Muelle de la Merced 2, local 4' WHERE id = v_event;
  UPDATE public.events SET venue_id = v_venue2, title = 'O6 Evento (2)' WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.address = 'Muelle de la Merced 2, local 4' AND r.city = 'Bilbao',
    '2: sin cambio de local no se reescribe el lugar');

  -- 3) Cambio de local con el lugar escrito por el cliente: manda el cliente.
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue1, city = 'Getafe', venue_name = 'Nave 7', address = 'Polígono Norte 7' WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.city = 'Getafe' AND r.venue_name = 'Nave 7' AND r.address = 'Polígono Norte 7',
    '3: el lugar que manda el cliente se respeta');

  -- 4) Si el cliente toca solo una de las tres columnas, tampoco se pisa nada.
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue2, venue_name = 'Solo el nombre' WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.venue_name = 'Solo el nombre' AND r.city = 'Getafe' AND r.address = 'Polígono Norte 7',
    format('4: cambio parcial del lugar (%s / %s / %s)', r.city, r.venue_name, r.address));

  -- 5) Local sin dirección: el evento queda SIN dirección (no se queda la del anterior).
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue4 WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.city = 'Valencia' AND r.venue_name = 'Sala Sin Dirección' AND r.address IS NULL,
    format('5: local sin dirección (%s / %s / %s)', r.city, r.venue_name, r.address));

  -- 6) Marca: sigue al local nuevo si es de la misma organización.
  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  UPDATE public.events SET venue_id = v_venue3 WHERE id = v_event;
  RESET ROLE;
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.brand_id = v_brand_b AND r.city = 'Sevilla', '6: la marca sigue al local de la misma organización');

  -- 7) Un local de otra organización no mezcla la marca (la organización del evento no cambia).
  UPDATE public.events SET venue_id = v_venue_x WHERE id = v_event;     -- como postgres (admin de la base)
  SELECT * INTO r FROM public.events WHERE id = v_event;
  PERFORM pg_temp.exige(r.org_id = v_org, '7: org_id del evento intacto');
  PERFORM pg_temp.exige(r.brand_id = v_brand_b, '7: brand_id no pasa a una marca de otra organización');
  PERFORM pg_temp.exige(r.brand_id <> v_brand2, '7: brand_id ajena');

  -- 8) La función del trigger no es llamable desde la API.
  PERFORM pg_temp.exige(NOT has_function_privilege('authenticated', 'public.events_sync_venue_place()', 'EXECUTE'),
    '8: events_sync_venue_place no debe ser ejecutable por authenticated');
  PERFORM pg_temp.exige(NOT has_function_privilege('anon', 'public.events_sync_venue_place()', 'EXECUTE'),
    '8: events_sync_venue_place no debe ser ejecutable por anon');

  RAISE NOTICE 'o6_lugar_evento: OK';
END $$;

ROLLBACK;
