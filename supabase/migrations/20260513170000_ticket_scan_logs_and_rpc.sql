-- Pasify · 0036 ticket_scan_logs + scan_ticket RPC
--
-- Auditoría de TODOS los intentos de escaneo (éxito + fallos) para que el
-- partner pueda investigar tickets repetidos, intentos sospechosos y
-- discrepancias en puerta. Reemplaza la lógica anterior de la app cliente
-- (UPDATE directo sobre tickets) por una RPC server-side atómica que:
--   1) Verifica que el ticket existe y pertenece al partner/org
--   2) Verifica estado (paid / used / cancelled / refunded / pending)
--   3) Marca como used si procede
--   4) SIEMPRE inserta una fila en ticket_scan_logs con el resultado

CREATE TYPE public.scan_result_t AS ENUM (
  'success',
  'already_used',
  'invalid_ticket',
  'wrong_event',
  'not_paid',
  'forbidden'
);

CREATE TABLE IF NOT EXISTS public.ticket_scan_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  event_id        UUID REFERENCES public.events(id) ON DELETE SET NULL,
  org_id          UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  venue_id        UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  scanned_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  result          public.scan_result_t NOT NULL,
  qr_token_hash   TEXT,            -- hash del qr_token escaneado (auditoría sin exponer el token)
  device_info     TEXT,            -- user-agent o etiqueta de dispositivo
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_ticket    ON public.ticket_scan_logs(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_logs_event     ON public.ticket_scan_logs(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_logs_org       ON public.ticket_scan_logs(org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_logs_scanner   ON public.ticket_scan_logs(scanned_by_user_id) WHERE scanned_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_logs_scanned_at ON public.ticket_scan_logs(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_result    ON public.ticket_scan_logs(result);

ALTER TABLE public.ticket_scan_logs ENABLE ROW LEVEL SECURITY;

-- RLS: partner puede leer los logs de SUS eventos (event.partner_id = uid)
--      o los de su org (vía organization_members con role suficiente). El
--      admin global puede leerlo todo.
DROP POLICY IF EXISTS "scan_logs_partner_read" ON public.ticket_scan_logs;
CREATE POLICY "scan_logs_partner_read" ON public.ticket_scan_logs FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = ticket_scan_logs.event_id
      AND (
        e.partner_id = auth.uid()
        OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
      )
  )
);

DROP POLICY IF EXISTS "scan_logs_admin_all" ON public.ticket_scan_logs;
CREATE POLICY "scan_logs_admin_all" ON public.ticket_scan_logs FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
) WITH CHECK (
  public.has_role(auth.uid(), 'admin')
);

-- INSERT no-op para usuarios autenticados: el INSERT viene de la RPC con
-- SECURITY DEFINER. No hace falta policy adicional.

GRANT SELECT ON public.ticket_scan_logs TO authenticated;

-- =================================================================
-- RPC scan_ticket: usado por el QRScanner del partner. Atomic, audita.
-- =================================================================
CREATE OR REPLACE FUNCTION public.scan_ticket(
  _qr_token UUID,
  _device_info TEXT DEFAULT NULL
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
  already_used_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_ticket       public.tickets%ROWTYPE;
  v_event        public.events%ROWTYPE;
  v_tier_name    TEXT;
  v_result       public.scan_result_t;
  v_scanned_at   TIMESTAMPTZ := now();
  v_org_id       UUID;
  v_venue_id     UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1) Cargar ticket
  SELECT * INTO v_ticket FROM public.tickets WHERE qr_token = _qr_token FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (NULL, NULL, v_uid, v_scanned_at, 'invalid_ticket', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info);
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t,
                        NULL::UUID, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
                        NULL::TEXT, v_scanned_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 2) Cargar evento + verificar ownership
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id;
  IF v_event.id IS NULL THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, NULL, v_uid, v_scanned_at, 'invalid_ticket', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info);
    RETURN QUERY SELECT FALSE, 'invalid_ticket'::public.scan_result_t,
                        v_ticket.id, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
                        NULL::TEXT, v_scanned_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_org_id := v_event.org_id;

  -- 3) Verificar permisos del scanner: partner_id directo o miembro de org con rol door/manager/admin/owner
  IF NOT (
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_org_id, v_uid, v_scanned_at, 'forbidden', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info);
    RETURN QUERY SELECT FALSE, 'forbidden'::public.scan_result_t,
                        v_ticket.id, v_event.id, v_event.title, v_ticket.buyer_first_name, v_ticket.buyer_last_name,
                        v_ticket.buyer_email, NULL::TEXT, v_scanned_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 4) Verificar estado del ticket
  IF v_ticket.status = 'used' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
    VALUES (v_ticket.id, v_event.id, v_org_id, v_uid, v_scanned_at, 'already_used', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info);
    -- tier name
    IF v_ticket.tier_id IS NOT NULL THEN
      SELECT name INTO v_tier_name FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
    END IF;
    RETURN QUERY SELECT FALSE, 'already_used'::public.scan_result_t,
                        v_ticket.id, v_event.id, v_event.title,
                        v_ticket.buyer_first_name, v_ticket.buyer_last_name, v_ticket.buyer_email,
                        v_tier_name, v_scanned_at, v_ticket.used_at;
    RETURN;
  END IF;

  IF v_ticket.status <> 'paid' THEN
    INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info, notes)
    VALUES (v_ticket.id, v_event.id, v_org_id, v_uid, v_scanned_at, 'not_paid', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info,
            'ticket status was: ' || v_ticket.status::text);
    RETURN QUERY SELECT FALSE, 'not_paid'::public.scan_result_t,
                        v_ticket.id, v_event.id, v_event.title,
                        v_ticket.buyer_first_name, v_ticket.buyer_last_name, v_ticket.buyer_email,
                        NULL::TEXT, v_scanned_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- 5) Marcar como usado
  UPDATE public.tickets
  SET status = 'used',
      used_at = v_scanned_at,
      used_by_partner_id = v_uid
  WHERE id = v_ticket.id;

  -- 6) Resolver tier name
  IF v_ticket.tier_id IS NOT NULL THEN
    SELECT name INTO v_tier_name FROM public.ticket_tiers WHERE id = v_ticket.tier_id;
  END IF;

  -- 7) Log success
  INSERT INTO public.ticket_scan_logs (ticket_id, event_id, org_id, scanned_by_user_id, scanned_at, result, qr_token_hash, device_info)
  VALUES (v_ticket.id, v_event.id, v_org_id, v_uid, v_scanned_at, 'success', encode(sha256(_qr_token::text::bytea), 'hex'), _device_info);

  RETURN QUERY SELECT TRUE, 'success'::public.scan_result_t,
                      v_ticket.id, v_event.id, v_event.title,
                      v_ticket.buyer_first_name, v_ticket.buyer_last_name, v_ticket.buyer_email,
                      v_tier_name, v_scanned_at, NULL::TIMESTAMPTZ;
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT) TO authenticated;

