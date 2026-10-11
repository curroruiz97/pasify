-- Pasify · puerta · reintentos de escaneo idempotentes (WP8, parte SQL)
--
-- Por qué: con mala cobertura, scan_ticket puede ejecutarse en el servidor y
-- marcar la entrada como usada mientras el móvil ya ha mostrado «Sin
-- conexión». Al reintentar sale «Entrada ya usada» en rojo y el portero puede
-- negar el paso a un invitado legítimo.
--
-- Qué: scan_ticket y scan_ticket_by_code reciben un último parámetro opcional,
-- _request_id UUID (uno por lectura, repetido en los reintentos).
--   * El éxito (también el forzado) lo guarda en ticket_scan_logs.metadata.
--   * Con la entrada ya 'used', si hay un éxito de esa entrada, del mismo
--     usuario y con ese request_id, se devuelve otra vez el éxito (forced =
--     false, scanned_at del original) sin tocar la entrada ni escribir otro
--     log. Otro request_id, otro usuario u otra entrada: 'already_used'.
--   * Sin _request_id todo se comporta como antes.
--
-- Un parámetro más es otra firma: un CREATE OR REPLACE dejaría dos sobrecargas
-- y PostgREST daría PGRST203. Por eso se borran las firmas antiguas y se
-- crean las nuevas aquí mismo (como mark_order_paid_v2 en 20260925110100).
-- Las llamadas sin _request_id (el QRScanner de hoy, los tests, las
-- posicionales de cinco argumentos) siguen valiendo por el DEFAULT.
--
-- DESPLIEGUE: fuera de horario de eventos (se borra y recrea la RPC de la
-- puerta). El QRScanner empezará a enviar _request_id en un PR posterior,
-- SOLO después de desplegar esta migración: antes, un argumento desconocido
-- haría fallar scan_ticket.

DROP FUNCTION IF EXISTS public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.scan_ticket_by_code(TEXT, UUID, TEXT, BOOLEAN, TEXT);

-- ============================================================================
-- 1) scan_ticket con _request_id
-- ============================================================================
-- La definición de 20260927170000 con tres cambios: el parámetro nuevo, el
-- reintento dentro de la rama 'used' y el request_id en el metadata del éxito.
CREATE OR REPLACE FUNCTION public.scan_ticket(
  _qr_token UUID,
  _device_info TEXT DEFAULT NULL,
  _event_id UUID DEFAULT NULL,
  _force BOOLEAN DEFAULT FALSE,
  _force_reason TEXT DEFAULT NULL,
  _request_id UUID DEFAULT NULL
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
  v_replay_at   TIMESTAMPTZ;
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
    -- Reintento de un escaneo que sí llegó al servidor (al móvil no le llegó la
    -- respuesta): mismo _request_id, mismo usuario y misma entrada que un éxito
    -- ya registrado. Se contesta con aquel éxito, con su hora y sin otro log.
    -- Con otro request_id, otro usuario, otra entrada o sin request_id, la
    -- entrada está usada de verdad. El bloqueo FOR UPDATE de arriba hace que un
    -- reintento simultáneo espere a que el primero confirme y vea su log.
    IF _request_id IS NOT NULL THEN
      SELECT l.scanned_at INTO v_replay_at
        FROM public.ticket_scan_logs l
       WHERE l.ticket_id = v_ticket.id
         AND l.scanned_by_user_id = v_uid
         AND l.result = 'success'
         AND l.metadata->>'request_id' = _request_id::text
       ORDER BY l.scanned_at
       LIMIT 1;
      IF v_replay_at IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, 'success'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
          v_first, v_last, v_email, v_tier_name, v_replay_at, NULL::TIMESTAMPTZ, v_event.date_start, FALSE;
        RETURN;
      END IF;
    END IF;

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
          (CASE WHEN v_problem IS NOT NULL
                THEN jsonb_build_object('forced', TRUE, 'original_result', v_problem, 'selected_event_id', _event_id)
                ELSE '{}'::jsonb END)
          || CASE WHEN _request_id IS NOT NULL
                  THEN jsonb_build_object('request_id', _request_id)
                  ELSE '{}'::jsonb END);

  RETURN QUERY SELECT TRUE, 'success'::public.scan_result_t, v_ticket.id, v_event.id, v_event.title,
    v_first, v_last, v_email, v_tier_name, v_now, NULL::TIMESTAMPTZ, v_event.date_start, (v_problem IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_ticket(UUID, TEXT, UUID, BOOLEAN, TEXT, UUID) TO authenticated, service_role;

-- ============================================================================
-- 2) scan_ticket_by_code con _request_id
-- ============================================================================
-- La definición de 20260923120300 con un cambio: _request_id pasa tal cual a
-- scan_ticket, así que un reintento por código también es idempotente. Busca
-- solo dentro del evento seleccionado y exige coincidencia única; luego aplica
-- las mismas reglas que scan_ticket (permisos, estado, horario, auditoría).
CREATE OR REPLACE FUNCTION public.scan_ticket_by_code(
  _code TEXT,
  _event_id UUID,
  _device_info TEXT DEFAULT NULL,
  _force BOOLEAN DEFAULT FALSE,
  _force_reason TEXT DEFAULT NULL,
  _request_id UUID DEFAULT NULL
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

  RETURN QUERY SELECT * FROM public.scan_ticket(v_token, _device_info, _event_id, _force, _force_reason, _request_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.scan_ticket_by_code(TEXT, UUID, TEXT, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_ticket_by_code(TEXT, UUID, TEXT, BOOLEAN, TEXT, UUID) TO authenticated, service_role;
