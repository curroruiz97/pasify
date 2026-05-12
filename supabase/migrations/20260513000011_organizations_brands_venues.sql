-- ============================================================================
-- Pasify · 0011 multi-tenancy: organizations → brands → venues
-- Modelo enterprise: una organization (grupo) tiene varias brands (marcas),
-- cada brand tiene varios venues (locales físicos). Un partner = 1 organization.
-- ============================================================================

-- ============================================================================
-- organizations — entidad legal/comercial top-level
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,                              -- pacha-group, costa-group, etc.
  name TEXT NOT NULL,
  legal_name TEXT,                                        -- razón social
  tier TEXT NOT NULL DEFAULT 'starter'                    -- starter | business | enterprise
    CHECK (tier IN ('starter','business','enterprise')),

  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  billing_email TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  vat_id TEXT,                                            -- NIF/CIF/VAT
  country TEXT NOT NULL DEFAULT 'ES',
  address TEXT,
  city TEXT,
  postal_code TEXT,

  -- Stripe a nivel organización (moved from profiles)
  stripe_customer_id TEXT UNIQUE,
  stripe_connect_account_id TEXT UNIQUE,
  stripe_connect_onboarded BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- Subscription Pasify (qué plan paga el partner)
  subscription_status TEXT,                               -- active|past_due|canceled|trialing
  subscription_plan_code TEXT,                            -- starter|business|enterprise
  subscription_current_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','closed')),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_tier ON public.organizations(tier);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_country ON public.organizations(country);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer ON public.organizations(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_connect ON public.organizations(stripe_connect_account_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Policies básicas — la policy fina por membership va en 0012.
DROP POLICY IF EXISTS "organizations_owner_read" ON public.organizations;
CREATE POLICY "organizations_owner_read"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "organizations_owner_update" ON public.organizations;
CREATE POLICY "organizations_owner_update"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "organizations_admin_all" ON public.organizations;
CREATE POLICY "organizations_admin_all"
  ON public.organizations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- brands — marcas dentro de una organization
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  slug TEXT NOT NULL,                                     -- razzmatazz, sala-apolo, etc.
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,

  logo_url TEXT,
  favicon_url TEXT,
  cover_image_url TEXT,

  -- White-label colors (override de la default Pasify)
  primary_color TEXT,
  accent_color TEXT,
  ink_color TEXT,
  bg_color TEXT,

  website_url TEXT,
  instagram_handle TEXT,
  tiktok_handle TEXT,
  spotify_artist_id TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),

  sort_order INT NOT NULL DEFAULT 0,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brands_org ON public.brands(org_id);
CREATE INDEX IF NOT EXISTS idx_brands_status ON public.brands(status);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_brands_updated_at ON public.brands;
CREATE TRIGGER trg_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lectura pública de brands activos (necesaria para feed cliente y página pública)
DROP POLICY IF EXISTS "brands_public_read" ON public.brands;
CREATE POLICY "brands_public_read"
  ON public.brands FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "brands_admin_all" ON public.brands;
