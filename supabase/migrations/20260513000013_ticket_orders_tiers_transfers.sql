-- ============================================================================
-- Pasify · 0013 ticket_tiers + ticket_orders + ticket_transfers
-- Ciclo completo de ticketing: tiers configurables, órdenes agrupando varios
-- tickets, transferencias entre usuarios.
-- ============================================================================

-- ============================================================================
-- ticket_tiers — niveles de precio dentro de un evento
-- (early bird, regular, late release, VIP, etc.)
-- ============================================================================
CREATE TYPE public.ticket_tier_status_t AS ENUM ('active', 'sold_out', 'closed', 'hidden');

CREATE TABLE IF NOT EXISTS public.ticket_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                                     -- "Early bird", "Late release", "VIP table 4p"
  description TEXT,
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',

  capacity INT CHECK (capacity IS NULL OR capacity > 0), -- NULL = ilimitado dentro del aforo evento
  sold INT NOT NULL DEFAULT 0,

  sale_starts_at TIMESTAMPTZ,
  sale_ends_at TIMESTAMPTZ,

  refundable_until_hours_before INT NOT NULL DEFAULT 168, -- 7 días por defecto
  transfer_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  per_user_max INT NOT NULL DEFAULT 10,

  stripe_price_id TEXT,                                   -- lazy: se crea al primer checkout

  sort_order INT NOT NULL DEFAULT 0,
  status public.ticket_tier_status_t NOT NULL DEFAULT 'active',

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_tiers_event ON public.ticket_tiers(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_tiers_status ON public.ticket_tiers(status);

ALTER TABLE public.ticket_tiers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_ticket_tiers_updated_at ON public.ticket_tiers;
CREATE TRIGGER trg_ticket_tiers_updated_at
  BEFORE UPDATE ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lectura pública para mostrar precios en evento (solo si tier activo y evento published)
DROP POLICY IF EXISTS "ticket_tiers_public_read" ON public.ticket_tiers;
CREATE POLICY "ticket_tiers_public_read"
  ON public.ticket_tiers FOR SELECT
  TO anon, authenticated
  USING (
    status = 'active' AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = ticket_tiers.event_id AND e.status IN ('published','past')
    )
  );

-- Partner / miembros gestionan tiers de sus eventos
DROP POLICY IF EXISTS "ticket_tiers_member_all" ON public.ticket_tiers;
CREATE POLICY "ticket_tiers_member_all"
  ON public.ticket_tiers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = ticket_tiers.event_id
        AND (
          e.partner_id = auth.uid()
          OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = ticket_tiers.event_id
        AND (
          e.partner_id = auth.uid()
          OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
        )
    )
  );

DROP POLICY IF EXISTS "ticket_tiers_admin_all" ON public.ticket_tiers;
CREATE POLICY "ticket_tiers_admin_all"
  ON public.ticket_tiers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- ticket_orders — agrupa N tickets comprados en una misma sesión Stripe
-- ============================================================================
CREATE TYPE public.ticket_order_status_t AS ENUM (
  'pending',       -- creada, sin pago aún
  'paid',          -- pago confirmado
  'partial_refund',-- algún ticket de la orden fue reembolsado
  'refunded',      -- toda la orden reembolsada
  'failed',        -- pago falló
  'expired'        -- session caducó sin completar pago
);

CREATE TABLE IF NOT EXISTS public.ticket_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,

  buyer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  buyer_email TEXT NOT NULL,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_phone TEXT,

  subtotal_cents INT NOT NULL DEFAULT 0,
  fees_cents INT NOT NULL DEFAULT 0,                      -- application_fee Pasify
  total_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',

  status public.ticket_order_status_t NOT NULL DEFAULT 'pending',

  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_destination_account TEXT,                        -- connected account del partner

  -- Idempotency
  request_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ                                  -- session expira tipicamente 30min
);

CREATE INDEX IF NOT EXISTS idx_ticket_orders_event ON public.ticket_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_org ON public.ticket_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_buyer ON public.ticket_orders(buyer_user_id) WHERE buyer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_orders_buyer_email ON public.ticket_orders(buyer_email);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_status ON public.ticket_orders(status);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_session ON public.ticket_orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_pi ON public.ticket_orders(stripe_payment_intent_id);

ALTER TABLE public.ticket_orders ENABLE ROW LEVEL SECURITY;

-- Buyer ve sus órdenes
DROP POLICY IF EXISTS "ticket_orders_buyer_read" ON public.ticket_orders;
CREATE POLICY "ticket_orders_buyer_read"
  ON public.ticket_orders FOR SELECT
  TO authenticated
  USING (buyer_user_id = auth.uid());

