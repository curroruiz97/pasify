-- ============================================================================
-- Pasify · 0015 subscription_plans + partner_subscriptions
-- Planes Pasify (Starter/Business/Enterprise) que el partner contrata.
-- Diferente del Stripe Connect (que es lo que el partner usa para cobrar
-- a sus clientes finales).
-- ============================================================================

-- ============================================================================
-- subscription_plans — catálogo de planes Pasify
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,                              -- starter|business|enterprise|custom
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,

  -- Stripe price IDs (test + live se gestionan via env)
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,

  monthly_price_cents INT NOT NULL DEFAULT 0,
  yearly_price_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',

  -- Limits & features
  max_venues INT,
  max_team_members INT,
  max_events_per_month INT,
  ai_capabilities_included TEXT[] NOT NULL DEFAULT '{}',  -- ['forecast','pricing','autopilot']
  features JSONB NOT NULL DEFAULT '{}'::jsonb,            -- white-label, custom domain, etc.

  visible_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  trial_days INT NOT NULL DEFAULT 14,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','grandfathered','retired')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_code ON public.subscription_plans(code);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Públicos: cualquiera ve los planes visibles
DROP POLICY IF EXISTS "subscription_plans_public_read" ON public.subscription_plans;
CREATE POLICY "subscription_plans_public_read"
  ON public.subscription_plans FOR SELECT
  TO anon, authenticated
  USING (visible_public = TRUE AND status = 'active');

DROP POLICY IF EXISTS "subscription_plans_admin_all" ON public.subscription_plans;
CREATE POLICY "subscription_plans_admin_all"
  ON public.subscription_plans FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- Seed planes iniciales
-- ============================================================================
INSERT INTO public.subscription_plans (code, name, tagline, monthly_price_cents, yearly_price_cents, max_venues, max_team_members, max_events_per_month, ai_capabilities_included, features, sort_order, trial_days)
VALUES
  ('starter', 'Starter', 'Para locales que empiezan en Pasify', 4900, 49000,
    1, 5, 20, ARRAY['forecast']::TEXT[],
    '{"white_label": false, "custom_domain": false, "support_level": "email"}'::jsonb, 1, 14),
  ('business', 'Business', 'Para grupos en crecimiento', 14900, 149000,
    5, 20, 100, ARRAY['forecast','pricing','marketing']::TEXT[],
    '{"white_label": true, "custom_domain": false, "support_level": "priority"}'::jsonb, 2, 14),
  ('enterprise', 'Enterprise', 'Para grupos consolidados y festivales', 49900, 499000,
    NULL, NULL, NULL, ARRAY['forecast','pricing','marketing','autopilot','door_vision']::TEXT[],
    '{"white_label": true, "custom_domain": true, "support_level": "dedicated_csm", "sla": "99.95%"}'::jsonb, 3, 30)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- partner_subscriptions — relación 1:1 con organizations
-- ============================================================================
CREATE TYPE public.partner_subscription_status_t AS ENUM (
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'cancel_at_period_end',
  'cancelled',
  'paused',
  'incomplete',
  'incomplete_expired'
);

CREATE TABLE IF NOT EXISTS public.partner_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  plan_code TEXT,                                         -- denormalizado para queries rápidas

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

DROP TRIGGER IF EXISTS trg_partner_subscriptions_updated_at ON public.partner_subscriptions;
CREATE TRIGGER trg_partner_subscriptions_updated_at
  BEFORE UPDATE ON public.partner_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Miembros del org pueden ver su subscription
DROP POLICY IF EXISTS "partner_subscriptions_member_read" ON public.partner_subscriptions;
CREATE POLICY "partner_subscriptions_member_read"
  ON public.partner_subscriptions FOR SELECT
  TO authenticated
  USING (public.is_member_of_org(org_id));

DROP POLICY IF EXISTS "partner_subscriptions_admin_all" ON public.partner_subscriptions;
CREATE POLICY "partner_subscriptions_admin_all"
  ON public.partner_subscriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INSERT/UPDATE solo service_role (stripe-webhook)

-- ============================================================================
-- app_settings + feature_flags
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- App settings públicos: solo claves whitelisted (los toggles que el cliente lee)
DROP POLICY IF EXISTS "app_settings_public_read" ON public.app_settings;
CREATE POLICY "app_settings_public_read"
  ON public.app_settings FOR SELECT
  TO anon, authenticated
  USING (key LIKE 'public.%' OR key IN ('partner_trial_enabled','partner_trial_days','maintenance_mode'));

