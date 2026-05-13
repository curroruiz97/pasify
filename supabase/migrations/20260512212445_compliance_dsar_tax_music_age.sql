-- Pasify · 0023 compliance: DSAR + age policies + tax filings + music licenses

CREATE TYPE public.dsar_type_t AS ENUM ('export','deletion','rectification','restriction','objection','portability');
CREATE TYPE public.dsar_status_t AS ENUM ('pending','in_progress','completed','rejected','cancelled');

CREATE TABLE IF NOT EXISTS public.compliance_dsar_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  type public.dsar_type_t NOT NULL,
  status public.dsar_status_t NOT NULL DEFAULT 'pending',
  notes TEXT,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  export_path TEXT,
  export_size_bytes BIGINT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsar_user ON public.compliance_dsar_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_dsar_status ON public.compliance_dsar_requests(status);
CREATE INDEX IF NOT EXISTS idx_dsar_deadline ON public.compliance_dsar_requests(deadline_at);
ALTER TABLE public.compliance_dsar_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dsar_self_read" ON public.compliance_dsar_requests FOR SELECT TO authenticated USING (requester_user_id = auth.uid());
CREATE POLICY "dsar_self_insert" ON public.compliance_dsar_requests FOR INSERT TO authenticated WITH CHECK (requester_user_id = auth.uid());
CREATE POLICY "dsar_admin_all" ON public.compliance_dsar_requests FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.compliance_age_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  min_age INT NOT NULL CHECK (min_age >= 0),
  require_id_check BOOLEAN NOT NULL DEFAULT TRUE,
  require_face_match BOOLEAN NOT NULL DEFAULT FALSE,
  bracelet_color TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_age_policies_org ON public.compliance_age_policies(org_id);
CREATE INDEX IF NOT EXISTS idx_age_policies_event ON public.compliance_age_policies(event_id);
ALTER TABLE public.compliance_age_policies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_age_policies_updated_at BEFORE UPDATE ON public.compliance_age_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "age_policies_member_read" ON public.compliance_age_policies FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "age_policies_member_write" ON public.compliance_age_policies FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "age_policies_admin_all" ON public.compliance_age_policies FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TYPE public.tax_filing_kind_t AS ENUM ('modelo_303','modelo_349','modelo_347','modelo_390','FR_CA12','FR_CA3','IT_LIPE','PT_IVA','UK_VAT');
CREATE TYPE public.tax_filing_status_t AS ENUM ('draft','submitted','accepted','rejected','amended');

CREATE TABLE IF NOT EXISTS public.tax_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ES',
  kind public.tax_filing_kind_t NOT NULL,
  status public.tax_filing_status_t NOT NULL DEFAULT 'draft',
  amount_due_cents INT,
  amount_paid_cents INT,
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload_path TEXT,
  agency_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tax_filings_org ON public.tax_filings(org_id);
CREATE INDEX IF NOT EXISTS idx_tax_filings_kind ON public.tax_filings(kind);
CREATE INDEX IF NOT EXISTS idx_tax_filings_status ON public.tax_filings(status);
CREATE INDEX IF NOT EXISTS idx_tax_filings_period ON public.tax_filings(period);
ALTER TABLE public.tax_filings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tax_filings_updated_at BEFORE UPDATE ON public.tax_filings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "tax_filings_member_read" ON public.tax_filings FOR SELECT TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "tax_filings_owner_write" ON public.tax_filings FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "tax_filings_admin_all" ON public.tax_filings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.music_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'ES',
  agency TEXT NOT NULL CHECK (agency IN ('SGAE','AGEDI','AIE','DACEM','SACEM','SIAE','PRS','GVL')),
  license_number TEXT NOT NULL,
  start_date DATE,
  expiry_date DATE,
  annual_fee_cents INT,
  document_path TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring','expired','suspended')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_music_licenses_org ON public.music_licenses(org_id);
CREATE INDEX IF NOT EXISTS idx_music_licenses_expiry ON public.music_licenses(expiry_date);
ALTER TABLE public.music_licenses ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_music_licenses_updated_at BEFORE UPDATE ON public.music_licenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "music_licenses_member_read" ON public.music_licenses FOR SELECT TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "music_licenses_owner_write" ON public.music_licenses FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "music_licenses_admin_all" ON public.music_licenses FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- compliance_consents (GDPR consent tracking)
CREATE TABLE IF NOT EXISTS public.compliance_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_kind TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  version TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON public.compliance_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_consents_kind ON public.compliance_consents(consent_kind);
ALTER TABLE public.compliance_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consents_self_read" ON public.compliance_consents FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "consents_self_insert" ON public.compliance_consents FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "consents_admin_all" ON public.compliance_consents FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
