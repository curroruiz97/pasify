-- Pasify · 0019 cashless wallets + POS + VIP + door scans + door_vision

-- ============================================================================
-- bars / products / pos_sales / pos_cash_closures
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main','vip','outdoor','kitchen','pop_up')),
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bars_venue ON public.bars(venue_id);
ALTER TABLE public.bars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bars_member_read" ON public.bars FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = bars.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "bars_member_write" ON public.bars FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = bars.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = bars.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "bars_admin_all" ON public.bars FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES public.bars(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price_cents INT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  sku TEXT,
  category TEXT,
  image_url TEXT,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  vat_pct NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_venue ON public.products(venue_id);
CREATE INDEX IF NOT EXISTS idx_products_bar ON public.products(bar_id);
CREATE INDEX IF NOT EXISTS idx_products_available ON public.products(available);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "products_member_read" ON public.products FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = products.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "products_member_write" ON public.products FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = products.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = products.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "products_admin_all" ON public.products FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TYPE public.pos_payment_method_t AS ENUM ('card','cash','wristband','complimentary','other');

CREATE TABLE IF NOT EXISTS public.pos_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  bar_id UUID REFERENCES public.bars(id) ON DELETE SET NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_cents INT NOT NULL DEFAULT 0,
  vat_cents INT NOT NULL DEFAULT 0,
  total_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_method public.pos_payment_method_t NOT NULL,
  stripe_payment_intent_id TEXT,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  cashier_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  request_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_sales_venue ON public.pos_sales(venue_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_event ON public.pos_sales(event_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_bar ON public.pos_sales(bar_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_created ON public.pos_sales(created_at DESC);
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_sales_member_read" ON public.pos_sales FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = pos_sales.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "pos_sales_pos_insert" ON public.pos_sales FOR INSERT TO authenticated WITH CHECK (cashier_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = pos_sales.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager','pos_staff']::public.org_member_role_t[])));
CREATE POLICY "pos_sales_admin_all" ON public.pos_sales FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.pos_cash_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_cash_cents INT NOT NULL DEFAULT 0,
  counted_cash_cents INT NOT NULL DEFAULT 0,
  variance_cents INT GENERATED ALWAYS AS (counted_cash_cents - expected_cash_cents) STORED,
  total_card_cents INT NOT NULL DEFAULT 0,
  total_wristband_cents INT NOT NULL DEFAULT 0,
  total_complimentary_cents INT NOT NULL DEFAULT 0,
  total_sales_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  partner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_cash_closures_venue ON public.pos_cash_closures(venue_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_closures_event ON public.pos_cash_closures(event_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_closures_closed ON public.pos_cash_closures(closed_at DESC);
ALTER TABLE public.pos_cash_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos_cash_closures_member_read" ON public.pos_cash_closures FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = pos_cash_closures.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "pos_cash_closures_manager_write" ON public.pos_cash_closures FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = pos_cash_closures.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = pos_cash_closures.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "pos_cash_closures_admin_all" ON public.pos_cash_closures FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- cashless_wallets + topups + transactions + refunds
-- ============================================================================
CREATE TYPE public.cashless_wallet_status_t AS ENUM ('active','closed','refunded');
CREATE TYPE public.cashless_topup_source_t AS ENUM ('card','cash','gift','transfer','wristband_recharge');
CREATE TYPE public.cashless_tx_kind_t AS ENUM ('purchase','refund','tip','transfer_in','transfer_out');

CREATE TABLE IF NOT EXISTS public.cashless_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  wristband_uid TEXT UNIQUE,
  pin_hash TEXT,
  balance_cents INT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  status public.cashless_wallet_status_t NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_event ON public.cashless_wallets(event_id);
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_user ON public.cashless_wallets(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_ticket ON public.cashless_wallets(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_wristband ON public.cashless_wallets(wristband_uid) WHERE wristband_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_status ON public.cashless_wallets(status);
ALTER TABLE public.cashless_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cashless_wallets_owner_read" ON public.cashless_wallets FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cashless_wallets_member_read" ON public.cashless_wallets FOR SELECT TO authenticated USING (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = cashless_wallets.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "cashless_wallets_admin_all" ON public.cashless_wallets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.cashless_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.cashless_wallets(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  source public.cashless_topup_source_t NOT NULL,
  stripe_payment_intent_id TEXT,
  partner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  request_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cashless_topups_wallet ON public.cashless_topups(wallet_id);
ALTER TABLE public.cashless_topups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cashless_topups_owner_read" ON public.cashless_topups FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cashless_wallets w WHERE w.id = cashless_topups.wallet_id AND w.user_id = auth.uid()));
CREATE POLICY "cashless_topups_member_read" ON public.cashless_topups FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cashless_wallets w JOIN public.venues v ON v.id = w.venue_id WHERE w.id = cashless_topups.wallet_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "cashless_topups_admin_all" ON public.cashless_topups FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.cashless_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.cashless_wallets(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL,
  kind public.cashless_tx_kind_t NOT NULL,
  bar_id UUID REFERENCES public.bars(id) ON DELETE SET NULL,
  product_name TEXT,
  partner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  pos_sale_id UUID REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  request_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cashless_tx_wallet ON public.cashless_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashless_tx_bar ON public.cashless_transactions(bar_id) WHERE bar_id IS NOT NULL;
ALTER TABLE public.cashless_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cashless_tx_owner_read" ON public.cashless_transactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cashless_wallets w WHERE w.id = cashless_transactions.wallet_id AND w.user_id = auth.uid()));
CREATE POLICY "cashless_tx_member_read" ON public.cashless_transactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.cashless_wallets w JOIN public.venues v ON v.id = w.venue_id WHERE w.id = cashless_transactions.wallet_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "cashless_tx_admin_all" ON public.cashless_transactions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.cashless_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.cashless_wallets(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  stripe_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
  failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cashless_refunds_wallet ON public.cashless_refunds(wallet_id);
ALTER TABLE public.cashless_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cashless_refunds_admin_read" ON public.cashless_refunds FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.cashless_pay(_wallet_id UUID, _amount_cents INT, _items JSONB DEFAULT NULL, _bar_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.cashless_wallets%ROWTYPE;
  v_new_balance INT;
BEGIN
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Importe inválido'; END IF;
  SELECT * INTO v_wallet FROM public.cashless_wallets WHERE id = _wallet_id FOR UPDATE;
  IF v_wallet.id IS NULL THEN RAISE EXCEPTION 'Wallet no encontrada'; END IF;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet no activa'; END IF;
  IF v_wallet.balance_cents < _amount_cents THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;
  v_new_balance := v_wallet.balance_cents - _amount_cents;
  UPDATE public.cashless_wallets SET balance_cents = v_new_balance WHERE id = _wallet_id;
  INSERT INTO public.cashless_transactions (wallet_id, amount_cents, kind, bar_id, partner_user_id) VALUES (_wallet_id, -_amount_cents, 'purchase', _bar_id, auth.uid());
  RETURN v_new_balance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cashless_pay(UUID, INT, JSONB, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cashless_topup(_wallet_id UUID, _amount_cents INT, _source public.cashless_topup_source_t, _stripe_pi TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet public.cashless_wallets%ROWTYPE;
  v_new_balance INT;
BEGIN
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Importe inválido'; END IF;
  SELECT * INTO v_wallet FROM public.cashless_wallets WHERE id = _wallet_id FOR UPDATE;
  IF v_wallet.id IS NULL THEN RAISE EXCEPTION 'Wallet no encontrada'; END IF;
  IF v_wallet.status <> 'active' THEN RAISE EXCEPTION 'Wallet no activa'; END IF;
  v_new_balance := v_wallet.balance_cents + _amount_cents;
  UPDATE public.cashless_wallets SET balance_cents = v_new_balance WHERE id = _wallet_id;
  INSERT INTO public.cashless_topups (wallet_id, amount_cents, source, stripe_payment_intent_id, partner_user_id) VALUES (_wallet_id, _amount_cents, _source, _stripe_pi, auth.uid());
  INSERT INTO public.cashless_transactions (wallet_id, amount_cents, kind, partner_user_id) VALUES (_wallet_id, _amount_cents, 'purchase', auth.uid()) ON CONFLICT DO NOTHING;
  RETURN v_new_balance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cashless_topup(UUID, INT, public.cashless_topup_source_t, TEXT) TO authenticated;

-- ============================================================================
-- VIP areas + bookings
-- ============================================================================
CREATE TYPE public.vip_booking_status_t AS ENUM ('requested','confirmed','seated','no_show','cancelled');

CREATE TABLE IF NOT EXISTS public.vip_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  min_spend_cents INT NOT NULL DEFAULT 0,
  description TEXT,
  photo_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vip_areas_venue ON public.vip_areas(venue_id);
ALTER TABLE public.vip_areas ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_vip_areas_updated_at BEFORE UPDATE ON public.vip_areas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "vip_areas_public_read" ON public.vip_areas FOR SELECT TO anon, authenticated USING (active = TRUE);
CREATE POLICY "vip_areas_member_write" ON public.vip_areas FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = vip_areas.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.venues v WHERE v.id = vip_areas.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "vip_areas_admin_all" ON public.vip_areas FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.vip_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vip_area_id UUID NOT NULL REFERENCES public.vip_areas(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  holder_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  holder_name TEXT NOT NULL,
  holder_phone TEXT,
  holder_email TEXT,
  party_size INT NOT NULL CHECK (party_size > 0),
  status public.vip_booking_status_t NOT NULL DEFAULT 'requested',
  min_spend_paid_cents INT NOT NULL DEFAULT 0,
  deposit_cents INT NOT NULL DEFAULT 0,
  notes TEXT,
  rrpp_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  seated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_event ON public.vip_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_status ON public.vip_bookings(status);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_rrpp ON public.vip_bookings(rrpp_user_id);
ALTER TABLE public.vip_bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_vip_bookings_updated_at BEFORE UPDATE ON public.vip_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "vip_bookings_holder_read" ON public.vip_bookings FOR SELECT TO authenticated USING (holder_user_id = auth.uid());
CREATE POLICY "vip_bookings_member_read" ON public.vip_bookings FOR SELECT TO authenticated USING (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = vip_bookings.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "vip_bookings_rrpp_write" ON public.vip_bookings FOR ALL TO authenticated USING (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = vip_bookings.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[]))) WITH CHECK (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = vip_bookings.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[])));
CREATE POLICY "vip_bookings_admin_all" ON public.vip_bookings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- door_scans + door_vision_events
-- ============================================================================
CREATE TYPE public.door_scan_result_t AS ENUM ('ok','already_used','expired','invalid','underage','blacklisted','denied','transferred');

CREATE TABLE IF NOT EXISTS public.door_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  scanner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result public.door_scan_result_t NOT NULL,
  reason TEXT,
  device_id TEXT,
  geo_lat DOUBLE PRECISION,
  geo_lng DOUBLE PRECISION,
  request_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_door_scans_ticket ON public.door_scans(ticket_id);
CREATE INDEX IF NOT EXISTS idx_door_scans_event ON public.door_scans(event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_door_scans_result ON public.door_scans(result);
ALTER TABLE public.door_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "door_scans_member_read" ON public.door_scans FOR SELECT TO authenticated USING (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = door_scans.venue_id AND public.is_member_of_org(v.org_id)));
CREATE POLICY "door_scans_door_staff_insert" ON public.door_scans FOR INSERT TO authenticated WITH CHECK (scanner_user_id = auth.uid() AND venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = door_scans.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])));
CREATE POLICY "door_scans_admin_all" ON public.door_scans FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TYPE public.door_vision_kind_t AS ENUM ('match','mismatch','underage','blacklist','density_alert','intoxication','dress_code');

CREATE TABLE IF NOT EXISTS public.door_vision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind public.door_vision_kind_t NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  snapshot_path TEXT,
  demographics JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_taken TEXT,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  scanner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_decision TEXT
);
CREATE INDEX IF NOT EXISTS idx_door_vision_event ON public.door_vision_events(event_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_door_vision_kind ON public.door_vision_events(kind);
CREATE INDEX IF NOT EXISTS idx_door_vision_unreviewed ON public.door_vision_events(reviewed_at) WHERE reviewed_at IS NULL;
ALTER TABLE public.door_vision_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "door_vision_member_read" ON public.door_vision_events FOR SELECT TO authenticated USING (venue_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = door_vision_events.venue_id AND public.has_org_role(v.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])));
CREATE POLICY "door_vision_admin_all" ON public.door_vision_events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.door_scan(_qr_token UUID)
RETURNS TABLE (result public.door_scan_result_t, ticket_id UUID, event_id UUID, holder_first_name TEXT, holder_last_name TEXT, tier_name TEXT, reason TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier_name TEXT;
  v_result public.door_scan_result_t;
  v_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE qr_token = _qr_token FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    v_result := 'invalid'; v_reason := 'QR no encontrado';
    INSERT INTO public.door_scans (event_id, scanner_user_id, result, reason, ticket_id) VALUES (NULL::uuid, v_uid, 'invalid', v_reason, NULL);
    RETURN QUERY SELECT v_result, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_reason;
    RETURN;
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;

  -- Permisos
  IF NOT (v_event.partner_id = v_uid OR (v_event.org_id IS NOT NULL AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))) THEN
    RAISE EXCEPTION 'Sin permisos para este evento';
  END IF;

  IF v_ticket.status = 'used' THEN
    v_result := 'already_used'; v_reason := 'Ticket ya escaneado';
  ELSIF v_ticket.status <> 'paid' THEN
    v_result := 'invalid'; v_reason := format('Estado %s', v_ticket.status);
  ELSE
    UPDATE public.tickets SET status = 'used', used_at = now(), used_by_partner_id = v_uid WHERE id = v_ticket.id;
    v_result := 'ok'; v_reason := NULL;
  END IF;

  INSERT INTO public.door_scans (ticket_id, event_id, venue_id, scanner_user_id, result, reason) VALUES (v_ticket.id, v_event.id, v_event.venue_id, v_uid, v_result, v_reason);

  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT name INTO v_tier_name FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
  END IF;
  RETURN QUERY SELECT v_result, v_ticket.id, v_ticket.event_id, v_ticket.holder_first_name, v_ticket.holder_last_name, v_tier_name, v_reason;
END;
$$;
GRANT EXECUTE ON FUNCTION public.door_scan(UUID) TO authenticated;
