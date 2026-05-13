-- Pasify · 0021 forecast_predictions + pricing_proposals + marketing_campaigns + benchmarks

CREATE TABLE IF NOT EXISTS public.forecast_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  predicted_attendance INT NOT NULL,
  predicted_revenue_cents INT,
  ci_low INT,
  ci_high INT,
  confidence NUMERIC(4,3),
  factors JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forecast_event ON public.forecast_predictions(event_id, generated_at DESC);
ALTER TABLE public.forecast_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "forecast_member_read" ON public.forecast_predictions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = forecast_predictions.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.is_member_of_org(e.org_id)))));
CREATE POLICY "forecast_admin_all" ON public.forecast_predictions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.pricing_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES public.ticket_tiers(id) ON DELETE CASCADE,
  current_price_cents INT NOT NULL,
  suggested_price_cents INT NOT NULL,
  delta_pct NUMERIC(6,3),
  expected_uplift_cents INT,
  expected_tickets_uplift INT,
  confidence NUMERIC(4,3),
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired','applied','superseded')),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_event ON public.pricing_proposals(event_id);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_tier ON public.pricing_proposals(tier_id);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_status ON public.pricing_proposals(status);
ALTER TABLE public.pricing_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_proposals_member_read" ON public.pricing_proposals FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = pricing_proposals.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.is_member_of_org(e.org_id)))));
CREATE POLICY "pricing_proposals_member_decide" ON public.pricing_proposals FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = pricing_proposals.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))))) WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = pricing_proposals.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])))));
CREATE POLICY "pricing_proposals_admin_all" ON public.pricing_proposals FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TYPE public.marketing_channel_t AS ENUM ('email','sms','push','in_app','meta_ads','tiktok_ads','google_ads','whatsapp');
CREATE TYPE public.marketing_campaign_status_t AS ENUM ('draft','scheduled','running','paused','completed','cancelled','failed');

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  channel public.marketing_channel_t NOT NULL,
  audience_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_cents INT NOT NULL DEFAULT 0,
  budget_consumed_cents INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  open_count INT NOT NULL DEFAULT 0,
  click_count INT NOT NULL DEFAULT 0,
  conversions_count INT NOT NULL DEFAULT 0,
  conversions_revenue_cents INT NOT NULL DEFAULT 0,
  status public.marketing_campaign_status_t NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_org ON public.marketing_campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_event ON public.marketing_campaigns(event_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON public.marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_channel ON public.marketing_campaigns(channel);
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_marketing_campaigns_updated_at BEFORE UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "marketing_campaigns_member_all" ON public.marketing_campaigns FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "marketing_campaigns_admin_all" ON public.marketing_campaigns FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.industry_benchmarks_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment TEXT NOT NULL,
  region TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_size INT NOT NULL,
  payload JSONB NOT NULL,
  k_anonymity_min INT NOT NULL DEFAULT 15,
  UNIQUE (segment, region, computed_at)
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_segment_region ON public.industry_benchmarks_snapshots(segment, region, computed_at DESC);
ALTER TABLE public.industry_benchmarks_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "benchmarks_authenticated_read" ON public.industry_benchmarks_snapshots FOR SELECT TO authenticated USING (sample_size >= k_anonymity_min);
CREATE POLICY "benchmarks_admin_all" ON public.industry_benchmarks_snapshots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Loyalty (Pasify Points)
CREATE TABLE IF NOT EXISTS public.loyalty_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  min_points INT NOT NULL,
  perks JSONB NOT NULL DEFAULT '[]'::jsonb,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.loyalty_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loyalty_levels_public_read" ON public.loyalty_levels FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "loyalty_levels_admin_write" ON public.loyalty_levels FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.loyalty_levels (code, name, min_points, color, sort_order, perks) VALUES
  ('bronze','Bronze',0,'#B8763C',1,'["Acceso a eventos exclusivos","Newsletter prioritaria"]'::jsonb),
  ('silver','Silver',500,'#C9C9C9',2,'["10% descuento puerta","Entrada prioritaria"]'::jsonb),
  ('gold','Gold',1500,'#E8B04C',3,'["20% descuento puerta","Drink de bienvenida","Acceso anticipado a venta"]'::jsonb),
  ('platinum','Platinum',5000,'#E8E1D4',4,'["Acceso VIP gratis","Concierge dedicado","Mesa reservada en eventos especiales"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  change_amount INT NOT NULL,
  reason TEXT NOT NULL,
  reason_code TEXT,
  balance_after INT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_user ON public.loyalty_points(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_event ON public.loyalty_points(event_id);
ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "loyalty_points_self_read" ON public.loyalty_points FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "loyalty_points_admin_all" ON public.loyalty_points FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.loyalty_balance(_user_id UUID) RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(change_amount), 0)::INT FROM public.loyalty_points WHERE user_id = _user_id AND (expires_at IS NULL OR expires_at > now());
$$;
GRANT EXECUTE ON FUNCTION public.loyalty_balance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_grant_points(_user_id UUID, _amount INT, _reason TEXT, _reason_code TEXT DEFAULT NULL, _event_id UUID DEFAULT NULL, _ticket_id UUID DEFAULT NULL, _org_id UUID DEFAULT NULL, _expires_at TIMESTAMPTZ DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_balance INT;
BEGIN
  IF _amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  v_new_balance := COALESCE(public.loyalty_balance(_user_id),0) + _amount;
  INSERT INTO public.loyalty_points (user_id, change_amount, reason, reason_code, event_id, ticket_id, org_id, balance_after, expires_at)
  VALUES (_user_id, _amount, _reason, _reason_code, _event_id, _ticket_id, _org_id, v_new_balance, _expires_at);
  RETURN v_new_balance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.loyalty_grant_points(UUID, INT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;

-- partner_favorites
CREATE TABLE IF NOT EXISTS public.partner_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_favorites_user ON public.partner_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_favorites_org ON public.partner_favorites(org_id);
ALTER TABLE public.partner_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "partner_favorites_self_all" ON public.partner_favorites FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "partner_favorites_admin_all" ON public.partner_favorites FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
