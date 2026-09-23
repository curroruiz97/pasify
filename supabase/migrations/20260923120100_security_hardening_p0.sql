-- Pasify · hardening P0 del panel de local (auditoría 2026-09-23)
--
-- Cierra lo que se podía explotar llamando directamente a la API, sin pasar
-- por la interfaz:
--   A7-1  mark_order_paid / mark_refund_processed los ejecutaba cualquier
--         usuario con sesión: entradas "pagadas" sin pagar.
--   A7-2  transfer_ticket / request_refund comparaban con `<>` contra un
--         transferred_to_user_id NULL: el control de propiedad no saltaba y
--         cualquiera se quedaba la entrada de otro.
--   A7-3  la fila completa de profiles de los locales (email, teléfono, IDs de
--         Stripe) era legible sin sesión.
--   A7-4  cashless_topup / cashless_pay sin control: saldo gratis.
--   A7-6  enqueue_notification aceptaba cualquier destinatario.
--   A7-7  loyalty_grant_points permitía darse puntos a uno mismo.
--   A7-8  el propio usuario podía escribir account_status y las columnas de
--         Stripe; una revocación del admin se deshacía desde el cliente.
--   A7-9  un local podía mover su evento a otra organización.
--   A7-10 scan_ticket devolvía nombre y email del comprador en 'forbidden'.
--   A5-2  apply_pricing_proposal no comprobaba que el tipo de entrada fuera
--         del evento de la propuesta.
--   A4-6  el portero podía cambiar cualquier columna de una entrada y leía el
--         qr_token de todos los asistentes.
-- Además aplica decisiones de producto de la misma pasada: el alta de local
-- la aprueba el servidor y todos los locales tienen el plan gratuito.

-- ============================================================================
-- 1) RPC de servicio: solo service_role (edge functions con clave de servicio)
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname IN ('mark_order_paid', 'mark_refund_processed', 'loyalty_grant_points',
                         'enqueue_notification', 'cashless_topup', 'cashless_pay', 'mark_ticket_used')
           OR p.proname LIKE 'cron\_%')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ============================================================================