-- Partner/team ve órdenes de sus eventos
DROP POLICY IF EXISTS "ticket_orders_member_read" ON public.ticket_orders;
CREATE POLICY "ticket_orders_member_read"
  ON public.ticket_orders FOR SELECT
  TO authenticated
  USING (
    org_id IS NOT NULL AND public.is_member_of_org(org_id)
  );

DROP POLICY IF EXISTS "ticket_orders_admin_all" ON public.ticket_orders;
CREATE POLICY "ticket_orders_admin_all"
  ON public.ticket_orders FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INSERT/UPDATE solo via service_role (edge function checkout + webhook)

-- ============================================================================
-- tickets — extender con order_id, tier_id, holder, transferred
-- ============================================================================
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.ticket_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier_id  UUID REFERENCES public.ticket_tiers(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS holder_first_name TEXT,
  ADD COLUMN IF NOT EXISTS holder_last_name  TEXT,
  ADD COLUMN IF NOT EXISTS holder_email      TEXT,
  ADD COLUMN IF NOT EXISTS transferred_to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_url_token UUID DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_tickets_order ON public.tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_tier  ON public.tickets(tier_id);
CREATE INDEX IF NOT EXISTS idx_tickets_transferred_to ON public.tickets(transferred_to_user_id);

-- Refrescar policy: cliente ve sus tickets (compró o le transfirieron)
DROP POLICY IF EXISTS "tickets_buyer_read_own" ON public.tickets;
CREATE POLICY "tickets_buyer_read_own"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (
    buyer_user_id = auth.uid()
    OR transferred_to_user_id = auth.uid()
  );

-- ============================================================================
-- ticket_transfers — historial de transferencias
-- ============================================================================
CREATE TYPE public.ticket_transfer_status_t AS ENUM ('pending', 'accepted', 'declined', 'expired', 'cancelled');

CREATE TABLE IF NOT EXISTS public.ticket_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.ticket_transfer_status_t NOT NULL DEFAULT 'pending',
  message TEXT,
  invitation_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_ticket ON public.ticket_transfers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_from ON public.ticket_transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_to_email ON public.ticket_transfers(to_email);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_token ON public.ticket_transfers(invitation_token);

ALTER TABLE public.ticket_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_transfers_from_read" ON public.ticket_transfers;
CREATE POLICY "ticket_transfers_from_read"
  ON public.ticket_transfers FOR SELECT
  TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

DROP POLICY IF EXISTS "ticket_transfers_from_insert" ON public.ticket_transfers;
CREATE POLICY "ticket_transfers_from_insert"
  ON public.ticket_transfers FOR INSERT
  TO authenticated
  WITH CHECK (
    from_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_transfers.ticket_id
        AND (t.buyer_user_id = auth.uid() OR t.transferred_to_user_id = auth.uid())
        AND t.status = 'paid'
    )
  );

