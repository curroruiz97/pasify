-- Pasify · máximo de 10 entradas por persona y evento
--
-- Hasta ahora solo había dos topes: 10 por pedido (qty 1..10) y `per_user_max`
-- por TIPO de entrada (por comprador y tipo). Nada limitaba lo que una persona
-- podía conseguir en un evento entero: 10 de cada tipo, o pedidos seguidos.
--
-- Regla nueva: una persona no puede tener más de 10 entradas por evento, entre
-- todos los tipos, sumando pagadas, usadas y reservas en curso (las mismas que
-- ocupan plaza, ticket_seats_held). Cuenta por COMPRADOR (`tickets.buyer_user_id`),
-- no por titular actual: pasar entradas a otra persona no libera cupo para
-- seguir comprando. Las devueltas, anuladas o caducadas no cuentan.
--
--   * max_tickets_per_buyer_event(): el tope (10), en un solo sitio.
--   * ticket_buyer_event_held(evento, comprador): cuántas lleva.
--   * create_ticket_order y create_free_ticket_order lo comprueban al final,
--     con el evento ya bloqueado FOR UPDATE: dos compras seguidas o a la vez
--     del mismo comprador no se lo saltan. Error `qty_exceeds_event_limit`
--     con HINT = cuántas puede añadir aún.
--   * event_ticket_allowance(evento): lo que ve el selector de entradas
--     (tope, las que ya tiene y las que puede añadir) para quien pregunta.
-- Las dos funciones de pedido son la definición de 20260927110000 con ese
-- único control más (y su variable).

-- ============================================================================
-- 1) El tope y la cuenta
-- ============================================================================
CREATE OR REPLACE FUNCTION public.max_tickets_per_buyer_event()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;

REVOKE EXECUTE ON FUNCTION public.max_tickets_per_buyer_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.max_tickets_per_buyer_event() TO service_role;