-- 2) Titular actual de una entrada: comprador si no se ha transferido; si se
--    transfirió, solo quien la recibió. El comprador original deja de ver el
--    QR nuevo tras una transferencia.
-- ============================================================================
DROP POLICY IF EXISTS "tickets_buyer_read_own" ON public.tickets;
CREATE POLICY "tickets_buyer_read_own" ON public.tickets FOR SELECT TO authenticated
  USING (
    (transferred_to_user_id IS NULL AND buyer_user_id = (SELECT auth.uid()))
    OR transferred_to_user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "refund_requests_requester_insert" ON public.refund_requests;
CREATE POLICY "refund_requests_requester_insert" ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (
    requester_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = refund_requests.ticket_id
        AND t.status = 'paid'
        AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "ticket_transfers_from_insert" ON public.ticket_transfers;
CREATE POLICY "ticket_transfers_from_insert" ON public.ticket_transfers FOR INSERT TO authenticated
  WITH CHECK (
    from_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_transfers.ticket_id
        AND t.status = 'paid'
        AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.transfer_ticket(_ticket_id UUID, _to_email TEXT, _message TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_to_user UUID;
  v_transfer_id UUID;
  v_tier_allowed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket no encontrado'; END IF;
  -- IS DISTINCT FROM: con `<>` un NULL hacía que la comprobación no saltara.
  IF COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'No eres el titular de esta entrada';
  END IF;
  IF v_ticket.status <> 'paid' THEN RAISE EXCEPTION 'El ticket no está disponible para transferir (status=%)', v_ticket.status; END IF;
  IF v_ticket.used_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket ya escaneado'; END IF;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT transfer_allowed INTO v_tier_allowed FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
    IF NOT COALESCE(v_tier_allowed, TRUE) THEN RAISE EXCEPTION 'Este tipo de entrada no permite transferencia'; END IF;
  END IF;
  SELECT id INTO v_to_user FROM public.profiles WHERE lower(email) = lower(_to_email);
  INSERT INTO public.ticket_transfers (ticket_id, from_user_id, to_email, to_user_id, message)
  VALUES (_ticket_id, v_uid, lower(trim(_to_email)), v_to_user, _message) RETURNING id INTO v_transfer_id;
  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_refund(_ticket_id UUID, _reason TEXT, _reason_code TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier public.ticket_tiers%ROWTYPE;
  v_request_id UUID;
  v_email TEXT;
  v_auto_approve BOOLEAN := FALSE;
  v_auto_reason TEXT;
  v_hours_to_event NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket no encontrado'; END IF;
  IF COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'No eres el titular de esta entrada';
  END IF;
  IF v_ticket.status <> 'paid' THEN RAISE EXCEPTION 'Solo tickets pagados (status=%)', v_ticket.status; END IF;
  IF v_ticket.used_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket ya escaneado'; END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE ticket_id = _ticket_id AND status NOT IN ('rejected','failed')) THEN
    RAISE EXCEPTION 'Ya existe solicitud';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
    v_hours_to_event := EXTRACT(EPOCH FROM (v_event.date_start - now())) / 3600.0;
    IF v_hours_to_event > v_tier.refundable_until_hours_before THEN
      v_auto_approve := TRUE;
      v_auto_reason := format('within_policy_t-%sh', v_tier.refundable_until_hours_before);
    END IF;
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents, currency, reason, reason_code, status, auto_approved, auto_approve_reason, decided_at, decided_by)
  VALUES (_ticket_id, v_ticket.order_id, v_ticket.event_id, v_event.org_id, v_uid, v_email, v_ticket.amount_paid_cents, v_ticket.currency, _reason, _reason_code,
    CASE WHEN v_auto_approve THEN 'approved'::public.refund_request_status_t ELSE 'pending'::public.refund_request_status_t END,
    v_auto_approve, v_auto_reason,
    CASE WHEN v_auto_approve THEN now() ELSE NULL END,
    CASE WHEN v_auto_approve THEN v_uid ELSE NULL END)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;

-- Aceptar una transferencia: el QR y el enlace público se regeneran (el QR
-- viejo deja de valer) y el titular pasa a ser quien la recibe, que es lo que
-- ve el portero.
CREATE OR REPLACE FUNCTION public.accept_ticket_transfer(_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_first TEXT;
  v_last TEXT;
  v_transfer public.ticket_transfers%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Email verificado de auth.users, no el de profiles.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT p.first_name, p.last_name INTO v_first, v_last FROM public.profiles p WHERE p.id = v_uid;
  SELECT * INTO v_transfer FROM public.ticket_transfers
    WHERE invitation_token = _token AND status = 'pending' AND expires_at > now() AND lower(to_email) = lower(v_email)
    FOR UPDATE;
  IF v_transfer.id IS NULL THEN RAISE EXCEPTION 'Transferencia no válida o caducada'; END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_transfer.ticket_id FOR UPDATE;
  IF v_ticket.status <> 'paid' OR v_ticket.used_at IS NOT NULL
     OR COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_transfer.from_user_id THEN
    UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now() WHERE id = v_transfer.id;
    RAISE EXCEPTION 'Esta entrada ya no se puede transferir';
  END IF;

  UPDATE public.ticket_transfers SET status = 'accepted', to_user_id = v_uid, responded_at = now() WHERE id = v_transfer.id;
  UPDATE public.tickets
     SET transferred_to_user_id = v_uid,
         transferred_at = now(),
         holder_first_name = v_first,
         holder_last_name = v_last,
         holder_email = v_email,
         qr_token = gen_random_uuid(),
         access_url_token = gen_random_uuid()
   WHERE id = v_transfer.ticket_id;
  UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now()
   WHERE ticket_id = v_transfer.ticket_id AND status = 'pending' AND id <> v_transfer.id;
  RETURN v_transfer.ticket_id;
END;
$$;

-- ============================================================================
-- 3) Perfil público de los locales: solo columnas públicas
-- ============================================================================
-- La vista public_partners es security_invoker, así que dependía de una
-- policy que daba la FILA ENTERA de profiles a anon. Ahora la proyección la
-- hace una función definer con solo columnas públicas y la policy desaparece.
CREATE OR REPLACE FUNCTION public.public_partner_rows()
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  business_category TEXT,
  business_description TEXT,
  city TEXT,
  avatar_url TEXT,
  cover_image_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.business_name, p.business_category, p.business_description, p.city, p.avatar_url, p.cover_image_url
  FROM public.profiles p
  WHERE p.account_status = 'approved'
    AND p.business_name IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'partner');
$$;

REVOKE EXECUTE ON FUNCTION public.public_partner_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_partner_rows() TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_partners
WITH (security_invoker = true)
AS
SELECT id, business_name, business_category, business_description, city, avatar_url, cover_image_url
FROM public.public_partner_rows();

GRANT SELECT ON public.public_partners TO anon, authenticated;

DROP POLICY IF EXISTS "profiles_public_partner_read" ON public.profiles;

-- ============================================================================
-- 4) Columnas que el propio usuario no puede tocar
-- ============================================================================
-- Silencioso a propósito (se conserva el valor anterior en vez de fallar): las
-- versiones de la app ya instaladas escriben account_status al registrarse y
-- no deben romperse. Las RPC SECURITY DEFINER y service_role pasan porque se
-- ejecutan con otro rol.
CREATE OR REPLACE FUNCTION public.profiles_protect_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    NEW.email := OLD.email;
    NEW.account_status := OLD.account_status;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.stripe_connect_account_id := OLD.stripe_connect_account_id;
    NEW.stripe_connect_onboarded := OLD.stripe_connect_onboarded;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_current_period_end := OLD.subscription_current_period_end;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_columns ON public.profiles;
CREATE TRIGGER trg_profiles_protect_columns BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_columns();

CREATE OR REPLACE FUNCTION public.organizations_protect_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    NEW.owner_id := OLD.owner_id;
    NEW.status := OLD.status;
    NEW.tier := OLD.tier;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.stripe_connect_account_id := OLD.stripe_connect_account_id;
    NEW.stripe_connect_onboarded := OLD.stripe_connect_onboarded;
    NEW.stripe_connect_charges_enabled := OLD.stripe_connect_charges_enabled;
    NEW.stripe_connect_payouts_enabled := OLD.stripe_connect_payouts_enabled;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_plan_code := OLD.subscription_plan_code;
    NEW.subscription_current_period_end := OLD.subscription_current_period_end;
    NEW.trial_ends_at := OLD.trial_ends_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_protect_columns ON public.organizations;
CREATE TRIGGER trg_organizations_protect_columns BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_protect_columns();

-- ============================================================================
-- 5) Eventos: tenant inamovible desde el cliente y publicar solo si el local
--    está activo. Nombre con zz para ejecutarse después de trg_events_set_org_chain.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.events_guard_tenant_and_publish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_publishing BOOLEAN := FALSE;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'published' THEN
    IF TG_OP = 'INSERT' THEN
      v_publishing := TRUE;
    ELSE
      v_publishing := OLD.status IS DISTINCT FROM 'published';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
      RAISE EXCEPTION 'No se puede cambiar el local propietario de un evento' USING ERRCODE = '42501';
    END IF;
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      IF NEW.org_id IS NULL
         OR NOT public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
         OR (OLD.org_id IS NOT NULL AND NOT public.has_org_role(OLD.org_id, ARRAY['owner','admin']::public.org_member_role_t[])) THEN
        RAISE EXCEPTION 'No puedes mover el evento a esa organización' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF NEW.org_id IS NOT NULL
        AND NOT public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'No perteneces a esa organización' USING ERRCODE = '42501';
  END IF;

  IF v_publishing THEN
    IF NEW.org_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.org_id AND o.status <> 'active') THEN
      RAISE EXCEPTION 'La organización del evento no está activa' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (public.has_role(v_uid, 'partner'::public.app_role)
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.account_status = 'approved'))
      OR (NEW.org_id IS NOT NULL
          AND public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    ) THEN
      RAISE EXCEPTION 'Tu cuenta de local no está activa: no puedes publicar eventos' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_events_guard ON public.events;
