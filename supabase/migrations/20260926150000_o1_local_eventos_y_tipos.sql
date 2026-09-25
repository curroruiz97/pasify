-- Pasify · eventos y tipos de entrada del panel de local (auditoría, ola 1)
--
--   * B4-02: el editor calculaba events.capacity sumando solo los tipos
--     ACTIVOS. Al ocultar un tipo agotado (Early 100 vendidas + General 400)
--     el aforo pasaba a 400, pero la venta cuenta también lo vendido de los
--     tipos ocultos (create_ticket_order): General se agotaba con 300. Ahora
--     el aforo lo mantiene un trigger con la suma de los cupos de TODOS los
--     tipos, como ticket_tiers_sync_event_price hace con el precio "desde".
--   * B4-03 (parte segura): Stripe no cobra importes de 0,01 a 0,49 € y el
--     editor dejaba crearlos; el comprador se encontraba un error al pagar.
--   * WP1.3: un evento pasado podía volver a publicarse desde el cliente
--     (el trigger de estado solo protegía 'cancelled').

-- ============================================================================
-- 1) Aforo del evento = suma de los cupos de todos sus tipos de entrada
-- ============================================================================
-- Reglas:
--   * Cuentan todos los tipos: activos, ocultos, agotados o cerrados. Lo que
--     un tipo oculto ya vendió sigue ocupando sitio.
--   * Un tipo sin cupo (sin límite) deja el evento sin límite (NULL), como
--     hacía el editor.
--   * Las entradas pagadas o usadas sin tipo (anteriores a los tipos de
--     entrada) se suman: ocupan sitio, y así el aforo nunca queda por debajo
--     de lo vendido (enforce_event_capacity_floor lo rechazaría).
--   * Un evento sin tipos no se toca: su aforo manual se respeta.
-- Con esta regla el aforo del evento ya no corta la venta antes que el cupo
-- de cada tipo; es el total que enseñan En vivo, Asistentes, la previsión y
-- el calendario.
CREATE OR REPLACE FUNCTION public.event_capacity_from_tiers(_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tiers    INT;
  v_limited  INT;
  v_sum      BIGINT;
  v_loose    INT;
  v_capacity INT;
BEGIN
  IF _event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*), count(tt.capacity), COALESCE(sum(tt.capacity), 0)
    INTO v_tiers, v_limited, v_sum
    FROM public.ticket_tiers tt
   WHERE tt.event_id = _event_id;

  IF v_tiers = 0 THEN
    RETURN;
  END IF;

  IF v_limited < v_tiers THEN
    v_capacity := NULL;
  ELSE
    SELECT count(*) INTO v_loose
      FROM public.tickets t
     WHERE t.event_id = _event_id
       AND t.tier_id IS NULL
       AND t.status IN ('paid', 'used');
    v_capacity := LEAST(v_sum + v_loose, 2147483647)::INT;
  END IF;

  UPDATE public.events e
     SET capacity = v_capacity
   WHERE e.id = _event_id
     AND e.capacity IS DISTINCT FROM v_capacity;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_capacity_from_tiers(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_capacity_from_tiers(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.ticket_tiers_sync_event_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.event_capacity_from_tiers(OLD.event_id);
  END IF;
  -- Un tipo que cambia de evento recalcula los dos.
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id) THEN
    PERFORM public.event_capacity_from_tiers(NEW.event_id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ticket_tiers_sync_event_capacity() FROM PUBLIC, anon, authenticated;

-- Salta también si el UPDATE repite el mismo cupo: el editor de las apps ya
-- publicadas escribe en el evento la suma de los tipos activos y justo
-- después guarda cada tipo con su cupo, así que el aforo queda bien al
-- terminar de guardar.
DROP TRIGGER IF EXISTS trg_ticket_tiers_sync_event_capacity ON public.ticket_tiers;
CREATE TRIGGER trg_ticket_tiers_sync_event_capacity
  AFTER INSERT OR DELETE OR UPDATE OF capacity, event_id ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.ticket_tiers_sync_event_capacity();

-- Eventos ya creados: el aforo que escribió el editor (solo tipos activos)
-- pasa a la suma de todos los tipos.
DO $$
DECLARE
  v_event UUID;
BEGIN
  FOR v_event IN SELECT DISTINCT tt.event_id FROM public.ticket_tiers tt LOOP
    PERFORM public.event_capacity_from_tiers(v_event);
  END LOOP;
END $$;

-- ============================================================================
-- 2) Precio de un tipo de entrada: 0 € o al menos 0,50 €
-- ============================================================================
-- Stripe no admite cobros de menos de 0,50 €. La regla de las entradas de
-- 0 € no cambia aquí (depende de la decisión pendiente sobre entradas
-- gratis). Solo se comprueba cuando el precio cambia: un tipo antiguo con un
-- precio así se puede seguir editando (nombre, cupo…) sin tocar el precio.
CREATE OR REPLACE FUNCTION public.ticket_tiers_guard_min_price()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.price_cents BETWEEN 1 AND 49
     AND (TG_OP = 'INSERT' OR NEW.price_cents IS DISTINCT FROM OLD.price_cents) THEN
    RAISE EXCEPTION 'El precio mínimo de una entrada de pago es 0,50 €'
      USING ERRCODE = '23514', HINT = 'Stripe no admite cobros de menos de 0,50 €.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ticket_tiers_guard_min_price() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticket_tiers_guard_min_price ON public.ticket_tiers;
CREATE TRIGGER trg_ticket_tiers_guard_min_price
  BEFORE INSERT OR UPDATE OF price_cents ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.ticket_tiers_guard_min_price();

-- ============================================================================
-- 3) Un evento cancelado o pasado no cambia de estado desde el cliente
-- ============================================================================
-- 'cancelled': sus entradas se reembolsan; reactivarlo mezclaría entradas
-- reembolsadas con ventas nuevas. 'past': lo pone el cron al terminar el
-- evento; publicarlo otra vez lo volvería a poner a la venta. Solo un admin
-- o el servidor (service_role, el cron, las funciones definer) lo cambian.
CREATE OR REPLACE FUNCTION public.events_guard_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'past')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'Un evento cancelado no se puede volver a publicar' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Un evento que ya ha pasado no puede cambiar de estado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_guard_status_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_events_status_transition ON public.events;
CREATE TRIGGER trg_zz_events_status_transition BEFORE UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_guard_status_transition();
