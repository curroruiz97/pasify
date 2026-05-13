-- Pasify · 0022 marketplace_apps + installed_apps + whitelabel_configs

CREATE TYPE public.marketplace_app_status_t AS ENUM ('available','beta','deprecated','coming_soon');
CREATE TYPE public.installed_app_status_t AS ENUM ('connected','disconnected','error','syncing','pending_auth');

CREATE TABLE IF NOT EXISTS public.marketplace_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  icon_slug TEXT,
  icon_color TEXT,
  oauth_provider TEXT,
  scopes_required JSONB NOT NULL DEFAULT '[]'::jsonb,
  official BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_price_cents INT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  popular BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  status public.marketplace_app_status_t NOT NULL DEFAULT 'available',
  documentation_url TEXT,
  support_email TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_apps_category ON public.marketplace_apps(category);
CREATE INDEX IF NOT EXISTS idx_marketplace_apps_status ON public.marketplace_apps(status);

ALTER TABLE public.marketplace_apps ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_marketplace_apps_updated_at BEFORE UPDATE ON public.marketplace_apps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "marketplace_apps_public_read" ON public.marketplace_apps FOR SELECT TO anon, authenticated USING (status IN ('available','beta'));
CREATE POLICY "marketplace_apps_admin_all" ON public.marketplace_apps FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.installed_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES public.marketplace_apps(id) ON DELETE CASCADE,
  app_code TEXT NOT NULL,
  status public.installed_app_status_t NOT NULL DEFAULT 'pending_auth',
  oauth_credentials_encrypted BYTEA,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  installed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_error TEXT,
  disconnected_at TIMESTAMPTZ,
  UNIQUE (org_id, app_code)
);
CREATE INDEX IF NOT EXISTS idx_installed_apps_org ON public.installed_apps(org_id);
CREATE INDEX IF NOT EXISTS idx_installed_apps_status ON public.installed_apps(status);
ALTER TABLE public.installed_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installed_apps_member_read" ON public.installed_apps FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "installed_apps_owner_write" ON public.installed_apps FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "installed_apps_admin_all" ON public.installed_apps FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.app_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installed_app_id UUID NOT NULL REFERENCES public.installed_apps(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  event_name TEXT NOT NULL,
  target_url TEXT,
  secret_hash TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_delivery_at TIMESTAMPTZ,
  last_delivery_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_webhooks_installed ON public.app_webhooks(installed_app_id);
ALTER TABLE public.app_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_webhooks_member_read" ON public.app_webhooks FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.installed_apps a WHERE a.id = app_webhooks.installed_app_id AND public.is_member_of_org(a.org_id)));
CREATE POLICY "app_webhooks_owner_write" ON public.app_webhooks FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.installed_apps a WHERE a.id = app_webhooks.installed_app_id AND public.has_org_role(a.org_id, ARRAY['owner','admin']::public.org_member_role_t[]))) WITH CHECK (EXISTS (SELECT 1 FROM public.installed_apps a WHERE a.id = app_webhooks.installed_app_id AND public.has_org_role(a.org_id, ARRAY['owner','admin']::public.org_member_role_t[])));
CREATE POLICY "app_webhooks_admin_all" ON public.app_webhooks FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.whitelabel_configs (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  subdomain TEXT UNIQUE,
  custom_domain TEXT UNIQUE,
  primary_color TEXT,
  accent_color TEXT,
  ink_color TEXT,
  bg_color TEXT,
  logo_url TEXT,
  logo_dark_url TEXT,
  favicon_url TEXT,
  app_name_override TEXT,
  email_sender_name TEXT,
  email_sender_email TEXT,
  email_reply_to TEXT,
  legal_company_name TEXT,
  legal_address TEXT,
  legal_vat_id TEXT,
  terms_url TEXT,
  privacy_url TEXT,
  cookies_url TEXT,
  support_email TEXT,
  support_phone TEXT,
  mobile_app_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mobile_app_bundle_id TEXT,
  mobile_app_scheme TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_css TEXT,
  custom_head_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','staging','live','suspended')),
  go_live_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whitelabel_subdomain ON public.whitelabel_configs(subdomain) WHERE subdomain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whitelabel_custom_domain ON public.whitelabel_configs(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whitelabel_status ON public.whitelabel_configs(status);

ALTER TABLE public.whitelabel_configs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_whitelabel_updated_at BEFORE UPDATE ON public.whitelabel_configs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lectura por subdomain/custom_domain: pública (necesario para resolver branding antes de auth)
CREATE POLICY "whitelabel_public_resolve" ON public.whitelabel_configs FOR SELECT TO anon, authenticated USING (status = 'live');
CREATE POLICY "whitelabel_member_read" ON public.whitelabel_configs FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "whitelabel_owner_write" ON public.whitelabel_configs FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "whitelabel_admin_all" ON public.whitelabel_configs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.resolve_whitelabel_host(_host TEXT)
RETURNS TABLE (org_id UUID, subdomain TEXT, custom_domain TEXT, primary_color TEXT, accent_color TEXT, logo_url TEXT, app_name_override TEXT, support_email TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.org_id, w.subdomain, w.custom_domain, w.primary_color, w.accent_color, w.logo_url, w.app_name_override, w.support_email
  FROM public.whitelabel_configs w
  WHERE w.status = 'live' AND (w.custom_domain = _host OR (w.subdomain IS NOT NULL AND _host = w.subdomain || '.pasify.es'))
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_whitelabel_host(TEXT) TO anon, authenticated;
