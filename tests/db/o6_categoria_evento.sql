-- Pasify · Ola 6 · clasificación de eventos.
-- Migración 20261013120000_eventos_categoria.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- events.category: NULL (eventos anteriores, siguen igual) o bar, discoteca,
-- festival; cualquier otro valor lo rechaza la BD (también al editar); el
-- local puede crear y cambiar la categoría de su evento.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20261013120000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o6_categoria_evento.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.exige(_ok BOOLEAN, _msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', _msg; END IF;
END $$;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_org     UUID;
  v_ev      UUID;
  v_cat     TEXT;
  v_state   TEXT;
  v_n       INT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES (v_partner, 'o6-cat-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O6 Categorías', 'ES', NULL);

  -- 1) Sin categoría (los eventos anteriores) sigue valiendo.
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents)
  VALUES (v_partner, v_org, 'O6 sin categoría', 'Madrid', now() + INTERVAL '10 days', 'draft', 1000)
  RETURNING id, category INTO v_ev, v_cat;
  PERFORM pg_temp.exige(v_cat IS NULL, '1: sin categoría queda a NULL (no se inventa)');

  -- 2) Las tres categorías, al crear.
  FOREACH v_cat IN ARRAY ARRAY['bar', 'discoteca', 'festival'] LOOP
    INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents, category)
    VALUES (v_partner, v_org, 'O6 ' || v_cat, 'Madrid', now() + INTERVAL '10 days', 'draft', 1000, v_cat);
  END LOOP;
  SELECT count(*) INTO v_n FROM public.events WHERE org_id = v_org AND category IN ('bar', 'discoteca', 'festival');
  PERFORM pg_temp.exige(v_n = 3, format('2: las tres categorías se guardan (%s)', v_n));

  -- 3) Se puede clasificar después (el evento 1 no tenía) y cambiar de una a otra.
  UPDATE public.events SET category = 'festival' WHERE id = v_ev;
  SELECT category INTO v_cat FROM public.events WHERE id = v_ev;
  PERFORM pg_temp.exige(v_cat = 'festival', '3: clasificar un evento que no la tenía');
  UPDATE public.events SET category = 'bar' WHERE id = v_ev;
  SELECT category INTO v_cat FROM public.events WHERE id = v_ev;
  PERFORM pg_temp.exige(v_cat = 'bar', '3: cambiar de categoría');
  UPDATE public.events SET category = NULL WHERE id = v_ev;
  SELECT category INTO v_cat FROM public.events WHERE id = v_ev;
  PERFORM pg_temp.exige(v_cat IS NULL, '3: quitarla (vuelve a sin clasificar)');

  -- 4) Un valor fuera de la lista lo rechaza la BD, al crear y al editar.
  BEGIN
    INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents, category)
    VALUES (v_partner, v_org, 'O6 mala', 'Madrid', now() + INTERVAL '10 days', 'draft', 1000, 'rooftop');
    RAISE EXCEPTION 'FAIL 4: aceptó una categoría que no existe al crear';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_state = CONSTRAINT_NAME;
    PERFORM pg_temp.exige(v_state = 'events_category_check', format('4: restricción inesperada (%s)', v_state));
  END;
  BEGIN
    UPDATE public.events SET category = 'Discoteca' WHERE id = v_ev;   -- con mayúscula tampoco
    RAISE EXCEPTION 'FAIL 4: aceptó una categoría que no existe al editar';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.events SET category = '' WHERE id = v_ev;
    RAISE EXCEPTION 'FAIL 4: aceptó una categoría vacía';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RESET ROLE;

  RAISE NOTICE 'o6_categoria_evento: OK';
END $$;

ROLLBACK;
