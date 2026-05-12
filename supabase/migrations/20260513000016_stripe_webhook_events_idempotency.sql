-- ============================================================================
-- Pasify · 0016 stripe_webhook_events (idempotencia) +
-- stripe_payouts + application_fees_ledger
-- ============================================================================

-- ============================================================================
-- stripe_webhook_events — log de todos los eventos recibidos (idempotencia)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,                          -- evt_xxx de Stripe
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processed','failed','ignored','duplicate')),
  attempt_count INT NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_event_type ON public.stripe_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_status ON public.stripe_webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_received ON public.stripe_webhook_events(received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stripe_webhook_events_admin_read" ON public.stripe_webhook_events;
CREATE POLICY "stripe_webhook_events_admin_read"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- INSERT/UPDATE solo service_role (webhook handler)

-- ============================================================================
-- stripe_payouts — registro de payouts a cuentas connected
-- ============================================================================
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
  method TEXT,                                            -- standard|instant
  destination_kind TEXT,                                  -- bank_account|card
  destination_last4 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_payouts_org ON public.stripe_payouts(org_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_status ON public.stripe_payouts(status);
CREATE INDEX IF NOT EXISTS idx_stripe_payouts_arrival ON public.stripe_payouts(arrival_date DESC);

ALTER TABLE public.stripe_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stripe_payouts_member_read" ON public.stripe_payouts;
CREATE POLICY "stripe_payouts_member_read"
  ON public.stripe_payouts FOR SELECT
  TO authenticated
  USING (org_id IS NOT NULL AND public.is_member_of_org(org_id));

DROP POLICY IF EXISTS "stripe_payouts_admin_all" ON public.stripe_payouts;
CREATE POLICY "stripe_payouts_admin_all"
  ON public.stripe_payouts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- application_fees_ledger — fees Pasify (revenue plataforma)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.application_fees_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ticket_order_id UUID REFERENCES public.ticket_orders(id) ON DELETE SET NULL,

  stripe_application_fee_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,

  amount_cents INT NOT NULL,                              -- fee Pasify
  gross_cents INT NOT NULL,                               -- amount total cobrado
  net_to_partner_cents INT NOT NULL,                      -- lo que va al partner
  stripe_fee_cents INT NOT NULL DEFAULT 0,                -- lo que Stripe cobra
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

DROP POLICY IF EXISTS "application_fees_admin_read" ON public.application_fees_ledger;
CREATE POLICY "application_fees_admin_read"
  ON public.application_fees_ledger FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Partner read sólo de su propia org
DROP POLICY IF EXISTS "application_fees_member_read" ON public.application_fees_ledger;
CREATE POLICY "application_fees_member_read"
  ON public.application_fees_ledger FOR SELECT
  TO authenticated
  USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

-- ============================================================================
-- payout_schedules — configuración por org
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payout_schedules (
  org_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (frequency IN ('daily','weekly','monthly','manual')),
  min_amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  weekly_day INT CHECK (weekly_day BETWEEN 1 AND 7),       -- 1=lunes
  monthly_day INT CHECK (monthly_day BETWEEN 1 AND 31),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payout_schedules ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_payout_schedules_updated_at ON public.payout_schedules;
CREATE TRIGGER trg_payout_schedules_updated_at
  BEFORE UPDATE ON public.payout_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "payout_schedules_member_read" ON public.payout_schedules;
CREATE POLICY "payout_schedules_member_read"
  ON public.payout_schedules FOR SELECT
  TO authenticated
  USING (public.is_member_of_org(org_id));

DROP POLICY IF EXISTS "payout_schedules_owner_write" ON public.payout_schedules;
CREATE POLICY "payout_schedules_owner_write"
  ON public.payout_schedules FOR ALL
  TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

DROP POLICY IF EXISTS "payout_schedules_admin_all" ON public.payout_schedules;
CREATE POLICY "payout_schedules_admin_all"
  ON public.payout_schedules FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- RPC helper: mark_order_paid — usado por stripe-webhook al recibir
-- checkout.session.completed
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_order_paid(
  _session_id TEXT,
  _payment_intent_id TEXT,
  _amount_total_cents INT,
  _application_fee_cents INT DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.ticket_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.ticket_orders WHERE stripe_session_id = _session_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order no encontrada para session %', _session_id;
  END IF;

  IF v_order.status = 'paid' THEN
    -- Idempotente: ya marcada
    RETURN v_order.id;
  END IF;

  UPDATE public.ticket_orders
  SET status = 'paid',
      paid_at = now(),
      stripe_payment_intent_id = _payment_intent_id,
      total_cents = _amount_total_cents,
      fees_cents = _application_fee_cents
  WHERE id = v_order.id;

  -- Marcar tickets de la orden como paid
  UPDATE public.tickets
  SET status = 'paid',
      paid_at = now(),
      stripe_payment_intent_id = _payment_intent_id
  WHERE order_id = v_order.id AND status = 'pending';

  RETURN v_order.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_order_paid(TEXT, TEXT, INT, INT) TO service_role;

-- ============================================================================
-- RPC helper: mark_refund_processed — usado por stripe-webhook al recibir
-- charge.refunded
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mark_refund_processed(
  _stripe_refund_id TEXT,
  _amount_refunded_cents INT,
  _payment_intent_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_order public.ticket_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.refund_requests WHERE stripe_refund_id = _stripe_refund_id FOR UPDATE;

  IF v_request.id IS NULL THEN
    -- Fallback: buscar por payment_intent
    SELECT r.* INTO v_request
    FROM public.refund_requests r
    JOIN public.ticket_orders o ON o.id = r.order_id
    WHERE o.stripe_payment_intent_id = _payment_intent_id AND r.status = 'processing'
    LIMIT 1;
  END IF;

  IF v_request.id IS NULL THEN
    RAISE NOTICE 'No refund_request found for stripe_refund_id=% pi=%', _stripe_refund_id, _payment_intent_id;
    RETURN NULL;
  END IF;

  UPDATE public.refund_requests
  SET status = 'refunded',
      stripe_refund_id = _stripe_refund_id,
      stripe_refund_status = 'succeeded',
      processed_at = now(),
      updated_at = now()
  WHERE id = v_request.id;

  -- Marcar ticket como refunded
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_request.ticket_id;

  -- Marcar order como partial/full refund
  SELECT * INTO v_order FROM public.ticket_orders WHERE id = v_request.order_id;
  IF v_order.id IS NOT NULL THEN
    DECLARE
      v_remaining_paid INT;
    BEGIN
      SELECT COUNT(*) INTO v_remaining_paid FROM public.tickets WHERE order_id = v_order.id AND status = 'paid';
      IF v_remaining_paid = 0 THEN
        UPDATE public.ticket_orders SET status = 'refunded', refunded_at = now() WHERE id = v_order.id;
      ELSE
        UPDATE public.ticket_orders SET status = 'partial_refund' WHERE id = v_order.id;
      END IF;
    END;
  END IF;

  RETURN v_request.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_refund_processed(TEXT, INT, TEXT) TO service_role;

-- ============================================================================
-- Realtime publication — añadir tablas de Fase 2/4
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='ticket_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tickets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='refund_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.refund_requests;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='refund_request_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.refund_request_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='stripe_webhook_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stripe_webhook_events;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='stripe_payouts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.stripe_payouts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='partner_subscriptions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_subscriptions;
  END IF;
END $$;
