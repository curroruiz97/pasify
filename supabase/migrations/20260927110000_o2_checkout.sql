-- Pasify · checkout, ola 2 (S1): locales suspendidos, sin reservas
-- fantasma, conciliación con Stripe y entradas gratis
--
--   T1 · B5-3, B4-10, D-8  Rechazar un local solo cambiaba
--         profiles.account_status: sus eventos publicados seguían a la venta,
--         en los listados públicos y con destino Connect. Ahora la suspensión
--         es de la organización (organizations.suspended_at / suspended_reason):
--           * org_can_sell(org): false si está suspendida (o no está activa).
--           * admin_set_org_suspension(org, suspender, motivo): solo un admin
--             de plataforma; avisa al dueño.
--           * create_ticket_order y create_free_ticket_order: 'org_suspended'.
--           * No publica (events_guard_tenant_and_publish) y sus eventos salen
--             de la lectura pública de events (y sus tipos de entrada, que la
--             policy pública lee a través de events). Quien tiene entradas
--             sigue viendo el evento en su cartera.
--           * Sin destino Connect.
--         La puerta, los reembolsos y el panel del local siguen igual.
--   T2 · B1-04, B1-08  event_availability(evento): lo que queda de cada tipo
--         con la misma cuenta que create_ticket_order (pagadas, usadas y
--         reservas vigentes) y el aforo del evento. La regla de "plaza
--         ocupada" pasa a ticket_seats_held, que usan las tres funciones.
--   T3 · B1-15  cron_expire_pending_orders anulaba a las 2,5 h pedidos que
--         Stripe quizá había cobrado (la pestaña se cerró y el webhook no
--         llegó). Ahora solo los que no tienen sesión o tienen más de 24 h (lo
--         máximo que vive una sesión de Stripe). El resto lo concilia la edge
--         function reconcile-pending-orders preguntando a Stripe; los lotes se
--         los da pending_orders_to_reconcile. Se programa cada 10 minutos solo
--         si Vault tiene el secreto pasify_internal_secret (ver el final).
--   T4 · B1-05, B4-03  create_free_ticket_order: entradas de 0 € sin Stripe,
--         con los mismos bloqueos y límites que create_ticket_order.

-- ============================================================================
-- 1) Suspensión de la organización
-- ============================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

COMMENT ON COLUMN public.organizations.suspended_at IS
  'Cuándo suspendió Pasify la venta del local (admin_set_org_suspension). NULL = no suspendido. Suspendido: no vende, no publica y sus eventos no salen en los listados públicos.';
COMMENT ON COLUMN public.organizations.suspended_reason IS
  'Motivo de la suspensión que se le comunicó al dueño.';

-- Las columnas nuevas, fuera del alcance del local: igual que en
-- 20260923120100 más suspended_at y suspended_reason (el dueño puede editar
-- su organización y, sin esto, se quitaba la suspensión él mismo).
CREATE OR REPLACE FUNCTION public.organizations_protect_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    NEW.owner_id := OLD.owner_id;
    NEW.status := OLD.status;
    NEW.tier := OLD.tier;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.stripe_connect_account_id := OLD.stripe_connect_account_id;
    NEW.stripe_connect_onboarded := OLD.stripe_connect_onboarded;
    NEW.stripe_connect_charges_enabled := OLD.stripe_connect_charges_enabled;
    NEW.stripe_connect_payouts_enabled := OLD.stripe_connect_payouts_enabled;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_plan_code := OLD.subscription_plan_code;
    NEW.subscription_current_period_end := OLD.subscription_current_period_end;
    NEW.trial_ends_at := OLD.trial_ends_at;
    NEW.suspended_at := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
  END IF;
  RETURN NEW;
END;
$$;