CREATE TRIGGER trg_zz_events_guard BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_guard_tenant_and_publish();

-- Los compradores pueden leer el evento de sus entradas aunque ya no esté
-- publicado (cancelado, borrador tras despublicar…), para no perder título y
-- fecha en su cartera. La comprobación va en una función definer: una
-- subconsulta directa a tickets desde una policy de events entra en
-- recursión infinita (las policies de tickets consultan events).
CREATE OR REPLACE FUNCTION public.holds_ticket_for_event(_event_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.event_id = _event_id
      AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.holds_ticket_for_event(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.holds_ticket_for_event(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "events_ticket_holder_read" ON public.events;
CREATE POLICY "events_ticket_holder_read" ON public.events FOR SELECT TO authenticated
  USING (status IN ('draft', 'cancelled') AND public.holds_ticket_for_event(id));

-- Y el tipo de sus entradas aunque ya no esté activo (si no, la cartera no
-- puede decir qué entrada es).
CREATE OR REPLACE FUNCTION public.holds_ticket_for_tier(_tier_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.tier_id = _tier_id
      AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) = (SELECT auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.holds_ticket_for_tier(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.holds_ticket_for_tier(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "ticket_tiers_holder_read" ON public.ticket_tiers;
CREATE POLICY "ticket_tiers_holder_read" ON public.ticket_tiers FOR SELECT TO authenticated
  USING (public.holds_ticket_for_tier(id));

-- ============================================================================
-- 6) Entradas y pedidos: el equipo no lee datos personales ni toca columnas
-- ============================================================================
-- Todo cambio de estado de una entrada pasa por RPC auditadas (scan_ticket…).
DROP POLICY IF EXISTS "tickets_door_staff_update" ON public.tickets;

DROP POLICY IF EXISTS "tickets_member_read" ON public.tickets;
CREATE POLICY "tickets_member_read" ON public.tickets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = tickets.event_id
        AND (
          e.partner_id = (SELECT auth.uid())
          OR (e.org_id IS NOT NULL
              AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
        )
    )
  );

DROP POLICY IF EXISTS "ticket_orders_member_read" ON public.ticket_orders;
CREATE POLICY "ticket_orders_member_read" ON public.ticket_orders FOR SELECT TO authenticated
  USING (
    (org_id IS NOT NULL
     AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = ticket_orders.event_id AND e.partner_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- 7) Pricing: aplicar con bloqueo y comprobando que el tipo es del evento;
--    rechazar por RPC (fuera la policy que dejaba editar cualquier columna)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_pricing_proposal(_proposal_id UUID)
RETURNS TABLE (proposal_id UUID, tier_id UUID, new_price_cents INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_proposal public.pricing_proposals%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_updated INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_proposal FROM public.pricing_proposals p WHERE p.id = _proposal_id FOR UPDATE;
  IF v_proposal.id IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending (status: %)', v_proposal.status;
  END IF;
  IF v_proposal.expires_at IS NOT NULL AND v_proposal.expires_at < now() THEN
    UPDATE public.pricing_proposals p SET status = 'expired' WHERE p.id = _proposal_id;
    RAISE EXCEPTION 'Proposal expired';
  END IF;
  IF v_proposal.tier_id IS NULL THEN RAISE EXCEPTION 'Proposal has no associated tier'; END IF;
  IF v_proposal.suggested_price_cents IS NULL OR v_proposal.suggested_price_cents < 0 THEN
    RAISE EXCEPTION 'Invalid suggested price';
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_proposal.event_id;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'Linked event not found'; END IF;
  IF NOT (
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to apply this proposal';
  END IF;

  UPDATE public.ticket_tiers t
     SET price_cents = v_proposal.suggested_price_cents, updated_at = now()
   WHERE t.id = v_proposal.tier_id
     AND t.event_id = v_proposal.event_id
     AND (v_proposal.current_price_cents IS NULL OR t.price_cents = v_proposal.current_price_cents);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'El tipo de entrada no es de este evento o su precio ha cambiado desde la propuesta';
  END IF;

  UPDATE public.pricing_proposals p
     SET status = 'applied', decided_by = v_uid, decided_at = now(), applied_at = now()
   WHERE p.id = _proposal_id;
  UPDATE public.pricing_proposals p
     SET status = 'superseded', decided_by = v_uid, decided_at = now()
   WHERE p.tier_id = v_proposal.tier_id AND p.status = 'pending' AND p.id <> _proposal_id;

  RETURN QUERY SELECT v_proposal.id, v_proposal.tier_id, v_proposal.suggested_price_cents;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_pricing_proposal(_proposal_id UUID, _reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_proposal public.pricing_proposals%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_proposal FROM public.pricing_proposals p WHERE p.id = _proposal_id FOR UPDATE;
  IF v_proposal.id IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  IF v_proposal.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO v_event FROM public.events e WHERE e.id = v_proposal.event_id;
  IF NOT (
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.pricing_proposals p
     SET status = 'rejected',
         decided_by = v_uid,
         decided_at = now(),
         rationale = CASE
           WHEN NULLIF(trim(_reason), '') IS NULL THEN p.rationale
           ELSE concat_ws(E'\n', p.rationale, '[Rechazada] ' || trim(_reason))
         END
   WHERE p.id = _proposal_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_pricing_proposal(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_pricing_proposal(UUID, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "pricing_proposals_member_decide" ON public.pricing_proposals;

-- ============================================================================
-- 8) Escáner v2: evento correcto, ventana horaria, evento cancelado, forzar
--    con motivo auditado, y sin datos personales cuando no hay permiso
-- ============================================================================
DROP FUNCTION IF EXISTS public.scan_ticket(UUID, TEXT);

CREATE FUNCTION public.scan_ticket(
  _qr_token UUID,
  _device_info TEXT DEFAULT NULL,
  _event_id UUID DEFAULT NULL,
  _force BOOLEAN DEFAULT FALSE,
  _force_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  success           BOOLEAN,
  result            public.scan_result_t,
  ticket_id         UUID,
  event_id          UUID,
  event_title       TEXT,
  buyer_first_name  TEXT,
  buyer_last_name   TEXT,
  buyer_email       TEXT,
  tier_name         TEXT,
  scanned_at        TIMESTAMPTZ,
  already_used_at   TIMESTAMPTZ,
  event_date_start  TIMESTAMPTZ,
  forced            BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_ticket      public.tickets%ROWTYPE;
  v_event       public.events%ROWTYPE;
  v_tier_name   TEXT;
  v_now         TIMESTAMPTZ := now();
  v_hash        TEXT := encode(sha256(_qr_token::text::bytea), 'hex');
  v_is_manager  BOOLEAN;
  v_can_scan    BOOLEAN;
  v_first       TEXT;
  v_last        TEXT;
  v_email       TEXT;
  v_problem     public.scan_result_t;
  v_reason      TEXT := NULLIF(trim(COALESCE(_force_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets t WHERE t.qr_token = _qr_token FOR UPDATE;
  IF v_ticket.id IS NOT NULL THEN
    SELECT * INTO v_event FROM public.events e WHERE e.id = v_ticket.event_id;
  END IF;

  IF v_ticket.id IS NULL OR v_event.id IS NULL THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, metadata)
    VALUES (v_ticket.id, NULL, v_uid, v_now, 'invalid_ticket', v_hash, _device_info,
            jsonb_build_object('selected_event_id', _event_id));
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  v_is_manager := v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role);
  v_can_scan := v_is_manager
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['door_staff']::public.org_member_role_t[]));

  -- Sin permiso: ni nombre, ni email, ni evento. Queda registrado para el
  -- local dueño de la entrada.
  IF NOT v_can_scan THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'forbidden', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'forbidden'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  -- El portero ve el nombre del titular actual y el tipo; el email solo lo ve
  -- quien gestiona el evento.
  v_first := COALESCE(NULLIF(v_ticket.holder_first_name, ''), v_ticket.buyer_first_name);
  v_last := COALESCE(NULLIF(v_ticket.holder_last_name, ''), v_ticket.buyer_last_name);
  v_email := CASE WHEN v_is_manager THEN COALESCE(NULLIF(v_ticket.holder_email, ''), v_ticket.buyer_email) END;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT tt.name INTO v_tier_name FROM public.ticket_tiers tt WHERE tt.id = v_ticket.tier_id;
  END IF;

  IF v_ticket.status = 'used' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'already_used', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'already_used'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, v_ticket.used_at, v_event.date_start, FALSE;
    RETURN;
  END IF;

  IF v_ticket.status <> 'paid' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'not_paid', v_hash, _device_info,
            'ticket status was: ' || v_ticket.status::text);
    RETURN QUERY SELECT FALSE, 'not_paid'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  IF v_event.status = 'cancelled' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'event_cancelled', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'event_cancelled'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  -- Entrada de otro evento del mismo local, o fuera de horario: se puede dejar
  -- pasar igualmente, pero solo quien gestiona el evento y con motivo.
  IF _event_id IS NOT NULL AND _event_id <> v_event.id THEN
    v_problem := 'wrong_event';
  ELSIF v_now < v_event.date_start - INTERVAL '6 hours'
     OR v_now > COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') + INTERVAL '2 hours' THEN
    v_problem := 'outside_window';
  END IF;

  IF v_problem IS NOT NULL AND NOT (_force AND v_is_manager AND v_reason IS NOT NULL) THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes, metadata)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, v_problem, v_hash, _device_info,
            CASE WHEN _force THEN 'force_denied' END,
            jsonb_build_object('selected_event_id', _event_id));
    RETURN QUERY SELECT FALSE, v_problem, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  UPDATE public.tickets t
     SET status = 'used', used_at = v_now, used_by_partner_id = v_uid
   WHERE t.id = v_ticket.id;

  INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes, metadata)
  VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'success', v_hash, _device_info,
          CASE WHEN v_problem IS NOT NULL THEN 'forced: ' || v_reason END,
          CASE WHEN v_problem IS NOT NULL
               THEN jsonb_build_object('forced', TRUE, 'original_result', v_problem, 'selected_event_id', _event_id)
               ELSE '{}'::jsonb END);

  RETURN QUERY SELECT TRUE, 'success'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
    v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, (v_problem IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- Asistentes: sin qr_token (era una credencial por asistente), sin datos de
-- contacto para el rol de puerta, sin checkouts abandonados.
DROP FUNCTION IF EXISTS public.partner_event_attendees(UUID);

CREATE FUNCTION public.partner_event_attendees(_event_id UUID)
RETURNS TABLE (
  ticket_id          UUID,
  order_id           UUID,
  status             TEXT,
  buyer_first_name   TEXT,
  buyer_last_name    TEXT,
  buyer_email        TEXT,
  buyer_phone        TEXT,
  amount_paid_cents  INT,
  currency           TEXT,
  paid_at            TIMESTAMPTZ,
  used_at            TIMESTAMPTZ,
  used_by_partner_id UUID,
  scanned_by_name    TEXT,
  tier_name          TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event public.events%ROWTYPE;
  v_is_manager BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  v_is_manager := v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role);

  IF NOT (
    v_is_manager
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['door_staff']::public.org_member_role_t[]))
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.order_id,
    t.status::text,
    COALESCE(NULLIF(t.holder_first_name, ''), t.buyer_first_name),
    COALESCE(NULLIF(t.holder_last_name, ''), t.buyer_last_name),
    CASE WHEN v_is_manager THEN COALESCE(NULLIF(t.holder_email, ''), t.buyer_email) END,
    CASE WHEN v_is_manager THEN t.buyer_phone END,
    t.amount_paid_cents,
    t.currency,
    t.paid_at,
    t.used_at,
    t.used_by_partner_id,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.email, '—')::TEXT,
    tt.name
  FROM public.tickets t
  LEFT JOIN public.ticket_tiers tt ON tt.id = t.tier_id
  LEFT JOIN public.profiles p ON p.id = t.used_by_partner_id
  LEFT JOIN public.ticket_orders o ON o.id = t.order_id
  WHERE t.event_id = _event_id
    AND (t.status IN ('paid', 'used', 'refunded')
         OR (t.status = 'cancelled' AND COALESCE(o.status::text, '') <> 'expired'))
  ORDER BY t.paid_at DESC NULLS LAST, t.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_event_attendees(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_event_attendees(UUID) TO authenticated, service_role;

-- Contadores: "reembolsadas" ya no suma los pagos abandonados.
CREATE OR REPLACE FUNCTION public.partner_event_checkin_stats(_event_id UUID)
RETURNS TABLE (
  capacity         INT,
  tickets_sold     INT,
  tickets_used     INT,
  tickets_pending  INT,
  tickets_refunded INT,
  revenue_cents    BIGINT,
  checkin_pct      NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event public.events%ROWTYPE;
  v_sold INT;
  v_used INT;
  v_pending INT;
  v_refunded INT;
  v_revenue BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;
  IF NOT (
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE t.status IN ('paid','used'))::INT,
    COUNT(*) FILTER (WHERE t.status = 'used')::INT,
    COUNT(*) FILTER (WHERE t.status = 'paid')::INT,
    COUNT(*) FILTER (WHERE t.status = 'refunded'
                     OR (t.status = 'cancelled' AND COALESCE(o.status::text, '') <> 'expired'))::INT,
    COALESCE(SUM(t.amount_paid_cents) FILTER (WHERE t.status IN ('paid','used')), 0)::BIGINT
  INTO v_sold, v_used, v_pending, v_refunded, v_revenue
  FROM public.tickets t
  LEFT JOIN public.ticket_orders o ON o.id = t.order_id
  WHERE t.event_id = _event_id;

  RETURN QUERY SELECT
    v_event.capacity,
    v_sold,
    v_used,
    v_pending,
    v_refunded,
    v_revenue,
    CASE WHEN v_sold > 0 THEN ROUND((v_used::numeric / v_sold::numeric) * 100, 1) ELSE 0::numeric END;
END;
$$;

-- ============================================================================
-- 9) Roles y planes: alta aprobada por el servidor, revocación que no se
--    deshace desde el cliente, y plan gratuito para todos los locales
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_initial_role(_role TEXT)
RETURNS public.app_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _role NOT IN ('client', 'partner') THEN
    RAISE EXCEPTION 'Role not claimable: %', _role USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'User already has a role assigned' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND account_status = 'rejected') THEN
    RAISE EXCEPTION 'Esta cuenta está desactivada. Escríbenos a soporte.' USING ERRCODE = '42501';
  END IF;

  v_role := _role::public.app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, v_role);
  -- Alta aprobada por el servidor (clientes y locales). Un admin puede
  -- desactivarla después y el usuario ya no puede cambiar account_status.
  UPDATE public.profiles SET account_status = 'approved' WHERE id = v_uid AND account_status = 'pending';
  RETURN v_role;
END;
$$;

-- Sin INSERT directo en user_roles: el rol lo da el trigger de alta o
-- claim_initial_role (que comprueba cuentas desactivadas). La policy anterior
-- consultaba la propia user_roles y Postgres la rechazaba siempre por
-- recursión infinita, así que en la práctica ya no dejaba insertar nada.
DROP POLICY IF EXISTS "user_roles_self_insert" ON public.user_roles;

-- Trigger de rol inicial: existía solo en producción (creado fuera de las
-- migraciones). Se versiona aquí y ahora aprueba también a los locales.
CREATE OR REPLACE FUNCTION public.handle_new_user_initial_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.app_role;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'initial_role', ''), 'client')::public.app_role;
  EXCEPTION WHEN OTHERS THEN
    v_role := 'client'::public.app_role;
  END;
  IF v_role NOT IN ('client', 'partner') THEN
    v_role := 'client'::public.app_role;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role) ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET account_status = 'approved' WHERE id = NEW.id AND account_status = 'pending';
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_initial_role() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'zz_on_auth_user_created_role' AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER zz_on_auth_user_created_role
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_initial_role();
  END IF;