DROP POLICY IF EXISTS "app_settings_admin_all" ON public.app_settings;
CREATE POLICY "app_settings_admin_all"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed defaults
INSERT INTO public.app_settings (key, value, description) VALUES
  ('partner_trial_enabled', 'true'::jsonb, 'Si true, los nuevos partners reciben trial automático al elegir plan'),
  ('partner_trial_days', '14'::jsonb, 'Duración del trial gratuito en días'),
  ('maintenance_mode', 'false'::jsonb, 'Modo mantenimiento global de la plataforma'),
  ('signup_enabled', 'true'::jsonb, 'Si false, deshabilita signups públicos'),
  ('application_fee_pct', '5.0'::jsonb, 'Application fee Pasify sobre ventas de tickets, en %'),
  ('refund_grace_period_hours', '168'::jsonb, 'Horas antes del evento durante las que se auto-aprueban reembolsos')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- RPCs settings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_app_setting_bool(_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (value::text)::boolean FROM public.app_settings WHERE key = _key LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_app_setting_int(_key TEXT)
RETURNS INT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (value::text)::int FROM public.app_settings WHERE key = _key LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_app_setting_text(_key TEXT)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value::text FROM public.app_settings WHERE key = _key LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_app_setting(_key TEXT, _value JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  INSERT INTO public.app_settings (key, value, updated_by, updated_at)
  VALUES (_key, _value, v_uid, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_app_setting(TEXT, JSONB) TO authenticated;

-- ============================================================================
-- feature_flags
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_pct NUMERIC NOT NULL DEFAULT 0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
  tenant_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"org_id_uuid": true, ...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "feature_flags_read" ON public.feature_flags;
CREATE POLICY "feature_flags_read"
  ON public.feature_flags FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "feature_flags_admin_write" ON public.feature_flags;
CREATE POLICY "feature_flags_admin_write"
  ON public.feature_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_feature_flag(_code TEXT, _org_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
  v_override JSONB;
BEGIN
  SELECT * INTO v_flag FROM public.feature_flags WHERE code = _code;
  IF v_flag.code IS NULL THEN RETURN FALSE; END IF;

  -- Override por tenant
  IF _org_id IS NOT NULL THEN
    v_override := v_flag.tenant_overrides->(_org_id::text);
    IF v_override IS NOT NULL THEN
      RETURN (v_override::text)::boolean;
    END IF;
  END IF;

  IF NOT v_flag.enabled THEN RETURN FALSE; END IF;

  -- Rollout estable por hash UUID
  IF v_flag.rollout_pct >= 100 THEN RETURN TRUE; END IF;
  IF v_flag.rollout_pct <= 0 THEN RETURN FALSE; END IF;

  RETURN (
    abs(hashtext(coalesce(_org_id::text, auth.uid()::text, 'anon') || _code)) % 100
  ) < v_flag.rollout_pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_feature_flag(TEXT, UUID) TO anon, authenticated;

-- ============================================================================
-- RPC: start_partner_trial — desde PartnerChoosePlan
-- ============================================================================
CREATE OR REPLACE FUNCTION public.start_partner_trial(_org_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org_id UUID := _org_id;
  v_plan_starter public.subscription_plans%ROWTYPE;
  v_sub_id UUID;
  v_trial_days INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations WHERE owner_id = v_uid LIMIT 1;
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No organization for current user';
    END IF;
  END IF;

  IF NOT public.has_org_role(v_org_id, ARRAY['owner','admin']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Validar setting
  IF NOT public.get_app_setting_bool('partner_trial_enabled') THEN
    RAISE EXCEPTION 'Trial deshabilitado';
  END IF;

  v_trial_days := COALESCE(public.get_app_setting_int('partner_trial_days'), 14);

  SELECT * INTO v_plan_starter FROM public.subscription_plans WHERE code = 'starter';

  -- Idempotente: si ya existe subscription, no duplica
  INSERT INTO public.partner_subscriptions (
    org_id, plan_id, plan_code, status,
    billing_interval, trial_starts_at, trial_ends_at,
    current_period_start, current_period_end
  )
  VALUES (
    v_org_id, v_plan_starter.id, v_plan_starter.code, 'trialing',
    'monthly', now(), now() + (v_trial_days || ' days')::interval,
    now(), now() + (v_trial_days || ' days')::interval
  )
  ON CONFLICT (org_id) DO UPDATE
    SET status = CASE WHEN partner_subscriptions.status = 'cancelled' THEN 'trialing'::public.partner_subscription_status_t
                      ELSE partner_subscriptions.status END,
        updated_at = now()
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_partner_trial(UUID) TO authenticated;

-- ============================================================================
-- RPC: set_admin_by_email — para bootstrap admin (AdminSetup)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_admin_by_email(_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_admin_count INT;
BEGIN
  -- Bootstrap protection: solo se permite si NO hay ningún admin todavía,
  -- O si quien llama YA es admin.
  SELECT COUNT(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin';

  IF v_admin_count > 0 AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT id INTO v_uid FROM public.profiles WHERE lower(email) = lower(_email) LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'User no encontrado';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_admin_by_email(TEXT) TO authenticated;

-- Permitir INSERT de admin via service_role o via la RPC SECURITY DEFINER
-- (la policy user_roles_self_insert sólo permite client/partner; admin se gestiona aquí)
