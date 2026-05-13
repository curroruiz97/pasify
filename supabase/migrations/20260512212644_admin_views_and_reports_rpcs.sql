-- Pasify · 0025 admin views + RPCs admin (Reports)

-- ============================================================================
-- Vistas materializadas / vistas para dashboards
-- ============================================================================
CREATE OR REPLACE VIEW public.v_event_revenue_summary AS
SELECT
  e.id AS event_id,
  e.partner_id,
  e.org_id,
  e.title,
  e.date_start,
  e.city,
  e.status,
  e.capacity,
  e.tickets_sold,
  COALESCE(SUM(o.total_cents), 0)::INT AS gross_revenue_cents,
  COALESCE(SUM(CASE WHEN o.status='paid' THEN o.fees_cents ELSE 0 END), 0)::INT AS fees_cents,
  COALESCE(SUM(CASE WHEN o.status='paid' THEN o.total_cents - o.fees_cents ELSE 0 END), 0)::INT AS net_revenue_cents,
  COUNT(o.id) FILTER (WHERE o.status='paid')::INT AS paid_orders,
  COUNT(o.id) FILTER (WHERE o.status='refunded' OR o.status='partial_refund')::INT AS refunded_orders,
  COUNT(rr.id) FILTER (WHERE rr.status='pending')::INT AS pending_refunds
FROM public.events e
LEFT JOIN public.ticket_orders o ON o.event_id = e.id
LEFT JOIN public.refund_requests rr ON rr.event_id = e.id
GROUP BY e.id, e.partner_id, e.org_id, e.title, e.date_start, e.city, e.status, e.capacity, e.tickets_sold;

GRANT SELECT ON public.v_event_revenue_summary TO authenticated;

CREATE OR REPLACE VIEW public.v_partner_kpis_daily AS
SELECT
  e.org_id,
  DATE(o.paid_at) AS day,
  COUNT(o.id)::INT AS orders_paid,
  SUM(o.total_cents)::BIGINT AS gross_cents,
  SUM(o.total_cents - o.fees_cents)::BIGINT AS net_cents,
  SUM(o.fees_cents)::BIGINT AS platform_fees_cents,
  COUNT(t.id) FILTER (WHERE t.status='paid')::INT AS tickets_paid,
  COUNT(t.id) FILTER (WHERE t.status='used')::INT AS tickets_used
FROM public.ticket_orders o
JOIN public.events e ON e.id = o.event_id
LEFT JOIN public.tickets t ON t.order_id = o.id
WHERE o.status IN ('paid','partial_refund','refunded') AND o.paid_at IS NOT NULL
GROUP BY e.org_id, DATE(o.paid_at);

GRANT SELECT ON public.v_partner_kpis_daily TO authenticated;

CREATE OR REPLACE VIEW public.v_admin_platform_kpis AS
SELECT
  (SELECT COUNT(*) FROM public.organizations WHERE status='active') AS active_orgs,
  (SELECT COUNT(*) FROM public.venues WHERE status='active') AS active_venues,
  (SELECT COUNT(*) FROM public.profiles) AS total_users,
  (SELECT COUNT(*) FROM public.user_roles WHERE role='partner') AS partners,
  (SELECT COUNT(*) FROM public.user_roles WHERE role='client') AS clients,
  (SELECT COUNT(*) FROM public.events WHERE status='published') AS published_events,
  (SELECT COUNT(*) FROM public.tickets WHERE status='paid') AS tickets_paid_lifetime,
  (SELECT COUNT(*) FROM public.tickets WHERE status='used') AS tickets_used_lifetime,
  (SELECT COUNT(*) FROM public.refund_requests WHERE status='pending') AS pending_refunds,
  (SELECT COUNT(*) FROM public.partner_subscriptions WHERE status='active') AS active_subscriptions,
  (SELECT COALESCE(SUM(amount_cents),0) FROM public.application_fees_ledger WHERE recorded_at > now() - INTERVAL '30 days') AS platform_revenue_30d_cents;

GRANT SELECT ON public.v_admin_platform_kpis TO authenticated;

