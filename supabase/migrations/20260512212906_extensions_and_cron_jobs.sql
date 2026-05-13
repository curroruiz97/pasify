-- Pasify · 0028 extensions + pg_cron schedules + cron_runs

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- cron_runs: log de ejecuciones de jobs (observabilidad)
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','skipped')),
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON public.cron_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON public.cron_runs(status);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cron_runs_admin_read" ON public.cron_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ========================================================================
-- MAINTENANCE FUNCTIONS (operan en SQL puro — no requieren edge functions)
-- ========================================================================

-- Marca eventos como 'past' 30 minutos después de su date_start (asumimos
-- que los eventos duran al menos 8h) o cuando date_end ha pasado
CREATE OR REPLACE FUNCTION public.cron_mark_past_events()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('mark_past_events','running') RETURNING id INTO v_run_id;
  UPDATE public.events SET status = 'past', updated_at = now()
  WHERE status = 'published'
    AND ((date_end IS NOT NULL AND date_end < now())
         OR (date_end IS NULL AND date_start < now() - INTERVAL '8 hours'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('events_marked', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Limpia rate_limits expirados
CREATE OR REPLACE FUNCTION public.cron_cleanup_rate_limits()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('cleanup_rate_limits','running') RETURNING id INTO v_run_id;
  DELETE FROM public.rate_limits WHERE expires_at < now() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('deleted', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Expira ticket_orders pending que llevan >30 min sin pago
CREATE OR REPLACE FUNCTION public.cron_expire_pending_orders()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('expire_pending_orders','running') RETURNING id INTO v_run_id;
  UPDATE public.ticket_orders SET status = 'expired'
  WHERE status = 'pending' AND created_at < now() - INTERVAL '30 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- También expirar tickets pending de esas órdenes
  UPDATE public.tickets t SET status = 'cancelled'
  FROM public.ticket_orders o WHERE t.order_id = o.id AND o.status = 'expired' AND t.status = 'pending';
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('expired', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Expira transferencias de tickets no aceptadas
CREATE OR REPLACE FUNCTION public.cron_expire_ticket_transfers()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('expire_ticket_transfers','running') RETURNING id INTO v_run_id;
  UPDATE public.ticket_transfers SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('expired', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Cierra wallets cashless después de 48h del evento + crea cashless_refunds para saldos residuales
CREATE OR REPLACE FUNCTION public.cron_close_event_wallets()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('close_event_wallets','running') RETURNING id INTO v_run_id;
  WITH ev AS (
    SELECT id FROM public.events WHERE status = 'past' AND date_start < now() - INTERVAL '48 hours'
  ), to_close AS (
    SELECT w.id, w.balance_cents FROM public.cashless_wallets w WHERE w.status='active' AND w.event_id IN (SELECT id FROM ev)
  ), refunds AS (
    INSERT INTO public.cashless_refunds (wallet_id, amount_cents, status)
    SELECT id, balance_cents, 'pending' FROM to_close WHERE balance_cents > 0
    RETURNING wallet_id
  )
  UPDATE public.cashless_wallets SET status = 'closed', closed_at = now() WHERE id IN (SELECT id FROM to_close);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('wallets_closed', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Limpia notifications viejas leídas (90 días)
CREATE OR REPLACE FUNCTION public.cron_cleanup_old_notifications()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('cleanup_old_notifications','running') RETURNING id INTO v_run_id;
  DELETE FROM public.notifications WHERE read_at IS NOT NULL AND read_at < now() - INTERVAL '90 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('deleted', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- Limpia cron_runs viejos (>30 días) y audit_logs viejos (>365 días)
CREATE OR REPLACE FUNCTION public.cron_cleanup_logs()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.cron_runs WHERE started_at < now() - INTERVAL '30 days';
  DELETE FROM public.audit_logs WHERE created_at < now() - INTERVAL '365 days';
  DELETE FROM public.ai_audit_log WHERE created_at < now() - INTERVAL '90 days';
  DELETE FROM public.service_status_snapshots WHERE recorded_at < now() - INTERVAL '90 days';
  DELETE FROM public.stripe_webhook_events WHERE received_at < now() - INTERVAL '180 days' AND status IN ('processed','ignored','duplicate');
END;
$$;

-- Expira DSAR requests con deadline cumplido (auto-deletion 30 días después de approved)
CREATE OR REPLACE FUNCTION public.cron_process_dsar_deadlines()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT; v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('process_dsar_deadlines','running') RETURNING id INTO v_run_id;
  -- Solo alertar: marca para procesamiento; el edge function gdpr-export se encarga del resto
  UPDATE public.compliance_dsar_requests SET status = 'in_progress' WHERE status = 'pending' AND deadline_at < now() + INTERVAL '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs SET finished_at = now(), status = 'success', metadata = jsonb_build_object('alerted', v_count) WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

-- ========================================================================
-- SCHEDULES (pg_cron)
-- ========================================================================
SELECT cron.schedule('pasify-mark-past-events',       '*/15 * * * *', $$SELECT public.cron_mark_past_events()$$);
SELECT cron.schedule('pasify-cleanup-rate-limits',    '*/30 * * * *', $$SELECT public.cron_cleanup_rate_limits()$$);
SELECT cron.schedule('pasify-expire-pending-orders',  '*/10 * * * *', $$SELECT public.cron_expire_pending_orders()$$);
SELECT cron.schedule('pasify-expire-ticket-transfers','0 */4 * * *',  $$SELECT public.cron_expire_ticket_transfers()$$);
SELECT cron.schedule('pasify-close-event-wallets',    '0 3 * * *',    $$SELECT public.cron_close_event_wallets()$$);
SELECT cron.schedule('pasify-cleanup-old-notifs',     '0 4 * * 0',    $$SELECT public.cron_cleanup_old_notifications()$$);
SELECT cron.schedule('pasify-cleanup-logs',           '0 5 * * 0',    $$SELECT public.cron_cleanup_logs()$$);
SELECT cron.schedule('pasify-process-dsar',           '0 6 * * *',    $$SELECT public.cron_process_dsar_deadlines()$$);
