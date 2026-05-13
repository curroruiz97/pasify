-- Pasify · 0014 refund_requests (aditiva)
CREATE TYPE public.refund_request_status_t AS ENUM ('pending','approved','rejected','processing','refunded','failed');
CREATE TYPE public.refund_request_sender_t AS ENUM ('client','partner','admin','system');

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.ticket_orders(id) ON DELETE SET NULL,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  requester_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  reason TEXT NOT NULL,
  reason_code TEXT,
  status public.refund_request_status_t NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  stripe_refund_id TEXT UNIQUE,
  stripe_refund_status TEXT,
  stripe_failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
  auto_approve_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_ticket ON public.refund_requests(ticket_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_order ON public.refund_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_event ON public.refund_requests(event_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_org ON public.refund_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_requester ON public.refund_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON public.refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_created ON public.refund_requests(created_at DESC);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_refund_requests_updated_at BEFORE UPDATE ON public.refund_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "refund_requests_requester_read" ON public.refund_requests FOR SELECT TO authenticated USING (requester_user_id = auth.uid());
CREATE POLICY "refund_requests_member_read" ON public.refund_requests FOR SELECT TO authenticated USING (org_id IS NOT NULL AND public.is_member_of_org(org_id));
CREATE POLICY "refund_requests_member_decide" ON public.refund_requests FOR UPDATE TO authenticated
  USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "refund_requests_requester_insert" ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = refund_requests.ticket_id AND (t.buyer_user_id = auth.uid() OR t.transferred_to_user_id = auth.uid()) AND t.status = 'paid'));
CREATE POLICY "refund_requests_admin_all" ON public.refund_requests FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.refund_request_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.refund_requests(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_kind public.refund_request_sender_t NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_messages_request ON public.refund_request_messages(request_id, created_at);
ALTER TABLE public.refund_request_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refund_messages_requester_read" ON public.refund_request_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id = refund_request_messages.request_id AND r.requester_user_id = auth.uid()));
CREATE POLICY "refund_messages_requester_insert" ON public.refund_request_messages FOR INSERT TO authenticated WITH CHECK (sender_kind = 'client' AND sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id = refund_request_messages.request_id AND r.requester_user_id = auth.uid()));
CREATE POLICY "refund_messages_member_read" ON public.refund_request_messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id = refund_request_messages.request_id AND r.org_id IS NOT NULL AND public.is_member_of_org(r.org_id)));
CREATE POLICY "refund_messages_member_insert" ON public.refund_request_messages FOR INSERT TO authenticated WITH CHECK (sender_kind = 'partner' AND sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.id = refund_request_messages.request_id AND r.org_id IS NOT NULL AND public.has_org_role(r.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "refund_messages_admin_all" ON public.refund_request_messages FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.request_refund(_ticket_id UUID, _reason TEXT, _reason_code TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tier public.ticket_tiers%ROWTYPE;
  v_request_id UUID;
  v_email TEXT;
  v_auto_approve BOOLEAN := FALSE;
  v_auto_reason TEXT;
  v_hours_to_event NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket no encontrado'; END IF;
  IF v_ticket.buyer_user_id <> v_uid AND v_ticket.transferred_to_user_id <> v_uid THEN RAISE EXCEPTION 'No eres propietario'; END IF;
  IF v_ticket.status <> 'paid' THEN RAISE EXCEPTION 'Solo tickets pagados (status=%)', v_ticket.status; END IF;
  IF v_ticket.used_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket ya escaneado'; END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE ticket_id = _ticket_id AND status NOT IN ('rejected','failed')) THEN RAISE EXCEPTION 'Ya existe solicitud'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT * INTO v_tier FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
    v_hours_to_event := EXTRACT(EPOCH FROM (v_event.date_start - now())) / 3600.0;
    IF v_hours_to_event > v_tier.refundable_until_hours_before THEN
      v_auto_approve := TRUE;
      v_auto_reason := format('within_policy_t-%sh', v_tier.refundable_until_hours_before);
    END IF;
  END IF;
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.refund_requests (ticket_id, order_id, event_id, org_id, requester_user_id, requester_email, amount_cents, currency, reason, reason_code, status, auto_approved, auto_approve_reason, decided_at, decided_by)
  VALUES (_ticket_id, v_ticket.order_id, v_ticket.event_id, v_event.org_id, v_uid, v_email, v_ticket.amount_paid_cents, v_ticket.currency, _reason, _reason_code,
    CASE WHEN v_auto_approve THEN 'approved'::public.refund_request_status_t ELSE 'pending'::public.refund_request_status_t END,
    v_auto_approve, v_auto_reason,
    CASE WHEN v_auto_approve THEN now() ELSE NULL END,
    CASE WHEN v_auto_approve THEN v_uid ELSE NULL END)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_refund(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_refund(_request_id UUID, _decision TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request public.refund_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id = _request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Request no encontrada'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Request ya decidida'; END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR (v_request.org_id IS NOT NULL AND public.has_org_role(v_request.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF _decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision inválida'; END IF;
  UPDATE public.refund_requests SET status = CASE WHEN _decision = 'approve' THEN 'approved'::public.refund_request_status_t ELSE 'rejected'::public.refund_request_status_t END,
    decided_by = v_uid, decided_at = now(), decision_note = _note, updated_at = now()
  WHERE id = _request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_refund(UUID, TEXT, TEXT) TO authenticated;
