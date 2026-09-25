-- Pasify · panel de local, ola 2: lo que el panel da por hecho en la BD.
--
--   * Bandeja de reembolsos (T2): el owner lee las solicitudes de SU
--     organización con el evento y el tipo de entrada (la misma consulta que
--     partnerData.leerReembolsos, con la RLS de cada tabla); el personal de
--     puerta y otra organización no ven nada. refund_requests está en la
--     publicación de Realtime (la bandeja se refresca sola).
--   * Políticas por tipo (T1): el local cambia la transferencia y el plazo de
--     devolución de un tipo YA VENDIDO (solo precio y cupo están protegidos).
--     Si la migración de reembolsos de la Ola 2 ya está (columna con NULL),
--     también "sin devolución (salvo cancelación)" = NULL.
--   * Suspensión (T5): si la migración de checkout de la Ola 2 ya está
--     (organizations.suspended_at), el local lee la columna, publicar se
--     rechaza con un mensaje que writeErrors.ts reconoce y la bandeja de
--     reembolsos sigue funcionando.
-- Lo que depende de otras migraciones de la Ola 2 se salta con un NOTICE si
-- aún no está. Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma transacción):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name;
--   $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;');
--   foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o2_local.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  v_owner   UUID := gen_random_uuid();
  v_door    UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_buyer   UUID := gen_random_uuid();
  v_org     UUID;
  v_org2    UUID;
  v_event   UUID;
  v_draft   UUID;
  v_tier    UUID;
  v_ticket  UUID;
  v_request UUID;
  v_count   INT;
  v_rows    INT;
  v_title   TEXT;
  v_tier_n  TEXT;
  v_text    TEXT;
  v_hours   INT;
  v_allowed BOOLEAN;
  v_nullable BOOLEAN;
  v_suspension BOOLEAN;
  v_ts      TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_owner, 'o2-owner-' || v_owner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_door,  'o2-door-'  || v_door  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_other, 'o2-other-' || v_other || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_buyer, 'o2-buyer-' || v_buyer || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  -- Dos organizaciones, cada una de su owner; una puerta en la primera.
  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org2 := public.create_organization('O2 Otra sala', 'ES', NULL);
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O2 Local', 'ES', NULL);
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_owner, v_org, 'O2 Concierto', 'Madrid', now() + INTERVAL '5 days', now() + INTERVAL '5 days 4 hours', 'published', 2000)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, status, price_cents)
  VALUES (v_owner, v_org, 'O2 Borrador', 'Madrid', now() + INTERVAL '9 days', 'draft', 1000)
  RETURNING id INTO v_draft;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order)
  VALUES (v_event, 'VIP O2', 2000, 50, 4, 0)
  RETURNING id INTO v_tier;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, per_user_max, sort_order)
  VALUES (v_draft, 'General O2', 1000, 100, 4, 0);
  RESET ROLE;

  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_door, 'o2-door-' || v_door || '@pasify.test', 'door_staff', 'active');

  -- Una entrada pagada del tipo VIP y su solicitud de devolución pendiente.
  INSERT INTO public.tickets (event_id, tier_id, buyer_user_id, buyer_email, buyer_first_name, status, amount_paid_cents, paid_at)
  VALUES (v_event, v_tier, v_buyer, 'o2-buyer@pasify.test', 'Berta', 'paid', 2000, now())
  RETURNING id INTO v_ticket;
  INSERT INTO public.refund_requests (ticket_id, event_id, org_id, requester_user_id, requester_email, amount_cents, currency, reason, status)
  VALUES (v_ticket, v_event, v_org, v_buyer, 'o2-buyer@pasify.test', 2000, 'EUR', 'No puedo ir: me operan ese día', 'pending')
  RETURNING id INTO v_request;

  -- ------------------------------------------------------------------
  -- 1) Bandeja de reembolsos con la RLS de cada tabla (T2)
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count
    FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'refund_requests';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL refund_requests no está en Realtime: la bandeja no se refrescaría sola'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Lo mismo que el select embebido de PostgREST: events(...), tickets(ticket_tiers(name)).
  SELECT count(*), max(e.title), max(tt.name) INTO v_count, v_title, v_tier_n
    FROM public.refund_requests r
    LEFT JOIN public.events e ON e.id = r.event_id
    LEFT JOIN public.tickets t ON t.id = r.ticket_id
    LEFT JOIN public.ticket_tiers tt ON tt.id = t.tier_id
   WHERE r.org_id = v_org AND r.status = 'pending';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL el owner ve % solicitudes pendientes (esperada 1)', v_count; END IF;
  IF v_title IS DISTINCT FROM 'O2 Concierto' THEN RAISE EXCEPTION 'FAIL la bandeja no ve el evento: %', v_title; END IF;
  IF v_tier_n IS DISTINCT FROM 'VIP O2' THEN RAISE EXCEPTION 'FAIL la bandeja no ve el tipo de entrada: %', v_tier_n; END IF;
  -- La decisión va por decide-refund (service role): el local no escribe la solicitud.
  UPDATE public.refund_requests SET status = 'approved' WHERE id = v_request;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL el local cambia el estado de una solicitud sin decide-refund'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_door::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_door, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.refund_requests WHERE org_id = v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL la puerta ve % solicitudes de reembolso', v_count; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.refund_requests WHERE org_id = v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL otra organización ve % solicitudes', v_count; END IF;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- 2) Políticas de un tipo ya vendido (T1)
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.ticket_tiers SET transfer_allowed = false, refundable_until_hours_before = 48 WHERE id = v_tier;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL el local no puede cambiar las políticas de un tipo vendido'; END IF;
  SELECT refundable_until_hours_before, transfer_allowed INTO v_hours, v_allowed FROM public.ticket_tiers WHERE id = v_tier;
  IF v_hours IS DISTINCT FROM 48 OR v_allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL las políticas no se han guardado: % h, transferible %', v_hours, v_allowed;
  END IF;
  RESET ROLE;

  SELECT is_nullable = 'YES' INTO v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'ticket_tiers' AND column_name = 'refundable_until_hours_before';
  IF v_nullable THEN
    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.ticket_tiers SET refundable_until_hours_before = NULL WHERE id = v_tier;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL "sin devolución" (NULL) no se guarda en un tipo vendido'; END IF;
    INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, sort_order, refundable_until_hours_before, transfer_allowed)
    VALUES (v_event, 'Sin devolución O2', 1500, 10, 1, NULL, false);
    -- Un tipo creado sin decir nada queda "sin devolución (salvo cancelación)".
    INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity, sort_order)
    VALUES (v_event, 'Por defecto O2', 1500, 10, 2);
    SELECT refundable_until_hours_before INTO v_hours FROM public.ticket_tiers WHERE event_id = v_event AND name = 'Por defecto O2';
    IF v_hours IS NOT NULL THEN RAISE EXCEPTION 'FAIL un tipo nuevo nace con devolución hasta % h (esperado NULL)', v_hours; END IF;
    RESET ROLE;
  ELSE
    RAISE NOTICE 'SKIP o2_local: refundable_until_hours_before aún es NOT NULL (falta la migración de reembolsos de la Ola 2)';
  END IF;

  -- ------------------------------------------------------------------
  -- 3) Organización suspendida (T5)
  -- ------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'suspended_at'
  ) INTO v_suspension;
  IF v_suspension THEN
    EXECUTE 'UPDATE public.organizations SET suspended_at = now() WHERE id = $1' USING v_org;

    PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- El panel la lee con su propia consulta (usePartnerContext.leerSuspension).
    BEGIN
      EXECUTE 'SELECT suspended_at FROM public.organizations WHERE id = $1' INTO v_ts USING v_org;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'FAIL el local no puede leer organizations.suspended_at: %', SQLERRM;
    END;
    IF v_ts IS NULL THEN RAISE EXCEPTION 'FAIL el local no ve su suspensión'; END IF;

    -- Publicar se rechaza, con un motivo que writeErrors.ts traduce a
    -- «Tu cuenta está suspendida…» (SUSPENDED_RE).
    v_text := NULL;
    BEGIN
      UPDATE public.events SET status = 'published' WHERE id = v_draft;
    EXCEPTION WHEN OTHERS THEN
      v_text := SQLERRM;
    END;
    IF v_text IS NULL THEN
      RAISE EXCEPTION 'FAIL con la organización suspendida se puede publicar un evento';
    END IF;
    IF v_text !~* '(suspend|suspensi[oó]n|cannot_sell|no puede vender)' THEN
      RAISE EXCEPTION 'FAIL el motivo del rechazo no lo reconoce writeErrors.ts (SUSPENDED_RE): %', v_text;
    END IF;

    -- La bandeja de reembolsos sigue funcionando.
    SELECT count(*) INTO v_count FROM public.refund_requests WHERE org_id = v_org AND status = 'pending';
    IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL con la suspensión la bandeja ve % pendientes', v_count; END IF;
    RESET ROLE;
  ELSE
    RAISE NOTICE 'SKIP o2_local: organizations.suspended_at aún no existe (falta la migración de checkout de la Ola 2)';
  END IF;

  RAISE NOTICE 'PASS o2_local: bandeja de reembolsos con RLS y Realtime, políticas de un tipo vendido y suspensión (si está)';
END $$;

ROLLBACK;
