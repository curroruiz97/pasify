-- Pasify · 0020 AI capabilities + decisions + policies + anomalies + audit + kill_switches

CREATE TYPE public.ai_capability_status_t AS ENUM ('active','paused','killed','beta','deprecated');
CREATE TYPE public.ai_decision_status_t AS ENUM ('proposed','approved','rejected','expired','executed','failed');
CREATE TYPE public.ai_anomaly_severity_t AS ENUM ('low','medium','high','critical');
CREATE TYPE public.ai_audit_result_t AS ENUM ('ok','blocked','escalated','failed','dry_run');

CREATE TABLE IF NOT EXISTS public.ai_capabilities (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  status public.ai_capability_status_t NOT NULL DEFAULT 'active',
  precision_target NUMERIC(4,3),
  latency_target_ms INT,
  error_target_pct NUMERIC(5,3),
  provider TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_capabilities ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_ai_capabilities_updated_at BEFORE UPDATE ON public.ai_capabilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "ai_capabilities_authenticated_read" ON public.ai_capabilities FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "ai_capabilities_admin_write" ON public.ai_capabilities FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed capabilities
INSERT INTO public.ai_capabilities (code, name, description, status, precision_target, latency_target_ms, error_target_pct, provider) VALUES
  ('autopilot',  'AutoPilot',           'Agente autónomo que ejecuta pricing/marketing/refunds/soporte', 'beta',   0.94, 500,   0.5, 'pasify'),
  ('pricing',    'Pricing IA',          'Motor de pricing dinámico basado en demanda y elasticidad',     'beta',   0.91, 200,   0.3, 'pasify'),
  ('forecast',   'Forecast IA',         'Predicción de venta de tickets por evento con intervalos',      'active', 0.89, 10000, 0.1, 'pasify'),
  ('door_vision','Door Vision',         'Computer vision para identificación facial y aforo',            'beta',   0.97, 100,   1.0, 'partner_provider'),
  ('concierge',  'Concierge IA',        'Auto-respuestas en soporte cliente con escalado humano',         'active', 0.88, 800,   0.8, 'openai'),
  ('marketing',  'Marketing IA',        'Auto-campañas en Meta/TikTok/Email con bidding cap',             'beta',   0.92, 2000,  0.2, 'openai'),
  ('benchmarks', 'Industry Benchmarks', 'Agregación anónima cross-tenant de métricas',                   'active', NULL, NULL,  NULL, 'pasify')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ai_kill_switches
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_kill_switches (
  capability_code TEXT PRIMARY KEY REFERENCES public.ai_capabilities(code) ON DELETE CASCADE,
  killed BOOLEAN NOT NULL DEFAULT FALSE,
  killed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  killed_at TIMESTAMPTZ,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_kill_switches ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_ai_kill_switches_updated_at BEFORE UPDATE ON public.ai_kill_switches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "ai_kill_switches_authenticated_read" ON public.ai_kill_switches FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "ai_kill_switches_admin_write" ON public.ai_kill_switches FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.ai_kill_switches (capability_code, killed) SELECT code, FALSE FROM public.ai_capabilities ON CONFLICT (capability_code) DO NOTHING;

-- ============================================================================
-- ai_policies (por org)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  capability_code TEXT NOT NULL REFERENCES public.ai_capabilities(code) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, capability_code, key)
);