END $$;

-- Solo los locales crean organizaciones (en producción había organizaciones
-- de cuentas cliente).
CREATE OR REPLACE FUNCTION public.create_organization(_name TEXT, _country TEXT DEFAULT 'ES', _slug TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org_id UUID;
  v_brand_id UUID;
  v_venue_id UUID;
  v_slug TEXT;
  v_brand_slug TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(v_uid, 'partner'::public.app_role) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Solo las cuentas de local pueden crear una organización' USING ERRCODE = '42501';
  END IF;

  v_slug := COALESCE(_slug, lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g')));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN v_slug := 'org-' || substring(v_uid::text, 1, 8); END IF;
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substring(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.organizations (slug, name, country, owner_id)
  VALUES (v_slug, _name, _country, v_uid)
  RETURNING id INTO v_org_id;

  v_brand_slug := v_slug;
  INSERT INTO public.brands (org_id, slug, name) VALUES (v_org_id, v_brand_slug, _name) RETURNING id INTO v_brand_id;

  INSERT INTO public.venues (brand_id, org_id, slug, name, city, country)
  VALUES (v_brand_id, v_org_id, 'principal', 'Principal',
          COALESCE((SELECT business_city FROM public.profiles WHERE id = v_uid), 'Madrid'),
          _country)
  RETURNING id INTO v_venue_id;

  UPDATE public.profiles SET last_active_venue_id = v_venue_id WHERE id = v_uid;
  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_partner_free_plan()
RETURNS TABLE (
  out_subscription_id  UUID,
  out_org_id           UUID,
  out_plan_code        TEXT,
  out_status           TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_org_id UUID;
  v_sub_id UUID;
  v_email  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_uid, 'partner'::public.app_role) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Solo las cuentas de local tienen plan' USING ERRCODE = '42501';
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.owner_id = v_uid
  ORDER BY o.created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id
    FROM public.organization_members m
    WHERE m.user_id = v_uid AND m.status = 'active' AND m.role IN ('owner', 'admin')
    ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    v_org_id := public.create_organization(
      COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'Mi local'),
      'ES',
      NULL
    );
  END IF;

  INSERT INTO public.partner_subscriptions AS ps (
    org_id, plan_code, status,
    current_period_start, current_period_end,
    trial_starts_at, trial_ends_at,
    metadata
  )
  VALUES (
    v_org_id, 'free', 'active'::public.partner_subscription_status_t,
    now(), NULL,
    NULL, NULL,
    jsonb_build_object('claimed_via', 'free_plan', 'claimed_at', now())
  )
  ON CONFLICT (org_id) DO UPDATE SET
    plan_code = CASE WHEN ps.status = 'active' THEN ps.plan_code ELSE 'free' END,
    status    = 'active'::public.partner_subscription_status_t,
    current_period_start = COALESCE(ps.current_period_start, now()),
    metadata  = ps.metadata || jsonb_build_object('reclaimed_at', now())
  RETURNING ps.id INTO v_sub_id;

  RETURN QUERY SELECT v_sub_id, v_org_id, 'free'::TEXT, 'active'::TEXT;
END;
$$;

-- Ya no hay prueba: todos los locales tienen el plan gratuito. Se conserva la
-- firma porque las versiones de la app ya publicadas la llaman al registrarse
-- (la v2 fallaba siempre por una columna ambigua).
CREATE OR REPLACE FUNCTION public.start_partner_trial(_org_id UUID DEFAULT NULL)
RETURNS TABLE (
  subscription_id UUID,
  org_id UUID,
  plan_id UUID,
  plan_code TEXT,
  status TEXT,
  trial_starts_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sub_id UUID;
BEGIN
  SELECT f.out_subscription_id INTO v_sub_id FROM public.claim_partner_free_plan() f;
  RETURN QUERY
    SELECT ps.id, ps.org_id, ps.plan_id, ps.plan_code, ps.status::text,
           ps.trial_starts_at, ps.trial_ends_at, ps.current_period_start, ps.current_period_end
    FROM public.partner_subscriptions ps
    WHERE ps.id = v_sub_id;
END;
$$;

-- Toda organización nueva nace con el plan gratuito.
CREATE OR REPLACE FUNCTION public.organizations_grant_free_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.partner_subscriptions (org_id, plan_code, status, current_period_start, metadata)
  VALUES (NEW.id, 'free', 'active', now(), jsonb_build_object('claimed_via', 'org_created'))
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.organizations_grant_free_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organizations_grant_free_plan ON public.organizations;
CREATE TRIGGER trg_organizations_grant_free_plan AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_grant_free_plan();

-- Datos existentes: locales pendientes aprobados, organizaciones sin plan con
-- el plan gratuito y suscripciones heredadas no activas (prueba caducada,
-- impago…) pasadas a gratuito. Las de pago con Stripe no se tocan.
UPDATE public.profiles p
   SET account_status = 'approved'
 WHERE p.account_status = 'pending'
   AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'partner');

INSERT INTO public.partner_subscriptions (org_id, plan_code, status, current_period_start, metadata)
SELECT o.id, 'free', 'active', now(), jsonb_build_object('claimed_via', 'backfill_20260923')
FROM public.organizations o
WHERE o.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.partner_subscriptions ps WHERE ps.org_id = o.id);

UPDATE public.partner_subscriptions ps
   SET plan_code = 'free',
       status = 'active',
       current_period_end = NULL,
       metadata = ps.metadata || jsonb_build_object('migrated_to_free_at', now(), 'previous_status', ps.status::text)
 WHERE ps.stripe_subscription_id IS NULL
   AND ps.status <> 'active';

-- ============================================================================
-- 10) Storage: tamaño y tipo de fichero en los buckets públicos de imágenes
-- ============================================================================
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/gif']
 WHERE id IN ('avatars', 'event-images', 'partner-branding', 'partner-galleries');