-- ¿Puede vender? Sin organización (eventos antiguos de un local sin
-- organización), sí. Con organización: activa y sin suspender; una que no
-- existe, no. La usan la RLS pública de events (por eso la ejecuta anon), las
-- RPC de compra y la app para explicar por qué no hay venta.
-- OJO: si anon pierde EXECUTE (p. ej. un barrido de SECURITY DEFINER como el
-- de 20260925110200), anon deja de poder leer events. Va en la lista blanca de
-- tests/db/o0_servidor.sql, igual que event_availability.
CREATE OR REPLACE FUNCTION public.org_can_sell(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN _org_id IS NULL THEN TRUE
    ELSE COALESCE(
      (SELECT o.suspended_at IS NULL AND o.status = 'active'
         FROM public.organizations o
        WHERE o.id = _org_id),
      FALSE)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.org_can_sell(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_can_sell(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.org_can_sell(UUID) IS
  'true si la organización puede vender y publicar: activa y sin suspender (sin organización, true).';

-- Suspender o reactivar. Repetir la misma orden no vuelve a avisar; al
-- suspender una ya suspendida solo se actualiza el motivo (si llega uno).
CREATE OR REPLACE FUNCTION public.admin_set_org_suspension(_org_id UUID, _suspended BOOLEAN, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org public.organizations%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _suspended IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_org FROM public.organizations o WHERE o.id = _org_id FOR UPDATE;
  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF _suspended THEN
    UPDATE public.organizations o
       SET suspended_at = COALESCE(o.suspended_at, now()),
           suspended_reason = COALESCE(v_reason, o.suspended_reason)
     WHERE o.id = _org_id;

    IF v_org.suspended_at IS NULL AND v_org.owner_id IS NOT NULL THEN
      PERFORM public.enqueue_notification(
        v_org.owner_id, 'system', 'org_suspended',
        'Hemos suspendido la venta de ' || COALESCE(NULLIF(btrim(v_org.name), ''), 'tu local'),
        'Tus eventos no se ven en Pasify y no puedes vender ni publicar hasta que se resuelva.'
          || CASE WHEN v_reason IS NOT NULL THEN ' Motivo: ' || v_reason || '.' ELSE '' END
          || ' La puerta y los reembolsos siguen funcionando. Escríbenos desde Soporte si tienes dudas.',
        '/#/partner-dashboard/soporte',
        jsonb_build_object('org_id', _org_id, 'reason', v_reason),
        'high'
      );
    END IF;
  ELSE
    UPDATE public.organizations o
       SET suspended_at = NULL,
           suspended_reason = NULL
     WHERE o.id = _org_id;

    IF v_org.suspended_at IS NOT NULL AND v_org.owner_id IS NOT NULL THEN
      PERFORM public.enqueue_notification(
        v_org.owner_id, 'system', 'org_reactivated',
        COALESCE(NULLIF(btrim(v_org.name), ''), 'Tu local') || ' vuelve a estar activo',
        'Ya puedes vender y publicar eventos, y tus eventos publicados vuelven a verse en Pasify.',
        '/#/partner-dashboard',
        jsonb_build_object('org_id', _org_id),
        'high'
      );
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_org_suspension(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_org_suspension(UUID, BOOLEAN, TEXT) TO authenticated;

-- ============================================================================
-- 2) Plazas ocupadas: una sola regla
-- ============================================================================
-- Ocupan plaza las entradas pagadas, las usadas y las pendientes de un pedido
-- pendiente aún vigente: la reserva dura 15 minutos más que la sesión de
-- Stripe, porque un pago del último segundo puede confirmarse después y no
-- debe encontrarse su plaza vendida a otro. Es la cuenta que tenía
-- create_ticket_order; ahora la comparten create_free_ticket_order y
-- event_availability.
--   * sin tipo: todas las del evento (aforo del evento);
--   * con tipo: las de ese tipo, y solo las del comprador si se indica.
-- Sin SECURITY DEFINER ni permisos para los clientes: la llaman funciones
-- definer.
CREATE OR REPLACE FUNCTION public.ticket_seats_held(
  _event_id UUID,
  _tier_id UUID DEFAULT NULL,
  _buyer_user_id UUID DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_count INT;
BEGIN
  IF _tier_id IS NULL THEN
    SELECT count(*) INTO v_count
      FROM public.tickets t
      LEFT JOIN public.ticket_orders o ON o.id = t.order_id
     WHERE t.event_id = _event_id
       AND (t.status IN ('paid', 'used')
            OR (t.status = 'pending' AND o.status = 'pending'
                AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
  ELSE
    SELECT count(*) INTO v_count
      FROM public.tickets t
      LEFT JOIN public.ticket_orders o ON o.id = t.order_id
     WHERE t.tier_id = _tier_id
       AND (_buyer_user_id IS NULL OR t.buyer_user_id = _buyer_user_id)
       AND (t.status IN ('paid', 'used')
            OR (t.status = 'pending' AND o.status = 'pending'
                AND COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') + INTERVAL '15 minutes' > v_now));
  END IF;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ticket_seats_held(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_seats_held(UUID, UUID, UUID) TO service_role;

-- ============================================================================
-- 3) create_ticket_order: local suspendido y sin destino Connect
-- ============================================================================
-- La definición de 20260925110100 con tres cambios: 'org_suspended' si el
-- local no puede vender, destino Connect solo de una organización sin
-- suspender y la cuenta de plazas en ticket_seats_held (la misma regla).
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
-- 4) Entradas gratis (T4)
-- ============================================================================
-- Solo la llama stripe-create-checkout (service role) cuando el tipo cuesta
-- 0 €. Mismos bloqueos y límites que create_ticket_order, más 'tier_not_free'
-- si el tipo no es gratis. El pedido nace pagado (0 €, sin comisión, sin
-- sesión de Stripe, livemode NULL) y sus entradas nacen como las deja
-- mark_order_paid_v2: 'paid', con paid_at y su QR (qr_token y
-- access_url_token por defecto). Sin registro de comisión: no hay cobro.
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

-- ============================================================================
-- 5) Disponibilidad por tipo (T2)
-- ============================================================================
-- remaining: lo que se puede comprar ahora de cada tipo activo, contando como
-- create_ticket_order (ticket_seats_held) y limitado también por el aforo
-- del evento. NULL = sin límite. Solo de un evento que quien pregunta puede
-- ver: el público (publicado o pasado, de un local que vende), o el equipo
-- del local y los admins (también en borrador o suspendido).
CREATE OR REPLACE FUNCTION public.event_availability(_event_id UUID)
RETURNS TABLE (tier_id UUID, remaining INT, sold_out BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_event public.events%ROWTYPE;
  v_uid UUID := auth.uid();
  v_event_left INT;
BEGIN
  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id;
  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    (v_event.status IN ('published', 'past') AND public.org_can_sell(v_event.org_id))
    OR (v_uid IS NOT NULL AND (
          v_event.partner_id = v_uid
          OR (v_event.org_id IS NOT NULL AND public.is_member_of_org(v_event.org_id))
          OR public.has_role(v_uid, 'admin'::public.app_role)))
  ) THEN
    RETURN;
  END IF;

  IF v_event.capacity IS NOT NULL THEN
    v_event_left := GREATEST(v_event.capacity - public.ticket_seats_held(v_event.id), 0);
  END IF;

  -- LEAST ignora los NULL: sin cupo del tipo manda el aforo del evento y al
  -- revés; sin ninguno de los dos, NULL.
  RETURN QUERY
  SELECT x.id, x.left_now, COALESCE(x.left_now = 0, FALSE)
    FROM (
      SELECT tt.id,
             tt.sort_order,
             tt.price_cents,
             LEAST(
               CASE WHEN tt.capacity IS NOT NULL
                    THEN GREATEST(tt.capacity - public.ticket_seats_held(tt.event_id, tt.id), 0)
               END,
               v_event_left
             ) AS left_now
        FROM public.ticket_tiers tt
       WHERE tt.event_id = v_event.id
         AND tt.status = 'active'
    ) x
   ORDER BY x.sort_order, x.price_cents, x.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_availability(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_availability(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_availability(UUID) IS
  'Plazas que quedan por tipo activo (remaining NULL = sin límite) con la cuenta de create_ticket_order y el aforo del evento.';

-- ============================================================================
-- 6) Lectura pública de events sin los locales suspendidos
-- ============================================================================
-- Antes: status IN ('published', 'past'). Los tipos de entrada públicos
-- (ticket_tiers_public_read) leen events con la RLS de quien pregunta, así
-- que también desaparecen. El equipo del local sigue viéndolos
-- (events_member_read) y el admin también (events_admin_all).
DROP POLICY IF EXISTS "events_public_read" ON public.events;
CREATE POLICY "events_public_read" ON public.events FOR SELECT TO anon, authenticated
  USING (status IN ('published', 'past') AND (org_id IS NULL OR public.org_can_sell(org_id)));

-- Quien tiene entradas de un evento que ya no es público (borrador,
-- cancelado o de un local suspendido) lo sigue viendo en su cartera.
DROP POLICY IF EXISTS "events_ticket_holder_read" ON public.events;
CREATE POLICY "events_ticket_holder_read" ON public.events FOR SELECT TO authenticated
  USING (
    (status IN ('draft', 'cancelled') OR (org_id IS NOT NULL AND NOT public.org_can_sell(org_id)))
    AND public.holds_ticket_for_event(id)
  );

-- ============================================================================
-- 7) Publicar: tampoco un local suspendido
-- ============================================================================
-- La definición de 20260923120100 con un control más al publicar (un
-- evento nuevo ya publicado o el paso a 'published' desde otro estado): la
-- organización tiene que poder vender. Los eventos ya publicados de un local
-- suspendido siguen 'published' pero no se ven ni se venden (RLS y
-- create_ticket_order); al reactivarlo vuelven solos.
CREATE OR REPLACE FUNCTION public.events_guard_tenant_and_publish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_publishing BOOLEAN := FALSE;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'published' THEN
    IF TG_OP = 'INSERT' THEN
      v_publishing := TRUE;
    ELSE
      v_publishing := OLD.status IS DISTINCT FROM 'published';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
      RAISE EXCEPTION 'No se puede cambiar el local propietario de un evento' USING ERRCODE = '42501';
    END IF;
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      IF NEW.org_id IS NULL
         OR NOT public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
         OR (OLD.org_id IS NOT NULL AND NOT public.has_org_role(OLD.org_id, ARRAY['owner','admin']::public.org_member_role_t[])) THEN
        RAISE EXCEPTION 'No puedes mover el evento a esa organización' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    -- Un evento nuevo va a nombre de quien lo crea: si no, se podía publicar
    -- con el nombre de otro local y cobrar en la organización propia.
    IF NEW.partner_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'El evento tiene que crearse a tu nombre' USING ERRCODE = '42501';
    END IF;
    IF NEW.org_id IS NOT NULL
       AND NOT public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[]) THEN
      RAISE EXCEPTION 'No perteneces a esa organización' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_publishing THEN
    IF NEW.org_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.org_id AND o.status <> 'active') THEN
      RAISE EXCEPTION 'La organización del evento no está activa' USING ERRCODE = '42501';
    END IF;
    -- Suspendido por Pasify (admin_set_org_suspension).
    IF NEW.org_id IS NOT NULL AND NOT public.org_can_sell(NEW.org_id) THEN
      RAISE EXCEPTION 'Tu local está suspendido: no puedes publicar eventos' USING ERRCODE = '42501', HINT = 'org_suspended';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.account_status = 'rejected')
       OR NOT (
      (public.has_role(v_uid, 'partner'::public.app_role)
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.account_status = 'approved'))
      OR (NEW.org_id IS NOT NULL
          AND public.has_org_role(NEW.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    ) THEN
      RAISE EXCEPTION 'Tu cuenta de local no está activa: no puedes publicar eventos' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 8) Caducidad de pedidos pendientes (T3)
-- ============================================================================
-- La definición de 20260923120200 con un filtro más: con sesión de Stripe
-- solo se anulan pasadas 24 h (una sesión no vive más). Antes de eso los
-- concilia reconcile-pending-orders preguntando a Stripe: si el pago llegó y
-- el webhook no, se confirma en vez de anularse. Las plazas quedan libres
-- para otros compradores en cuanto pasa expires_at + 15 min, aunque el pedido
-- siga 'pending' (ticket_seats_held).
CREATE OR REPLACE FUNCTION public.cron_expire_pending_orders()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('expire_pending_orders', 'running') RETURNING id INTO v_run_id;
  WITH expired AS (
    UPDATE public.ticket_orders
       SET status = 'expired'
     WHERE status = 'pending'
       AND COALESCE(expires_at, created_at + INTERVAL '30 minutes') < now() - INTERVAL '2 hours'
       AND (stripe_session_id IS NULL OR created_at < now() - INTERVAL '24 hours')
    RETURNING id
  )
  UPDATE public.tickets t
     SET status = 'cancelled'
    FROM expired e
   WHERE t.order_id = e.id AND t.status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs
     SET finished_at = now(), status = 'success', metadata = jsonb_build_object('tickets_cancelled', v_count)
   WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_expire_pending_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_expire_pending_orders() TO service_role;

-- Lote de pedidos a conciliar con Stripe (solo reconcile-pending-orders):
-- pendientes con sesión y ya caducados ('expired'), y los de un local que ya
-- no puede vender aunque su sesión siga abierta ('org_suspended': se caduca
-- para que nadie pague después de la suspensión). Los más antiguos primero;
-- _exclude son los ya revisados en esta pasada.
CREATE OR REPLACE FUNCTION public.pending_orders_to_reconcile(_limit INT DEFAULT 50, _exclude UUID[] DEFAULT '{}')
RETURNS TABLE (order_id UUID, stripe_session_id TEXT, reason TEXT)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT o.id,
         o.stripe_session_id,
         CASE WHEN COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') < now()
              THEN 'expired' ELSE 'org_suspended' END
    FROM public.ticket_orders o
   WHERE o.status = 'pending'
     AND o.stripe_session_id IS NOT NULL
     AND o.id <> ALL (COALESCE(_exclude, '{}'::UUID[]))
     AND (COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes') < now()
          OR (o.org_id IS NOT NULL AND NOT public.org_can_sell(o.org_id)))
   ORDER BY COALESCE(o.expires_at, o.created_at + INTERVAL '30 minutes'), o.id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.pending_orders_to_reconcile(INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_orders_to_reconcile(INT, UUID[]) TO service_role;

-- ============================================================================
-- 9) Programar reconcile-pending-orders (pg_cron + pg_net)
-- ============================================================================
-- Cada 10 minutos, POST a la edge function con la cabecera x-pasify-internal
-- (requireServiceRole de _shared/internal-auth.ts). El secreto se lee de Vault
-- en cada ejecución: no queda escrito en cron.job. La URL es la del secreto
-- pasify_project_url de Vault si existe; si no, la de producción.
--
-- Acción manual (una vez, en el SQL editor de producción), si esta migración
-- avisó de que no había secreto:
--   1. Secreto de las edge functions PASIFY_INTERNAL_SECRET (32+ caracteres).
--   2. El mismo valor en Vault:
--        SELECT vault.create_secret('<mismo valor>', 'pasify_internal_secret');
--   3. SELECT public.schedule_reconcile_pending_orders();
-- Repetir el paso 3 no duplica el trabajo (cron.schedule reemplaza el del
-- mismo nombre). Para pararlo: SELECT cron.unschedule('pasify-reconcile-pending-orders');
CREATE OR REPLACE FUNCTION public.schedule_reconcile_pending_orders()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_url TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret') THEN
    RAISE EXCEPTION 'Falta el secreto pasify_internal_secret en Vault (el mismo valor que PASIFY_INTERNAL_SECRET de las edge functions)';
  END IF;

  SELECT s.decrypted_secret INTO v_base
    FROM vault.decrypted_secrets s
   WHERE s.name = 'pasify_project_url'
   LIMIT 1;
  v_base := rtrim(COALESCE(NULLIF(btrim(v_base), ''), 'https://ixkyfwzkknehvsqpopof.supabase.co'), '/');
  v_url := v_base || '/functions/v1/reconcile-pending-orders';

  PERFORM cron.schedule(
    'pasify-reconcile-pending-orders',
    '*/10 * * * *',
    format(
      $job$SELECT net.http_post(
  url := %L,
  body := '{}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-pasify-internal', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret' LIMIT 1)
  ),
  timeout_milliseconds := 55000
)$job$,
      v_url
    )
  );
  RETURN 'pasify-reconcile-pending-orders: cada 10 minutos contra ' || v_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_reconcile_pending_orders() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_ready BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret') INTO v_ready;
  EXCEPTION WHEN OTHERS THEN
    v_ready := FALSE;
  END;

  IF v_ready THEN
    RAISE NOTICE '%', public.schedule_reconcile_pending_orders();
  ELSE
    RAISE NOTICE 'reconcile-pending-orders sin programar: falta el secreto pasify_internal_secret en Vault. Tras crearlo: SELECT public.schedule_reconcile_pending_orders();';
  END IF;
END $$;
