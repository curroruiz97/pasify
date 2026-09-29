-- Pasify · Ola 2 · reembolsos, disputas, puntos, referidos y transferencias (S2)
--
--   T1 (B4-05, B1-07, D-3) La devolución la decide el local:
--      * ticket_tiers.refundable_until_hours_before: NULL = sin devolución
--        salvo cancelación (nuevo valor por defecto y el de todos los tipos
--        que ya existen); N = se puede pedir hasta N horas antes del inicio.
--      * request_refund ya no aprueba sola: con la política a NULL,
--        'refund_not_allowed'; fuera de plazo, 'refund_window_closed'; dentro
--        de plazo, solicitud 'pending' y aviso (enqueue_notification) al
--        dueño y a los owner/admin/manager de la organización. Con el evento
--        cancelado sigue el flujo de cancelación: aprobada y automática.
--      * decide_refund: owner/admin/manager de la organización del evento o
--        admin de plataforma; denegar exige motivo (5 caracteres o más).
--        Lo usa la edge function decide-refund.
--      * RLS: owner/admin/manager leen las solicitudes de su organización
--        (también si refund_requests.org_id faltara: se mira el evento).
--   T2 (B1-06) Reembolsos hechos en el panel de Stripe y disputas:
--      * mark_external_refund: total → entradas pagadas y pedido a
--        'refunded' con solicitudes del sistema en 'refunded' (auditoría y
--        saldo del local); parcial → se anota en el pedido (el webhook avisa
--        al admin).
--      * mark_order_dispute + ticket_orders.dispute_status: abierta → la
--        puerta la rechaza ('not_paid'); perdida → reembolso externo total;
--        ganada → vuelve a valer.
--   T3 (B1-18, B2-13) mark_refund_processed resta los puntos de la compra en
--      proporción a lo devuelto y ya no pasa a 'refunded' una entrada usada.
--   T4 (B2-13, D-5) Referidos: el canje deja el referido pendiente (solo
--      cuentas de menos de 30 días) y grant_referral_on_first_purchase da los
--      puntos con la primera compra de pago, con un tope de 10 invitados
--      premiados por invitador. Si esa compra se reembolsa entera, se retiran.
--   T5 (B1-11) Transferencias: transfer_ticket comprueba evento (ni pasado ni
--      cancelado), disputa y transferencia pendiente; accept_ticket_transfer
--      también el evento; cancel_ticket_transfer anula una pendiente.
--
-- Orden de despliegue: esta migración antes que las edge functions
-- (decide-refund, stripe-webhook, process-refund, send-ticket-transfer y
-- accept-ticket-transfer la necesitan). En Stripe hay que añadir los eventos
-- charge.dispute.* al endpoint de plataforma del webhook.

-- ============================================================================
-- 1) Política de devolución por tipo de entrada
-- ============================================================================
ALTER TABLE public.ticket_tiers ALTER COLUMN refundable_until_hours_before DROP NOT NULL;
ALTER TABLE public.ticket_tiers ALTER COLUMN refundable_until_hours_before SET DEFAULT NULL;

-- Todos los tipos existentes pasan a "sin devolución salvo cancelación". El
-- guard de tipos con ventas mira el aforo en cualquier UPDATE: un tipo
-- antiguo con más vendidas que aforo haría fallar la migración, así que se
-- aparta mientras dura el UPDATE (solo cambia esta columna).
DO $$
DECLARE
  v_guard BOOLEAN := EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.ticket_tiers'::regclass
       AND tgname = 'trg_enforce_tier_immutable_on_sales'
       AND NOT tgisinternal);
BEGIN
  IF v_guard THEN
    EXECUTE 'ALTER TABLE public.ticket_tiers DISABLE TRIGGER trg_enforce_tier_immutable_on_sales';
  END IF;
  UPDATE public.ticket_tiers SET refundable_until_hours_before = NULL
   WHERE refundable_until_hours_before IS NOT NULL;
  IF v_guard THEN
    EXECUTE 'ALTER TABLE public.ticket_tiers ENABLE TRIGGER trg_enforce_tier_immutable_on_sales';
  END IF;
END $$;

ALTER TABLE public.ticket_tiers DROP CONSTRAINT IF EXISTS ticket_tiers_refundable_hours_check;
ALTER TABLE public.ticket_tiers ADD CONSTRAINT ticket_tiers_refundable_hours_check
  CHECK (refundable_until_hours_before IS NULL OR refundable_until_hours_before BETWEEN 0 AND 8760);

COMMENT ON COLUMN public.ticket_tiers.refundable_until_hours_before IS
  'Política de devolución que elige el local. NULL = sin devolución salvo que se cancele el evento (por defecto). N = el comprador puede pedirla hasta N horas antes del inicio y el local la aprueba o la deniega.';

-- ============================================================================
-- 2) Disputas (contracargos) en el pedido
-- ============================================================================
ALTER TABLE public.ticket_orders
  ADD COLUMN IF NOT EXISTS dispute_status TEXT,
  ADD COLUMN IF NOT EXISTS stripe_dispute_id TEXT,
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;

ALTER TABLE public.ticket_orders DROP CONSTRAINT IF EXISTS ticket_orders_dispute_status_check;
ALTER TABLE public.ticket_orders ADD CONSTRAINT ticket_orders_dispute_status_check
  CHECK (dispute_status IS NULL OR dispute_status IN ('open', 'won', 'lost'));

CREATE INDEX IF NOT EXISTS idx_ticket_orders_dispute_open
  ON public.ticket_orders (disputed_at) WHERE dispute_status = 'open';

COMMENT ON COLUMN public.ticket_orders.dispute_status IS
  'Disputa del cargo en Stripe (charge.dispute.*): NULL = ninguna; open = abierta (la puerta rechaza sus entradas); won = ganada (vuelven a valer); lost = perdida (reembolso externo total). Detalle en metadata->dispute.';

-- ============================================================================
-- 3) Referidos: pendientes hasta la primera compra de pago
-- ============================================================================
-- Los canjes anteriores ya dieron los puntos al canjear: nacen 'rewarded'.
-- Después, el valor por defecto pasa a 'pending'.
ALTER TABLE public.referral_claims
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'rewarded',
  ADD COLUMN IF NOT EXISTS referrer_rewarded BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rewarded_order_id UUID REFERENCES public.ticket_orders(id) ON DELETE SET NULL;

UPDATE public.referral_claims SET rewarded_at = claimed_at
 WHERE status = 'rewarded' AND rewarded_at IS NULL;

ALTER TABLE public.referral_claims ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.referral_claims ALTER COLUMN referrer_rewarded SET DEFAULT FALSE;
ALTER TABLE public.referral_claims DROP CONSTRAINT IF EXISTS referral_claims_status_check;
ALTER TABLE public.referral_claims ADD CONSTRAINT referral_claims_status_check
  CHECK (status IN ('pending', 'rewarded'));

CREATE INDEX IF NOT EXISTS idx_referral_claims_rewarded_order
  ON public.referral_claims (rewarded_order_id) WHERE rewarded_order_id IS NOT NULL;

COMMENT ON COLUMN public.referral_claims.status IS
  'pending = canjeado, sin puntos todavía; rewarded = puntos dados con la primera compra de pago de la cuenta invitada (rewarded_order_id). Si esa compra se reembolsa entera vuelve a pending.';
