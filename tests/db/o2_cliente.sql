-- Pasify · app del cliente, ola 2: locales favoritos (B2-03), la ciudad del
-- perfil (B2-10) y lo que la cartera necesita leer para sus acciones
-- (reenviar el email, enviar a un amigo y pedir la devolución).
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260927120000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o2_cliente.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_pending UUID := gen_random_uuid();
  v_client  UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_tier    UUID;
  v_order   UUID;
  v_ticket  UUID;
  v_count   INT;
  v_text    TEXT;
  v_bool    BOOLEAN;
  v_int     INT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o2c-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_pending, 'o2c-pending-' || v_pending || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o2c-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other,   'o2c-other-'   || v_other   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- Local público (aprobado y con nombre): sale en public_partners.
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O2C Local', 'ES', NULL);
  UPDATE public.profiles SET business_name = 'O2C Local', city = 'Madrid' WHERE id = v_partner;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O2C Evento', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, transfer_allowed, refundable_until_hours_before)
  VALUES (v_event, 'General', 1000, 10, FALSE, 48)
  RETURNING id INTO v_tier;
  RESET ROLE;
  -- El otro "local" no tiene nombre: no es público.
  SELECT count(*) INTO v_count FROM public.public_partners WHERE id IN (v_partner, v_pending);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL public_partners no tiene solo al local con nombre: %', v_count; END IF;

  -- ------------------------------------------------------------------
  -- 1) Locales favoritos (B2-03)
  -- ------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'partner_favorites' AND column_name = 'partner_id') THEN
    RAISE EXCEPTION 'FAIL partner_favorites sin partner_id';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.partner_favorites'::regclass
               AND polname IN ('partner_favorites_self_all', 'partner_favorites_admin_all')) THEN
    RAISE EXCEPTION 'FAIL siguen las políticas antiguas de partner_favorites';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Guardar el local con el id de public_partners (antes: 23503 siempre)
  INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_partner);
  -- Doble toque: el upsert de la app (ON CONFLICT DO NOTHING) no duplica ni falla
  INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_partner)
    ON CONFLICT (user_id, partner_id) DO NOTHING;
  SELECT count(*) INTO v_count FROM public.partner_favorites WHERE user_id = v_client AND partner_id = v_partner;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el local favorito se duplicó: %', v_count; END IF;
  -- ...y un INSERT a secas choca con el índice único
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_partner);
  EXCEPTION WHEN unique_violation THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL partner_favorites admite duplicados'; END IF;

  -- La lista que lee la app: id del local y nombre de public_partners
  SELECT pp.business_name INTO v_text
    FROM public.partner_favorites f JOIN public.public_partners pp ON pp.id = f.partner_id
   WHERE f.user_id = v_client;
  IF v_text IS DISTINCT FROM 'O2C Local' THEN RAISE EXCEPTION 'FAIL el favorito no resuelve el local: %', v_text; END IF;

  -- Nada a nombre de otro, ni perfiles que no son locales públicos
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_other, v_partner);
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL un cliente guardó un local a nombre de otro'; END IF;
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_pending);
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL se guardó como favorito un local que no es público'; END IF;
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_other);
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL se guardó como favorito el perfil de un cliente'; END IF;
  -- Como antes (solo org_id): ya no entra
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, org_id) VALUES (v_client, v_org);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL se guardó un favorito sin local'; END IF;

  -- Sin UPDATE: se guarda o se quita
  UPDATE public.partner_favorites SET created_at = now() - INTERVAL '1 day' WHERE user_id = v_client;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL se pudo modificar un favorito'; END IF;
  RESET ROLE;

  -- Otro cliente no ve ni quita los favoritos ajenos
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.partner_favorites WHERE user_id = v_client;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve % favoritos ajenos', v_count; END IF;
  DELETE FROM public.partner_favorites WHERE user_id = v_client;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente borró favoritos ajenos'; END IF;
  RESET ROLE;

  -- Sin sesión, nada
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.partner_favorites;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL anon ve % locales favoritos', v_count; END IF;
  v_text := NULL;
  BEGIN
    INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_partner);
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL anon guardó un local favorito'; END IF;
  RESET ROLE;

  -- Quitarlo
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.partner_favorites WHERE user_id = v_client AND partner_id = v_partner;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL no se pudo quitar el local de favoritos'; END IF;
  -- (vuelve a guardarlo para comprobar el borrado en cascada)
  INSERT INTO public.partner_favorites (user_id, partner_id) VALUES (v_client, v_partner);
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 2) Ciudad del perfil (B2-10): el cliente la cambia o la deja vacía
  --    («Toda España»), solo la suya
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.profiles SET city = 'Sevilla' WHERE id = v_client;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el cliente no puede cambiar su ciudad'; END IF;
  SELECT city INTO v_text FROM public.profiles WHERE id = v_client;
  IF v_text IS DISTINCT FROM 'Sevilla' THEN RAISE EXCEPTION 'FAIL la ciudad no se guardó: %', v_text; END IF;
  UPDATE public.profiles SET city = NULL WHERE id = v_client;
  SELECT city INTO v_text FROM public.profiles WHERE id = v_client;
  IF v_text IS NOT NULL THEN RAISE EXCEPTION 'FAIL «Toda España» no deja la ciudad vacía: %', v_text; END IF;
  UPDATE public.profiles SET city = 'Cádiz' WHERE id = v_other;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un cliente cambió la ciudad de otro'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 3) Cartera: lo que leen las acciones de cada entrada
  -- ------------------------------------------------------------------
  INSERT INTO public.ticket_orders (event_id, org_id, buyer_user_id, buyer_email, status, subtotal_cents, total_cents, paid_at)
  VALUES (v_event, v_org, v_client, 'o2c-client@pasify.test', 'paid', 1000, 1000, now())
  RETURNING id INTO v_order;
  INSERT INTO public.tickets (event_id, tier_id, order_id, buyer_user_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_tier, v_order, v_client, 'o2c-client@pasify.test', 'Clara', 'paid', 1000, now())
  RETURNING id INTO v_ticket;
  -- El tipo deja de venderse: el titular sigue leyendo su política
  UPDATE public.ticket_tiers SET status = 'closed' WHERE id = v_tier;
  -- Transferencia pendiente de esta entrada (la crea el servidor)
  INSERT INTO public.ticket_transfers (ticket_id, from_user_id, to_email, message)
  VALUES (v_ticket, v_client, 'amigo-o2c@pasify.test', 'Para ti');

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Pedido de la entrada («Reenviar email» manda { order_id })
  SELECT order_id::text INTO v_text FROM public.tickets WHERE id = v_ticket;
  IF v_text IS DISTINCT FROM v_order::text THEN RAISE EXCEPTION 'FAIL la cartera no lee el pedido de la entrada: %', v_text; END IF;
  -- Política del tipo («Enviar a un amigo» y «Solicitar reembolso»)
  SELECT transfer_allowed, refundable_until_hours_before INTO v_bool, v_int FROM public.ticket_tiers WHERE id = v_tier;
  IF v_bool IS DISTINCT FROM FALSE OR v_int IS DISTINCT FROM 48 THEN
    RAISE EXCEPTION 'FAIL el titular no lee la política de su tipo: transfer=% horas=%', v_bool, v_int;
  END IF;
  -- «Transferencia pendiente»: la lee quien la envía (sin el email del amigo)
  SELECT count(*) INTO v_count FROM public.ticket_transfers
   WHERE from_user_id = v_client AND ticket_id = v_ticket AND status = 'pending' AND expires_at > now();
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL quien envía no ve su transferencia pendiente: %', v_count; END IF;
  -- La solicitud de devolución solo pasa por la RPC
  v_text := NULL;
  BEGIN
    INSERT INTO public.refund_requests (ticket_id, event_id, requester_user_id, requester_email, amount_cents, reason)
    VALUES (v_ticket, v_event, v_client, 'o2c-client@pasify.test', 1000, 'directo');
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL se creó una solicitud de devolución sin la RPC'; END IF;
  RESET ROLE;

  -- Otro cliente no ve ni la entrada, ni su tipo cerrado, ni la transferencia
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.tickets WHERE id = v_ticket;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve la entrada ajena'; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_tiers WHERE id = v_tier;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve el tipo cerrado ajeno'; END IF;
  SELECT count(*) INTO v_count FROM public.ticket_transfers WHERE ticket_id = v_ticket;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve la transferencia ajena'; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 4) Si se borra la cuenta del local, sus favoritos se van con ella
  -- ------------------------------------------------------------------
  DELETE FROM public.ticket_transfers WHERE ticket_id = v_ticket;
  DELETE FROM public.tickets WHERE id = v_ticket;
  DELETE FROM public.ticket_orders WHERE id = v_order;
  DELETE FROM public.events WHERE partner_id = v_partner;
  DELETE FROM public.profiles WHERE id = v_partner;
  SELECT count(*) INTO v_count FROM public.partner_favorites WHERE partner_id = v_partner;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL quedan % favoritos de un local borrado', v_count; END IF;

  RAISE NOTICE 'PASS o2_cliente: locales favoritos (solo los suyos, sin duplicados, solo locales públicos), ciudad del perfil editable y lo que leen las acciones de la cartera';
END $$;

ROLLBACK;