DROP POLICY IF EXISTS "ticket_transfers_admin_all" ON public.ticket_transfers;
CREATE POLICY "ticket_transfers_admin_all"
  ON public.ticket_transfers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- favorites_v2 — versión backend-backed (reemplaza localStorage)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.favorites_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((event_id IS NOT NULL)::int + (brand_id IS NOT NULL)::int + (venue_id IS NOT NULL)::int = 1),
  UNIQUE (user_id, event_id),
  UNIQUE (user_id, brand_id),
  UNIQUE (user_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_v2_user ON public.favorites_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_v2_event ON public.favorites_v2(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_favorites_v2_brand ON public.favorites_v2(brand_id) WHERE brand_id IS NOT NULL;

ALTER TABLE public.favorites_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_v2_self_all" ON public.favorites_v2;
CREATE POLICY "favorites_v2_self_all"
  ON public.favorites_v2 FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "favorites_v2_admin_all" ON public.favorites_v2;
CREATE POLICY "favorites_v2_admin_all"
  ON public.favorites_v2 FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- Trigger: al INSERT en tickets, actualizar events.tickets_sold + tier.sold
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tickets_update_counters()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'paid' THEN
      UPDATE public.events SET tickets_sold = tickets_sold + 1, updated_at = now()
        WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = sold + 1, updated_at = now()
          WHERE id = NEW.tier_id;
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- pending → paid
    IF OLD.status <> 'paid' AND NEW.status = 'paid' THEN
      UPDATE public.events SET tickets_sold = tickets_sold + 1, updated_at = now()
        WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = sold + 1, updated_at = now()
          WHERE id = NEW.tier_id;
      END IF;
    END IF;
    -- paid → refunded/cancelled (revertir)
    IF OLD.status = 'paid' AND NEW.status IN ('refunded','cancelled') THEN
      UPDATE public.events SET tickets_sold = GREATEST(0, tickets_sold - 1), updated_at = now()
        WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = GREATEST(0, sold - 1), updated_at = now()
          WHERE id = NEW.tier_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_update_counters ON public.tickets;
CREATE TRIGGER trg_tickets_update_counters
  AFTER INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_update_counters();

-- ============================================================================
-- RPC: mark_ticket_used(qr_token, scanner_user_id) — usado por QRScanner
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_ticket_used(_qr_token UUID)
RETURNS TABLE (
  ticket_id UUID,
  event_id UUID,
  event_title TEXT,
  holder_first_name TEXT,
  holder_last_name TEXT,
  tier_name TEXT,
  status TEXT,
  already_used BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event_title TEXT;
  v_tier_name TEXT;
  v_already_used BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE qr_token = _qr_token FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket no encontrado';
  END IF;

  IF v_ticket.status <> 'paid' AND v_ticket.status <> 'used' THEN
    RAISE EXCEPTION 'Ticket no válido (status=%)', v_ticket.status;
  END IF;

  -- Validar que el scanner pertenece al venue del evento
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = v_ticket.event_id
      AND (
        e.partner_id = v_uid
        OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
      )
  ) THEN
    RAISE EXCEPTION 'No tienes permisos para escanear este ticket';
  END IF;

  IF v_ticket.used_at IS NOT NULL THEN
    v_already_used := TRUE;
  ELSE
    UPDATE public.tickets
    SET status = 'used',
        used_at = now(),
        used_by_partner_id = v_uid
    WHERE id = v_ticket.id;
  END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = v_ticket.event_id;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT name INTO v_tier_name FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
  END IF;

  RETURN QUERY SELECT
    v_ticket.id,
    v_ticket.event_id,
    v_event_title,
    v_ticket.holder_first_name,
    v_ticket.holder_last_name,
    v_tier_name,
    'used'::TEXT,
    v_already_used;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ticket_used(UUID) TO authenticated;

-- ============================================================================
-- RPC: transfer_ticket(ticket_id, to_email, message)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transfer_ticket(
  _ticket_id UUID,
  _to_email TEXT,
  _message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_to_user UUID;
  v_transfer_id UUID;
  v_tier_allowed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'Ticket no encontrado';
  END IF;

  IF v_ticket.buyer_user_id <> v_uid AND v_ticket.transferred_to_user_id <> v_uid THEN
    RAISE EXCEPTION 'No eres propietario de este ticket';
  END IF;

  IF v_ticket.status <> 'paid' THEN
    RAISE EXCEPTION 'El ticket no está disponible para transferir (status=%)', v_ticket.status;
  END IF;

  IF v_ticket.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ticket ya escaneado';
  END IF;

  -- Validar que el tier permite transferencia
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT transfer_allowed INTO v_tier_allowed FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
    IF NOT v_tier_allowed THEN
      RAISE EXCEPTION 'Este tipo de entrada no permite transferencia';
    END IF;
  END IF;

  SELECT id INTO v_to_user FROM public.profiles WHERE lower(email) = lower(_to_email);

  INSERT INTO public.ticket_transfers (ticket_id, from_user_id, to_email, to_user_id, message)
  VALUES (_ticket_id, v_uid, _to_email, v_to_user, _message)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_ticket(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- RPC: accept_ticket_transfer(token)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_ticket_transfer(_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_transfer public.ticket_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_transfer
  FROM public.ticket_transfers
  WHERE invitation_token = _token
    AND status = 'pending'
    AND expires_at > now()
    AND lower(to_email) = lower(v_email)
  FOR UPDATE;

  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'Transferencia no válida o caducada';
  END IF;

  -- Actualizar transfer
  UPDATE public.ticket_transfers
  SET status = 'accepted', to_user_id = v_uid, responded_at = now()
  WHERE id = v_transfer.id;

  -- Reassignar el ticket
  UPDATE public.tickets
  SET transferred_to_user_id = v_uid,
      transferred_at = now(),
      qr_token = gen_random_uuid()                        -- invalida QR original
  WHERE id = v_transfer.ticket_id;

  RETURN v_transfer.ticket_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) TO authenticated;
