-- Pasify · Ola 1 · Servidor: tenant_for_user elige siempre la misma
-- organización (la propia antes que las ajenas y, dentro de cada grupo, la
-- más antigua) y un local de esa organización.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Necesita la migración 20260926110000. Para probarla sin aplicarla, todo en
-- una transacción que acaba en ROLLBACK:
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
--     -c "BEGIN;" \
--     -f supabase/migrations/20260926110000_tenant_for_user_orden_estable.sql \
--     -f tests/db/o1_servidor.sql -c "ROLLBACK;"

BEGIN;

DO $$
DECLARE
  v_owner    UUID := gen_random_uuid();
  v_other    UUID := gen_random_uuid();
  v_member   UUID := gen_random_uuid();
  v_nobody   UUID := gen_random_uuid();
  v_org_a    UUID;
  v_org_b    UUID;
  v_org_c    UUID;
  v_org_d    UUID;
  v_org_e    UUID;
  v_brand_a  UUID;
  v_venue_a  UUID;
  v_venue_c  UUID;
  v_brand2   UUID;
  v_venue2   UUID;
  v_expected UUID;
  v_t        RECORD;
  v_first    RECORD;
  v_count    INT;
  v_uuid     UUID;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_owner,  'o1s-owner-'  || v_owner  || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,  'o1s-other-'  || v_other  || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_member, 'o1s-member-' || v_member || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_nobody, 'o1s-nobody-' || v_nobody || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- El local crea dos organizaciones: la A y, después, la C (create_organization
  -- deja como local activo el de la C, la última).
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org_a := public.create_organization('O1S Local A', 'ES', NULL);
  v_org_c := public.create_organization('O1S Local C', 'ES', NULL);
  RESET ROLE;

  -- Otro local con tres organizaciones: B, D y E
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org_b := public.create_organization('O1S Local B', 'ES', NULL);
  v_org_d := public.create_organization('O1S Local D', 'ES', NULL);
  v_org_e := public.create_organization('O1S Local E', 'ES', NULL);
  RESET ROLE;

  -- Antigüedad: B (la más antigua) > E > A > D > C
  UPDATE public.organizations SET created_at = now() - INTERVAL '10 days' WHERE id = v_org_b;
  UPDATE public.organizations SET created_at = now() - INTERVAL '5 days'  WHERE id = v_org_e;
  UPDATE public.organizations SET created_at = now() - INTERVAL '3 days'  WHERE id = v_org_a;
  UPDATE public.organizations SET created_at = now() - INTERVAL '2 days'  WHERE id = v_org_d;
  UPDATE public.organizations SET created_at = now() - INTERVAL '1 day'   WHERE id = v_org_c;

  -- El primer local es además admin de B, más antigua que las suyas.
  -- El tercer usuario solo es miembro: admin de D y portero de E.
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES
    (v_org_b, v_owner,  'o1s-owner@pasify.test',  'admin',      'active'),
    (v_org_d, v_member, 'o1s-member@pasify.test', 'admin',      'active'),
    (v_org_e, v_member, 'o1s-member@pasify.test', 'door_staff', 'active');

  SELECT b.id INTO v_brand_a FROM public.brands b WHERE b.org_id = v_org_a;
  SELECT v.id INTO v_venue_a FROM public.venues v WHERE v.org_id = v_org_a;
  SELECT v.id INTO v_venue_c FROM public.venues v WHERE v.org_id = v_org_c;
  SELECT last_active_venue_id INTO v_uuid FROM public.profiles WHERE id = v_owner;
  IF v_uuid IS DISTINCT FROM v_venue_c THEN
    RAISE EXCEPTION 'FAIL preparación: el local activo debía ser el de la C (%)', v_uuid;
  END IF;

  -- ------------------------------------------------------------------
  -- 1) La organización propia más antigua, con un local suyo
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_first FROM public.tenant_for_user();
  IF v_first.org_id IS DISTINCT FROM v_org_a THEN
    RAISE EXCEPTION 'FAIL esperaba la organización propia más antigua (A) y llegó %', v_first.org_id;
  END IF;
  IF v_first.role::text <> 'owner' THEN RAISE EXCEPTION 'FAIL rol en la organización propia = %', v_first.role; END IF;
  -- El local activo es de la C: no vale para la A
  IF v_first.venue_id IS DISTINCT FROM v_venue_a OR v_first.brand_id IS DISTINCT FROM v_brand_a THEN
    RAISE EXCEPTION 'FAIL local o marca de otra organización: local %, marca % (esperado %, %)',
      v_first.venue_id, v_first.brand_id, v_venue_a, v_brand_a;
  END IF;
  -- La misma respuesta en cada llamada
  FOR v_count IN 1..5 LOOP
    SELECT * INTO v_t FROM public.tenant_for_user();
    IF v_t.org_id IS DISTINCT FROM v_first.org_id OR v_t.venue_id IS DISTINCT FROM v_first.venue_id THEN
      RAISE EXCEPTION 'FAIL tenant_for_user cambió de una llamada a otra: % / %', v_t.org_id, v_t.venue_id;
    END IF;
  END LOOP;
  -- El asistente de alta habla de la misma organización
  SELECT primary_org_id INTO v_uuid FROM public.partner_onboarding_status();
  IF v_uuid IS DISTINCT FROM v_first.org_id THEN
    RAISE EXCEPTION 'FAIL partner_onboarding_status (%) y tenant_for_user (%) no coinciden', v_uuid, v_first.org_id;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 2) Empate de antigüedad entre las dos propias: decide el id
  -- ------------------------------------------------------------------
  UPDATE public.organizations
     SET created_at = (SELECT created_at FROM public.organizations WHERE id = v_org_a)
   WHERE id = v_org_c;
  v_expected := LEAST(v_org_a, v_org_c);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_t FROM public.tenant_for_user();
  IF v_t.org_id IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL con empate esperaba el menor id (%) y llegó %', v_expected, v_t.org_id;
  END IF;
  IF (SELECT v.org_id FROM public.venues v WHERE v.id = v_t.venue_id) IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'FAIL con empate el local % no es de la organización elegida', v_t.venue_id;
  END IF;
  RESET ROLE;
  UPDATE public.organizations SET created_at = now() - INTERVAL '1 day' WHERE id = v_org_c;

  -- ------------------------------------------------------------------
  -- 3) Local activo de la organización elegida: ese local y su marca
  -- ------------------------------------------------------------------
  INSERT INTO public.brands (org_id, slug, name, sort_order)
  VALUES (v_org_a, 'o1s-marca-2-' || substring(v_org_a::text, 1, 8), 'O1S Marca 2', 1)
  RETURNING id INTO v_brand2;
  INSERT INTO public.venues (brand_id, org_id, slug, name, city)
  VALUES (v_brand2, v_org_a, 'sala-2', 'O1S Sala 2', 'Madrid')
  RETURNING id INTO v_venue2;
  UPDATE public.profiles SET last_active_venue_id = v_venue2 WHERE id = v_owner;
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_t FROM public.tenant_for_user();
  IF v_t.org_id IS DISTINCT FROM v_org_a OR v_t.venue_id IS DISTINCT FROM v_venue2
     OR v_t.brand_id IS DISTINCT FROM v_brand2 OR v_t.venue_name <> 'O1S Sala 2' OR v_t.brand_name <> 'O1S Marca 2' THEN
    RAISE EXCEPTION 'FAIL local activo: org %, local % (%), marca % (%)',
      v_t.org_id, v_t.venue_id, v_t.venue_name, v_t.brand_id, v_t.brand_name;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 4) Solo miembro: la organización más antigua, sea cual sea el rol
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_t FROM public.tenant_for_user();
  IF v_t.org_id IS DISTINCT FROM v_org_e OR v_t.role::text <> 'door_staff' THEN
    RAISE EXCEPTION 'FAIL miembro de dos organizaciones: esperaba E como door_staff y llegó % como %', v_t.org_id, v_t.role;
  END IF;
  IF (SELECT v.org_id FROM public.venues v WHERE v.id = v_t.venue_id) IS DISTINCT FROM v_org_e THEN
    RAISE EXCEPTION 'FAIL el local % no es de la organización del miembro', v_t.venue_id;
  END IF;
  RESET ROLE;

  -- Una baja no cuenta: sin E queda D
  UPDATE public.organization_members SET status = 'removed' WHERE org_id = v_org_e AND user_id = v_member;
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_t FROM public.tenant_for_user();
  IF v_t.org_id IS DISTINCT FROM v_org_d OR v_t.role::text <> 'admin' THEN
    RAISE EXCEPTION 'FAIL tras la baja en E esperaba D como admin y llegó % como %', v_t.org_id, v_t.role;
  END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 5) Sin organización: ninguna fila. Permisos.
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_nobody::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.tenant_for_user();
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL sin organización devolvió % filas', v_count; END IF;
  RESET ROLE;

  IF has_function_privilege('anon', 'public.tenant_for_user()', 'execute') THEN
    RAISE EXCEPTION 'FAIL tenant_for_user ejecutable por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.tenant_for_user()', 'execute') THEN
    RAISE EXCEPTION 'FAIL tenant_for_user no ejecutable por authenticated';
  END IF;

  RAISE NOTICE 'PASS o1_servidor: tenant_for_user con la propia primero, la más antigua, desempate por id y local de la organización elegida';
END $$;

ROLLBACK;