-- =================================================================
-- RPC partner_event_attendees: lista de asistentes con stats agregadas
-- =================================================================
CREATE OR REPLACE FUNCTION public.partner_event_attendees(_event_id UUID)
RETURNS TABLE (
  ticket_id         UUID,
  order_id          UUID,
  status            TEXT,
  buyer_first_name  TEXT,
  buyer_last_name   TEXT,
  buyer_email       TEXT,
  buyer_phone       TEXT,
  amount_paid_cents INT,
  currency          TEXT,
  paid_at           TIMESTAMPTZ,
  used_at           TIMESTAMPTZ,
  used_by_partner_id UUID,
  scanned_by_name   TEXT,
  tier_name         TEXT,
  qr_token          UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
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
    t.id,
    t.order_id,
    t.status::text,
    t.buyer_first_name,
    t.buyer_last_name,
    t.buyer_email,
    t.buyer_phone,
    t.amount_paid_cents,
    t.currency,
    t.paid_at,
    t.used_at,
    t.used_by_partner_id,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), p.email, '—')::TEXT AS scanned_by_name,
    tt.name AS tier_name,
    t.qr_token
  FROM public.tickets t
  LEFT JOIN public.ticket_tiers tt ON tt.id = t.tier_id
  LEFT JOIN public.profiles p ON p.id = t.used_by_partner_id
  WHERE t.event_id = _event_id
    AND t.status IN ('paid','used','refunded','cancelled')
  ORDER BY t.paid_at DESC NULLS LAST, t.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_event_attendees(UUID) TO authenticated;

-- =================================================================
-- RPC partner_event_checkin_stats: contadores agregados para el header
-- =================================================================
CREATE OR REPLACE FUNCTION public.partner_event_checkin_stats(_event_id UUID)
RETURNS TABLE (
  capacity         INT,
  tickets_sold     INT,
  tickets_used     INT,
  tickets_pending  INT,
  tickets_refunded INT,
  revenue_cents    BIGINT,
  checkin_pct      NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_event public.events%ROWTYPE;
  v_sold INT;
  v_used INT;
  v_pending INT;
  v_refunded INT;
  v_revenue BIGINT;
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

  SELECT
    COUNT(*) FILTER (WHERE status IN ('paid','used'))::INT,
    COUNT(*) FILTER (WHERE status = 'used')::INT,
    COUNT(*) FILTER (WHERE status = 'paid')::INT,
    COUNT(*) FILTER (WHERE status IN ('refunded','cancelled'))::INT,
    COALESCE(SUM(amount_paid_cents) FILTER (WHERE status IN ('paid','used')), 0)::BIGINT
  INTO v_sold, v_used, v_pending, v_refunded, v_revenue
  FROM public.tickets WHERE event_id = _event_id;

  RETURN QUERY SELECT
    v_event.capacity,
    v_sold,
    v_used,
    v_pending,
    v_refunded,
    v_revenue,
    CASE WHEN v_sold > 0 THEN ROUND((v_used::numeric / v_sold::numeric) * 100, 1) ELSE 0::numeric END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_event_checkin_stats(UUID) TO authenticated;
