-- Pasify · 0015 subscription_plans + partner_subscriptions + app_settings + feature_flags

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  monthly_price_cents INT NOT NULL DEFAULT 0,
  yearly_price_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  max_venues INT,
  max_team_members INT,
  max_events_per_month INT,
  ai_capabilities_included TEXT[] NOT NULL DEFAULT '{}',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  visible_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  trial_days INT NOT NULL DEFAULT 14,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','grandfathered','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON public.subscription_plans(code);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_subscription_plans_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "subscription_plans_public_read" ON public.subscription_plans FOR SELECT TO anon, authenticated USING (visible_public = TRUE AND status = 'active');
CREATE POLICY "subscription_plans_admin_all" ON public.subscription_plans FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TYPE public.partner_subscription_status_t AS ENUM ('trialing','active','past_due','unpaid','cancel_at_period_end','cancelled','paused','incomplete','incomplete_expired');

CREATE TABLE IF NOT EXISTS public.partner_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  plan_code TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  status public.partner_subscription_status_t NOT NULL DEFAULT 'trialing',
  billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly','yearly')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_starts_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  last_payment_at TIMESTAMPTZ,
  last_payment_amount_cents INT,
  last_payment_failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_subscriptions_org ON public.partner_subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_partner_subscriptions_status ON public.partner_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_partner_subscriptions_stripe_sub ON public.partner_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_partner_subscriptions_plan ON public.partner_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_partner_subscriptions_period_end ON public.partner_subscriptions(current_period_end);

ALTER TABLE public.partner_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_partner_subscriptions_updated_at BEFORE UPDATE ON public.partner_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "partner_subscriptions_member_read" ON public.partner_subscriptions FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "partner_subscriptions_admin_all" ON public.partner_subscriptions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_public_read" ON public.app_settings FOR SELECT TO anon, authenticated USING (key LIKE 'public.%' OR key IN ('partner_trial_enabled','partner_trial_days','maintenance_mode','signup_enabled'));
CREATE POLICY "app_settings_admin_all" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_app_setting_bool(_key TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (value::text)::boolean FROM public.app_settings WHERE key = _key LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_app_setting_int(_key TEXT) RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (value::text)::int FROM public.app_settings WHERE key = _key LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_app_setting_text(_key TEXT) RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value::text FROM public.app_settings WHERE key = _key LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_app_setting(_key TEXT, _value JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  INSERT INTO public.app_settings (key, value, updated_by, updated_at) VALUES (_key, _value, v_uid, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_app_setting(TEXT, JSONB) TO authenticated;

CREATE TABLE IF NOT EXISTS public.feature_flags (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_pct NUMERIC NOT NULL DEFAULT 0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
  tenant_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_feature_flags_updated_at BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "feature_flags_read" ON public.feature_flags FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "feature_flags_admin_write" ON public.feature_flags FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_feature_flag(_code TEXT, _org_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
  v_override JSONB;
BEGIN
  SELECT * INTO v_flag FROM public.feature_flags WHERE code = _code;
  IF v_flag.code IS NULL THEN RETURN FALSE; END IF;
  IF _org_id IS NOT NULL THEN
    v_override := v_flag.tenant_overrides->(_org_id::text);
    IF v_override IS NOT NULL THEN RETURN (v_override::text)::boolean; END IF;
  END IF;
  IF NOT v_flag.enabled THEN RETURN FALSE; END IF;
  IF v_flag.rollout_pct >= 100 THEN RETURN TRUE; END IF;
  IF v_flag.rollout_pct <= 0 THEN RETURN FALSE; END IF;
  RETURN (abs(hashtext(coalesce(_org_id::text, auth.uid()::text, 'anon') || _code)) % 100) < v_flag.rollout_pct;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_feature_flag(TEXT, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_partner_trial(_org_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org_id UUID := _org_id;
  v_plan_starter public.subscription_plans%ROWTYPE;
  v_sub_id UUID;
  v_trial_days INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE owner_id = v_uid LIMIT 1;
    IF v_org_id IS NULL THEN RAISE EXCEPTION 'No organization'; END IF;
  END IF;
  IF NOT public.has_org_role(v_org_id, ARRAY['owner','admin']::public.org_member_role_t[]) THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF NOT public.get_app_setting_bool('partner_trial_enabled') THEN RAISE EXCEPTION 'Trial deshabilitado'; END IF;
  v_trial_days := COALESCE(public.get_app_setting_int('partner_trial_days'), 14);
  SELECT * INTO v_plan_starter FROM public.subscription_plans WHERE code = 'starter';
  INSERT INTO public.partner_subscriptions (org_id, plan_id, plan_code, status, billing_interval, trial_starts_at, trial_ends_at, current_period_start, current_period_end)
  VALUES (v_org_id, v_plan_starter.id, v_plan_starter.code, 'trialing', 'monthly', now(), now() + (v_trial_days || ' days')::interval, now(), now() + (v_trial_days || ' days')::interval)
  ON CONFLICT (org_id) DO UPDATE SET status = CASE WHEN partner_subscriptions.status = 'cancelled' THEN 'trialing'::public.partner_subscription_status_t ELSE partner_subscriptions.status END, updated_at = now()
  RETURNING id INTO v_sub_id;
  RETURN v_sub_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_partner_trial(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_admin_by_email(_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
  v_admin_count INT;
BEGIN
  SELECT COUNT(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';
  IF v_admin_count > 0 AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT id INTO v_uid FROM public.profiles WHERE lower(email) = lower(_email) LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'User no encontrado'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN v_uid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_admin_by_email(TEXT) TO authenticated;