-- Misma regla de «ocupa plaza» que ticket_seats_held: pagadas, usadas y las
-- pendientes de un pedido pendiente aún vigente (la reserva dura 15 minutos
-- más que la sesión de Stripe).
CREATE OR REPLACE FUNCTION public.ticket_buyer_event_held(_event_id UUID, _buyer_user_id UUID)
RETURNS INT
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_count INT;
BEGIN
  IF _event_id IS NULL OR _buyer_user_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.tickets t
    LEFT JOIN public.ticket_orders o ON o.id = t.order_id
   WHERE t.event_id = _event_id
     AND t.buyer_user_id = _buyer_user_id
     AND (t.status IN ('paid', 'used')
          OR (t.status = 'pending' AND o.status = 'pending'
              AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ticket_buyer_event_held(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_buyer_event_held(UUID, UUID) TO service_role;

-- ============================================================================
-- 2) Lo que ve el selector de entradas
-- ============================================================================
-- Solo habla de quien pregunta (auth.uid()): sin sesión, el tope y 0 entradas.
-- No enseña nada de otras personas ni del evento.
CREATE OR REPLACE FUNCTION public.event_ticket_allowance(_event_id UUID)
RETURNS TABLE (max_per_buyer INT, held INT, remaining INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limit INT := public.max_tickets_per_buyer_event();
  v_held INT := 0;
BEGIN
  IF v_uid IS NOT NULL AND _event_id IS NOT NULL THEN
    v_held := public.ticket_buyer_event_held(_event_id, v_uid);
  END IF;
  RETURN QUERY SELECT v_limit, v_held, GREATEST(v_limit - v_held, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_ticket_allowance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ticket_allowance(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_ticket_allowance(UUID) IS
  'Tope de entradas por persona y evento (10), las que ya lleva quien pregunta y las que aún puede añadir.';

-- ============================================================================
-- 3) create_ticket_order con el límite por evento
-- ============================================================================
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
  v_buyer_event_held INT;
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
  -- Local suspendido por Pasify (o cerrado): no vende.
  IF NOT public.org_can_sell(v_event.org_id) THEN RAISE EXCEPTION 'org_suspended'; END IF;

  SELECT * INTO v_tier FROM public.ticket_tiers tt WHERE tt.id = _tier_id AND tt.event_id = _event_id FOR UPDATE;
  IF v_tier.id IS NULL OR v_tier.status <> 'active' THEN RAISE EXCEPTION 'tier_not_available'; END IF;
  IF v_tier.sale_starts_at IS NOT NULL AND v_tier.sale_starts_at > v_now THEN RAISE EXCEPTION 'sale_not_started'; END IF;
  IF v_tier.sale_ends_at IS NOT NULL AND v_tier.sale_ends_at < v_now THEN RAISE EXCEPTION 'sale_ended'; END IF;
  IF _qty > v_tier.per_user_max THEN RAISE EXCEPTION 'qty_exceeds_per_user_max'; END IF;

  -- Ocupan plaza: pagadas, usadas y las pendientes de pedidos aún vigentes
  -- (ticket_seats_held).
  v_tier_held := public.ticket_seats_held(v_event.id, v_tier.id);
  IF v_tier.capacity IS NOT NULL AND v_tier_held + _qty > v_tier.capacity THEN
    RAISE EXCEPTION 'tier_sold_out';
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    v_event_held := public.ticket_seats_held(v_event.id);
    IF v_event_held + _qty > v_event.capacity THEN
      RAISE EXCEPTION 'event_sold_out';
    END IF;
  END IF;

  -- Límite por comprador en este tipo, sumando compras anteriores.
  v_buyer_held := public.ticket_seats_held(v_event.id, v_tier.id, _buyer_user_id);
  IF v_buyer_held + _qty > v_tier.per_user_max THEN
    RAISE EXCEPTION 'qty_exceeds_per_user_max';
  END IF;

  -- Límite por comprador en TODO el evento (todos los tipos): ver
  -- max_tickets_per_buyer_event. Va el último para que los errores de antes
  -- no cambien de código; el evento está bloqueado FOR UPDATE, así que dos
  -- compras seguidas o a la vez del mismo comprador no se lo saltan.
  v_buyer_event_held := public.ticket_buyer_event_held(v_event.id, _buyer_user_id);
  IF v_buyer_event_held + _qty > public.max_tickets_per_buyer_event() THEN
    RAISE EXCEPTION 'qty_exceeds_event_limit'
      USING HINT = GREATEST(public.max_tickets_per_buyer_event() - v_buyer_event_held, 0)::TEXT;
  END IF;

  v_subtotal := v_tier.price_cents * _qty;
  v_fee := floor(v_subtotal * GREATEST(COALESCE(_fee_pct, 0), 0) / 100.0)::INT;
  -- Stripe exige al menos 30 minutos de vida para una Checkout Session.
  v_expires := v_now + make_interval(mins => GREATEST(30, COALESCE(_ttl_minutes, 30)));

  IF v_event.org_id IS NOT NULL THEN
    SELECT o.stripe_connect_account_id INTO v_dest
    FROM public.organizations o
    WHERE o.id = v_event.org_id
      AND o.suspended_at IS NULL
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
-- 4) create_free_ticket_order con el límite por evento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_free_ticket_order(
  _event_id UUID,
  _tier_id UUID,
  _qty INT,
  _buyer_user_id UUID,
  _buyer_email TEXT,
  _buyer_first_name TEXT DEFAULT NULL,
  _buyer_last_name TEXT DEFAULT NULL,
  _buyer_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
  order_id UUID,
  request_id UUID,
  org_id UUID,
  event_id UUID,
  qty INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_tiers%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_email TEXT := lower(trim(COALESCE(_buyer_email, '')));
  v_order_id UUID;
  v_request_id UUID;
  v_buyer_event_held INT;
BEGIN
  IF _buyer_user_id IS NULL THEN RAISE EXCEPTION 'buyer_user_required'; END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 10 THEN RAISE EXCEPTION 'invalid_qty'; END IF;
  IF position('@' IN v_email) = 0 THEN RAISE EXCEPTION 'buyer_email_required'; END IF;

  -- Mismo orden de bloqueo que create_ticket_order (evento y luego tipo).
  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id FOR UPDATE;
  IF v_event.id IS NULL OR v_event.status <> 'published'
     OR COALESCE(v_event.date_end, v_event.date_start + INTERVAL '12 hours') < v_now THEN
    RAISE EXCEPTION 'event_not_available';
  END IF;
  IF NOT public.org_can_sell(v_event.org_id) THEN RAISE EXCEPTION 'org_suspended'; END IF;

  SELECT * INTO v_tier FROM public.ticket_tiers tt WHERE tt.id = _tier_id AND tt.event_id = _event_id FOR UPDATE;
  IF v_tier.id IS NULL OR v_tier.status <> 'active' THEN RAISE EXCEPTION 'tier_not_available'; END IF;
  IF v_tier.price_cents <> 0 THEN RAISE EXCEPTION 'tier_not_free'; END IF;
  IF v_tier.sale_starts_at IS NOT NULL AND v_tier.sale_starts_at > v_now THEN RAISE EXCEPTION 'sale_not_started'; END IF;
  IF v_tier.sale_ends_at IS NOT NULL AND v_tier.sale_ends_at < v_now THEN RAISE EXCEPTION 'sale_ended'; END IF;
  IF _qty > v_tier.per_user_max THEN RAISE EXCEPTION 'qty_exceeds_per_user_max'; END IF;

  IF v_tier.capacity IS NOT NULL
     AND public.ticket_seats_held(v_event.id, v_tier.id) + _qty > v_tier.capacity THEN
    RAISE EXCEPTION 'tier_sold_out';
  END IF;
  IF v_event.capacity IS NOT NULL
     AND public.ticket_seats_held(v_event.id) + _qty > v_event.capacity THEN
    RAISE EXCEPTION 'event_sold_out';
  END IF;
  IF public.ticket_seats_held(v_event.id, v_tier.id, _buyer_user_id) + _qty > v_tier.per_user_max THEN
    RAISE EXCEPTION 'qty_exceeds_per_user_max';
  END IF;

  -- Límite por comprador en TODO el evento (como create_ticket_order).
  v_buyer_event_held := public.ticket_buyer_event_held(v_event.id, _buyer_user_id);
  IF v_buyer_event_held + _qty > public.max_tickets_per_buyer_event() THEN
    RAISE EXCEPTION 'qty_exceeds_event_limit'
      USING HINT = GREATEST(public.max_tickets_per_buyer_event() - v_buyer_event_held, 0)::TEXT;
  END IF;

  INSERT INTO public.ticket_orders (
    event_id, org_id, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone,
    subtotal_cents, fees_cents, total_cents, currency, status, paid_at, metadata
  )
  VALUES (
    v_event.id, v_event.org_id, _buyer_user_id, v_email, _buyer_first_name, _buyer_last_name, _buyer_phone,
    0, 0, 0, v_tier.currency, 'paid', v_now, jsonb_build_object('free', TRUE)
  )
  RETURNING public.ticket_orders.id, public.ticket_orders.request_id INTO v_order_id, v_request_id;

  INSERT INTO public.tickets (
    event_id, order_id, tier_id, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone,
    holder_first_name, holder_last_name, holder_email, status, paid_at, amount_paid_cents, currency
  )
  SELECT v_event.id, v_order_id, v_tier.id, _buyer_user_id, v_email, _buyer_first_name, _buyer_last_name, _buyer_phone,
         _buyer_first_name, _buyer_last_name, v_email, 'paid', v_now, 0, v_tier.currency
  FROM generate_series(1, _qty);

  RETURN QUERY SELECT v_order_id, v_request_id, v_event.org_id, v_event.id, _qty;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_free_ticket_order(UUID, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_free_ticket_order(UUID, UUID, INT, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
