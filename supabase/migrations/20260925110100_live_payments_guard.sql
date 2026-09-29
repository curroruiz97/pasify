-- Pasify · pagos de prueba en producción y compras sin cuenta (Ola 0)
--
--   B1-01 En producción STRIPE_SECRET_KEY es una clave de test: la tarjeta
--         4242 "pagaba" y el pedido acababa con entradas válidas en puerta y
--         sumando en el neto que Pasify liquida al local. Nada guardaba ni
--         miraba el modo del pago. Las edge functions ya no abren ni
--         confirman pagos de prueba en producción (_shared/stripe.ts); aquí:
--           * ticket_orders.livemode: modo del pago (NULL = desconocido).
--             Todos los pedidos anteriores se hicieron con la clave de test.
--           * mark_order_paid_v2 recibe y guarda _livemode.
--           * live_payments_required(): ajuste require_live_payments de
--             app_settings (true por defecto).
--           * scan_ticket: 'test_payment' para las entradas de un pedido con
--             livemode = false (sin datos del comprador; no se marca usada).
--           * partner_balance_v: esos pedidos (y sus reembolsos) no suman.
--   B1-08 create_ticket_order aceptaba pedidos sin comprador: sin límite por
--         persona, y cada reserva retenía plazas 47 minutos.
--
-- Necesita 20260925110000 ('test_payment' en scan_result_t).

-- ============================================================================
-- 1) Modo del pago en el pedido
-- ============================================================================
-- DEFAULT false al añadirla: solo toca metadatos (las filas existentes leen
-- false sin reescribir la tabla ni disparar triggers ni Realtime). Después se
-- quita: un pedido nuevo nace con NULL hasta que Stripe confirma el cobro.
ALTER TABLE public.ticket_orders ADD COLUMN IF NOT EXISTS livemode BOOLEAN DEFAULT FALSE;
ALTER TABLE public.ticket_orders ALTER COLUMN livemode DROP DEFAULT;

COMMENT ON COLUMN public.ticket_orders.livemode IS
  'Modo del pago en Stripe (session.livemode). false = pago de prueba; NULL = desconocido (sin cobrar, o confirmado por una versión que no lo enviaba).';

-- ============================================================================
-- 2) Ajuste require_live_payments
-- ============================================================================
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'require_live_payments',
  'true'::jsonb,
  'Si es true, un pedido pagado en modo prueba de Stripe (livemode = false) no vale: el escáner rechaza sus entradas (test_payment) y no suma en el saldo del local.'
)
ON CONFLICT (key) DO NOTHING;

