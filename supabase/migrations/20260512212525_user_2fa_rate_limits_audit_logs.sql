-- Pasify · 0024 user_2fa + rate_limits + audit_logs

CREATE TYPE public.user_2fa_method_t AS ENUM ('totp','sms','email');

CREATE TABLE IF NOT EXISTS public.user_2fa (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  method public.user_2fa_method_t NOT NULL DEFAULT 'totp',
  totp_secret_encrypted BYTEA,
  phone TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  backup_codes_hashed TEXT[] NOT NULL DEFAULT '{}',
  enabled_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_2fa ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_user_2fa_updated_at BEFORE UPDATE ON public.user_2fa FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "user_2fa_self_all" ON public.user_2fa FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_2fa_admin_read" ON public.user_2fa FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- rate_limits (token bucket simple)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON public.rate_limits(expires_at);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limits_admin_read" ON public.rate_limits FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.check_rate_limit(_key TEXT, _max INT, _window_sec INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.rate_limits%ROWTYPE;
BEGIN
  -- Garbage collect expirados
  DELETE FROM public.rate_limits WHERE expires_at < now();
  SELECT * INTO v_row FROM public.rate_limits WHERE key = _key FOR UPDATE;
  IF v_row.key IS NULL THEN
    INSERT INTO public.rate_limits (key, count, window_start, expires_at) VALUES (_key, 1, now(), now() + make_interval(secs => _window_sec));
    RETURN TRUE;
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.rate_limits SET count = 1, window_start = now(), expires_at = now() + make_interval(secs => _window_sec) WHERE key = _key;
    RETURN TRUE;
  END IF;
  IF v_row.count >= _max THEN RETURN FALSE; END IF;
  UPDATE public.rate_limits SET count = count + 1 WHERE key = _key;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO service_role;

-- ============================================================================
-- audit_logs global
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id UUID,
  before JSONB,
  after JSONB,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_kind, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON public.audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_self_read" ON public.audit_logs FOR SELECT TO authenticated USING (actor_user_id = auth.uid());
CREATE POLICY "audit_logs_org_admin_read" ON public.audit_logs FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "audit_logs_admin_all" ON public.audit_logs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.audit_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_role TEXT;
  v_before JSONB;
  v_after JSONB;
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
  IF TG_OP = 'UPDATE' THEN v_before := row_to_json(OLD)::jsonb; v_after := row_to_json(NEW)::jsonb;
  ELSIF TG_OP = 'DELETE' THEN v_before := row_to_json(OLD)::jsonb; v_after := NULL;
  ELSE v_before := NULL; v_after := row_to_json(NEW)::jsonb; END IF;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, action, target_kind, target_id, before, after)
  VALUES (v_actor, COALESCE(v_role,'service'), TG_OP || '_' || TG_TABLE_NAME, TG_TABLE_NAME, COALESCE((NEW.id)::uuid, (OLD.id)::uuid), v_before, v_after);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Aplicar audit a tablas críticas
DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles AFTER UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_events ON public.events;
CREATE TRIGGER trg_audit_events AFTER UPDATE OR DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_refund_requests ON public.refund_requests;
CREATE TRIGGER trg_audit_refund_requests AFTER UPDATE OR DELETE ON public.refund_requests FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_partner_subscriptions ON public.partner_subscriptions;
CREATE TRIGGER trg_audit_partner_subscriptions AFTER UPDATE OR DELETE ON public.partner_subscriptions FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_ai_kill_switches ON public.ai_kill_switches;
CREATE TRIGGER trg_audit_ai_kill_switches AFTER UPDATE OR DELETE ON public.ai_kill_switches FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_organization_members ON public.organization_members;
CREATE TRIGGER trg_audit_organization_members AFTER UPDATE OR DELETE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_whitelabel_configs ON public.whitelabel_configs;
CREATE TRIGGER trg_audit_whitelabel_configs AFTER UPDATE OR DELETE ON public.whitelabel_configs FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_organizations ON public.organizations;
CREATE TRIGGER trg_audit_organizations AFTER UPDATE OR DELETE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_app_settings ON public.app_settings;
CREATE TRIGGER trg_audit_app_settings AFTER UPDATE OR DELETE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
DROP TRIGGER IF EXISTS trg_audit_feature_flags ON public.feature_flags;
CREATE TRIGGER trg_audit_feature_flags AFTER UPDATE OR DELETE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.audit_changes();
