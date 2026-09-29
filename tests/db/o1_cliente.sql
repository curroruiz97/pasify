-- Pasify · app del cliente, ola 1: flag de las pantallas demo (D-7) y lo que
-- la cartera necesita leer para enseñar estados reales (B1-09): entradas
-- reembolsadas y eventos cancelados. Favoritos de eventos sin duplicados
-- (B2-12). Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con la migración 20260926120000 aplicada en la misma transacción; si
-- la BD aún no tiene 20260925110200, que arregla el trigger de auditoría de
-- feature_flags, va delante con la 20260925110100):
--   psql … -v ON_ERROR_STOP=1 -c "BEGIN;" -f supabase/migrations/20260925110100_live_payments_guard.sql -f supabase/migrations/20260925110200_permissions_hardening.sql -f supabase/migrations/20260926120000_o1_cliente_client_showcase.sql -f tests/db/o1_cliente.sql -c "ROLLBACK;"

BEGIN;

DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_client  UUID := gen_random_uuid();
  v_demo    UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_cancel  UUID;
  v_tier    UUID;
  v_valid   UUID;
  v_refund  UUID;
  v_orphan  UUID;
  v_count   INT;
  v_text    TEXT;
  v_json    JSONB;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_partner, 'o1c-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_client,  'o1c-client-'  || v_client  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_demo,    'o1c-demo-'    || v_demo    || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,   'o1c-admin-'   || v_admin   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin') ON CONFLICT DO NOTHING;

  -- ------------------------------------------------------------------
  -- 1) Flag client_showcase: existe, apagado y sin excepciones
  -- ------------------------------------------------------------------
  SELECT jsonb_build_object('enabled', enabled, 'rollout', rollout_pct, 'overrides', tenant_overrides)
    INTO v_json FROM public.feature_flags WHERE code = 'client_showcase';
  IF v_json IS NULL THEN RAISE EXCEPTION 'FAIL no existe el flag client_showcase'; END IF;
  IF (v_json->>'enabled')::boolean OR (v_json->>'rollout')::numeric <> 0 OR v_json->'overrides' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL client_showcase no nace apagado: %', v_json;
  END IF;

  -- Un cliente cualquiera pregunta por sí mismo: no
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.get_feature_flag('client_showcase', v_client) THEN
    RAISE EXCEPTION 'FAIL client_showcase activo para un cliente normal';
  END IF;
  IF public.get_feature_flag('client_showcase', NULL) THEN
    RAISE EXCEPTION 'FAIL client_showcase activo sin usuario';
  END IF;
  -- ...y no puede encendérselo: solo un admin escribe feature_flags
  UPDATE public.feature_flags
     SET tenant_overrides = tenant_overrides || jsonb_build_object(v_client::text, true)
   WHERE code = 'client_showcase';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL un cliente ha podido tocar client_showcase'; END IF;
  RESET ROLE;
  IF (SELECT tenant_overrides FROM public.feature_flags WHERE code = 'client_showcase') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL client_showcase cambió tras el intento de un cliente';
  END IF;

  -- Un admin da de alta la cuenta de demo (clave = id del usuario)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.feature_flags
     SET tenant_overrides = tenant_overrides || jsonb_build_object(v_demo::text, true)
   WHERE code = 'client_showcase';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el admin no pudo activar la cuenta de demo'; END IF;
  RESET ROLE;

  -- La cuenta de demo sí; el resto sigue sin ver nada
  PERFORM set_config('request.jwt.claim.sub', v_demo::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT public.get_feature_flag('client_showcase', v_demo) THEN
    RAISE EXCEPTION 'FAIL la cuenta de demo no ve client_showcase';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF public.get_feature_flag('client_showcase', v_client) THEN
    RAISE EXCEPTION 'FAIL el override de la demo alcanza a otro cliente';
  END IF;
  RESET ROLE;
  -- El flag del panel de local no se ha tocado
  IF (SELECT tenant_overrides ? v_demo::text FROM public.feature_flags WHERE code = 'partner_showcase') THEN
    RAISE EXCEPTION 'FAIL partner_showcase recibió la cuenta de demo del cliente';
  END IF;

  -- ------------------------------------------------------------------
  -- 2) Cartera: la entrada reembolsada y el evento cancelado se leen (B1-09)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O1C Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1C Evento', 'Madrid', now() + INTERVAL '2 days', now() + INTERVAL '2 days 6 hours', 'published', 1000)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O1C Evento que se cancela', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 1000)
  RETURNING id INTO v_cancel;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, 'General', 1000, 10) RETURNING id INTO v_tier;
  RESET ROLE;

  -- Entradas del cliente (sin pasar por Stripe: solo importa lo que lee la cartera)
  INSERT INTO public.tickets (event_id, tier_id, buyer_user_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_tier, v_client, 'o1c-client@pasify.test', 'Clara', 'paid', 1000, now())
  RETURNING id INTO v_valid;
  INSERT INTO public.tickets (event_id, tier_id, buyer_user_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_tier, v_client, 'o1c-client@pasify.test', 'Clara', 'refunded', 1000, now() - INTERVAL '1 day')
  RETURNING id INTO v_refund;
  INSERT INTO public.tickets (event_id, buyer_user_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_cancel, v_client, 'o1c-client@pasify.test', 'Clara', 'paid', 1000, now())
  RETURNING id INTO v_orphan;
  -- El local cancela el evento (estado final; el reembolso va aparte)
  UPDATE public.events SET status = 'cancelled' WHERE id = v_cancel;

  PERFORM set_config('request.jwt.claim.sub', v_client::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Misma consulta que la cartera (clientData.ts: paid, used y refunded)
  SELECT count(*) INTO v_count FROM public.tickets
   WHERE (buyer_user_id = v_client OR transferred_to_user_id = v_client)
     AND status IN ('paid', 'used', 'refunded');
  IF v_count <> 3 THEN RAISE EXCEPTION 'FAIL la cartera ve % entradas (esperadas 3, con la reembolsada)', v_count; END IF;
  SELECT status::text INTO v_text FROM public.tickets WHERE id = v_refund;
  IF v_text IS DISTINCT FROM 'refunded' THEN RAISE EXCEPTION 'FAIL el titular no ve su entrada reembolsada: %', v_text; END IF;
  -- El evento cancelado se lee con su estado y su hora de fin (events_ticket_holder_read)
  SELECT status::text INTO v_text FROM public.events WHERE id = v_cancel AND date_end IS NOT NULL;
  IF v_text IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'FAIL el titular no ve que su evento está cancelado: %', v_text; END IF;
  -- Favoritos de eventos: un doble toque no duplica (upsert con ignoreDuplicates)
  INSERT INTO public.favorites_v2 (user_id, event_id) VALUES (v_client, v_event) ON CONFLICT (user_id, event_id) DO NOTHING;
  INSERT INTO public.favorites_v2 (user_id, event_id) VALUES (v_client, v_event) ON CONFLICT (user_id, event_id) DO NOTHING;
  SELECT count(*) INTO v_count FROM public.favorites_v2 WHERE user_id = v_client AND event_id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el favorito se duplicó: %', v_count; END IF;
  -- ...y nadie guarda favoritos a nombre de otro
  v_text := NULL;
  BEGIN
    INSERT INTO public.favorites_v2 (user_id, event_id) VALUES (v_demo, v_event);
  EXCEPTION WHEN insufficient_privilege THEN
    v_text := 'bloqueado';
  END;
  IF v_text IS DISTINCT FROM 'bloqueado' THEN RAISE EXCEPTION 'FAIL un cliente guardó un favorito a nombre de otro'; END IF;
  RESET ROLE;

  -- Otro cliente no ve ni las entradas ni el evento cancelado
  PERFORM set_config('request.jwt.claim.sub', v_demo::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.tickets WHERE id IN (v_valid, v_refund, v_orphan);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve % entradas ajenas', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.events WHERE id = v_cancel;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otro cliente ve el evento cancelado ajeno'; END IF;
  RESET ROLE;

  RAISE NOTICE 'PASS o1_cliente: client_showcase por usuario (solo admin lo activa), cartera con reembolsadas y cancelados, favoritos sin duplicados';
END $$;

ROLLBACK;
