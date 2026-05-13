-- Pasify · 0037 partner event editing guards + per-tier live stats
--
-- Habilita el flujo profesional de edicion de eventos garantizando que
-- los cambios criticos NO se pueden hacer cuando ya hay ventas.
-- Frontend bloquea inputs por UX; backend bloquea via triggers para
-- proteger la integridad de las compras frente a clientes malformed
-- o llamadas directas al PostgREST.
--
-- Anade ademas la RPC partner_event_tier_live_stats que el panel
-- "En vivo" (LiveWarRoom) usa para mostrar metricas reales por tipo
-- de entrada (vendidos, dentro, pendientes, recaudacion, % check-in)
-- en lugar de zonas simuladas.
--
-- Idempotente: usa CREATE OR REPLACE / DROP IF EXISTS para poder
-- re-aplicarse sin perder datos ni romper la app.

-- =================================================================
-- 1) event_has_sales(_event_id) — fuente unica de verdad
-- =================================================================
CREATE OR REPLACE FUNCTION public.event_has_sales(_event_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets
    WHERE event_id = _event_id
      AND status IN ('paid', 'used', 'refunded')
  );
$$;
GRANT EXECUTE ON FUNCTION public.event_has_sales(UUID) TO authenticated;

-- =================================================================
-- 2) tier_has_sales(_tier_id) — granular por tipo de entrada
-- =================================================================
CREATE OR REPLACE FUNCTION public.tier_has_sales(_tier_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets
    WHERE tier_id = _tier_id
      AND status IN ('paid', 'used', 'refunded')
  );
$$;
GRANT EXECUTE ON FUNCTION public.tier_has_sales(UUID) TO authenticated;

-- =================================================================
-- 3) partner_event_tier_live_stats(_event_id) — stats por tier
-- =================================================================
-- Devuelve una fila por cada ticket_tier del evento con sus contadores
-- reales y % de check-in. Reemplaza la simulacion de "zonas" del
-- LiveWarRoom anterior. La autorizacion replica el patron de las RPCs
-- existentes (partner_event_attendees / partner_event_checkin_stats):
-- partner_id directo, miembro de la org con rol door+ , o admin global.
CREATE OR REPLACE FUNCTION public.partner_event_tier_live_stats(_event_id UUID)
RETURNS TABLE (
  tier_id        UUID,
  tier_name      TEXT,
  tier_status    TEXT,
  capacity       INT,
  sold_count     INT,
  used_count     INT,
  pending_count  INT,
  refunded_count INT,
  revenue_cents  BIGINT,
  checkin_pct    NUMERIC,
  has_sales      BOOLEAN,
  sort_order     INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_event public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = _event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF NOT (
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    tt.id AS tier_id,
    tt.name AS tier_name,
    tt.status::text AS tier_status,
    tt.capacity,
    COALESCE(COUNT(t.id) FILTER (WHERE t.status IN ('paid','used')), 0)::INT AS sold_count,
    COALESCE(COUNT(t.id) FILTER (WHERE t.status = 'used'), 0)::INT AS used_count,
    COALESCE(COUNT(t.id) FILTER (WHERE t.status = 'paid'), 0)::INT AS pending_count,
    COALESCE(COUNT(t.id) FILTER (WHERE t.status IN ('refunded','cancelled')), 0)::INT AS refunded_count,
    COALESCE(SUM(t.amount_paid_cents) FILTER (WHERE t.status IN ('paid','used')), 0)::BIGINT AS revenue_cents,
    CASE
      WHEN COUNT(t.id) FILTER (WHERE t.status IN ('paid','used')) > 0
      THEN ROUND(
        (COUNT(t.id) FILTER (WHERE t.status = 'used')::numeric
          / COUNT(t.id) FILTER (WHERE t.status IN ('paid','used'))::numeric) * 100,
        1
      )
      ELSE 0::numeric
    END AS checkin_pct,
    EXISTS (
      SELECT 1 FROM public.tickets t2
      WHERE t2.tier_id = tt.id AND t2.status IN ('paid','used','refunded')
    ) AS has_sales,
    tt.sort_order
  FROM public.ticket_tiers tt
  LEFT JOIN public.tickets t ON t.tier_id = tt.id
  WHERE tt.event_id = _event_id
  GROUP BY tt.id, tt.name, tt.status, tt.capacity, tt.sort_order
  ORDER BY tt.sort_order ASC, tt.name ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.partner_event_tier_live_stats(UUID) TO authenticated;

-- =================================================================
-- 4) Trigger: bloquea cambios criticos sobre ticket_tiers con ventas
-- =================================================================
-- - No permite cambiar price_cents si el tier ya tiene tickets vendidos.
-- - No permite reducir capacity por debajo del numero ya vendido.
-- - Permite cambiar nombre, descripcion, status (oculto/cerrado),
--   per_user_max, sale_starts_at, sale_ends_at, sort_order, etc.
CREATE OR REPLACE FUNCTION public.enforce_tier_immutable_on_sales()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sold INT;
BEGIN
  IF NEW.id IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_sold
  FROM public.tickets
  WHERE tier_id = NEW.id
    AND status IN ('paid','used');

  -- Cambio de precio sobre tier con ventas → bloquear
  IF v_sold > 0 AND OLD.price_cents IS DISTINCT FROM NEW.price_cents THEN
    RAISE EXCEPTION 'Cannot change price of tier % (% tickets already sold). Hide it or create a new tier instead.', NEW.name, v_sold
      USING ERRCODE = 'check_violation';
  END IF;

  -- Capacity por debajo de vendidos → bloquear
  IF NEW.capacity IS NOT NULL AND NEW.capacity < v_sold THEN
    RAISE EXCEPTION 'Cannot reduce tier capacity to % below sold count %', NEW.capacity, v_sold
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tier_immutable_on_sales ON public.ticket_tiers;
CREATE TRIGGER trg_enforce_tier_immutable_on_sales
  BEFORE UPDATE ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tier_immutable_on_sales();

-- =================================================================
-- 5) Trigger: bloquea DELETE de tier con ventas
-- =================================================================
CREATE OR REPLACE FUNCTION public.enforce_tier_no_delete_on_sales()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sold INT;
BEGIN
  SELECT COUNT(*) INTO v_sold
  FROM public.tickets
  WHERE tier_id = OLD.id
    AND status IN ('paid','used','refunded');

  IF v_sold > 0 THEN
    RAISE EXCEPTION 'Cannot delete tier % (% tickets already sold). Hide it instead.', OLD.name, v_sold
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tier_no_delete_on_sales ON public.ticket_tiers;
CREATE TRIGGER trg_enforce_tier_no_delete_on_sales
  BEFORE DELETE ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tier_no_delete_on_sales();

