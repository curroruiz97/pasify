-- Pasify · 0016 stripe_webhook_events + payouts + application_fees + payout_schedules

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored','duplicate')),
  attempt_count INT NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_event_type ON public.stripe_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_status ON public.stripe_webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_received ON public.stripe_webhook_events(received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_webhook_events_admin_read" ON public.stripe_webhook_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TYPE public.stripe_payout_status_t AS ENUM ('pending','in_transit','paid','failed','cancelled');

CREATE TABLE IF NOT EXISTS public.stripe_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  stripe_payout_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL,
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status public.stripe_payout_status_t NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  failure_message TEXT,
  arrival_date DATE,
  method TEXT,
  destination_kind TEXT,
  destination_last4 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_payouts_org ON public.stripe_payouts(org_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_status ON public.stripe_payouts(status);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_arrival ON public.stripe_payouts(arrival_date DESC);

ALTER TABLE public.stripe_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_payouts_member_read" ON public.stripe_payouts FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.is_member_of_org(org_id));
CREATE POLICY "stripe_payouts_admin_all" ON public.stripe_payouts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.application_fees_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ticket_order_id UUID REFERENCES public.ticket_orders(id) ON DELETE SET NULL,
  stripe_application_fee_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  amount_cents INT NOT NULL,
  gross_cents INT NOT NULL,
  net_to_partner_cents INT NOT NULL,
  stripe_fee_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_amount_cents INT NOT NULL DEFAULT 0,
  refunded_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_fees_org ON public.application_fees_ledger(org_id);
CREATE INDEX IF NOT EXISTS idx_application_fees_order ON public.application_fees_ledger(ticket_order_id);
CREATE INDEX IF NOT EXISTS idx_application_fees_recorded ON public.application_fees_ledger(recorded_at DESC);

ALTER TABLE public.application_fees_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "application_fees_admin_read" ON public.application_fees_ledger FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "application_fees_member_read" ON public.application_fees_ledger FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

CREATE TABLE IF NOT EXISTS public.payout_schedules (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily','weekly','monthly','manual')),
  min_amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  weekly_day INT CHECK (weekly_day BETWEEN 1 AND 7),
  monthly_day INT CHECK (monthly_day BETWEEN 1 AND 31),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payout_schedules ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_payout_schedules_updated_at BEFORE UPDATE ON public.payout_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "payout_schedules_member_read" ON public.payout_schedules FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "payout_schedules_owner_write" ON public.payout_schedules FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "payout_schedules_admin_all" ON public.payout_schedules FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.mark_order_paid(_session_id TEXT, _payment_intent_id TEXT, _amount_total_cents INT, _application_fee_cents INT DEFAULT 0)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.ticket_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.ticket_orders WHERE stripe_session_id = _session_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order no encontrada %', _session_id; END IF;
  IF v_order.status = 'paid' THEN RETURN v_order.id; END IF;
  UPDATE public.ticket_orders SET status = 'paid', paid_at = now(), stripe_payment_intent_id = _payment_intent_id, total_cents = _amount_total_cents, fees_cents = _application_fee_cents WHERE id = v_order.id;
  UPDATE public.tickets SET status = 'paid', paid_at = now(), stripe_payment_intent_id = _payment_intent_id WHERE order_id = v_order.id AND status = 'pending';
  RETURN v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_refund_processed(_stripe_refund_id TEXT, _amount_refunded_cents INT, _payment_intent_id TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_order public.ticket_orders%ROWTYPE;
  v_remaining_paid INT;
BEGIN
  SELECT * INTO v_request FROM public.refund_requests WHERE stripe_refund_id = _stripe_refund_id FOR UPDATE;
  IF v_request.id IS NULL THEN
    SELECT r.* INTO v_request FROM public.refund_requests r
    JOIN public.ticket_orders o ON o.id = r.order_id
    WHERE o.stripe_payment_intent_id = _payment_intent_id AND r.status = 'processing' LIMIT 1;
  END IF;
  IF v_request.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.refund_requests SET status = 'refunded', stripe_refund_id = _stripe_refund_id, stripe_refund_status = 'succeeded', processed_at = now(), updated_at = now() WHERE id = v_request.id;
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_request.ticket_id;
  SELECT * INTO v_order FROM public.ticket_orders WHERE id = v_request.order_id;
  IF v_order.id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_remaining_paid FROM public.tickets WHERE order_id = v_order.id AND status = 'paid';
    IF v_remaining_paid = 0 THEN
      UPDATE public.ticket_orders SET status = 'refunded', refunded_at = now() WHERE id = v_order.id;
    ELSE
      UPDATE public.ticket_orders SET status = 'partial_refund' WHERE id = v_order.id;
    END IF;
  END IF;
  RETURN v_request.id;
END;
$$;
