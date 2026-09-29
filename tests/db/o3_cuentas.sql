-- Pasify · Ola 3, cuentas: de cliente a local (B3-01 / B4-07) y alta de local
-- con confirmación de email (B3-16). Migración 20260928140000_o3_cuentas.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260928140000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o3_cuentas.sql','-c','ROLLBACK;'); & psql @a

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

DO $$
DECLARE
  -- Clientes
  v_nuevo      UUID := gen_random_uuid();  -- elegible
  v_antiguo    UUID := gen_random_uuid();  -- 31 días
  v_comprador  UUID := gen_random_uuid();  -- entrada pagada
  v_pagando    UUID := gen_random_uuid();  -- pedido a medio pagar
  v_pedido     UUID := gen_random_uuid();  -- solo el pedido, aún sin entradas
  v_caducado   UUID := gen_random_uuid();  -- solo un pedido caducado: elegible
  v_receptor   UUID := gen_random_uuid();  -- entrada recibida por transferencia
  v_rechazado  UUID := gen_random_uuid();  -- cuenta desactivada
  v_admin      UUID := gen_random_uuid();  -- client + admin
  -- Locales
  v_local      UUID := gen_random_uuid();  -- organizador de los eventos
  v_alta       UUID := gen_random_uuid();  -- alta de local sin confirmar el email
  v_raro       UUID := gen_random_uuid();  -- metadatos que no son un objeto
  v_org        UUID;
  v_event      UUID;
  v_tier       UUID;
  v_order      UUID;
  v_ticket     UUID;
  v_org2       UUID;
  v_json       JSONB;
  v_text       TEXT;
  v_text2      TEXT;
  v_count      INT;
  v_roles      TEXT[];
  v_state      TEXT;
  v_detail     TEXT;
  v_rec        RECORD;