-- =================================================================
-- 6) Trigger: bloquea DELETE de evento con ventas
-- =================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_no_delete_on_sales()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sold INT;
BEGIN
  SELECT COUNT(*) INTO v_sold
  FROM public.tickets
  WHERE event_id = OLD.id
    AND status IN ('paid','used','refunded');

  IF v_sold > 0 THEN
    RAISE EXCEPTION 'Cannot delete event % (% tickets already sold). Cancel it instead.', OLD.title, v_sold
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_no_delete_on_sales ON public.events;
CREATE TRIGGER trg_enforce_event_no_delete_on_sales
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_no_delete_on_sales();

-- =================================================================
-- 7) Trigger: bloquea reducir capacity por debajo de tickets vendidos
-- =================================================================
CREATE OR REPLACE FUNCTION public.enforce_event_capacity_floor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sold INT;
BEGIN
  IF NEW.capacity IS NULL THEN RETURN NEW; END IF;
  IF NEW.capacity = OLD.capacity THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_sold
  FROM public.tickets
  WHERE event_id = NEW.id
    AND status IN ('paid','used');

  IF NEW.capacity < v_sold THEN
    RAISE EXCEPTION 'Cannot reduce event capacity to % below sold count %', NEW.capacity, v_sold
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_event_capacity_floor ON public.events;
CREATE TRIGGER trg_enforce_event_capacity_floor
  BEFORE UPDATE OF capacity ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_capacity_floor();

-- =================================================================
-- 8) Auditoria: registra cambios sobre tier price/capacity y events
-- =================================================================
-- Reusamos la infraestructura audit_logs ya existente (mig 0024) para
-- dejar traza de cualquier intento sospechoso de modificar campos
-- protegidos. El trigger queda silencioso si la operacion tuvo exito
-- normal, pero las violaciones quedan capturadas por los triggers de
-- guard arriba.
CREATE OR REPLACE FUNCTION public.audit_ticket_tier_critical_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    OLD.price_cents IS DISTINCT FROM NEW.price_cents
    OR OLD.capacity IS DISTINCT FROM NEW.capacity
    OR OLD.status IS DISTINCT FROM NEW.status
  ) THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_role, action, target_kind, target_id, before, after)
    VALUES (
      auth.uid(),
      COALESCE((SELECT role::text FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1), 'anon'),
      'tier_critical_update',
      'ticket_tier',
      NEW.id,
      jsonb_build_object('price_cents', OLD.price_cents, 'capacity', OLD.capacity, 'status', OLD.status),
      jsonb_build_object('price_cents', NEW.price_cents, 'capacity', NEW.capacity, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_ticket_tier_critical_changes ON public.ticket_tiers;
CREATE TRIGGER trg_audit_ticket_tier_critical_changes
  AFTER UPDATE ON public.ticket_tiers
  FOR EACH ROW EXECUTE FUNCTION public.audit_ticket_tier_critical_changes();