CREATE POLICY "brands_admin_all"
  ON public.brands FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- venues — locales físicos dentro de una brand
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- org_id denormalizado para policies / queries cross-brand más rápidas

  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  business_category TEXT,                                 -- discoteca|club|bar|sala|festival|rooftop|beachclub|otro

  address TEXT,
  city TEXT NOT NULL,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'ES',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',

  capacity INT CHECK (capacity IS NULL OR capacity > 0),
  cover_image_url TEXT,
  description TEXT,

  phone TEXT,
  email TEXT,
  opening_hours JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { mon: [{open,close}], ... }

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (brand_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_venues_brand ON public.venues(brand_id);
CREATE INDEX IF NOT EXISTS idx_venues_org ON public.venues(org_id);
CREATE INDEX IF NOT EXISTS idx_venues_city ON public.venues(city);
CREATE INDEX IF NOT EXISTS idx_venues_status ON public.venues(status);
CREATE INDEX IF NOT EXISTS idx_venues_category ON public.venues(business_category);

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_venues_updated_at ON public.venues;
CREATE TRIGGER trg_venues_updated_at
  BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "venues_public_read" ON public.venues;
CREATE POLICY "venues_public_read"
  ON public.venues FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "venues_admin_all" ON public.venues;
CREATE POLICY "venues_admin_all"
  ON public.venues FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- profiles → last_active_venue_id FK
-- ============================================================================
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_last_active_venue_fk
  FOREIGN KEY (last_active_venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;

-- ============================================================================
-- events → venue_id + brand_id + org_id (denormalizado)
-- ============================================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_id   UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_venue ON public.events(venue_id);
CREATE INDEX IF NOT EXISTS idx_events_brand ON public.events(brand_id);
CREATE INDEX IF NOT EXISTS idx_events_org   ON public.events(org_id);

-- Trigger: al INSERT/UPDATE de events, si venue_id está set y brand_id/org_id no,
-- los rellenamos automáticamente.
CREATE OR REPLACE FUNCTION public.events_set_org_chain()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_brand UUID;
  v_org UUID;
BEGIN
  IF NEW.venue_id IS NOT NULL AND (NEW.brand_id IS NULL OR NEW.org_id IS NULL) THEN
    SELECT brand_id, org_id INTO v_brand, v_org FROM public.venues WHERE id = NEW.venue_id;
    NEW.brand_id := COALESCE(NEW.brand_id, v_brand);
    NEW.org_id   := COALESCE(NEW.org_id, v_org);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_set_org_chain ON public.events;
CREATE TRIGGER trg_events_set_org_chain
  BEFORE INSERT OR UPDATE OF venue_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_set_org_chain();

-- ============================================================================
-- partner_galleries (reemplaza gallery legacy)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.partner_galleries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  caption TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_galleries_brand ON public.partner_galleries(brand_id);
CREATE INDEX IF NOT EXISTS idx_partner_galleries_venue ON public.partner_galleries(venue_id);

ALTER TABLE public.partner_galleries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "partner_galleries_public_read" ON public.partner_galleries;
CREATE POLICY "partner_galleries_public_read"
  ON public.partner_galleries FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "partner_galleries_admin_all" ON public.partner_galleries;
CREATE POLICY "partner_galleries_admin_all"
  ON public.partner_galleries FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- RPC: create_organization(name, country) — atómico, crea org+brand+venue default
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_organization(
  _name TEXT,
  _country TEXT DEFAULT 'ES',
  _slug TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org_id UUID;
  v_brand_id UUID;
  v_venue_id UUID;
  v_slug TEXT;
  v_brand_slug TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Calcular slug si no se pasó
  v_slug := COALESCE(_slug, lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g')));
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'org-' || substring(v_uid::text, 1, 8);
  END IF;

  -- Asegurar unicidad de slug
  WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) LOOP
    v_slug := v_slug || '-' || substring(gen_random_uuid()::text, 1, 4);
  END LOOP;

  INSERT INTO public.organizations (slug, name, country, owner_id)
  VALUES (v_slug, _name, _country, v_uid)
  RETURNING id INTO v_org_id;

  v_brand_slug := v_slug;
  INSERT INTO public.brands (org_id, slug, name)
  VALUES (v_org_id, v_brand_slug, _name)
  RETURNING id INTO v_brand_id;

  INSERT INTO public.venues (brand_id, org_id, slug, name, city, country)
  VALUES (v_brand_id, v_org_id, 'principal', 'Principal', COALESCE((SELECT business_city FROM public.profiles WHERE id = v_uid), 'Madrid'), _country)
  RETURNING id INTO v_venue_id;

  -- Marcar venue activo del profile
  UPDATE public.profiles SET last_active_venue_id = v_venue_id WHERE id = v_uid;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- RPC: switch_active_venue(_venue_id) — partner cambia venue activo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.switch_active_venue(_venue_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validar acceso: o eres owner de la org, o miembro activo
  IF NOT EXISTS (
    SELECT 1 FROM public.venues v
    JOIN public.organizations o ON o.id = v.org_id
    WHERE v.id = _venue_id
      AND (o.owner_id = v_uid OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.org_id = v.org_id AND om.user_id = v_uid AND om.status = 'active'
      ))
  ) THEN
    RAISE EXCEPTION 'No access to this venue';
  END IF;

  UPDATE public.profiles SET last_active_venue_id = _venue_id WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_active_venue(UUID) TO authenticated;