COMMENT ON COLUMN public.referral_claims.referrer_rewarded IS
  'false si quien invitó ya tenía 10 invitados premiados: el invitado recibe sus puntos y quien invita no.';

-- ============================================================================
-- 4) Ayudantes internos (sin EXECUTE para el cliente)
-- ============================================================================

-- Puntos de una compra reembolsada. order-paid.ts da floor(total/100) puntos
-- (1 por euro) con reason_code 'ticket_purchase'; aquí se resta la parte
-- proporcional a lo devuelto del pedido (solicitudes 'refunded' y reembolsos
-- externos parciales anotados), descontando lo ya restado a ese pedido. Nunca
-- se resta más de lo que se dio por compras de ese evento: si el abono falló,
-- no se resta nada. Idempotente: se puede llamar tras cada reembolso.
CREATE OR REPLACE FUNCTION public.loyalty_revoke_refunded_points(_order_id UUID, _ticket_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.ticket_orders%ROWTYPE;
  v_points INT;
  v_refunded BIGINT;
  v_target INT;
  v_done INT;
  v_granted INT;
  v_revoked INT;
  v_delta INT;
  v_ticket UUID := _ticket_id;
  v_title TEXT;
BEGIN
  -- Bloqueo del pedido: dos reembolsos del mismo pedido a la vez no restan dos veces.
  SELECT * INTO v_order FROM public.ticket_orders WHERE id = _order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.buyer_user_id IS NULL OR COALESCE(v_order.total_cents, 0) <= 0 THEN
    RETURN 0;
  END IF;
  v_points := v_order.total_cents / 100;
  IF v_points <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(sum(r.amount_cents), 0) INTO v_refunded
    FROM public.refund_requests r
   WHERE r.order_id = _order_id AND r.status = 'refunded';
  SELECT v_refunded + COALESCE(sum((e->>'amount_cents')::BIGINT), 0) INTO v_refunded
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(v_order.metadata->'external_refunds') = 'array'
                THEN v_order.metadata->'external_refunds' ELSE '[]'::jsonb END) e
   WHERE NOT COALESCE((e->>'full')::BOOLEAN, FALSE);
  v_refunded := LEAST(v_refunded, v_order.total_cents);
  v_target := (v_points::BIGINT * v_refunded / v_order.total_cents)::INT;

  SELECT COALESCE(-sum(lp.change_amount), 0)::INT INTO v_done
    FROM public.loyalty_points lp
   WHERE lp.user_id = v_order.buyer_user_id
     AND lp.reason_code = 'ticket_refund'
     AND lp.ticket_id IN (SELECT t.id FROM public.tickets t WHERE t.order_id = _order_id);
  v_delta := v_target - v_done;
  IF v_delta <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(sum(lp.change_amount) FILTER (WHERE lp.reason_code = 'ticket_purchase'), 0)::INT,
         COALESCE(-sum(lp.change_amount) FILTER (WHERE lp.reason_code = 'ticket_refund'), 0)::INT
    INTO v_granted, v_revoked
    FROM public.loyalty_points lp
   WHERE lp.user_id = v_order.buyer_user_id AND lp.event_id = v_order.event_id;
  v_delta := LEAST(v_delta, v_granted - v_revoked);
  IF v_delta <= 0 THEN RETURN 0; END IF;

  IF v_ticket IS NULL THEN
    SELECT t.id INTO v_ticket FROM public.tickets t WHERE t.order_id = _order_id ORDER BY t.id LIMIT 1;
  END IF;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_order.event_id;
  PERFORM public.loyalty_grant_points(
    v_order.buyer_user_id, -v_delta,
    left('Reembolso · ' || COALESCE(v_title, 'evento'), 200),
    'ticket_refund', v_order.event_id, v_ticket, v_order.org_id
  );
  RETURN v_delta;
END;
$$;

