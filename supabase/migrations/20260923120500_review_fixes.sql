-- Pasify · correcciones de la revisión de seguridad previa al despliegue
--
--   * refund_requests: los owner/admin/manager podían reescribir cualquier
--     columna (pedido, importe, estado) de una solicitud y process-refund
--     devolvía ese importe en Stripe. Las solicitudes se deciden solo con
--     decide_refund; el personal de puerta o de RRPP ya no ve los emails.
--   * partner_event_tier_live_stats comparaba events.partner_id = auth.uid():
--     con partner_id NULL (cuenta del creador borrada) el IF NOT (...) daba
--     NULL y no bloqueaba a nadie.
--   * door_scan (heredada, sin uso en la app) tenía el mismo fallo y marcaba
--     entradas como usadas.
--   * auto_approve_if_allowed volvía a aprobar a una cuenta que el admin
--     había rechazado.

-- ============================================================================
-- 1) refund_requests: sin UPDATE directo; lectura de miembros solo gestión
-- ============================================================================
DROP POLICY IF EXISTS "refund_requests_member_decide" ON public.refund_requests;

DROP POLICY IF EXISTS "refund_requests_member_read" ON public.refund_requests;
CREATE POLICY "refund_requests_member_read" ON public.refund_requests FOR SELECT TO authenticated
  USING (
    org_id IS NOT NULL
    AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

-- ============================================================================
-- 2) partner_event_tier_live_stats: comprobación a prueba de NULL
-- ============================================================================
CREATE OR REPLACE FUNCTION public.partner_event_tier_live_stats(_event_id uuid)
 RETURNS TABLE(tier_id uuid, tier_name text, tier_status text, capacity integer, sold_count integer, used_count integer, pending_count integer, refunded_count integer, revenue_cents bigint, checkin_pct numeric, has_sales boolean, sort_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_event.partner_id IS NOT DISTINCT FROM v_uid
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
$function$;

-- ============================================================================
-- 3) door_scan: fuera del cliente (el escáner usa scan_ticket)
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.door_scan(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.door_scan(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.door_scan(uuid) TO service_role;
  END IF;
END $$;

-- ============================================================================
-- 4) auto_approve_if_allowed: solo aprueba cuentas pendientes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_approve_if_allowed(_role text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF _role = 'client' THEN
    -- Nunca deshace un rechazo del admin.
    UPDATE public.profiles SET account_status = 'approved'
     WHERE id = v_uid AND account_status = 'pending';
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_approve_if_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_if_allowed(text) TO authenticated, service_role;
