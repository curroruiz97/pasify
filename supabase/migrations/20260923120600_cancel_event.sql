-- Pasify · cancelar un evento con reembolso a todos los compradores (WP2.3)
--
-- D7 del plan: si el local cancela, el comprador recupera todo lo que pagó y
-- la comisión de Pasify la asume el local (sigue en el registro de
-- comisiones, así que partner_balance_v le resta ese importe).
--
--   * create_cancellation_refund_requests: una solicitud APROBADA por cada
--     entrada pagada y sin usar del evento (o de un pedido concreto, para el
--     pago que llega tarde a un evento ya cancelado).
--   * partner_cancel_event: estado final 'cancelled' (el trigger de
--     transición impide reactivarlo), anula las reservas pendientes, crea las
--     solicitudes y avisa a los titulares. El reembolso en Stripe lo hace la
--     edge function partner-cancel-event, por tandas y reintentable.
--   * mark_refund_processed: casa el reembolso de Stripe por el id de la
--     solicitud de sus metadatos. Antes buscaba "la primera en proceso del
--     mismo pago", y una cancelación deja varias a la vez por pedido.

-- ============================================================================
-- 1) Solicitudes de reembolso por cancelación
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_cancellation_refund_requests(
  _event_id UUID,
  _decided_by UUID,
  _note TEXT DEFAULT NULL,
  _order_id UUID DEFAULT NULL
)
RETURNS UUID[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_ticket RECORD;
  v_holder UUID;
  v_email TEXT;
  v_request UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = _event_id;
  IF v_event.id IS NULL OR v_event.status <> 'cancelled' THEN
    RETURN v_ids;
  END IF;

  FOR v_ticket IN
    SELECT t.*
      FROM public.tickets t
     WHERE t.event_id = _event_id
       AND (_order_id IS NULL OR t.order_id = _order_id)
       AND t.status = 'paid'
       AND t.used_at IS NULL
     ORDER BY t.id
     FOR UPDATE
  LOOP
    -- Entradas gratuitas: no hay nada que devolver, se anulan.
    IF COALESCE(v_ticket.amount_paid_cents, 0) <= 0 THEN
      UPDATE public.tickets SET status = 'cancelled' WHERE id = v_ticket.id;
      CONTINUE;
    END IF;

    v_holder := COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id);
    IF v_holder IS NULL THEN
      CONTINUE; -- sin titular con cuenta: lo liquida el admin a mano
    END IF;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_holder;

    SELECT r.id INTO v_request FROM public.refund_requests r WHERE r.ticket_id = v_ticket.id FOR UPDATE;
    IF v_request IS NOT NULL THEN
      -- Una solicitud en proceso o ya reembolsada no se toca.
      UPDATE public.refund_requests
         SET order_id = v_ticket.order_id, event_id = v_ticket.event_id, org_id = v_event.org_id,
             requester_user_id = v_holder, requester_email = COALESCE(v_email, requester_email),
             amount_cents = v_ticket.amount_paid_cents, currency = v_ticket.currency,
             reason = 'Evento cancelado por el local', reason_code = 'event_cancelled',
             status = 'approved', auto_approved = FALSE, auto_approve_reason = NULL,
             decided_by = _decided_by, decided_at = now(), decision_note = _note,
             stripe_refund_id = NULL, stripe_refund_status = NULL, stripe_failure_reason = NULL,
             processed_at = NULL, created_at = now()
       WHERE id = v_request
         AND status NOT IN ('processing', 'refunded');
      IF FOUND THEN
        v_ids := v_ids || v_request;
      END IF;
    ELSE
      INSERT INTO public.refund_requests (
        ticket_id, order_id, event_id, org_id, requester_user_id, requester_email,
        amount_cents, currency, reason, reason_code, status, auto_approved,
        decided_by, decided_at, decision_note
      ) VALUES (
        v_ticket.id, v_ticket.order_id, v_ticket.event_id, v_event.org_id, v_holder,
        COALESCE(v_email, v_ticket.buyer_email, ''), v_ticket.amount_paid_cents, v_ticket.currency,
        'Evento cancelado por el local', 'event_cancelled', 'approved', FALSE,
        _decided_by, now(), _note
      )
      RETURNING id INTO v_request;
      v_ids := v_ids || v_request;
    END IF;
    v_request := NULL;
  END LOOP;

  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_cancellation_refund_requests(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_cancellation_refund_requests(UUID, UUID, TEXT, UUID) TO service_role;

-- ============================================================================
-- 2) Cancelar el evento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.partner_cancel_event(_event_id UUID, _reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event public.events%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(_reason, '')), '');
  v_already BOOLEAN;
  v_sessions TEXT[];
  v_requests UUID[];
  v_pending_refunds UUID[];
  v_holder RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN RAISE EXCEPTION 'cancel_reason_required'; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = _event_id FOR UPDATE;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'Event not found'; END IF;
  IF NOT (
    v_event.partner_id IS NOT DISTINCT FROM v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_already := v_event.status = 'cancelled';
  IF NOT v_already THEN
    IF v_event.status NOT IN ('published', 'draft') THEN
      RAISE EXCEPTION 'event_not_cancellable';
    END IF;
    UPDATE public.events
       SET status = 'cancelled',
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'cancelled_at', now(), 'cancelled_by', v_uid, 'cancel_reason', v_reason)
     WHERE id = _event_id;
  END IF;

  -- Reservas sin pagar: fuera. Sus sesiones de Stripe las caduca la edge
  -- function; si aun así llega un pago, order-paid lo devuelve.
  SELECT COALESCE(array_agg(o.stripe_session_id) FILTER (WHERE o.stripe_session_id IS NOT NULL), ARRAY[]::TEXT[])
    INTO v_sessions
    FROM public.ticket_orders o
   WHERE o.event_id = _event_id AND o.status = 'pending';
  UPDATE public.tickets t
     SET status = 'cancelled'
    FROM public.ticket_orders o
   WHERE o.id = t.order_id AND o.event_id = _event_id AND o.status = 'pending' AND t.status = 'pending';
  UPDATE public.ticket_orders SET status = 'failed' WHERE event_id = _event_id AND status = 'pending';

  v_requests := public.create_cancellation_refund_requests(_event_id, v_uid, v_reason, NULL);

  -- Todas las aprobadas pendientes de Stripe (incluye las de un intento
  -- anterior que falló): la edge function las procesa y se puede reintentar.
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), ARRAY[]::UUID[]) INTO v_pending_refunds
    FROM public.refund_requests r
   WHERE r.event_id = _event_id AND r.reason_code = 'event_cancelled' AND r.status IN ('approved', 'failed');
  -- Un reintento: las fallidas vuelven a aprobadas.
  UPDATE public.refund_requests
     SET status = 'approved', stripe_failure_reason = NULL, created_at = now()
   WHERE event_id = _event_id AND reason_code = 'event_cancelled' AND status = 'failed';

  -- Aviso in-app a cada titular (una vez, al cancelar).
  IF NOT v_already THEN
    FOR v_holder IN
      SELECT DISTINCT COALESCE(t.transferred_to_user_id, t.buyer_user_id) AS user_id
        FROM public.tickets t
       WHERE t.event_id = _event_id
         AND t.status IN ('paid', 'cancelled')
         AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) IS NOT NULL
    LOOP
      PERFORM public.enqueue_notification(
        v_holder.user_id, 'tickets', 'event_cancelled',
        'Evento cancelado: ' || v_event.title,
        'El local ha cancelado el evento. Si pagaste, te devolvemos el importe completo.',
        '/#/client-dashboard',
        jsonb_build_object('event_id', _event_id)
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'event_id', _event_id,
    'already_cancelled', v_already,
    'pending_session_ids', to_jsonb(v_sessions),
    'refund_request_ids', to_jsonb(v_pending_refunds),
    'tickets_without_account', (
      SELECT count(*) FROM public.tickets t
       WHERE t.event_id = _event_id AND t.status = 'paid' AND t.used_at IS NULL
         AND COALESCE(t.transferred_to_user_id, t.buyer_user_id) IS NULL
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_cancel_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_cancel_event(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 3) mark_refund_processed: por el id de la solicitud de los metadatos
-- ============================================================================
DROP FUNCTION IF EXISTS public.mark_refund_processed(TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.mark_refund_processed(
  _stripe_refund_id TEXT,
  _amount_refunded_cents INT,
  _payment_intent_id TEXT,
  _refund_request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_order public.ticket_orders%ROWTYPE;
  v_remaining_paid INT;
  v_candidates INT;
BEGIN
  IF _refund_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.refund_requests WHERE id = _refund_request_id FOR UPDATE;
  END IF;
  IF v_request.id IS NULL THEN
    SELECT * INTO v_request FROM public.refund_requests WHERE stripe_refund_id = _stripe_refund_id FOR UPDATE;
  END IF;
  IF v_request.id IS NULL THEN
    -- Reembolsos antiguos sin metadatos: solo si hay UNA en proceso para ese
    -- pago; con varias no se puede saber cuál es.
    SELECT count(*) INTO v_candidates
      FROM public.refund_requests r
      JOIN public.ticket_orders o ON o.id = r.order_id
     WHERE o.stripe_payment_intent_id = _payment_intent_id AND r.status = 'processing';
    IF v_candidates = 1 THEN
      SELECT r.* INTO v_request
        FROM public.refund_requests r
        JOIN public.ticket_orders o ON o.id = r.order_id
       WHERE o.stripe_payment_intent_id = _payment_intent_id AND r.status = 'processing'
       FOR UPDATE OF r;
    END IF;
  END IF;
  IF v_request.id IS NULL THEN RETURN NULL; END IF;
  IF v_request.status = 'refunded' THEN RETURN v_request.id; END IF;

  UPDATE public.refund_requests
     SET status = 'refunded', stripe_refund_id = _stripe_refund_id, stripe_refund_status = 'succeeded',
         processed_at = now(), updated_at = now()
   WHERE id = v_request.id;
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

REVOKE EXECUTE ON FUNCTION public.mark_refund_processed(TEXT, INT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_processed(TEXT, INT, TEXT, UUID) TO service_role;