REVOKE ALL ON FUNCTION public.loyalty_revoke_refunded_points(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Una compra premiada por un referido que se reembolsa entera: se retiran los
-- puntos a los dos y el referido vuelve a pendiente (si la cuenta invitada
-- tiene otra compra de pago válida, se vuelve a premiar con ella).
CREATE OR REPLACE FUNCTION public.referral_revert_for_order(_order_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claim public.referral_claims%ROWTYPE;
  v_count INT := 0;
BEGIN
  FOR v_claim IN
    SELECT * FROM public.referral_claims
     WHERE rewarded_order_id = _order_id AND status = 'rewarded'
     ORDER BY id
     FOR UPDATE
  LOOP
    PERFORM public.loyalty_grant_points(
      v_claim.referee_user_id, -v_claim.reward_points,
      'Invita a un amigo · compra reembolsada', 'referral_referee_reverted');
    IF v_claim.referrer_rewarded THEN
      PERFORM public.loyalty_grant_points(
        v_claim.referrer_user_id, -v_claim.reward_points,
        'Invita a un amigo · la compra de tu amigo se reembolsó', 'referral_referrer_reverted');
    END IF;
    UPDATE public.referral_claims
       SET status = 'pending', referrer_rewarded = FALSE, rewarded_at = NULL, rewarded_order_id = NULL
     WHERE id = v_claim.id;
    v_count := v_count + 1;
    PERFORM public.grant_referral_on_first_purchase(v_claim.referee_user_id);
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_revert_for_order(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 5) Referidos: canje pendiente y puntos con la primera compra de pago
-- ============================================================================
-- Misma firma y mismo resultado que antes (claim_id, reward_points): el
-- cliente solo llama al canje. reward_points son los puntos que recibirá cada
-- uno cuando la cuenta invitada haga su primera compra de pago.
CREATE OR REPLACE FUNCTION public.redeem_referral_code(_code TEXT)
RETURNS TABLE (
  claim_id UUID,
  reward_points INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_code TEXT := upper(btrim(COALESCE(_code, '')));
  v_referrer UUID;
  v_created TIMESTAMPTZ;
  v_claim UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_code !~ '^[A-Z0-9]{8}$' THEN
    RAISE EXCEPTION 'El código de invitación tiene 8 letras o cifras';
  END IF;
  SELECT rc.user_id INTO v_referrer FROM public.referral_codes rc WHERE rc.code = v_code;
  IF v_referrer IS NULL THEN RAISE EXCEPTION 'Ese código de invitación no existe'; END IF;
  IF v_referrer = v_uid THEN RAISE EXCEPTION 'No puedes canjear tu propio código'; END IF;
  -- Solo cuentas nuevas: una cuenta antigua no es una alta traída por nadie.
  SELECT u.created_at INTO v_created FROM auth.users u WHERE u.id = v_uid;
  IF v_created IS NULL OR v_created < now() - INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Los códigos de invitación solo valen para cuentas creadas hace menos de 30 días';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referral_claims c WHERE c.referee_user_id = v_uid) THEN
    RAISE EXCEPTION 'Ya has canjeado un código de invitación';
  END IF;

  INSERT INTO public.referral_claims (referral_code, referrer_user_id, referee_user_id, reward_points, status, referrer_rewarded)
  VALUES (v_code, v_referrer, v_uid, 500, 'pending', FALSE)
  ON CONFLICT (referee_user_id) DO NOTHING
  RETURNING id INTO v_claim;
  IF v_claim IS NULL THEN RAISE EXCEPTION 'Ya has canjeado un código de invitación'; END IF;

  RETURN QUERY SELECT v_claim, 500;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) TO authenticated, service_role;

-- La llama _shared/order-paid.ts (service role) al pagarse un pedido no
-- gratuito cuyo livemode no sea false. Da los puntos a los dos con la primera
-- compra de pago de la cuenta invitada mientras su referido esté pendiente.
-- Tope: 10 invitados premiados por invitador; a partir de ahí el invitado
-- recibe sus puntos y quien invita no. No lanza por reglas de negocio:
-- sin referido, ya premiado o sin compra válida, no hace nada.
CREATE OR REPLACE FUNCTION public.grant_referral_on_first_purchase(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claim public.referral_claims%ROWTYPE;
  v_order UUID;
  v_rewarded INT;
  v_referrer_ok BOOLEAN;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_claim FROM public.referral_claims WHERE referee_user_id = _user_id FOR UPDATE;
  IF v_claim.id IS NULL OR v_claim.status <> 'pending' THEN RETURN; END IF;

  -- Compra de pago válida: pagada (o reembolsada solo en parte), con importe
  -- y no de prueba mientras se exijan pagos reales.
  SELECT o.id INTO v_order
    FROM public.ticket_orders o
   WHERE o.buyer_user_id = _user_id
     AND o.status IN ('paid', 'partial_refund')
     AND COALESCE(o.total_cents, 0) > 0
     AND (o.livemode IS NOT FALSE OR NOT public.live_payments_required())
   ORDER BY o.paid_at ASC NULLS LAST, o.created_at, o.id
   LIMIT 1;
  IF v_order IS NULL THEN RETURN; END IF;

  -- El tope se cuenta con el invitador bloqueado: dos compras a la vez no lo pasan.
  PERFORM pg_advisory_xact_lock(hashtext('pasify_referral_reward:' || v_claim.referrer_user_id::text));
  SELECT count(*) INTO v_rewarded
    FROM public.referral_claims c
   WHERE c.referrer_user_id = v_claim.referrer_user_id
     AND c.status = 'rewarded' AND c.referrer_rewarded;
  v_referrer_ok := v_rewarded < 10;

  PERFORM public.loyalty_grant_points(
    _user_id, v_claim.reward_points, 'Invita a un amigo · tu primera compra', 'referral_referee');
  IF v_referrer_ok THEN
    PERFORM public.loyalty_grant_points(
      v_claim.referrer_user_id, v_claim.reward_points,
      'Invita a un amigo · tu amigo ha hecho su primera compra', 'referral_referrer');
  END IF;
  UPDATE public.referral_claims
     SET status = 'rewarded', referrer_rewarded = v_referrer_ok, rewarded_at = now(), rewarded_order_id = v_order
   WHERE id = v_claim.id;

  -- Solo en la app (sin email propio ni duplicados).
  PERFORM public.enqueue_notification(
    _user_id, 'loyalty', 'referral_rewarded',
    format('Has sumado %s Pasify Points', v_claim.reward_points),
    'Por tu primera compra con un código de invitación.',
    '/#/client-dashboard', jsonb_build_object('claim_id', v_claim.id));
  IF v_referrer_ok THEN
    PERFORM public.enqueue_notification(
      v_claim.referrer_user_id, 'loyalty', 'referral_rewarded',
      format('Has sumado %s Pasify Points', v_claim.reward_points),
      'Tu amigo ha hecho su primera compra en Pasify.',
      '/#/client-dashboard', jsonb_build_object('claim_id', v_claim.id));
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_referral_on_first_purchase(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_referral_on_first_purchase(UUID) TO service_role;

-- ============================================================================
-- 6) request_refund: la decide el local
-- ============================================================================
-- Parte de 20260923120100. Errores con código estable en el mensaje (y el
-- texto para el comprador en DETAIL): refund_not_allowed,
-- refund_window_closed, refund_in_dispute. Los de siempre no cambian.
CREATE OR REPLACE FUNCTION public.request_refund(_ticket_id UUID, _reason TEXT, _reason_code TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_hours INT;
  v_dispute TEXT;
  v_email TEXT;
  v_reason TEXT := left(COALESCE(NULLIF(btrim(COALESCE(_reason, '')), ''), 'Sin motivo'), 1000);
  v_request_id UUID;
  v_recipient UUID;
  v_amount TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket no encontrado'; END IF;
  IF COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'No eres el titular de esta entrada';
  END IF;
  IF v_ticket.status <> 'paid' THEN RAISE EXCEPTION 'Solo tickets pagados (status=%)', v_ticket.status; END IF;
  IF v_ticket.used_at IS NOT NULL THEN RAISE EXCEPTION 'Ticket ya escaneado'; END IF;
  IF COALESCE(v_ticket.amount_paid_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'Esta entrada no tiene importe que devolver';
  END IF;
  -- Sin pedido no hay cobro de Stripe que devolver (entradas antiguas).
  IF v_ticket.order_id IS NULL THEN
    RAISE EXCEPTION 'refund_not_allowed' USING DETAIL = 'Esta entrada no tiene un pago que se pueda devolver.';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  SELECT * INTO v_request FROM public.refund_requests WHERE ticket_id = _ticket_id FOR UPDATE;

  -- Evento cancelado: el flujo de cancelación, sin política ni plazo. La
  -- solicitud queda aprobada y marcada como automática para que la app del
  -- comprador lance el reembolso (process-refund) en el momento.
  IF v_event.status = 'cancelled' THEN
    IF v_request.id IS NULL OR v_request.status IN ('pending', 'rejected', 'failed')
       OR (v_request.status = 'approved' AND v_request.reason_code IS DISTINCT FROM 'event_cancelled') THEN
      PERFORM public.create_cancellation_refund_requests(
        v_event.id, NULL, v_event.metadata->>'cancel_reason', v_ticket.order_id);
    END IF;
    UPDATE public.refund_requests
       SET auto_approved = TRUE, auto_approve_reason = 'event_cancelled'
     WHERE ticket_id = _ticket_id AND status = 'approved' AND reason_code = 'event_cancelled'
       AND auto_approved IS DISTINCT FROM TRUE;
    SELECT r.id INTO v_request_id FROM public.refund_requests r WHERE r.ticket_id = _ticket_id;
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'No se ha podido preparar el reembolso de esta entrada';
    END IF;
    RETURN v_request_id;
  END IF;

  IF v_request.id IS NOT NULL AND v_request.status NOT IN ('rejected', 'failed') THEN
    RAISE EXCEPTION 'Ya existe solicitud';
  END IF;
  -- Con una transferencia pendiente, el reembolso anularía la entrada que
  -- acaba de recibir otra persona.
  IF EXISTS (SELECT 1 FROM public.ticket_transfers tr
             WHERE tr.ticket_id = _ticket_id AND tr.status = 'pending' AND tr.expires_at > now()) THEN
    RAISE EXCEPTION 'Cancela antes la transferencia pendiente de esta entrada';
  END IF;
  SELECT o.dispute_status INTO v_dispute FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;
  IF v_dispute = 'open' THEN
    RAISE EXCEPTION 'refund_in_dispute' USING DETAIL = 'El pago de esta entrada está en disputa con el banco.';
  END IF;

  -- Política del tipo de entrada (NULL: sin devolución salvo cancelación).
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT tt.refundable_until_hours_before INTO v_hours FROM public.ticket_tiers tt WHERE tt.id = v_ticket.tier_id;
  END IF;
  IF v_hours IS NULL THEN
    RAISE EXCEPTION 'refund_not_allowed'
      USING DETAIL = 'Este tipo de entrada no admite devoluciones, salvo que se cancele el evento.';
  END IF;
  IF v_event.date_start IS NULL OR now() > v_event.date_start - make_interval(hours => v_hours) THEN
    RAISE EXCEPTION 'refund_window_closed'
      USING DETAIL = format('Las devoluciones de esta entrada se piden hasta %s horas antes del inicio.', v_hours);
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  -- ticket_id es UNIQUE: una solicitud rechazada o fallida se reabre.
  IF v_request.id IS NOT NULL THEN
    UPDATE public.refund_requests
       SET order_id = v_ticket.order_id, event_id = v_ticket.event_id, org_id = v_event.org_id,
           requester_user_id = v_uid, requester_email = COALESCE(v_email, requester_email),
           amount_cents = v_ticket.amount_paid_cents, currency = v_ticket.currency,
           reason = v_reason, reason_code = _reason_code,
           status = 'pending', auto_approved = FALSE, auto_approve_reason = NULL,
           decided_at = NULL, decided_by = NULL, decision_note = NULL,
           stripe_refund_id = NULL, stripe_refund_status = NULL, stripe_failure_reason = NULL,
           processed_at = NULL, created_at = now()
     WHERE id = v_request.id;
    v_request_id := v_request.id;
  ELSE
    INSERT INTO public.refund_requests (
      ticket_id, order_id, event_id, org_id, requester_user_id, requester_email,
      amount_cents, currency, reason, reason_code, status, auto_approved
    ) VALUES (
      _ticket_id, v_ticket.order_id, v_ticket.event_id, v_event.org_id, v_uid, COALESCE(v_email, ''),
      v_ticket.amount_paid_cents, v_ticket.currency, v_reason, _reason_code, 'pending', FALSE
    )
    RETURNING id INTO v_request_id;
  END IF;

  -- Aviso al local: dueño de la organización y owner/admin/manager activos
  -- (evento sin organización: quien lo creó).
  v_amount := replace(to_char(v_ticket.amount_paid_cents / 100.0, 'FM999999990.00'), '.', ',') || ' €';
  FOR v_recipient IN
    SELECT o.owner_id FROM public.organizations o
     WHERE o.id = v_event.org_id AND o.owner_id IS NOT NULL
    UNION
    SELECT m.user_id FROM public.organization_members m
     WHERE m.org_id = v_event.org_id AND m.status = 'active' AND m.user_id IS NOT NULL
       AND m.role IN ('owner', 'admin', 'manager')
    UNION
    SELECT v_event.partner_id WHERE v_event.org_id IS NULL AND v_event.partner_id IS NOT NULL
  LOOP
    PERFORM public.enqueue_notification(
      v_recipient, 'tickets', 'refund_requested',
      'Nueva solicitud de reembolso',
      left(format('%s · %s · «%s»', COALESCE(v_event.title, 'Evento'), v_amount, v_reason), 280),
      '/#/partner-dashboard/reembolsos',
      jsonb_build_object('refund_request_id', v_request_id, 'event_id', v_event.id, 'ticket_id', _ticket_id),
      'high'
    );
  END LOOP;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_refund(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_refund(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 7) decide_refund: el local (o el admin) aprueba o deniega
-- ============================================================================
-- Parte de 20260926160000. Cambia: los permisos se miran en la organización
-- del evento (antes en refund_requests.org_id) y antes que el estado; 'Sin
-- permisos' es 42501; aprobar exige que la entrada siga reembolsable.
CREATE OR REPLACE FUNCTION public.decide_refund(_request_id UUID, _decision TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request public.refund_requests%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_note TEXT := NULLIF(btrim(_note), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id = _request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Request no encontrada'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_request.event_id;
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR public.has_org_role(COALESCE(v_event.org_id, v_request.org_id),
                           ARRAY['owner','admin','manager']::public.org_member_role_t[])
    OR (v_event.org_id IS NULL AND v_request.org_id IS NULL AND v_event.partner_id IS NOT DISTINCT FROM v_uid)
  ) THEN
    RAISE EXCEPTION 'Sin permisos' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Request ya decidida'; END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision inválida'; END IF;
  -- El comprador tiene que saber por qué: el motivo se guarda en decision_note.
  IF _decision = 'reject' AND (v_note IS NULL OR char_length(v_note) < 5) THEN
    RAISE EXCEPTION 'Para denegar un reembolso hace falta un motivo (5 caracteres o más)' USING ERRCODE = '22023';
  END IF;
  -- Aprobar solo si la entrada sigue pagada, sin usar y en manos de quien la pidió.
  IF _decision = 'approve' THEN
    SELECT * INTO v_ticket FROM public.tickets WHERE id = v_request.ticket_id;
    IF v_ticket.id IS NULL OR v_ticket.status <> 'paid' OR v_ticket.used_at IS NOT NULL
       OR COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_request.requester_user_id THEN
      RAISE EXCEPTION 'ticket_not_refundable'
        USING ERRCODE = '22023', DETAIL = 'La entrada ya se ha usado, ha cambiado de titular o ya no está pagada.';
    END IF;
  END IF;
  UPDATE public.refund_requests
     SET status = CASE WHEN _decision = 'approve' THEN 'approved'::public.refund_request_status_t ELSE 'rejected'::public.refund_request_status_t END,
         decided_by = v_uid,
         decided_at = now(),
         decision_note = v_note,
         updated_at = now()
   WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_refund(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_refund(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 8) RLS: la bandeja del local
-- ============================================================================
-- owner/admin/manager leen las solicitudes de su organización. Se mira
-- refund_requests.org_id y, si faltara, la organización del evento.
DROP POLICY IF EXISTS "refund_requests_member_read" ON public.refund_requests;
CREATE POLICY "refund_requests_member_read" ON public.refund_requests FOR SELECT TO authenticated
  USING (
    public.has_org_role(
      COALESCE(org_id, (SELECT e.org_id FROM public.events e WHERE e.id = refund_requests.event_id)),
      ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

-- Los mensajes de una solicitud, como la solicitud: sin puerta ni RRPP.
DROP POLICY IF EXISTS "refund_messages_member_read" ON public.refund_request_messages;
CREATE POLICY "refund_messages_member_read" ON public.refund_request_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.refund_requests r
     WHERE r.id = refund_request_messages.request_id
       AND r.org_id IS NOT NULL
       AND public.has_org_role(r.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  ));

-- Solicitudes sin organización cuyo evento sí la tiene (por si quedara alguna).
UPDATE public.refund_requests r
   SET org_id = e.org_id
  FROM public.events e
 WHERE r.event_id = e.id
   AND r.org_id IS NULL
   AND e.org_id IS NOT NULL;

-- ============================================================================
-- 9) mark_refund_processed: puntos y entradas usadas
-- ============================================================================
-- Parte de 20260923120600. Cambia:
--   * una entrada ya usada no pasa a 'refunded' (la solicitud sí, con
--     metadata.ticket_used_before_refund);
--   * el pedido queda 'refunded' cuando se ha devuelto todo su importe (o no
--     le queda ninguna entrada pagada ni usada); si no, 'partial_refund';
--   * se restan los puntos de la compra en proporción a lo devuelto y, con
--     el pedido devuelto entero, se retira el premio de referido que diera;
--   * se anulan las transferencias pendientes de esa entrada;
--   * sin solicitud de Pasify (ni por id ni por reembolso) devuelve NULL: un
--     reembolso sin metadatos es externo y lo trata mark_external_refund (ya
--     no se adivina "la única en proceso del mismo pago").
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
  v_used BOOLEAN;
  v_refunded BIGINT;
  v_full BOOLEAN;
BEGIN
  IF _refund_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.refund_requests WHERE id = _refund_request_id FOR UPDATE;
  END IF;
  IF v_request.id IS NULL AND NULLIF(_stripe_refund_id, '') IS NOT NULL THEN
    SELECT * INTO v_request FROM public.refund_requests WHERE stripe_refund_id = _stripe_refund_id FOR UPDATE;
  END IF;
  IF v_request.id IS NULL THEN RETURN NULL; END IF;
  IF v_request.status = 'refunded' THEN RETURN v_request.id; END IF;

  UPDATE public.tickets SET status = 'refunded' WHERE id = v_request.ticket_id AND status = 'paid';
  SELECT (t.status = 'used') INTO v_used FROM public.tickets t WHERE t.id = v_request.ticket_id;

  UPDATE public.refund_requests
     SET status = 'refunded', stripe_refund_id = _stripe_refund_id, stripe_refund_status = 'succeeded',
         processed_at = now(), updated_at = now(),
         metadata = CASE WHEN v_used
                         THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('ticket_used_before_refund', TRUE)
                         ELSE metadata END
   WHERE id = v_request.id;

  UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now()
   WHERE ticket_id = v_request.ticket_id AND status = 'pending';

  SELECT * INTO v_order FROM public.ticket_orders WHERE id = v_request.order_id FOR UPDATE;
  IF v_order.id IS NOT NULL THEN
    SELECT COALESCE(sum(r.amount_cents), 0) INTO v_refunded
      FROM public.refund_requests r
     WHERE r.order_id = v_order.id AND r.status = 'refunded';
    v_full := (COALESCE(v_order.total_cents, 0) > 0 AND v_refunded >= v_order.total_cents)
              OR NOT EXISTS (SELECT 1 FROM public.tickets t
                              WHERE t.order_id = v_order.id AND t.status IN ('paid', 'used'));
    IF v_order.status IN ('paid', 'partial_refund') THEN
      UPDATE public.ticket_orders
         SET status = CASE WHEN v_full THEN 'refunded'::public.ticket_order_status_t
                           ELSE 'partial_refund'::public.ticket_order_status_t END,
             refunded_at = CASE WHEN v_full THEN now() ELSE refunded_at END
       WHERE id = v_order.id;
    END IF;
    PERFORM public.loyalty_revoke_refunded_points(v_order.id, v_request.ticket_id);
    IF v_full THEN
      PERFORM public.referral_revert_for_order(v_order.id);
    END IF;
  END IF;
  RETURN v_request.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_refund_processed(TEXT, INT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_refund_processed(TEXT, INT, TEXT, UUID) TO service_role;

-- ============================================================================
-- 10) mark_external_refund: reembolsos hechos fuera de Pasify
-- ============================================================================
-- La llama stripe-webhook (service role) con cada reembolso sin
-- pasify_refund_request_id (hecho en el panel de Stripe) y con la disputa
-- perdida (_source 'dispute_lost', siempre total).
--   _full = el cargo queda devuelto entero (charge.amount_refunded >= amount).
--   * total: cada entrada pagada o usada del pedido con importe tiene su
--     solicitud 'refunded' (la que hubiera o una del sistema: reason_code
--     'external_refund' / 'dispute_lost', metadata.system = true), para la
--     auditoría y el saldo del local (partner_balance_v). Las pagadas pasan a
--     'refunded'; las usadas no se tocan. Se salta la solicitud cuyo
--     reembolso de Pasify sigue en curso en Stripe (la cierra su webhook).
--     Pedido 'refunded', puntos restados y premio de referido retirado.
--   * parcial: no se sabe de qué entrada es. Se anota en
--     metadata.external_refunds, el pedido pasa a 'partial_refund', se restan
--     los puntos en proporción y el webhook avisa al admin.
-- Idempotente por id de Stripe (metadata.external_refunds); uno anotado como
-- parcial se completa si llega como total.
-- Devuelve { result: full | partial | duplicate | order_not_found | pasify_refund, ... }.
CREATE OR REPLACE FUNCTION public.mark_external_refund(
  _payment_intent_id TEXT,
  _stripe_object_id TEXT,
  _amount_cents INT,
  _full BOOLEAN,
  _source TEXT DEFAULT 'stripe_refund'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.ticket_orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_log JSONB;
  v_prev JSONB;
  v_full BOOLEAN := COALESCE(_full, FALSE) OR _source = 'dispute_lost';
  v_ticket public.tickets%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_holder UUID;
  v_email TEXT;
  v_code TEXT;
  v_reason TEXT;
  v_tickets INT := 0;
  v_requests INT := 0;
  v_points INT := 0;
BEGIN
  IF _source IS NULL OR _source NOT IN ('stripe_refund', 'dispute_lost') THEN
    RAISE EXCEPTION 'invalid_source: %', _source USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(_payment_intent_id, '')), '') IS NULL OR NULLIF(btrim(COALESCE(_stripe_object_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- Un reembolso de Pasify nunca es externo.
  IF EXISTS (SELECT 1 FROM public.refund_requests r WHERE r.stripe_refund_id = _stripe_object_id) THEN
    RETURN jsonb_build_object('result', 'pasify_refund');
  END IF;

  SELECT * INTO v_order FROM public.ticket_orders o
   WHERE o.stripe_payment_intent_id = _payment_intent_id
   ORDER BY o.created_at DESC, o.id
   LIMIT 1
   FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN jsonb_build_object('result', 'order_not_found'); END IF;

  v_log := CASE WHEN jsonb_typeof(v_order.metadata->'external_refunds') = 'array'
                THEN v_order.metadata->'external_refunds' ELSE '[]'::jsonb END;
  SELECT e INTO v_prev FROM jsonb_array_elements(v_log) e WHERE e->>'id' = _stripe_object_id LIMIT 1;
  IF v_prev IS NOT NULL AND (COALESCE((v_prev->>'full')::BOOLEAN, FALSE) OR NOT v_full) THEN
    RETURN jsonb_build_object('result', 'duplicate', 'order_id', v_order.id);
  END IF;
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_log
    FROM jsonb_array_elements(v_log) e
   WHERE e->>'id' IS DISTINCT FROM _stripe_object_id;
  v_log := v_log || jsonb_build_array(jsonb_build_object(
    'id', _stripe_object_id, 'amount_cents', COALESCE(_amount_cents, 0), 'source', _source,
    'full', v_full, 'at', now()));
  UPDATE public.ticket_orders
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{external_refunds}', v_log)
   WHERE id = v_order.id;

  IF NOT v_full THEN
    IF v_order.status = 'paid' THEN
      UPDATE public.ticket_orders SET status = 'partial_refund' WHERE id = v_order.id;
    END IF;
    v_points := public.loyalty_revoke_refunded_points(v_order.id, NULL);
    RETURN jsonb_build_object('result', 'partial', 'order_id', v_order.id, 'event_id', v_order.event_id,
                              'amount_cents', COALESCE(_amount_cents, 0), 'points_removed', v_points);
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_order.event_id;
  v_code := CASE WHEN _source = 'dispute_lost' THEN 'dispute_lost' ELSE 'external_refund' END;
  v_reason := CASE WHEN _source = 'dispute_lost'
                   THEN 'Disputa perdida: el banco devolvió el cargo al comprador'
                   ELSE 'Reembolso hecho desde el panel de Stripe' END;

  FOR v_ticket IN
    SELECT t.* FROM public.tickets t WHERE t.order_id = v_order.id ORDER BY t.id FOR UPDATE
  LOOP
    IF v_ticket.status NOT IN ('paid', 'used') OR COALESCE(v_ticket.amount_paid_cents, 0) <= 0 THEN
      CONTINUE;
    END IF;
    -- Sin fila, SELECT INTO deja v_request a NULL (no arrastra la vuelta anterior).
    SELECT * INTO v_request FROM public.refund_requests r WHERE r.ticket_id = v_ticket.id FOR UPDATE;
    IF v_request.id IS NOT NULL
       AND (v_request.status = 'refunded'
            OR (v_request.status = 'processing' AND v_request.stripe_refund_id IS NOT NULL)) THEN
      CONTINUE;
    END IF;

    v_holder := COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id);
    v_email := NULL;
    IF v_holder IS NOT NULL THEN
      SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_holder;
    END IF;
    v_email := COALESCE(v_email, v_ticket.holder_email, v_ticket.buyer_email, '');

    IF v_request.id IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'refunded', order_id = v_order.id, event_id = v_ticket.event_id, org_id = v_event.org_id,
             amount_cents = v_ticket.amount_paid_cents, currency = v_ticket.currency,
             decided_at = COALESCE(decided_at, now()), decision_note = COALESCE(decision_note, v_reason),
             stripe_failure_reason = NULL, processed_at = now(), updated_at = now(),
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('external', jsonb_build_object(
               'source', _source, 'stripe_id', _stripe_object_id, 'previous_status', v_request.status::text))
       WHERE id = v_request.id;
    ELSE
      INSERT INTO public.refund_requests (
        ticket_id, order_id, event_id, org_id, requester_user_id, requester_email,
        amount_cents, currency, reason, reason_code, status, auto_approved,
        decided_at, decision_note, processed_at, metadata
      ) VALUES (
        v_ticket.id, v_order.id, v_ticket.event_id, v_event.org_id, v_holder, v_email,
        v_ticket.amount_paid_cents, v_ticket.currency, v_reason, v_code, 'refunded', FALSE,
        now(), v_reason, now(),
        jsonb_build_object('system', TRUE, 'source', _source, 'stripe_id', _stripe_object_id)
      );
    END IF;
    v_requests := v_requests + 1;

    IF v_ticket.status = 'paid' THEN
      UPDATE public.tickets SET status = 'refunded' WHERE id = v_ticket.id;
      v_tickets := v_tickets + 1;
    END IF;
    UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now()
     WHERE ticket_id = v_ticket.id AND status = 'pending';
  END LOOP;

  UPDATE public.ticket_orders
     SET status = 'refunded', refunded_at = COALESCE(refunded_at, now())
   WHERE id = v_order.id AND status IN ('paid', 'partial_refund');

  v_points := public.loyalty_revoke_refunded_points(v_order.id, NULL);
  PERFORM public.referral_revert_for_order(v_order.id);

  RETURN jsonb_build_object('result', 'full', 'order_id', v_order.id, 'event_id', v_order.event_id,
                            'amount_cents', COALESCE(_amount_cents, 0), 'tickets_refunded', v_tickets,
                            'requests', v_requests, 'points_removed', v_points);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_external_refund(TEXT, TEXT, INT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_external_refund(TEXT, TEXT, INT, BOOLEAN, TEXT) TO service_role;

-- ============================================================================
-- 11) mark_order_dispute: disputas de Stripe
-- ============================================================================
-- stripe-webhook: charge.dispute.created → 'open'; charge.dispute.closed →
-- 'won' (también warning_closed) o 'lost'. Perdida = reembolso externo total.
-- Stripe no garantiza el orden: una apertura que llega después del cierre de
-- la misma disputa no la reabre. Idempotente.
-- Devuelve { result: open | won | lost | duplicate | stale | order_not_found, ... }.
CREATE OR REPLACE FUNCTION public.mark_order_dispute(
  _payment_intent_id TEXT,
  _dispute_id TEXT,
  _status TEXT,
  _amount_cents INT DEFAULT NULL,
  _reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order public.ticket_orders%ROWTYPE;
  v_refund JSONB;
  v_title TEXT;
BEGIN
  IF _status IS NULL OR _status NOT IN ('open', 'won', 'lost') THEN
    RAISE EXCEPTION 'invalid_dispute_status: %', _status USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(_payment_intent_id, '')), '') IS NULL OR NULLIF(btrim(COALESCE(_dispute_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.ticket_orders o
   WHERE o.stripe_payment_intent_id = _payment_intent_id
   ORDER BY o.created_at DESC, o.id
   LIMIT 1
   FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN jsonb_build_object('result', 'order_not_found'); END IF;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = v_order.event_id;

  IF v_order.stripe_dispute_id IS NOT DISTINCT FROM _dispute_id
     AND v_order.dispute_status IS NOT DISTINCT FROM _status THEN
    RETURN jsonb_build_object('result', 'duplicate', 'order_id', v_order.id);
  END IF;
  IF _status = 'open' AND v_order.stripe_dispute_id IS NOT DISTINCT FROM _dispute_id
     AND v_order.dispute_status IN ('won', 'lost') THEN
    RETURN jsonb_build_object('result', 'stale', 'order_id', v_order.id);
  END IF;

  UPDATE public.ticket_orders
     SET dispute_status = _status,
         disputed_at = CASE WHEN stripe_dispute_id IS NOT DISTINCT FROM _dispute_id AND disputed_at IS NOT NULL
                            THEN disputed_at ELSE now() END,
         stripe_dispute_id = _dispute_id,
         metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb), '{dispute}',
           (CASE WHEN jsonb_typeof(metadata->'dispute') = 'object' AND metadata->'dispute'->>'id' = _dispute_id
                 THEN metadata->'dispute' ELSE '{}'::jsonb END)
           || jsonb_strip_nulls(jsonb_build_object(
                'id', _dispute_id, 'status', _status, 'amount_cents', _amount_cents,
                'reason', _reason, 'updated_at', now())))
   WHERE id = v_order.id;

  IF _status = 'lost' THEN
    v_refund := public.mark_external_refund(
      _payment_intent_id, _dispute_id, COALESCE(_amount_cents, v_order.total_cents), TRUE, 'dispute_lost');
  END IF;

  RETURN jsonb_build_object('result', _status, 'order_id', v_order.id, 'event_id', v_order.event_id,
                            'event_title', v_title, 'total_cents', v_order.total_cents,
                            'currency', v_order.currency, 'refund', v_refund);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_order_dispute(TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_dispute(TEXT, TEXT, TEXT, INT, TEXT) TO service_role;

-- ============================================================================
-- 12) Puerta: pedido en disputa
-- ============================================================================
-- Igual que en 20260925110100 salvo el bloque "Pago en disputa", justo
-- después de 'test_payment': con una disputa abierta la entrada no entra
-- ('not_paid', nota 'order in dispute') y no se marca como usada.
-- scan_ticket_by_code delega en esta función.
CREATE OR REPLACE FUNCTION public.scan_ticket(
  _qr_token UUID,
  _device_info TEXT DEFAULT NULL,
  _event_id UUID DEFAULT NULL,
  _force BOOLEAN DEFAULT FALSE,
  _force_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  success           BOOLEAN,
  result            public.scan_result_t,
  ticket_id         UUID,
  event_id          UUID,
  event_title       TEXT,
  buyer_first_name  TEXT,
  buyer_last_name   TEXT,
  buyer_email       TEXT,
  tier_name         TEXT,
  scanned_at        TIMESTAMPTZ,
  already_used_at   TIMESTAMPTZ,
  event_date_start  TIMESTAMPTZ,
  forced            BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_ticket      public.tickets%ROWTYPE;
  v_event       public.events%ROWTYPE;
  v_tier_name   TEXT;
  v_now         TIMESTAMPTZ := now();
  v_hash        TEXT := encode(sha256(_qr_token::text::bytea), 'hex');
  v_is_manager  BOOLEAN;
  v_can_scan    BOOLEAN;
  v_first       TEXT;
  v_last        TEXT;
  v_email       TEXT;
  v_problem     public.scan_result_t;
  v_reason      TEXT := NULLIF(trim(COALESCE(_force_reason, '')), '');
  v_livemode    BOOLEAN;
  v_dispute     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets t WHERE t.qr_token = _qr_token FOR UPDATE;
  IF v_ticket.id IS NOT NULL THEN
    SELECT * INTO v_event FROM public.events e WHERE e.id = v_ticket.event_id;
  END IF;

  IF v_ticket.id IS NULL OR v_event.id IS NULL THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, metadata)
    VALUES (v_ticket.id, NULL, v_uid, v_now, 'invalid_ticket', v_hash, _device_info,
            jsonb_build_object('selected_event_id', _event_id));
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  v_is_manager := v_event.partner_id IS NOT DISTINCT FROM v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role);
  v_can_scan := v_is_manager
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['door_staff']::public.org_member_role_t[]));

  -- Sin permiso: ni nombre, ni email, ni evento. Queda registrado para el
  -- local dueño de la entrada.
  IF NOT v_can_scan THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'forbidden', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'forbidden'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  -- El portero ve el nombre del titular actual y el tipo; el email solo lo ve
  -- quien gestiona el evento.
  v_first := COALESCE(NULLIF(v_ticket.holder_first_name, ''), v_ticket.buyer_first_name);
  v_last := COALESCE(NULLIF(v_ticket.holder_last_name, ''), v_ticket.buyer_last_name);
  v_email := CASE WHEN v_is_manager THEN COALESCE(NULLIF(v_ticket.holder_email, ''), v_ticket.buyer_email) END;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT tt.name INTO v_tier_name FROM public.ticket_tiers tt WHERE tt.id = v_ticket.tier_id;
  END IF;

  IF v_ticket.status = 'used' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'already_used', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'already_used'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, v_ticket.used_at, v_event.date_start, FALSE;
    RETURN;
  END IF;

  IF v_ticket.status <> 'paid' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'not_paid', v_hash, _device_info,
            'ticket status was: ' || v_ticket.status::text);
    RETURN QUERY SELECT FALSE, 'not_paid'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  IF v_ticket.order_id IS NOT NULL THEN
    SELECT o.livemode, o.dispute_status INTO v_livemode, v_dispute
      FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;

    -- Pago de prueba (Stripe en modo test): no vale en puerta mientras
    -- require_live_payments esté activo. Como en 'forbidden', sin datos del
    -- comprador; la entrada sigue sin usar.
    IF v_livemode IS FALSE AND public.live_payments_required() THEN
      INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
      VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'test_payment', v_hash, _device_info,
              'order livemode = false');
      RETURN QUERY SELECT FALSE, 'test_payment'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
        NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
      RETURN;
    END IF;

    -- Pago en disputa (contracargo abierto): el dinero puede volver al
    -- comprador. No entra y la entrada sigue sin usar.
    IF v_dispute IS NOT DISTINCT FROM 'open' THEN
      INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
      VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'not_paid', v_hash, _device_info,
              'order in dispute');
      RETURN QUERY SELECT FALSE, 'not_paid'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
        v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
      RETURN;
    END IF;
  END IF;

  IF v_event.status = 'cancelled' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'event_cancelled', v_hash, _device_info);
    RETURN QUERY SELECT FALSE, 'event_cancelled'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  -- Entrada de otro evento del mismo local, o fuera de horario: se puede dejar
  -- pasar igualmente, pero solo quien gestiona el evento y con motivo.
  IF _event_id IS NOT NULL AND _event_id <> v_event.id THEN
    v_problem := 'wrong_event';
  ELSIF v_now < v_event.date_start - INTERVAL '6 hours'
     OR v_now > COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') + INTERVAL '2 hours' THEN
    v_problem := 'outside_window';
  END IF;

  IF v_problem IS NOT NULL AND NOT (_force AND v_is_manager AND v_reason IS NOT NULL) THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes, metadata)
    VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, v_problem, v_hash, _device_info,
            CASE WHEN _force THEN 'force_denied' END,
            jsonb_build_object('selected_event_id', _event_id));
    RETURN QUERY SELECT FALSE, v_problem, v_ticket.id, v_event.id, v_event.title,
      v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
    RETURN;
  END IF;

  UPDATE public.tickets t
     SET status = 'used', used_at = v_now, used_by_partner_id = v_uid
   WHERE t.id = v_ticket.id;

  INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes, metadata)
  VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'success', v_hash, _device_info,
          CASE WHEN v_problem IS NOT NULL THEN 'forced: ' || v_reason END,
          CASE WHEN v_problem IS NOT NULL
               THEN jsonb_build_object('forced', TRUE, 'original_result', v_problem, 'selected_event_id', _event_id)
               ELSE '{}'::jsonb END);

  RETURN QUERY SELECT TRUE, 'success'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
    v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, (v_problem IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 13) Transferencias