-- Solo devuelve un booleano: la pueden llamar anon y authenticated (el saldo
-- es security_invoker y la RLS de app_settings no enseña esta clave). Sin la
-- clave, o con cualquier valor que no sea un false explícito, true: el control
-- no se apaga por accidente.
CREATE OR REPLACE FUNCTION public.live_payments_required()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT lower(btrim(s.value #>> '{}')) NOT IN ('false', 'f', '0', 'no', 'off')
       FROM public.app_settings s
      WHERE s.key = 'require_live_payments'),
    TRUE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.live_payments_required() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_payments_required() TO anon, authenticated, service_role;

-- ============================================================================
-- 3) mark_order_paid_v2 guarda el modo del pago
-- ============================================================================
-- Un parámetro más es otra firma: se borra la antigua para no dejar dos
-- sobrecargas que PostgREST no sabría elegir (PGRST203). Las llamadas antiguas
-- (cuatro parámetros, sin _livemode) siguen valiendo por el DEFAULT, también
-- la de mark_order_paid (v1), que delega en esta.
DROP FUNCTION IF EXISTS public.mark_order_paid_v2(TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.mark_order_paid_v2(
  _session_id TEXT,
  _payment_intent_id TEXT,
  _amount_total_cents INT,
  _application_fee_cents INT DEFAULT 0,
  _livemode BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  order_id UUID,
  newly_paid BOOLEAN,
  buyer_user_id UUID,
  buyer_email TEXT,
  org_id UUID,
  event_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_order public.ticket_orders%ROWTYPE;
  v_fee INT;
  v_total INT;
BEGIN
  SELECT * INTO v_order FROM public.ticket_orders o WHERE o.stripe_session_id = _session_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  IF v_order.status IN ('paid', 'partial_refund', 'refunded') THEN
    -- Pagado por una versión que no enviaba el modo: se completa ahora.
    IF _livemode IS NOT NULL AND v_order.livemode IS NULL THEN
      UPDATE public.ticket_orders o SET livemode = _livemode WHERE o.id = v_order.id;
    END IF;
    RETURN QUERY SELECT v_order.id, FALSE, v_order.buyer_user_id, v_order.buyer_email, v_order.org_id, v_order.event_id;
    RETURN;
  END IF;

  v_fee := CASE WHEN COALESCE(_application_fee_cents, 0) > 0 THEN _application_fee_cents ELSE v_order.fees_cents END;
  v_total := COALESCE(NULLIF(_amount_total_cents, 0), v_order.total_cents);

  UPDATE public.ticket_orders o
     SET status = 'paid',
         paid_at = now(),
         stripe_payment_intent_id = _payment_intent_id,
         total_cents = v_total,
         fees_cents = v_fee,
         livemode = COALESCE(_livemode, o.livemode)
   WHERE o.id = v_order.id;

  -- Si el pedido caducó mientras el cliente pagaba, Stripe ya ha cobrado:
  -- las entradas vuelven a ser válidas.
  UPDATE public.tickets t
     SET status = 'paid', paid_at = now(), stripe_payment_intent_id = _payment_intent_id
   WHERE t.order_id = v_order.id AND t.status IN ('pending', 'cancelled');

  IF v_order.org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.application_fees_ledger l WHERE l.ticket_order_id = v_order.id) THEN
    INSERT INTO public.application_fees_ledger (
      org_id, ticket_order_id, stripe_payment_intent_id, amount_cents, gross_cents, net_to_partner_cents, currency
    )
    VALUES (v_order.org_id, v_order.id, _payment_intent_id, v_fee, v_total, v_total - v_fee, upper(v_order.currency));
  END IF;

  RETURN QUERY SELECT v_order.id, TRUE, v_order.buyer_user_id, v_order.buyer_email, v_order.org_id, v_order.event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_order_paid_v2(TEXT, TEXT, INT, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid_v2(TEXT, TEXT, INT, INT, BOOLEAN) TO service_role;

-- ============================================================================
-- 4) create_ticket_order: siempre con comprador (B1-08)
-- ============================================================================
-- Solo la llama stripe-create-checkout (service role), que ya exige sesión.
-- Sin comprador no se aplicaba el máximo por persona y cada reserva retenía
-- plazas 32 + 15 minutos. El resto, igual que en 20260923120200.
CREATE OR REPLACE FUNCTION public.create_ticket_order(
  _event_id UUID,
  _tier_id UUID,
  _qty INT,
  _buyer_user_id UUID,
  _buyer_email TEXT,
  _buyer_first_name TEXT DEFAULT NULL,
  _buyer_last_name TEXT DEFAULT NULL,
  _buyer_phone TEXT DEFAULT NULL,
  _fee_pct NUMERIC DEFAULT 5,
  _ttl_minutes INT DEFAULT 30
)
RETURNS TABLE (
  order_id UUID,
  request_id UUID,
  org_id UUID,
  event_title TEXT,
  event_date_start TIMESTAMPTZ,
  event_image_url TEXT,
  venue_name TEXT,
  city TEXT,
  timezone TEXT,
  tier_name TEXT,
  unit_price_cents INT,
  qty INT,
  subtotal_cents INT,
  fee_cents INT,
  currency TEXT,
  expires_at TIMESTAMPTZ,
  stripe_destination_account TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_tiers%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_email TEXT := lower(trim(COALESCE(_buyer_email, '')));
  v_expires TIMESTAMPTZ;
  v_tier_held INT;
  v_event_held INT;
  v_buyer_held INT;
  v_order_id UUID;
  v_request_id UUID;
  v_subtotal INT;
  v_fee INT;
  v_dest TEXT;
  v_tz TEXT;
BEGIN
  IF _buyer_user_id IS NULL THEN RAISE EXCEPTION 'buyer_user_required'; END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 10 THEN RAISE EXCEPTION 'invalid_qty'; END IF;
  IF position('@' IN v_email) = 0 THEN RAISE EXCEPTION 'buyer_email_required'; END IF;

  -- Orden de bloqueo fijo (evento y luego tipo) para que dos compras no se
  -- interbloqueen. Mientras dura esta transacción nadie más reserva plazas
  -- de este evento.
  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id FOR UPDATE;
  IF v_event.id IS NULL OR v_event.status <> 'published'
     OR COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') < v_now THEN
    RAISE EXCEPTION 'event_not_available';
  END IF;

  SELECT * INTO v_tier FROM public.ticket_tiers tt WHERE tt.id = _tier_id AND tt.event_id = _event_id FOR UPDATE;
  IF v_tier.id IS NULL OR v_tier.status <> 'active' THEN RAISE EXCEPTION 'tier_not_available'; END IF;
  IF v_tier.sale_starts_at IS NOT NULL AND v_tier.sale_starts_at > v_now THEN RAISE EXCEPTION 'sale_not_started'; END IF;
  IF v_tier.sale_ends_at IS NOT NULL AND v_tier.sale_ends_at < v_now THEN RAISE EXCEPTION 'sale_ended'; END IF;
  IF _qty > v_tier.per_user_max THEN RAISE EXCEPTION 'qty_exceeds_per_user_max'; END IF;

  -- Ocupan plaza: pagadas, usadas y las pendientes de pedidos aún vigentes.
  -- La reserva dura 15 minutos más que la sesión de Stripe: un pago hecho en
  -- el último segundo puede confirmarse después y no debe encontrarse su
  -- plaza vendida a otro.
  SELECT count(*) INTO v_tier_held
  FROM public.tickets t
  LEFT JOIN public.ticket_orders o ON o.id = t.order_id
  WHERE t.tier_id = v_tier.id
    AND (t.status IN ('paid', 'used')
         OR (t.status = 'pending' AND o.status = 'pending'
             AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
  IF v_tier.capacity IS NOT NULL AND v_tier_held + _qty > v_tier.capacity THEN
    RAISE EXCEPTION 'tier_sold_out';
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_event_held
    FROM public.tickets t
    LEFT JOIN public.ticket_orders o ON o.id = t.order_id
    WHERE t.event_id = v_event.id
      AND (t.status IN ('paid', 'used')
           OR (t.status = 'pending' AND o.status = 'pending'
               AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
    IF v_event_held + _qty > v_event.capacity THEN
      RAISE EXCEPTION 'event_sold_out';
    END IF;
  END IF;

  -- Límite por comprador en este tipo, sumando compras anteriores.
  IF _buyer_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_buyer_held
    FROM public.tickets t
    LEFT JOIN public.ticket_orders o ON o.id = t.order_id
    WHERE t.tier_id = v_tier.id
      AND t.buyer_user_id = _buyer_user_id
      AND (t.status IN ('paid', 'used')
           OR (t.status = 'pending' AND o.status = 'pending'
               AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
    IF v_buyer_held + _qty > v_tier.per_user_max THEN
      RAISE EXCEPTION 'qty_exceeds_per_user_max';
    END IF;
  END IF;

  v_subtotal := v_tier.price_cents * _qty;
  v_fee := floor(v_subtotal * GREATEST(COALESCE(_fee_pct, 0), 0) / 100.0)::INT;
  -- Stripe exige al menos 30 minutos de vida para una Checkout Session.
  v_expires := v_now + make_interval(mins => GREATEST(30, COALESCE(_ttl_minutes, 30)));

  IF v_event.org_id IS NOT NULL THEN
    SELECT o.stripe_connect_account_id INTO v_dest
    FROM public.organizations o
    WHERE o.id = v_event.org_id
      AND o.stripe_connect_charges_enabled
      AND o.stripe_connect_account_id IS NOT NULL;
  END IF;
  IF v_event.venue_id IS NOT NULL THEN
    SELECT v.timezone INTO v_tz FROM public.venues v WHERE v.id = v_event.venue_id;
  END IF;

  INSERT INTO public.ticket_orders (
    event_id, org_id, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone,
    subtotal_cents, fees_cents, total_cents, currency, status, stripe_destination_account, expires_at
  )
  VALUES (
    v_event.id, v_event.org_id, _buyer_user_id, v_email, _buyer_first_name, _buyer_last_name, _buyer_phone,
    v_subtotal, v_fee, v_subtotal, v_tier.currency, 'pending', v_dest, v_expires
  )
  RETURNING public.ticket_orders.id, public.ticket_orders.request_id INTO v_order_id, v_request_id;

  INSERT INTO public.tickets (
    event_id, order_id, tier_id, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone,
    holder_first_name, holder_last_name, holder_email, status, amount_paid_cents, currency
  )
  SELECT v_event.id, v_order_id, v_tier.id, _buyer_user_id, v_email, _buyer_first_name, _buyer_last_name, _buyer_phone,
         _buyer_first_name, _buyer_last_name, v_email, 'pending', v_tier.price_cents, v_tier.currency
  FROM generate_series(1, _qty);

  RETURN QUERY SELECT
    v_order_id, v_request_id, v_event.org_id, v_event.title, v_event.date_start, v_event.image_url,
    v_event.venue_name, v_event.city, COALESCE(v_tz, 'Europe/Madrid'), v_tier.name, v_tier.price_cents,
    _qty, v_subtotal, v_fee, v_tier.currency, v_expires, v_dest;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_ticket_order(UUID, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ticket_order(UUID, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT) TO service_role;

-- ============================================================================
-- 5) Escáner: 'test_payment'
-- ============================================================================
-- Igual que en 20260923120100 salvo el bloque "Pago de prueba", justo después
-- de 'not_paid': una entrada pagada de un pedido con livemode = false no entra
-- mientras live_payments_required(). No se puede forzar, no devuelve datos del
-- comprador (como 'forbidden') y la entrada no se marca como usada.
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

  -- Pago de prueba (Stripe en modo test): no vale en puerta mientras
  -- require_live_payments esté activo. Como en 'forbidden', sin datos del
  -- comprador; la entrada sigue sin usar.
  IF v_ticket.order_id IS NOT NULL THEN
    SELECT o.livemode INTO v_livemode FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;
    IF v_livemode IS FALSE AND public.live_payments_required() THEN
      INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
      VALUES (v_ticket.id, v_event.id, v_event.org_id, v_uid, v_now, 'test_payment', v_hash, _device_info,
              'order livemode = false');
      RETURN QUERY SELECT FALSE, 'test_payment'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
        NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, v_now, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
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
-- 6) Saldo por local sin pagos de prueba
-- ============================================================================
-- La definición de 20260923120300 con un filtro más en cada lado: mientras
-- live_payments_required(), ni los pedidos con livemode = false ni sus
-- reembolsos suman. Sigue siendo security_invoker (cada local ve su fila por
-- la RLS de ticket_orders y refund_requests); el ajuste se lee una vez por
-- consulta.
CREATE OR REPLACE VIEW public.partner_balance_v
WITH (security_invoker = true)
AS
WITH paid AS (
  SELECT o.org_id,
         count(*) AS paid_orders,
         COALESCE(sum(o.total_cents), 0) AS gross_cents,
         COALESCE(sum(o.fees_cents), 0) AS fee_cents
  FROM public.ticket_orders o
  WHERE o.org_id IS NOT NULL
    AND o.status IN ('paid', 'partial_refund', 'refunded')
    AND (o.livemode IS NOT FALSE OR NOT (SELECT public.live_payments_required()))
  GROUP BY o.org_id
),
refunded AS (
  SELECT r.org_id, COALESCE(sum(r.amount_cents), 0) AS refunded_cents
  FROM public.refund_requests r
  WHERE r.org_id IS NOT NULL AND r.status = 'refunded'
    AND (NOT (SELECT public.live_payments_required())
         OR NOT EXISTS (SELECT 1 FROM public.ticket_orders t
                         WHERE t.id = r.order_id AND t.livemode IS FALSE))
  GROUP BY r.org_id
)
SELECT p.org_id,
       p.paid_orders,
       p.gross_cents,
       COALESCE(r.refunded_cents, 0) AS refunded_cents,
       p.fee_cents,
       p.gross_cents - COALESCE(r.refunded_cents, 0) - p.fee_cents AS net_cents
FROM paid p
LEFT JOIN refunded r ON r.org_id = p.org_id;

GRANT SELECT ON public.partner_balance_v TO authenticated;
