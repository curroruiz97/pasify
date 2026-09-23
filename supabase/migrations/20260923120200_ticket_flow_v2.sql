-- Pasify · flujo de compra de entradas v2 (Fase 0)
--
-- Lo que había:
--   * stripe-create-checkout creaba pedido y entradas con inserts sueltos: dos
--     compras simultáneas de las últimas plazas se vendían las dos, y el aforo
--     del evento no se comprobaba nunca (A3-2).
--   * mark_order_paid pisaba la comisión con 0 y, si el cron había caducado el
--     pedido mientras el cliente pagaba (a los 30 min), dejaba un pedido pagado
--     con sus entradas canceladas: cobrado y sin entrada.
--   * el cron cancelaba pedidos a los 30 min de crearse, justo cuando caduca la
--     sesión de Stripe, sin margen para que llegara la confirmación.
--   * events.price_cents lo escribía el cliente al guardar; con varios tipos
--     de entrada el "desde" dejaba de cuadrar.
--   * un local no podía darse de baja: organizations.owner_id es RESTRICT y
--     events.partner_id CASCADE (borraría sus eventos y chocaría con las
--     entradas).

-- ============================================================================
-- 1) Crear pedido reservando plazas (solo edge functions con service role)
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
  v_order_id UUID;
  v_request_id UUID;
  v_subtotal INT;
  v_fee INT;
  v_dest TEXT;
  v_tz TEXT;
BEGIN
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