-- ============================================================================
-- Admin RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_list_users(
  _search TEXT DEFAULT NULL, _role_filter TEXT DEFAULT NULL, _status_filter TEXT DEFAULT NULL, _limit INT DEFAULT 50, _offset INT DEFAULT 0
)
RETURNS TABLE (id UUID, email TEXT, first_name TEXT, last_name TEXT, business_name TEXT, account_status TEXT, role TEXT, city TEXT, country TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.first_name, p.last_name, p.business_name, p.account_status::text,
           (SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = p.id LIMIT 1),
           p.city, p.country, p.created_at
    FROM public.profiles p
    WHERE (_search IS NULL OR p.email ILIKE '%'||_search||'%' OR COALESCE(p.business_name,'') ILIKE '%'||_search||'%' OR COALESCE(p.first_name,'') ILIKE '%'||_search||'%' OR COALESCE(p.last_name,'') ILIKE '%'||_search||'%')
      AND (_role_filter IS NULL OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _role_filter))
      AND (_status_filter IS NULL OR p.account_status::text = _status_filter)
    ORDER BY p.created_at DESC
    LIMIT _limit OFFSET _offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_partner_access(_user_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'partner') ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.profiles SET account_status = 'approved' WHERE id = _user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_grant_partner_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_partner_access(_user_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'partner';
  UPDATE public.profiles SET account_status = 'rejected' WHERE id = _user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_partner_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_metrics_timeseries(_days INT DEFAULT 30)
RETURNS TABLE (day DATE, signups INT, tickets_sold INT, gross_cents BIGINT, platform_fees_cents BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN QUERY
    WITH days AS (SELECT generate_series((CURRENT_DATE - (_days || ' days')::interval)::date, CURRENT_DATE, '1 day')::date AS day)
    SELECT
      d.day,
      COUNT(p.id) FILTER (WHERE DATE(p.created_at) = d.day)::INT AS signups,
      COUNT(t.id) FILTER (WHERE t.status='paid' AND DATE(t.paid_at) = d.day)::INT AS tickets_sold,
      COALESCE(SUM(o.total_cents) FILTER (WHERE o.status='paid' AND DATE(o.paid_at) = d.day), 0)::BIGINT AS gross_cents,
      COALESCE(SUM(o.fees_cents) FILTER (WHERE o.status='paid' AND DATE(o.paid_at) = d.day), 0)::BIGINT AS platform_fees_cents
    FROM days d
    LEFT JOIN public.profiles p ON DATE(p.created_at) = d.day
    LEFT JOIN public.ticket_orders o ON DATE(o.paid_at) = d.day
    LEFT JOIN public.tickets t ON DATE(t.paid_at) = d.day
    GROUP BY d.day
    ORDER BY d.day;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_metrics_timeseries(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_top_events(_limit INT DEFAULT 20, _days INT DEFAULT 90)
RETURNS TABLE (event_id UUID, title TEXT, city TEXT, partner_id UUID, business_name TEXT, tickets_sold INT, gross_revenue_cents INT, date_start TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN QUERY
    SELECT e.id, e.title, e.city, e.partner_id, p.business_name, e.tickets_sold,
           COALESCE((SELECT SUM(o.total_cents) FROM public.ticket_orders o WHERE o.event_id = e.id AND o.status='paid'), 0)::INT,
           e.date_start
    FROM public.events e
    LEFT JOIN public.profiles p ON p.id = e.partner_id
    WHERE e.date_start > now() - (_days || ' days')::interval
    ORDER BY e.tickets_sold DESC, e.date_start DESC
    LIMIT _limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_top_events(INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_subscription_funnel()
RETURNS TABLE (status TEXT, count INT, mrr_cents BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  RETURN QUERY
    SELECT ps.status::text, COUNT(*)::INT,
           COALESCE(SUM(CASE WHEN ps.billing_interval='monthly' THEN sp.monthly_price_cents ELSE sp.yearly_price_cents/12 END), 0)::BIGINT
    FROM public.partner_subscriptions ps
    LEFT JOIN public.subscription_plans sp ON sp.id = ps.plan_id
    GROUP BY ps.status
    ORDER BY ps.status;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_subscription_funnel() TO authenticated;

-- Global search (rudimentary cross-table search)
CREATE OR REPLACE FUNCTION public.global_search(_q TEXT, _limit INT DEFAULT 20)
RETURNS TABLE (kind TEXT, id UUID, title TEXT, subtitle TEXT, link TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    (SELECT 'event'::text, e.id, e.title, e.city || ' · ' || to_char(e.date_start, 'DD-MM-YYYY HH24:MI'), '/calendar?event=' || e.id::text
     FROM public.events e WHERE e.status IN ('published','past') AND e.title ILIKE '%' || _q || '%' LIMIT _limit)
    UNION ALL
    (SELECT 'organization'::text, o.id, o.name, COALESCE(o.city,'')||' · '||o.country, '/p/' || o.id::text
     FROM public.organizations o WHERE o.status='active' AND o.name ILIKE '%' || _q || '%' LIMIT _limit)
    UNION ALL
    (SELECT 'venue'::text, v.id, v.name, v.city, '/v/' || v.id::text
     FROM public.venues v WHERE v.status='active' AND v.name ILIKE '%' || _q || '%' LIMIT _limit)
    UNION ALL
    (SELECT 'brand'::text, b.id, b.name, COALESCE(b.tagline,''), '/b/' || b.id::text
     FROM public.brands b WHERE b.status='active' AND b.name ILIKE '%' || _q || '%' LIMIT _limit);
END;
$$;
GRANT EXECUTE ON FUNCTION public.global_search(TEXT, INT) TO authenticated;

-- ============================================================================
-- service_status_snapshots + alerting_rules + bug_reports + help_faq + business_categories + event_categories + music_genres + media_renditions + errors_i18n
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.service_status_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational','degraded','partial_outage','major_outage','maintenance')),
  latency_ms INT,
  error_pct NUMERIC(5,2),
  message TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_status_service_recorded ON public.service_status_snapshots(service, recorded_at DESC);
ALTER TABLE public.service_status_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_status_public_read" ON public.service_status_snapshots FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "service_status_admin_write" ON public.service_status_snapshots FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.alerting_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  query TEXT NOT NULL,
  threshold NUMERIC,
  comparator TEXT NOT NULL CHECK (comparator IN ('gt','lt','eq','gte','lte')),
  window_seconds INT NOT NULL DEFAULT 300,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  notify_channels JSONB NOT NULL DEFAULT '["email"]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.alerting_rules ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_alerting_rules_updated_at BEFORE UPDATE ON public.alerting_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "alerting_rules_admin_all" ON public.alerting_rules FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  role TEXT,
  page TEXT,
  description TEXT NOT NULL,
  screenshot_path TEXT,
  console_logs TEXT,
  user_agent TEXT,
  url TEXT,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','in_progress','fixed','wontfix','duplicate')),
  triaged_at TIMESTAMPTZ,
  triaged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON public.bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON public.bug_reports(created_at DESC);
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bug_reports_self_insert" ON public.bug_reports FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "bug_reports_self_read" ON public.bug_reports FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "bug_reports_admin_all" ON public.bug_reports FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.help_faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('client','partner','admin','all')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tag TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, slug)
);
CREATE INDEX IF NOT EXISTS idx_help_faq_role ON public.help_faq(role, sort_order);
ALTER TABLE public.help_faq ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_help_faq_updated_at BEFORE UPDATE ON public.help_faq FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "help_faq_public_read" ON public.help_faq FOR SELECT TO anon, authenticated USING (active = TRUE);
CREATE POLICY "help_faq_admin_write" ON public.help_faq FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.business_categories (
  code TEXT PRIMARY KEY,
  label_es TEXT NOT NULL,
  label_en TEXT NOT NULL,
  icon TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.business_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_categories_public_read" ON public.business_categories FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "business_categories_admin_write" ON public.business_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.event_categories (
  code TEXT PRIMARY KEY,
  label_es TEXT NOT NULL,
  label_en TEXT NOT NULL,
  icon TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_categories_public_read" ON public.event_categories FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "event_categories_admin_write" ON public.event_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.music_genres (
  code TEXT PRIMARY KEY,
  label_es TEXT NOT NULL,
  label_en TEXT NOT NULL,
  parent_code TEXT REFERENCES public.music_genres(code),
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.music_genres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "music_genres_public_read" ON public.music_genres FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "music_genres_admin_write" ON public.music_genres FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.media_renditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path TEXT NOT NULL,
  bucket TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('thumb','medium','large','hero','poster','square')),
  path TEXT NOT NULL,
  width INT,
  height INT,
  size_bytes BIGINT,
  format TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_path, variant)
);
CREATE INDEX IF NOT EXISTS idx_media_renditions_source ON public.media_renditions(source_path);
ALTER TABLE public.media_renditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_renditions_authenticated_read" ON public.media_renditions FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "media_renditions_admin_write" ON public.media_renditions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.errors_i18n (
  code TEXT PRIMARY KEY,
  en TEXT NOT NULL,
  es TEXT NOT NULL,
  fr TEXT,
  it TEXT,
  pt TEXT,
  de TEXT
);
ALTER TABLE public.errors_i18n ENABLE ROW LEVEL SECURITY;
CREATE POLICY "errors_i18n_public_read" ON public.errors_i18n FOR SELECT TO anon, authenticated USING (TRUE);
CREATE POLICY "errors_i18n_admin_write" ON public.errors_i18n FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