BEGIN
  -- ------------------------------------------------------------------
  -- 0) Usuarios. Los triggers de alta crean perfil y rol
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at, email_confirmed_at)
  VALUES
    (v_nuevo,     'o3-nuevo-'     || v_nuevo     || '@pasify.test', '{"initial_role":"client","first_name":"  Nuria ","last_name":"Nueva","phone":"600 000 001","country":"pt","city":"Sevilla"}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - INTERVAL '2 days', now(), now()),
    (v_antiguo,   'o3-antiguo-'   || v_antiguo   || '@pasify.test', '{"initial_role":"client"}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - INTERVAL '31 days', now(), now()),
    (v_comprador, 'o3-comprador-' || v_comprador || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - INTERVAL '1 day', now(), now()),
    (v_pagando,   'o3-pagando-'   || v_pagando   || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_pedido,    'o3-pedido-'    || v_pedido    || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_caducado,  'o3-caducado-'  || v_caducado  || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_receptor,  'o3-receptor-'  || v_receptor  || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_rechazado, 'o3-rechazado-' || v_rechazado || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_admin,     'o3-admin-'     || v_admin     || '@pasify.test', '{}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    (v_local,     'o3-local-'     || v_local     || '@pasify.test', '{"initial_role":"partner"}',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now()),
    -- Alta de local con «Confirm email»: el usuario existe sin confirmar y sin sesión.
    (v_alta,      'o3-alta-'      || v_alta      || '@pasify.test',
       jsonb_build_object(
         'initial_role', 'partner',
         'business_name', 'Sala Aurora O3',
         'business_category', 'club',
         'business_address', 'Calle Mayor 1',
         'business_country', 'ES',
         'business_city', 'Valencia',
         'business_phone', '+34 600 000 002',
         -- recortes: nombre larguísimo, caracteres de control y un país que no es un código
         'first_name', repeat('x', 500),
         'last_name', E'Apellido\u0007\tCon\ncontrol',
         'country', 'España'),
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), NULL),
    -- Metadatos que no son un objeto: el alta no se corta.
    (v_raro,      'o3-raro-'      || v_raro      || '@pasify.test', '["initial_role","partner"]',
       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now(), now());

  UPDATE public.user_roles SET role = 'admin' WHERE user_id = v_admin;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'client');
  UPDATE public.profiles SET account_status = 'rejected' WHERE id = v_rechazado;

  IF (SELECT count(*) FROM public.profiles WHERE id = v_raro) <> 1
     OR (SELECT array_agg(role::text) FROM public.user_roles WHERE user_id = v_raro) <> ARRAY['client'] THEN
    RAISE EXCEPTION 'FAIL un alta con metadatos raros no creó perfil y rol de cliente';
  END IF;

  -- ------------------------------------------------------------------
  -- 1) Datos del alta en el perfil (trigger), sin sesión
  -- ------------------------------------------------------------------
  SELECT first_name || '|' || last_name || '|' || phone || '|' || country || '|' || city INTO v_text
    FROM public.profiles WHERE id = v_nuevo;
  IF v_text IS DISTINCT FROM 'Nuria|Nueva|600 000 001|PT|Sevilla' THEN
    RAISE EXCEPTION 'FAIL el alta de cliente no dejó sus datos en el perfil: %', v_text;
  END IF;

  SELECT business_name || '|' || business_category || '|' || business_address || '|' || business_country
         || '|' || business_city || '|' || business_phone
    INTO v_text FROM public.profiles WHERE id = v_alta;
  IF v_text IS DISTINCT FROM 'Sala Aurora O3|club|Calle Mayor 1|ES|Valencia|+34 600 000 002' THEN
    RAISE EXCEPTION 'FAIL el alta de local sin confirmar no dejó los datos del negocio: %', v_text;
  END IF;
  -- 'España' no es un código de país: se queda el de por defecto.
  SELECT length(first_name), last_name, country INTO v_count, v_text, v_text2 FROM public.profiles WHERE id = v_alta;
  IF v_count <> 80 OR v_text IS DISTINCT FROM 'ApellidoConcontrol' OR v_text2 IS DISTINCT FROM 'ES' THEN
    RAISE EXCEPTION 'FAIL los metadatos del alta no se recortan: len=% apellido=% país=%', v_count, v_text, v_text2;
  END IF;
  -- El rol sale del alta aunque no haya confirmado el email.
  SELECT array_agg(role::text) INTO v_roles FROM public.user_roles WHERE user_id = v_alta;
  IF v_roles IS DISTINCT FROM ARRAY['partner'] THEN
    RAISE EXCEPTION 'FAIL el alta de local sin confirmar no tiene rol de local: %', v_roles;
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE owner_id = v_alta) THEN
    RAISE EXCEPTION 'FAIL el alta sin sesión ya creó organización';
  END IF;

  -- ------------------------------------------------------------------
  -- 2) complete_partner_signup: tras confirmar y entrar
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_alta);
  SET LOCAL ROLE authenticated;
  v_org := public.complete_partner_signup();
  RESET ROLE;
  SELECT name || '|' || country || '|' || contact_phone || '|' || city || '|' || address || '|' || billing_email || '|' || contact_email
    INTO v_text FROM public.organizations WHERE id = v_org AND owner_id = v_alta;
  IF v_text IS DISTINCT FROM 'Sala Aurora O3|ES|+34 600 000 002|Valencia|Calle Mayor 1|o3-alta-' || v_alta || '@pasify.test|o3-alta-' || v_alta || '@pasify.test' THEN
    RAISE EXCEPTION 'FAIL la organización del alta no lleva los datos del negocio: %', v_text;
  END IF;
  SELECT business_category || '|' || city || '|' || address || '|' || phone || '|' || email INTO v_text
    FROM public.venues WHERE org_id = v_org;
  IF v_text IS DISTINCT FROM 'club|Valencia|Calle Mayor 1|+34 600 000 002|o3-alta-' || v_alta || '@pasify.test' THEN
    RAISE EXCEPTION 'FAIL el local del alta no lleva sus datos: %', v_text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_subscriptions WHERE org_id = v_org AND plan_code = 'free' AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL el alta de local no tiene el plan gratuito';
  END IF;
  -- Idempotente: PartnerGate puede volver a llamarla.
  PERFORM pg_temp.como(v_alta);
  SET LOCAL ROLE authenticated;
  v_org2 := public.complete_partner_signup();
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.organizations WHERE owner_id = v_alta;
  IF v_org2 IS DISTINCT FROM v_org OR v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL complete_partner_signup duplicó la organización (% organizaciones)', v_count;
  END IF;
  -- Con el plan cancelado lo reactiva, como claim_partner_free_plan.
  UPDATE public.partner_subscriptions SET status = 'cancelled' WHERE org_id = v_org;
  PERFORM pg_temp.como(v_alta);
  SET LOCAL ROLE authenticated;
  PERFORM public.complete_partner_signup();
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.partner_subscriptions WHERE org_id = v_org AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL complete_partner_signup no reactivó el plan';
  END IF;

  -- Un local sin datos de negocio: organización con el nombre del email.
  PERFORM pg_temp.como(v_local);
  SET LOCAL ROLE authenticated;
  v_org := public.complete_partner_signup();
  RESET ROLE;
  SELECT name INTO v_text FROM public.organizations WHERE id = v_org;
  IF v_text IS DISTINCT FROM 'o3-local-' || v_local THEN
    RAISE EXCEPTION 'FAIL la organización sin nombre de negocio no usa el email: %', v_text;
  END IF;

  -- Un cliente no tiene organización.
  v_state := NULL;
  PERFORM pg_temp.como(v_nuevo);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.complete_partner_signup();
  EXCEPTION WHEN insufficient_privilege THEN
    v_state := 'bloqueado';
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL un cliente creó una organización'; END IF;

  -- ------------------------------------------------------------------
  -- 3) Compras de los clientes no elegibles
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_local);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_local, v_org, 'O3 Evento', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, transfer_allowed, refundable_until_hours_before)
  VALUES (v_event, 'General', 1000, 50, TRUE, 48)
  RETURNING id INTO v_tier;
  RESET ROLE;

  -- Entrada pagada
  INSERT INTO public.ticket_orders (event_id, org_id, buyer_user_id, buyer_email, status, subtotal_cents, total_cents, paid_at)
  VALUES (v_event, v_org, v_comprador, 'o3-comprador@pasify.test', 'paid', 1000, 1000, now())
  RETURNING id INTO v_order;
  INSERT INTO public.tickets (event_id, tier_id, order_id, buyer_user_id, buyer_email, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_tier, v_order, v_comprador, 'o3-comprador@pasify.test', 'paid', 1000, now())
  RETURNING id INTO v_ticket;
  -- ...que luego se transfiere a otro cliente
  UPDATE public.tickets SET transferred_to_user_id = v_receptor, transferred_at = now() WHERE id = v_ticket;
  -- Pedido a medio pagar (sus entradas, pendientes)
  INSERT INTO public.ticket_orders (event_id, org_id, buyer_user_id, buyer_email, status, subtotal_cents, total_cents, expires_at)
  VALUES (v_event, v_org, v_pagando, 'o3-pagando@pasify.test', 'pending', 1000, 1000, now() + INTERVAL '30 minutes')
  RETURNING id INTO v_order;
  INSERT INTO public.tickets (event_id, tier_id, order_id, buyer_user_id, buyer_email, status, amount_paid_cents)
  VALUES (v_event, v_tier, v_order, v_pagando, 'o3-pagando@pasify.test', 'pending', 1000);
  -- Pedido en curso del que aún no hay entradas
  INSERT INTO public.ticket_orders (event_id, org_id, buyer_user_id, buyer_email, status, subtotal_cents, total_cents, expires_at)
  VALUES (v_event, v_org, v_pedido, 'o3-pedido@pasify.test', 'pending', 1000, 1000, now() + INTERVAL '30 minutes');
  -- Pedido caducado sin pagar (sus entradas, canceladas): no cuenta
  INSERT INTO public.ticket_orders (event_id, org_id, buyer_user_id, buyer_email, status, subtotal_cents, total_cents, expires_at)
  VALUES (v_event, v_org, v_caducado, 'o3-caducado@pasify.test', 'expired', 1000, 1000, now() - INTERVAL '1 hour')
  RETURNING id INTO v_order;
  INSERT INTO public.tickets (event_id, tier_id, order_id, buyer_user_id, buyer_email, status, amount_paid_cents)
  VALUES (v_event, v_tier, v_order, v_caducado, 'o3-caducado@pasify.test', 'cancelled', 1000);

  -- ------------------------------------------------------------------
  -- 4) ¿Quién puede pasar a local? (lo que pregunta Ajustes)
  -- ------------------------------------------------------------------
  FOR v_rec IN
    SELECT * FROM (VALUES
      (v_nuevo,     TRUE,  NULL::TEXT),
      (v_caducado,  TRUE,  NULL),
      (v_antiguo,   FALSE, 'account_too_old'),
      (v_comprador, FALSE, 'has_purchases'),
      (v_pagando,   FALSE, 'has_purchases'),
      (v_pedido,    FALSE, 'has_purchases'),
      (v_receptor,  FALSE, 'has_purchases'),
      (v_rechazado, FALSE, 'account_disabled'),
      (v_admin,     FALSE, 'not_client'),
      (v_alta,      FALSE, 'not_client')
    ) AS t(uid, elegible, motivo)
  LOOP
    PERFORM pg_temp.como(v_rec.uid);
    SET LOCAL ROLE authenticated;
    v_json := public.partner_conversion_status();
    RESET ROLE;
    IF (v_json->>'eligible')::BOOLEAN IS DISTINCT FROM v_rec.elegible OR (v_json->>'reason') IS DISTINCT FROM v_rec.motivo THEN
      RAISE EXCEPTION 'FAIL partner_conversion_status de %: % (esperaba % / %)', v_rec.uid, v_json, v_rec.elegible, v_rec.motivo;
    END IF;
  END LOOP;
  PERFORM pg_temp.como(NULL);
  v_json := public.partner_conversion_status();
  IF (v_json->>'eligible')::BOOLEAN IS NOT FALSE THEN RAISE EXCEPTION 'FAIL sin sesión se puede pasar a local: %', v_json; END IF;

  -- ------------------------------------------------------------------
  -- 5) No elegibles: la conversión se niega y no cambia nada
  -- ------------------------------------------------------------------
  FOR v_rec IN
    SELECT * FROM (VALUES
      (v_antiguo,   'account_too_old', 'client'),
      (v_comprador, 'has_purchases',   'client'),
      (v_pagando,   'has_purchases',   'client'),
      (v_pedido,    'has_purchases',   'client'),
      (v_receptor,  'has_purchases',   'client'),
      (v_rechazado, 'account_disabled','client'),
      (v_admin,     'not_client',      'admin,client'),
      (v_alta,      'not_client',      'partner')
    ) AS t(uid, motivo, roles)
  LOOP
    v_state := NULL;
    v_detail := NULL;
    PERFORM pg_temp.como(v_rec.uid);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.convert_new_client_to_partner('No debería');
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    END;
    RESET ROLE;
    IF v_state IS DISTINCT FROM 'partner_conversion_not_allowed' OR v_detail IS DISTINCT FROM v_rec.motivo THEN
      RAISE EXCEPTION 'FAIL convert_new_client_to_partner de % no se negó con %: % / %', v_rec.uid, v_rec.motivo, v_state, v_detail;
    END IF;
    SELECT string_agg(role::text, ',' ORDER BY role::text) INTO v_text FROM public.user_roles WHERE user_id = v_rec.uid;
    IF v_text IS DISTINCT FROM v_rec.roles THEN
      RAISE EXCEPTION 'FAIL una conversión rechazada cambió los roles de %: %', v_rec.uid, v_text;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE owner_id IN (v_antiguo, v_comprador, v_pagando, v_pedido, v_receptor, v_rechazado, v_admin)) THEN
    RAISE EXCEPTION 'FAIL una conversión rechazada creó organización';
  END IF;

  -- Sin sesión, ni se puede llamar.
  v_state := NULL;
  PERFORM pg_temp.como(NULL);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.convert_new_client_to_partner(NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_state := 'bloqueado';
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL anon puede llamar a convert_new_client_to_partner'; END IF;

  -- ------------------------------------------------------------------
  -- 6) Elegible: pasa a local con organización y plan, como el alta
  -- ------------------------------------------------------------------
  PERFORM pg_temp.como(v_nuevo);
  SET LOCAL ROLE authenticated;
  v_json := public.convert_new_client_to_partner('  Bar Nuria  ');
  -- Ya con su nuevo rol, en la misma sesión
  v_roles := public.get_user_roles(v_nuevo);
  RESET ROLE;
  IF v_roles IS DISTINCT FROM ARRAY['partner'] THEN
    RAISE EXCEPTION 'FAIL tras convertir, los roles son %', v_roles;
  END IF;
  v_org := (v_json->>'org_id')::UUID;
  SELECT name || '|' || country INTO v_text FROM public.organizations WHERE id = v_org AND owner_id = v_nuevo;
  IF v_text IS DISTINCT FROM 'Bar Nuria|PT' THEN
    RAISE EXCEPTION 'FAIL la organización de la conversión: % (%)', v_text, v_json;
  END IF;
  SELECT city INTO v_text FROM public.venues WHERE org_id = v_org;
  IF v_text IS DISTINCT FROM 'Sevilla' THEN RAISE EXCEPTION 'FAIL el local de la conversión no está en su ciudad: %', v_text; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_subscriptions WHERE org_id = v_org AND plan_code = 'free' AND status = 'active') THEN
    RAISE EXCEPTION 'FAIL la conversión no dejó el plan gratuito';
  END IF;
  SELECT business_name || '|' || business_country || '|' || business_city INTO v_text FROM public.profiles WHERE id = v_nuevo;
  IF v_text IS DISTINCT FROM 'Bar Nuria|PT|Sevilla' THEN RAISE EXCEPTION 'FAIL el perfil tras convertir: %', v_text; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE action = 'UPDATE_user_roles' AND actor_user_id = v_nuevo
                    AND after->>'role' = 'partner' AND before->>'role' = 'client') THEN
    RAISE EXCEPTION 'FAIL el cambio de rol no quedó en el registro de actividad';
  END IF;

  -- Ya es local: ni se ofrece ni se repite.
  PERFORM pg_temp.como(v_nuevo);
  SET LOCAL ROLE authenticated;
  v_json := public.partner_conversion_status();
  v_state := NULL;
  BEGIN
    PERFORM public.convert_new_client_to_partner(NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_state := 'bloqueado';
  END;
  RESET ROLE;
  IF (v_json->>'reason') IS DISTINCT FROM 'not_client' OR v_state IS DISTINCT FROM 'bloqueado' OR v_detail IS DISTINCT FROM 'not_client' THEN
    RAISE EXCEPTION 'FAIL un local recién convertido puede volver a convertirse: % / % / %', v_json, v_state, v_detail;
  END IF;
  SELECT count(*) INTO v_count FROM public.organizations WHERE owner_id = v_nuevo;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL la conversión dejó % organizaciones', v_count; END IF;

  -- Sin nombre: la organización se llama como el email (y el wizard la completa).
  PERFORM pg_temp.como(v_caducado);
  SET LOCAL ROLE authenticated;
  v_json := public.convert_new_client_to_partner(NULL);
  RESET ROLE;
  SELECT name INTO v_text FROM public.organizations WHERE id = (v_json->>'org_id')::UUID;
  IF v_text IS DISTINCT FROM 'o3-caducado-' || v_caducado THEN
    RAISE EXCEPTION 'FAIL la organización sin nombre de la conversión: %', v_text;
  END IF;

  -- ------------------------------------------------------------------
  -- 7) Permisos
  -- ------------------------------------------------------------------
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('public.partner_conversion_status()',            'anon',          FALSE),
      ('public.partner_conversion_status()',            'authenticated', TRUE),
      ('public.convert_new_client_to_partner(text)',    'anon',          FALSE),
      ('public.convert_new_client_to_partner(text)',    'authenticated', TRUE),
      ('public.complete_partner_signup()',              'anon',          FALSE),
      ('public.complete_partner_signup()',              'authenticated', TRUE),
      ('public.partner_conversion_blocker(uuid)',       'anon',          FALSE),
      ('public.partner_conversion_blocker(uuid)',       'authenticated', FALSE),
      ('public.handle_new_user_signup_data()',          'anon',          FALSE),
      ('public.handle_new_user_signup_data()',          'authenticated', FALSE),
      ('public.signup_meta_text(text,integer)',         'authenticated', FALSE),
      ('public.signup_meta_country(text)',              'authenticated', FALSE)
    ) AS t(fn, rol, esperado)
  LOOP
    IF has_function_privilege(v_rec.rol, v_rec.fn, 'EXECUTE') IS DISTINCT FROM v_rec.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre %: esperaba %', v_rec.rol, v_rec.fn, v_rec.esperado;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS o3_cuentas: datos del alta en el perfil (con y sin confirmar), organización y plan del local tras entrar, y paso de cliente a local (elegible, antigua, con compras, desactivada y con otro rol)';
END $$;

ROLLBACK;