-- ============================================================================
-- transfer_ticket: parte de 20260923120100. La llama send-ticket-transfer
-- con el JWT del titular. Errores con código estable en el mensaje:
-- invalid_email, ticket_not_found, not_ticket_holder, ticket_not_transferable,
-- event_not_transferable, refund_in_progress, transfer_pending,
-- transfer_not_allowed, transfer_to_self.
CREATE OR REPLACE FUNCTION public.transfer_ticket(_ticket_id UUID, _to_email TEXT, _message TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_to_email TEXT := lower(btrim(COALESCE(_to_email, '')));
  v_message TEXT := left(NULLIF(btrim(COALESCE(_message, '')), ''), 500);
  v_my_email TEXT;
  v_to_user UUID;
  v_transfer_id UUID;
  v_tier_allowed BOOLEAN;
  v_dispute TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(v_to_email) > 254 OR v_to_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING DETAIL = 'El email del destinatario no es válido.';
  END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'ticket_not_found' USING DETAIL = 'No encontramos esta entrada.'; END IF;
  -- IS DISTINCT FROM: con `<>` un NULL hacía que la comprobación no saltara.
  IF COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_ticket_holder' USING DETAIL = 'No eres el titular de esta entrada.';
  END IF;
  IF v_ticket.status <> 'paid' OR v_ticket.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_not_transferable' USING DETAIL = 'Solo se envían entradas pagadas y sin usar.';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF v_event.id IS NULL OR v_event.status IN ('cancelled', 'past')
     OR COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') < now() THEN
    RAISE EXCEPTION 'event_not_transferable' USING DETAIL = 'El evento está cancelado o ya ha pasado.';
  END IF;
  IF v_ticket.order_id IS NOT NULL THEN
    SELECT o.dispute_status INTO v_dispute FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;
    IF v_dispute = 'open' THEN
      RAISE EXCEPTION 'ticket_not_transferable' USING DETAIL = 'El pago de esta entrada está en disputa.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests r
             WHERE r.ticket_id = _ticket_id AND r.status IN ('pending', 'approved', 'processing')) THEN
    RAISE EXCEPTION 'refund_in_progress' USING DETAIL = 'Hay un reembolso en curso para esta entrada.';
  END IF;
  -- Las caducadas dejan de contar; una pendiente de verdad bloquea otra.
  UPDATE public.ticket_transfers SET status = 'expired'
   WHERE ticket_id = _ticket_id AND status = 'pending' AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM public.ticket_transfers tr WHERE tr.ticket_id = _ticket_id AND tr.status = 'pending') THEN
    RAISE EXCEPTION 'transfer_pending' USING DETAIL = 'Esta entrada ya tiene un envío pendiente: anúlalo antes de enviarla a otra persona.';
  END IF;
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT tt.transfer_allowed INTO v_tier_allowed FROM public.ticket_tiers tt WHERE tt.id = v_ticket.tier_id;
    IF NOT COALESCE(v_tier_allowed, TRUE) THEN
      RAISE EXCEPTION 'transfer_not_allowed' USING DETAIL = 'Este tipo de entrada no se puede transferir.';
    END IF;
  END IF;
  SELECT lower(u.email) INTO v_my_email FROM auth.users u WHERE u.id = v_uid;
  IF v_my_email = v_to_email THEN
    RAISE EXCEPTION 'transfer_to_self' USING DETAIL = 'No puedes enviarte una entrada a ti mismo.';
  END IF;

  SELECT u.id INTO v_to_user FROM auth.users u WHERE lower(u.email) = v_to_email LIMIT 1;
  INSERT INTO public.ticket_transfers (ticket_id, from_user_id, to_email, to_user_id, message)
  VALUES (_ticket_id, v_uid, v_to_email, v_to_user, v_message)
  RETURNING id INTO v_transfer_id;
  RETURN v_transfer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_ticket(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_ticket(UUID, TEXT, TEXT) TO authenticated;

-- accept_ticket_transfer: parte de 20260923120100. El QR y el enlace público
-- se regeneran (el QR viejo deja de valer) y el titular pasa a ser quien la
-- recibe. Caducada, cancelada o ya respondida: 'transfer_invalid_or_expired'.
-- Entrada que ya no se puede transferir (usada, reembolso en curso, evento
-- cancelado o pasado, disputa, cambio de titular): 'ticket_not_transferable'
-- (accept-ticket-transfer anula entonces la transferencia).
CREATE OR REPLACE FUNCTION public.accept_ticket_transfer(_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_first TEXT;
  v_last TEXT;
  v_transfer public.ticket_transfers%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_dispute TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Email verificado de auth.users, no el de profiles.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  SELECT p.first_name, p.last_name INTO v_first, v_last FROM public.profiles p WHERE p.id = v_uid;
  SELECT * INTO v_transfer FROM public.ticket_transfers
    WHERE invitation_token = _token AND status = 'pending' AND expires_at > now() AND lower(to_email) = lower(v_email)
    FOR UPDATE;
  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'transfer_invalid_or_expired' USING DETAIL = 'Transferencia no válida o caducada.';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_transfer.ticket_id FOR UPDATE;
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF v_ticket.order_id IS NOT NULL THEN
    SELECT o.dispute_status INTO v_dispute FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;
  END IF;
  IF v_ticket.id IS NULL OR v_ticket.status <> 'paid' OR v_ticket.used_at IS NOT NULL
     OR COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id) IS DISTINCT FROM v_transfer.from_user_id
     OR EXISTS (SELECT 1 FROM public.refund_requests r
                WHERE r.ticket_id = v_ticket.id AND r.status IN ('pending', 'approved', 'processing'))
     OR v_event.id IS NULL OR v_event.status IN ('cancelled', 'past')
     OR COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') < now()
     OR v_dispute IS NOT DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'ticket_not_transferable' USING DETAIL = 'Esta entrada ya no se puede transferir.';
  END IF;

  UPDATE public.ticket_transfers SET status = 'accepted', to_user_id = v_uid, responded_at = now() WHERE id = v_transfer.id;
  UPDATE public.tickets
     SET transferred_to_user_id = v_uid,
         transferred_at = now(),
         holder_first_name = v_first,
         holder_last_name = v_last,
         holder_email = v_email,
         qr_token = gen_random_uuid(),
         access_url_token = gen_random_uuid()
   WHERE id = v_transfer.ticket_id;
  UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now()
   WHERE ticket_id = v_transfer.ticket_id AND status = 'pending' AND id <> v_transfer.id;
  RETURN v_transfer.ticket_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) TO authenticated, service_role;

-- cancel_ticket_transfer: quien la envió anula una transferencia pendiente
-- (para mandarla a otra persona o pedir un reembolso). Errores:
-- transfer_not_found (no existe o no es suya) y transfer_not_pending.
CREATE OR REPLACE FUNCTION public.cancel_ticket_transfer(_transfer_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_transfer public.ticket_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_transfer FROM public.ticket_transfers WHERE id = _transfer_id FOR UPDATE;
  IF v_transfer.id IS NULL OR v_transfer.from_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'transfer_not_found' USING DETAIL = 'No encontramos ese envío.';
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'transfer_not_pending' USING DETAIL = 'Ese envío ya no está pendiente.';
  END IF;
  UPDATE public.ticket_transfers SET status = 'cancelled', responded_at = now() WHERE id = _transfer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_ticket_transfer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_ticket_transfer(UUID) TO authenticated;