CREATE INDEX IF NOT EXISTS idx_ai_policies_org ON public.ai_policies(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_policies_cap ON public.ai_policies(capability_code);

ALTER TABLE public.ai_policies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_ai_policies_updated_at BEFORE UPDATE ON public.ai_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "ai_policies_member_read" ON public.ai_policies FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "ai_policies_owner_write" ON public.ai_policies FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "ai_policies_admin_all" ON public.ai_policies FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- ai_decisions (cada decisión del agente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_code TEXT NOT NULL REFERENCES public.ai_capabilities(code) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  impact_eur NUMERIC(12,2),
  needs_approval BOOLEAN NOT NULL DEFAULT FALSE,
  auto_approved_reason TEXT,
  policy_scope TEXT,
  confidence NUMERIC(4,3),
  model_version TEXT,
  status public.ai_decision_status_t NOT NULL DEFAULT 'proposed',
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_note TEXT,
  executed_at TIMESTAMPTZ,
  execution_result JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_cap ON public.ai_decisions(capability_code);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_org ON public.ai_decisions(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_status ON public.ai_decisions(status);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_needs_approval ON public.ai_decisions(needs_approval) WHERE needs_approval = TRUE;
CREATE INDEX IF NOT EXISTS idx_ai_decisions_created ON public.ai_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_event ON public.ai_decisions(event_id);

ALTER TABLE public.ai_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_decisions_member_read" ON public.ai_decisions FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.is_member_of_org(org_id));
CREATE POLICY "ai_decisions_member_decide" ON public.ai_decisions FOR UPDATE TO authenticated USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "ai_decisions_admin_all" ON public.ai_decisions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- ai_anomalies
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_code TEXT NOT NULL REFERENCES public.ai_capabilities(code) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  severity public.ai_anomaly_severity_t NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_anomalies_cap ON public.ai_anomalies(capability_code);
CREATE INDEX IF NOT EXISTS idx_ai_anomalies_severity ON public.ai_anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_ai_anomalies_open ON public.ai_anomalies(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_ai_anomalies_created ON public.ai_anomalies(created_at DESC);

ALTER TABLE public.ai_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_anomalies_admin_all" ON public.ai_anomalies FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ai_anomalies_member_read" ON public.ai_anomalies FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

-- ============================================================================
-- ai_audit_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_code TEXT NOT NULL REFERENCES public.ai_capabilities(code) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  decision_id UUID REFERENCES public.ai_decisions(id) ON DELETE SET NULL,
  action_summary TEXT NOT NULL,
  result public.ai_audit_result_t NOT NULL,
  model_version TEXT,
  request_id UUID,
  latency_ms INT,
  prompt_tokens INT,
  completion_tokens INT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_cap ON public.ai_audit_log(capability_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_org ON public.ai_audit_log(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_result ON public.ai_audit_log(result);

ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_audit_admin_all" ON public.ai_audit_log FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "ai_audit_member_read" ON public.ai_audit_log FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

-- ============================================================================
-- RPC: decide_ai_decision
-- ============================================================================
CREATE OR REPLACE FUNCTION public.decide_ai_decision(_decision_id UUID, _decision TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.ai_decisions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_row FROM public.ai_decisions WHERE id = _decision_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Decision no encontrada'; END IF;
  IF v_row.status NOT IN ('proposed') THEN RAISE EXCEPTION 'Decision ya tratada'; END IF;
  IF NOT (public.has_role(v_uid,'admin') OR (v_row.org_id IS NOT NULL AND public.has_org_role(v_row.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF _decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision invalida'; END IF;
  UPDATE public.ai_decisions SET
    status = CASE WHEN _decision='approve' THEN 'approved'::public.ai_decision_status_t ELSE 'rejected'::public.ai_decision_status_t END,
    decided_by = v_uid, decided_at = now(), decision_note = _note
  WHERE id = _decision_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decide_ai_decision(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_ai_kill_switch(_capability TEXT, _reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_killed BOOLEAN;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.ai_kill_switches SET
    killed = NOT killed,
    killed_at = CASE WHEN NOT killed THEN now() ELSE NULL END,
    killed_by = CASE WHEN NOT killed THEN auth.uid() ELSE NULL END,
    reason = COALESCE(_reason, reason),
    updated_at = now()
  WHERE capability_code = _capability
  RETURNING killed INTO v_killed;
  RETURN v_killed;
END;
$$;
GRANT EXECUTE ON FUNCTION public.toggle_ai_kill_switch(TEXT, TEXT) TO authenticated;