-- Sin enlace no hay pago posible: si no actualiza nada, falla (y el caller
-- anula la sesión de Stripe en vez de dar una URL de pago huérfana).
-- La sesión va solo en el pedido: tickets.stripe_session_id es UNIQUE
-- (herencia de cuando una entrada era un pago) y un pedido tiene varias.
CREATE OR REPLACE FUNCTION public.set_order_stripe_session(_order_id UUID, _session_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.ticket_orders
     SET stripe_session_id = _session_id
   WHERE id = _order_id AND stripe_session_id IS NULL AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN RAISE EXCEPTION 'order_not_linkable'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_order_stripe_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_stripe_session(UUID, TEXT) TO service_role;

-- Si Stripe no llega a crear la sesión, el pedido se anula en el acto para
-- liberar las plazas en vez de retenerlas hasta que caduque.
CREATE OR REPLACE FUNCTION public.cancel_ticket_order(_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ticket_orders SET status = 'failed' WHERE id = _order_id AND status = 'pending';
  UPDATE public.tickets SET status = 'cancelled' WHERE order_id = _order_id AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_ticket_order(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket_order(UUID) TO service_role;

-- Cuándo se envió el email con las entradas. Si el primer envío falla, la
-- siguiente confirmación del mismo pago (webhook o vuelta del cliente) lo
-- reintenta en vez de dejar al cliente sin su QR por correo.
ALTER TABLE public.ticket_orders ADD COLUMN IF NOT EXISTS tickets_email_sent_at TIMESTAMPTZ;

-- ============================================================================
-- 2) Marcar pagado (webhook y confirmación al volver de Stripe)
-- ============================================================================
-- newly_paid solo es true la primera vez, para que el email, los puntos y las
-- notificaciones se envíen una vez aunque lleguen webhook y confirmación.
CREATE OR REPLACE FUNCTION public.mark_order_paid_v2(
  _session_id TEXT,
  _payment_intent_id TEXT,
  _amount_total_cents INT,
  _application_fee_cents INT DEFAULT 0
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
         fees_cents = v_fee
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

REVOKE EXECUTE ON FUNCTION public.mark_order_paid_v2(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid_v2(TEXT, TEXT, INT, INT) TO service_role;

-- La v1 delega en la v2 para que las funciones ya desplegadas se beneficien
-- del arreglo (comisión y entradas revividas) hasta que se redespliegan.
CREATE OR REPLACE FUNCTION public.mark_order_paid(
  _session_id TEXT,
  _payment_intent_id TEXT,
  _amount_total_cents INT,
  _application_fee_cents INT DEFAULT 0
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT r.order_id INTO v_id
  FROM public.mark_order_paid_v2(_session_id, _payment_intent_id, _amount_total_cents, _application_fee_cents) r;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_order_paid(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(TEXT, TEXT, INT, INT) TO service_role;

-- ============================================================================
-- 3) Caducidad
-- ============================================================================
CREATE OR REPLACE FUNCTION public.expire_ticket_order(_session_id TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.ticket_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.ticket_orders WHERE stripe_session_id = _session_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;
  IF v_order.status = 'pending' THEN
    UPDATE public.ticket_orders SET status = 'expired' WHERE id = v_order.id;
    UPDATE public.tickets SET status = 'cancelled' WHERE order_id = v_order.id AND status = 'pending';
  END IF;
  RETURN v_order.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_ticket_order(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ticket_order(TEXT) TO service_role;

-- Red de seguridad: Stripe avisa cuando caduca la sesión (webhook) y el
-- cliente confirma al volver. Aquí solo se cierran pedidos abandonados hace
-- más de 2 horas, para no cancelar las entradas de un pago que aún se está
-- confirmando. Las plazas quedan libres para otros compradores en cuanto pasa
-- expires_at, aunque el pedido siga 'pending'.
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

-- ============================================================================
-- 4) Precio "desde" del evento = el menor de sus tipos activos
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ticket_tiers_sync_event_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event UUID := COALESCE(NEW.event_id, OLD.event_id);
  v_min INT;
BEGIN
  SELECT min(price_cents) INTO v_min FROM public.ticket_tiers WHERE event_id = v_event AND status = 'active';
  IF v_min IS NOT NULL THEN
    UPDATE public.events SET price_cents = v_min WHERE id = v_event AND price_cents IS DISTINCT FROM v_min;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ticket_tiers_sync_event_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_tiers_sync_event_price ON public.ticket_tiers;
CREATE TRIGGER trg_ticket_tiers_sync_event_price
  AFTER INSERT OR DELETE OR UPDATE OF price_cents, status ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.ticket_tiers_sync_event_price();

UPDATE public.events e
   SET price_cents = m.min_price
  FROM (
    SELECT event_id, min(price_cents) AS min_price
    FROM public.ticket_tiers
    WHERE status = 'active'
    GROUP BY event_id
  ) m
 WHERE m.event_id = e.id AND e.price_cents IS DISTINCT FROM m.min_price;

-- ============================================================================
-- 5) Baja de cuenta de un local
-- ============================================================================
-- Los eventos y organizaciones sobreviven al usuario (las entradas y los
-- pedidos son registros de los compradores y fiscales); quedan sin dueño.
ALTER TABLE public.events ALTER COLUMN partner_id DROP NOT NULL;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_partner_id_fkey;
ALTER TABLE public.events
  ADD CONSTRAINT events_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.organizations ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_owner_id_fkey;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Se llama con la sesión del local (delete-own-account) antes de borrar el
-- usuario. Con eventos futuros con ventas no deja cerrar: primero hay que
-- cancelarlos y reembolsar.
CREATE OR REPLACE FUNCTION public.partner_close_account()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_orgs UUID[];
  v_cancelled INT := 0;
  v_closed INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(array_agg(o.id), '{}') INTO v_orgs FROM public.organizations o WHERE o.owner_id = v_uid;

  IF EXISTS (
    SELECT 1 FROM public.events e
    WHERE (e.partner_id = v_uid OR e.org_id = ANY (v_orgs))
      AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') > now()
      AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used'))
  ) THEN
    RAISE EXCEPTION 'partner_has_upcoming_sales';
  END IF;

  UPDATE public.events e
     SET status = 'cancelled'
   WHERE (e.partner_id = v_uid OR e.org_id = ANY (v_orgs))
     AND e.status IN ('draft', 'published')
     AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') > now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.organizations o
     SET status = 'closed',
         metadata = o.metadata || jsonb_build_object('closed_at', now(), 'closed_by', v_uid)
   WHERE o.id = ANY (v_orgs) AND o.status <> 'closed';
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE public.organization_members m
     SET status = 'removed', removed_at = now()
   WHERE m.org_id = ANY (v_orgs) AND m.status <> 'removed';

  UPDATE public.partner_subscriptions ps
     SET status = 'cancelled', cancelled_at = now()
   WHERE ps.org_id = ANY (v_orgs);

  RETURN jsonb_build_object('closed_orgs', v_closed, 'cancelled_events', v_cancelled);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_close_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_close_account() TO authenticated, service_role;

-- ============================================================================
-- 6) Secciones demo del panel: solo para organizaciones listadas en
--    tenant_overrides ({"<org_id>": true}); apagado para el resto.
-- ============================================================================
INSERT INTO public.feature_flags (code, name, description, enabled, rollout_pct)
SELECT 'partner_showcase',
       'Secciones demo del panel de local',
       'Enseña las secciones maqueta (CRM, Marketing, Equipo…) con la franja DEMO solo a las organizaciones listadas en tenant_overrides.',
       FALSE,
       0
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE code = 'partner_showcase');
