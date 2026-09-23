-- Pasify · Fase 1: eventos ligados a su local, saldo por local, avisos de
-- soporte y entrada manual por código corto
--
--   * Todos los eventos de producción tenían org_id y venue_id a NULL: el
--     editor nunca enviaba venue_id y el trigger events_set_org_chain solo
--     deduce la organización a partir de él. Sin org_id no hay cobro por
--     Connect, ni registro de comisiones, ni equipo, ni cashless.
--   * El local no tenía forma de ver lo cobrado y lo que se le debe mientras
--     no haya Connect (liquidación manual).
--   * Nadie se enteraba cuando soporte respondía.
--   * En puerta, el cliente solo ve 8 caracteres de su código; no había forma
--     de validar una entrada tecleándolos.

-- ============================================================================
-- 1) Eventos y pedidos existentes → su local y su organización
-- ============================================================================
-- Local principal de cada organización (el primero creado).
WITH primary_venue AS (
  SELECT DISTINCT ON (v.org_id) v.org_id, v.id AS venue_id
  FROM public.venues v
  ORDER BY v.org_id, v.created_at
),
owner_org AS (
  SELECT DISTINCT ON (o.owner_id) o.owner_id, o.id AS org_id
  FROM public.organizations o
  WHERE o.owner_id IS NOT NULL
  ORDER BY o.owner_id, o.created_at
)
UPDATE public.events e
   SET venue_id = pv.venue_id
  FROM owner_org oo
  JOIN primary_venue pv ON pv.org_id = oo.org_id
 WHERE e.venue_id IS NULL
   AND e.org_id IS NULL
   AND e.partner_id = oo.owner_id;
-- trg_events_set_org_chain rellena brand_id y org_id a partir de venue_id.

UPDATE public.ticket_orders o
   SET org_id = e.org_id
  FROM public.events e
 WHERE o.event_id = e.id
   AND o.org_id IS NULL
   AND e.org_id IS NOT NULL;

UPDATE public.refund_requests r
   SET org_id = e.org_id
  FROM public.events e
 WHERE r.event_id = e.id
   AND r.org_id IS NULL
   AND e.org_id IS NOT NULL;

-- ============================================================================
-- 2) Saldo por local (liquidación manual hasta que haya Connect)
-- ============================================================================
-- Bruto cobrado, reembolsado, comisión de Pasify y neto a liquidar por
-- organización. security_invoker: cada local solo ve su fila (RLS de
-- ticket_orders y refund_requests: owner/admin/manager).
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
  GROUP BY o.org_id
),
refunded AS (
  SELECT r.org_id, COALESCE(sum(r.amount_cents), 0) AS refunded_cents
  FROM public.refund_requests r
  WHERE r.org_id IS NOT NULL AND r.status = 'refunded'
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

-- ============================================================================
-- 3) Soporte: aviso al usuario cuando Pasify responde
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_notify_reply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv public.support_conversations%ROWTYPE;
BEGIN
  IF NEW.sender_kind <> 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_conv FROM public.support_conversations WHERE id = NEW.conversation_id;
  IF v_conv.id IS NULL OR v_conv.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_notification(
    v_conv.client_id,
    'support',
    'support_reply',
    'Te ha respondido el equipo de Pasify',
    left(NEW.body, 140),
    CASE WHEN v_conv.kind = 'partner_admin' THEN '/#/partner-dashboard' ELSE '/#/client-dashboard' END,
    jsonb_build_object('conversation_id', v_conv.id)
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_notify_reply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_notify_reply ON public.support_messages;
CREATE TRIGGER trg_support_notify_reply AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_notify_reply();

-- ============================================================================
-- 4) Puerta: validar tecleando los 8 primeros caracteres del código
-- ============================================================================
-- Busca solo dentro del evento seleccionado y exige coincidencia única; luego
-- aplica exactamente las mismas reglas que scan_ticket (permisos, estado,
-- horario, auditoría).
CREATE OR REPLACE FUNCTION public.scan_ticket_by_code(
  _code TEXT,
  _event_id UUID,
  _device_info TEXT DEFAULT NULL,
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
  v_uid UUID := auth.uid();
  v_code TEXT := lower(regexp_replace(COALESCE(_code, ''), '[^0-9a-fA-F]', '', 'g'));
  v_event public.events%ROWTYPE;
  v_matches INT;
  v_token UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id;
  IF v_event.id IS NULL OR NOT (
    v_event.partner_id IS NOT DISTINCT FROM v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RETURN QUERY SELECT FALSE, 'forbidden'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, now(), NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  IF length(v_code) < 8 THEN
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, now(), NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  SELECT count(*), min(t.qr_token::text)::uuid INTO v_matches, v_token
  FROM public.tickets t
  WHERE t.event_id = _event_id
    AND replace(t.qr_token::text, '-', '') LIKE v_code || '%'
    AND t.status IN ('paid', 'used', 'refunded', 'cancelled');

  IF v_matches <> 1 THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, device_info, notes)
    VALUES (NULL, _event_id, v_event.org_id, v_uid, now(), 'invalid_ticket', _device_info,
            CASE WHEN v_matches = 0 THEN 'manual_code_not_found' ELSE 'manual_code_ambiguous' END);
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t, NULL::UUID, NULL::UUID, NULL::TEXT,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, now(), NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
    RETURN;
  END IF;

  RETURN QUERY SELECT * FROM public.scan_ticket(v_token, _device_info, _event_id, _force, _force_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_ticket_by_code(TEXT, UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_ticket_by_code(TEXT, UUID, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 5) Un evento cancelado no vuelve a la venta desde el cliente
-- ============================================================================
-- Las entradas vendidas de un evento cancelado se reembolsan; reactivarlo
-- dejaría entradas reembolsadas y ventas nuevas mezcladas. Solo un admin (o
-- el servidor) puede sacarlo de 'cancelled'.
CREATE OR REPLACE FUNCTION public.events_guard_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled'
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Un evento cancelado no se puede volver a publicar' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zz_events_status_transition ON public.events;
CREATE TRIGGER trg_zz_events_status_transition BEFORE UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_guard_status_transition();
