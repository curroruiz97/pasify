-- Pasify · panel de admin, ola 2: liquidaciones, pedidos y bajas de local
--
--   B5-4  Liquidaciones. Pasify cobra las entradas por los locales y les
--         transfiere lo suyo a mano, y Finanzas era una maqueta. Ahora:
--           * partner_settlements: una fila por transferencia (importe,
--             fecha, referencia bancaria). El admin lo hace todo; el owner y
--             los admins de la organización leen las suyas.
--           * admin_record_settlement: registra una. No deja liquidar más de
--             lo pendiente sin confirmarlo, ni dos veces la misma
--             transferencia, ni a un local suspendido (D-8). Avisa al dueño.
--           * admin_settlement_overview: por organización, bruto, reembolsos,
--             comisión y neto de partner_balance_v (sin pagos de prueba si
--             require_live_payments), lo liquidado y lo pendiente.
--           * admin_org_settlements: el historial de una organización.
--   B5-7  Pedidos. Soporte pide "el evento y el correo de la compra", pero el
--         admin no podía buscar un pedido ni reembolsar por su cuenta:
--           * admin_search_orders: por email del comprador o del titular,
--             referencia (8 primeros caracteres del id), código de puerta
--             (8 primeros del QR), id (pedido, entrada, QR o solicitud),
--             ids de Stripe o nombre. Devuelve el pedido con sus entradas.
--           * admin_create_refund_request: la solicitud de reembolso de una
--             entrada, creada por el sistema y ya aprobada por el admin;
--             process-refund la ejecuta después.
--   B5-3  Locales: admin_partner_orgs da las organizaciones de los locales de
--         una página de Locales con su estado de suspensión. suspended_at y
--         suspended_reason las crea la migración del checkout (Ola 2): aquí
--         se leen con to_jsonb, así que da igual cuál se despliegue antes.
--   B3-13 delete-user borraba a un local sin cerrar su actividad: sus eventos
--         seguían publicados y vendiendo, sin dueño.
--         admin_close_partner_account hace lo mismo que partner_close_account
--         (que usa auth.uid() y es para la baja propia) con otro usuario, y
--         se niega si tiene ventas futuras o si es admin.
--
-- Convenciones: SECURITY DEFINER con search_path = public, has_role(admin)
-- dentro y EXECUTE solo para authenticated (anon fuera).

-- ============================================================================
-- 1) Liquidaciones
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.partner_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: una transferencia hecha no desaparece con la organización
  -- (las organizaciones se cierran, no se borran).
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Cuándo se hizo la transferencia (no cuándo se apuntó: created_at).
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bank_reference TEXT CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 140),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by UUID DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.partner_settlements IS
  'Transferencias de Pasify a los locales (liquidación manual mientras no cobran con su Stripe). Pendiente = partner_balance_v.net_cents - suma de estas.';

CREATE INDEX IF NOT EXISTS idx_partner_settlements_org ON public.partner_settlements (org_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_created_by ON public.partner_settlements (created_by);

ALTER TABLE public.partner_settlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.partner_settlements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_settlements TO authenticated;
GRANT ALL ON public.partner_settlements TO service_role;

DROP POLICY IF EXISTS "partner_settlements_admin_all" ON public.partner_settlements;
CREATE POLICY "partner_settlements_admin_all" ON public.partner_settlements FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- has_org_role cuenta también al dueño (organizations.owner_id).
DROP POLICY IF EXISTS "partner_settlements_org_read" ON public.partner_settlements;
CREATE POLICY "partner_settlements_org_read" ON public.partner_settlements FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));

-- Dinero: altas, cambios y bajas quedan en audit_logs con quién las hizo.
DROP TRIGGER IF EXISTS trg_audit_partner_settlements ON public.partner_settlements;
CREATE TRIGGER trg_audit_partner_settlements AFTER INSERT OR UPDATE OR DELETE ON public.partner_settlements
  FOR EACH ROW EXECUTE FUNCTION public.audit_changes();

-- ¿Está suspendida? status = 'suspended' o suspended_at (columna de la
-- migración del checkout, leída con to_jsonb para no depender de ella).
CREATE OR REPLACE FUNCTION public.admin_org_is_suspended(_org JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(_org ->> 'status', '') = 'suspended'
      OR NULLIF(_org ->> 'suspended_at', '') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.admin_org_is_suspended(JSONB) FROM PUBLIC, anon, authenticated;

-- 1a) Registrar una transferencia
CREATE OR REPLACE FUNCTION public.admin_record_settlement(
  _org_id UUID,
  _amount_cents INT,
  _paid_at TIMESTAMPTZ DEFAULT NULL,
  _bank_reference TEXT DEFAULT NULL,
  _note TEXT DEFAULT NULL,
  _currency TEXT DEFAULT 'EUR',
  _allow_excess BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org JSONB;
  v_owner UUID;
  v_org_created TIMESTAMPTZ;
  v_ref TEXT := NULLIF(btrim(COALESCE(_bank_reference, '')), '');
  v_note TEXT := NULLIF(btrim(COALESCE(_note, '')), '');
  v_currency TEXT := upper(btrim(COALESCE(_currency, 'EUR')));
  v_paid_at TIMESTAMPTZ := COALESCE(_paid_at, now());
  v_net BIGINT;
  v_settled BIGINT;
  v_pending BIGINT;
  v_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  -- Bloqueo de la organización: dos admins a la vez no pasan los dos el
  -- control de lo pendiente ni el de duplicados.
  SELECT to_jsonb(o), o.owner_id, o.created_at INTO v_org, v_owner, v_org_created
    FROM public.organizations o
   WHERE o.id = _org_id
     FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'P0002'; END IF;
  -- D-8: suspender bloquea también liquidar. Una organización cerrada (baja
  -- del local) sí se liquida: se le debe lo vendido.
  IF public.admin_org_is_suspended(v_org) THEN
    RAISE EXCEPTION 'org_suspended' USING ERRCODE = '55000',
      DETAIL = 'Un local suspendido no se liquida hasta que se reactive.';
  END IF;

  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_ref IS NULL OR char_length(v_ref) < 3 THEN
    RAISE EXCEPTION 'bank_reference_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_ref) > 140 THEN
    RAISE EXCEPTION 'bank_reference_too_long' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;
  -- Un día de margen por la zona horaria de quien la apunta.
  IF v_paid_at > now() + INTERVAL '1 day' THEN
    RAISE EXCEPTION 'paid_at_in_future' USING ERRCODE = '22023';
  END IF;
  IF v_paid_at < v_org_created - INTERVAL '1 day' THEN
    RAISE EXCEPTION 'paid_at_before_org' USING ERRCODE = '22023';
  END IF;

  -- La misma transferencia apuntada dos veces (doble clic, dos admins):
  -- mismo importe, misma referencia y mismo día.
  IF EXISTS (
    SELECT 1 FROM public.partner_settlements s
     WHERE s.org_id = _org_id
       AND s.amount_cents = _amount_cents
       AND lower(btrim(COALESCE(s.bank_reference, ''))) = lower(v_ref)
       AND (s.paid_at AT TIME ZONE 'Europe/Madrid')::date = (v_paid_at AT TIME ZONE 'Europe/Madrid')::date
  ) THEN
    RAISE EXCEPTION 'duplicate_settlement' USING ERRCODE = '23505';
  END IF;

  -- Más de lo pendiente solo si el admin confirma que se transfirió de más.
  -- partner_balance_v es security_invoker: aquí se evalúa como el dueño de
  -- la función y ve la fila de cualquier organización.
  SELECT b.net_cents INTO v_net FROM public.partner_balance_v b WHERE b.org_id = _org_id;
  SELECT COALESCE(sum(s.amount_cents), 0) INTO v_settled FROM public.partner_settlements s WHERE s.org_id = _org_id;
  v_pending := COALESCE(v_net, 0) - v_settled;
  IF NOT COALESCE(_allow_excess, FALSE) AND _amount_cents > v_pending THEN
    RAISE EXCEPTION 'amount_exceeds_pending' USING ERRCODE = '22023',
      DETAIL = format('Pendiente: %s céntimos', GREATEST(v_pending, 0));
  END IF;

  INSERT INTO public.partner_settlements (org_id, amount_cents, currency, paid_at, bank_reference, note, created_by)
  VALUES (_org_id, _amount_cents, v_currency, v_paid_at, v_ref, v_note, v_uid)
  RETURNING id INTO v_id;

  -- Aviso in-app al dueño (una organización cerrada puede no tenerlo ya).
  IF v_owner IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      v_owner,
      'payments',
      'settlement_recorded',
      'Pasify te ha transferido ' || replace(to_char(_amount_cents / 100.0, 'FM999999990.00'), '.', ',')
        || CASE WHEN v_currency = 'EUR' THEN ' €' ELSE ' ' || v_currency END,
      'Liquidación de tus ventas. Referencia de la transferencia: ' || v_ref || '.',
      '/#/partner-dashboard/stripe',
      jsonb_build_object('settlement_id', v_id, 'org_id', _org_id, 'amount_cents', _amount_cents),
      'normal'
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_record_settlement(UUID, INT, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_settlement(UUID, INT, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- 1b) Resumen por organización: las que han vendido o tienen liquidaciones.
-- Los totales (total_*) son los de todo el filtro, no solo los de la página.
-- connect_orders: pedidos cobrados con el Stripe del propio local (cargo con
-- destino): ese dinero ya le llegó por Stripe, pero partner_balance_v lo
-- cuenta en el neto; el panel lo advierte antes de liquidar.
CREATE OR REPLACE FUNCTION public.admin_settlement_overview(
  _search TEXT DEFAULT NULL,
  _only_pending BOOLEAN DEFAULT FALSE,
  _limit INT DEFAULT 50,
  _offset INT DEFAULT 0
)
RETURNS TABLE (
  org_id UUID,
  org_name TEXT,
  org_status TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  owner_id UUID,
  owner_email TEXT,
  owner_name TEXT,
  paid_orders BIGINT,
  gross_cents BIGINT,
  refunded_cents BIGINT,
  fee_cents BIGINT,
  net_cents BIGINT,
  settled_cents BIGINT,
  pending_cents BIGINT,
  settlements_count BIGINT,
  last_paid_at TIMESTAMPTZ,
  connect_orders BIGINT,
  total_count BIGINT,
  total_net_cents BIGINT,
  total_settled_cents BIGINT,
  total_pending_cents BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_search TEXT := NULLIF(btrim(COALESCE(_search, '')), '');
  v_pattern TEXT;
  v_live BOOLEAN := public.live_payments_required();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  -- % y _ de lo que se teclea se buscan tal cual.
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  RETURN QUERY
    WITH liquidado AS (
      SELECT s.org_id AS sid,
             sum(s.amount_cents)::BIGINT AS settled,
             count(*)::BIGINT AS n,
             max(s.paid_at) AS last_paid
        FROM public.partner_settlements s
       GROUP BY s.org_id
    ),
    -- Mismo filtro de pedidos que partner_balance_v.
    conectados AS (
      SELECT o.org_id AS cid, count(*)::BIGINT AS n
        FROM public.ticket_orders o
       WHERE o.org_id IS NOT NULL
         AND o.stripe_destination_account IS NOT NULL
         AND o.status IN ('paid', 'partial_refund', 'refunded')
         AND (o.livemode IS NOT FALSE OR NOT v_live)
       GROUP BY o.org_id
    ),
    base AS (
      SELECT o.id AS oid,
             o.name AS oname,
             o.status AS ostatus,
             NULLIF(to_jsonb(o) ->> 'suspended_at', '')::timestamptz AS osusp_at,
             NULLIF(to_jsonb(o) ->> 'suspended_reason', '') AS osusp_reason,
             o.owner_id AS oowner,
             p.email AS pemail,
             COALESCE(NULLIF(btrim(p.business_name), ''),
                      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')) AS pname,
             COALESCE(b.paid_orders, 0)::BIGINT AS b_orders,
             COALESCE(b.gross_cents, 0)::BIGINT AS b_gross,
             COALESCE(b.refunded_cents, 0)::BIGINT AS b_refunded,
             COALESCE(b.fee_cents, 0)::BIGINT AS b_fee,
             COALESCE(b.net_cents, 0)::BIGINT AS b_net,
             COALESCE(l.settled, 0)::BIGINT AS l_settled,
             COALESCE(l.n, 0)::BIGINT AS l_n,
             l.last_paid AS l_last,
             COALESCE(c.n, 0)::BIGINT AS c_n
        FROM public.organizations o
        LEFT JOIN public.partner_balance_v b ON b.org_id = o.id
        LEFT JOIN liquidado l ON l.sid = o.id
        LEFT JOIN conectados c ON c.cid = o.id
        LEFT JOIN public.profiles p ON p.id = o.owner_id
       WHERE (b.org_id IS NOT NULL OR l.sid IS NOT NULL)
         AND (v_pattern IS NULL
              OR o.name ILIKE v_pattern ESCAPE '\'
              OR COALESCE(p.email, '') ILIKE v_pattern ESCAPE '\'
              OR COALESCE(p.business_name, '') ILIKE v_pattern ESCAPE '\')
    ),
    filtrado AS (
      SELECT * FROM base
       WHERE NOT COALESCE(_only_pending, FALSE) OR b_net - l_settled <> 0
    )
    SELECT f.oid, f.oname, f.ostatus, f.osusp_at, f.osusp_reason, f.oowner, f.pemail, f.pname,
           f.b_orders, f.b_gross, f.b_refunded, f.b_fee, f.b_net,
           f.l_settled, f.b_net - f.l_settled, f.l_n, f.l_last, f.c_n,
           count(*) OVER (),
           (sum(f.b_net) OVER ())::BIGINT,
           (sum(f.l_settled) OVER ())::BIGINT,
           -- Lo que se debe: un local al que se le transfirió de más no lo resta.
           (sum(GREATEST(f.b_net - f.l_settled, 0)) OVER ())::BIGINT
      FROM filtrado f
     -- Lo que más se debe, primero.
     ORDER BY f.b_net - f.l_settled DESC, f.oname, f.oid
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_settlement_overview(TEXT, BOOLEAN, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settlement_overview(TEXT, BOOLEAN, INT, INT) TO authenticated;

-- 1c) Historial de una organización, lo último primero.
CREATE OR REPLACE FUNCTION public.admin_org_settlements(_org_id UUID)
RETURNS TABLE (
  id UUID,
  org_id UUID,
  amount_cents INT,
  currency TEXT,
  paid_at TIMESTAMPTZ,
  bank_reference TEXT,
  note TEXT,
  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT s.id, s.org_id, s.amount_cents, s.currency, s.paid_at, s.bank_reference, s.note, s.created_by,
           COALESCE(NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email),
           s.created_at
      FROM public.partner_settlements s
      LEFT JOIN public.profiles p ON p.id = s.created_by
     WHERE s.org_id = _org_id
     ORDER BY s.paid_at DESC, s.created_at DESC, s.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_org_settlements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_org_settlements(UUID) TO authenticated;

-- ============================================================================
-- 2) Locales: sus organizaciones y si están suspendidas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_partner_orgs(_owner_ids UUID[])
RETURNS TABLE (
  org_id UUID,
  owner_id UUID,
  name TEXT,
  status TEXT,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  IF _owner_ids IS NULL OR cardinality(_owner_ids) = 0 THEN RETURN; END IF;
  IF cardinality(_owner_ids) > 200 THEN RAISE EXCEPTION 'too_many_ids' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT o.id, o.owner_id, o.name, o.status,
           NULLIF(to_jsonb(o) ->> 'suspended_at', '')::timestamptz,
           NULLIF(to_jsonb(o) ->> 'suspended_reason', ''),
           o.created_at
      FROM public.organizations o
     WHERE o.owner_id = ANY (_owner_ids)
     ORDER BY o.owner_id, o.created_at, o.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_partner_orgs(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_partner_orgs(UUID[]) TO authenticated;

-- ============================================================================
-- 3) Pedidos
-- ============================================================================
-- 3a) Buscar. Qué se reconoce en _q:
--   * un uuid (con o sin guiones): id del pedido, de una entrada, QR
--     completo o solicitud de reembolso;
--   * de 8 a 31 caracteres hexadecimales ("A1B2C3D4", con o sin #, espacios
--     o guiones): referencia del pedido (orderReference) o código de puerta
--     (ticketDoorCode), como prefijo. Los 8 primeros se buscan como rango de
--     uuid, así que usa los índices;
--   * pi_…, cs_…: ids de Stripe del pedido;
--   * con @: email del pedido, del titular de una entrada o de la cuenta del
--     comprador (contiene, sin distinguir mayúsculas);
--   * el resto (3 caracteres o más): nombre del comprador o del titular.
-- Todos los estados de pedido (un pago fallido o caducado también es una
-- consulta de soporte); lo más reciente primero.
CREATE OR REPLACE FUNCTION public.admin_search_orders(_q TEXT, _limit INT DEFAULT 20)
RETURNS TABLE (
  order_id UUID,
  reference TEXT,
  matched_by TEXT,
  status TEXT,
  livemode BOOLEAN,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  subtotal_cents INT,
  fees_cents INT,
  total_cents INT,
  refunded_cents BIGINT,
  currency TEXT,
  stripe_payment_intent_id TEXT,
  tickets_email_sent_at TIMESTAMPTZ,
  buyer_user_id UUID,
  buyer_email TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_phone TEXT,
  event_id UUID,
  event_title TEXT,
  event_date_start TIMESTAMPTZ,
  event_date_end TIMESTAMPTZ,
  event_status TEXT,
  venue_name TEXT,
  event_city TEXT,
  org_id UUID,
  org_name TEXT,
  tickets JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_q TEXT := left(btrim(COALESCE(_q, '')), 200);
  v_limit INT := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
  v_code TEXT;
  v_kind TEXT;
  v_uuid UUID;
  v_lo UUID;
  v_hi UUID;
  v_prefix TEXT;
  v_pattern TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  IF char_length(v_q) < 3 THEN RETURN; END IF;

  v_code := lower(regexp_replace(v_q, '[[:space:]#-]', '', 'g'));
  IF v_q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR v_code ~ '^[0-9a-f]{32}$' THEN
    v_kind := 'id';
    v_uuid := v_code::uuid;
  ELSIF v_code ~ '^[0-9a-f]{8,31}$' THEN
    v_kind := 'code';
    v_prefix := v_code || '%';
    v_lo := (left(v_code, 8) || '-0000-0000-0000-000000000000')::uuid;
    v_hi := (left(v_code, 8) || '-ffff-ffff-ffff-ffffffffffff')::uuid;
  ELSIF v_q ~ '^(pi|cs)_[A-Za-z0-9_-]+$' THEN
    v_kind := 'stripe';
  ELSE
    v_kind := CASE WHEN position('@' IN v_q) > 0 THEN 'email' ELSE 'name' END;
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  RETURN QUERY
    WITH hits AS (
      SELECT o.id AS oid, 'id'::TEXT AS why
        FROM public.ticket_orders o WHERE v_kind = 'id' AND o.id = v_uuid
      UNION ALL
      SELECT t.order_id, 'id'
        FROM public.tickets t WHERE v_kind = 'id' AND (t.id = v_uuid OR t.qr_token = v_uuid)
      UNION ALL
      SELECT r.order_id, 'id'
        FROM public.refund_requests r WHERE v_kind = 'id' AND r.id = v_uuid
      UNION ALL
      SELECT o.id, 'reference'
        FROM public.ticket_orders o
       WHERE v_kind = 'code' AND o.id BETWEEN v_lo AND v_hi AND replace(o.id::text, '-', '') LIKE v_prefix
      UNION ALL
      SELECT t.order_id, 'door_code'
        FROM public.tickets t
       WHERE v_kind = 'code' AND t.qr_token BETWEEN v_lo AND v_hi AND replace(t.qr_token::text, '-', '') LIKE v_prefix
      UNION ALL
      SELECT o.id, 'stripe'
        FROM public.ticket_orders o
       WHERE v_kind = 'stripe' AND (o.stripe_payment_intent_id = v_q OR o.stripe_session_id = v_q)
      UNION ALL
      SELECT o.id, 'email'
        FROM public.ticket_orders o WHERE v_kind = 'email' AND o.buyer_email ILIKE v_pattern ESCAPE '\'
      UNION ALL
      SELECT t.order_id, 'email'
        FROM public.tickets t WHERE v_kind = 'email' AND t.holder_email ILIKE v_pattern ESCAPE '\'
      UNION ALL
      SELECT o.id, 'email'
        FROM public.ticket_orders o
        JOIN public.profiles p ON p.id = o.buyer_user_id
       WHERE v_kind = 'email' AND p.email ILIKE v_pattern ESCAPE '\'
      UNION ALL
      SELECT o.id, 'name'
        FROM public.ticket_orders o
       WHERE v_kind = 'name'
         AND concat_ws(' ', o.buyer_first_name, o.buyer_last_name) ILIKE v_pattern ESCAPE '\'
      UNION ALL
      SELECT t.order_id, 'name'
        FROM public.tickets t
       WHERE v_kind = 'name'
         AND concat_ws(' ', t.holder_first_name, t.holder_last_name) ILIKE v_pattern ESCAPE '\'
    ),
    encontrados AS (
      SELECT h.oid, string_agg(DISTINCT h.why, ',' ORDER BY h.why) AS why
        FROM hits h
       WHERE h.oid IS NOT NULL
       GROUP BY h.oid
    )
    SELECT o.id,
           upper(left(replace(o.id::text, '-', ''), 8)),
           m.why,
           o.status::text,
           o.livemode,
           o.created_at,
           o.paid_at,
           o.refunded_at,
           o.subtotal_cents,
           o.fees_cents,
           o.total_cents,
           COALESCE((SELECT sum(r.amount_cents) FROM public.refund_requests r
                      WHERE r.order_id = o.id AND r.status = 'refunded'), 0)::BIGINT,
           o.currency,
           o.stripe_payment_intent_id,
           o.tickets_email_sent_at,
           o.buyer_user_id,
           o.buyer_email,
           o.buyer_first_name,
           o.buyer_last_name,
           o.buyer_phone,
           e.id,
           e.title,
           e.date_start,
           e.date_end,
           e.status::text,
           e.venue_name,
           e.city,
           COALESCE(o.org_id, e.org_id),
           org.name,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', t.id,
                      'status', t.status,
                      'door_code', upper(left(replace(t.qr_token::text, '-', ''), 8)),
                      'tier_name', tt.name,
                      'amount_paid_cents', t.amount_paid_cents,
                      'currency', t.currency,
                      'holder_name', NULLIF(btrim(concat_ws(' ', t.holder_first_name, t.holder_last_name)), ''),
                      'holder_email', t.holder_email,
                      'transferred', t.transferred_to_user_id IS NOT NULL,
                      'paid_at', t.paid_at,
                      'used_at', t.used_at,
                      'refund_id', rr.id,
                      'refund_status', rr.status,
                      'refund_amount_cents', rr.amount_cents,
                      'refund_reason_code', rr.reason_code,
                      'refund_note', rr.decision_note,
                      'refund_failure', rr.stripe_failure_reason,
                      'refund_updated_at', rr.updated_at
                    ) ORDER BY t.created_at, t.id)
               FROM public.tickets t
               LEFT JOIN public.ticket_tiers tt ON tt.id = t.tier_id
               LEFT JOIN public.refund_requests rr ON rr.ticket_id = t.id
              WHERE t.order_id = o.id
           ), '[]'::jsonb)
      FROM encontrados m
      JOIN public.ticket_orders o ON o.id = m.oid
      LEFT JOIN public.events e ON e.id = o.event_id
      LEFT JOIN public.organizations org ON org.id = COALESCE(o.org_id, e.org_id)
     ORDER BY o.created_at DESC, o.id
     LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_search_orders(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_orders(TEXT, INT) TO authenticated;

-- 3b) Reembolsar una entrada desde el admin. La solicitud la crea el sistema
-- (reason_code 'admin_refund', metadata.source 'admin') ya aprobada por el
-- admin (decided_by); después el panel llama a process-refund, que la
-- ejecuta en Stripe y avisa al comprador con _note como motivo.
--   * El solicitante es el titular actual (process-refund exige que la
--     entrada siga en manos de quien figura en la solicitud); sin cuenta, el
--     email de la entrada o del pedido, como en una cancelación.
--   * Una solicitud previa de la entrada (ticket_id es UNIQUE): 'pending' la
--     decide Pasify, 'rejected' se corrige y pasan a aprobadas; 'failed' se
--     reintenta como en la cola (admin_retry_refund); 'approved' y
--     'processing' ya están en curso (se retoman desde Reembolsos).
CREATE OR REPLACE FUNCTION public.admin_create_refund_request(_ticket_id UUID, _note TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_note TEXT := NULLIF(btrim(COALESCE(_note, '')), '');
  v_ticket public.tickets%ROWTYPE;
  v_order public.ticket_orders%ROWTYPE;
  v_org UUID;
  v_request public.refund_requests%ROWTYPE;
  v_holder UUID;
  v_email TEXT;
  v_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  -- El comprador lo lee en el email del reembolso.
  IF v_note IS NULL OR char_length(v_note) < 5 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets t WHERE t.id = _ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_ticket.status = 'used' OR v_ticket.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_used' USING ERRCODE = '55000';
  END IF;
  IF v_ticket.status = 'refunded' THEN RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000'; END IF;
  IF v_ticket.status <> 'paid' THEN RAISE EXCEPTION 'ticket_not_paid' USING ERRCODE = '55000'; END IF;
  IF COALESCE(v_ticket.amount_paid_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'nothing_to_refund' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_order FROM public.ticket_orders o WHERE o.id = v_ticket.order_id;
  IF v_order.id IS NULL OR v_order.status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable' USING ERRCODE = '55000';
  END IF;
  IF v_order.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'no_payment_intent' USING ERRCODE = '55000';
  END IF;
  -- Un pago de prueba no se devuelve con la clave real de Stripe.
  IF v_order.livemode IS FALSE AND public.live_payments_required() THEN
    RAISE EXCEPTION 'test_payment' USING ERRCODE = '55000';
  END IF;

  SELECT e.org_id INTO v_org FROM public.events e WHERE e.id = v_ticket.event_id;
  v_holder := COALESCE(v_ticket.transferred_to_user_id, v_ticket.buyer_user_id);
  IF v_holder IS NOT NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_holder;
  END IF;
  v_email := COALESCE(NULLIF(btrim(v_email), ''), NULLIF(btrim(v_ticket.holder_email), ''),
                      NULLIF(btrim(v_ticket.buyer_email), ''), v_order.buyer_email, '');

  SELECT * INTO v_request FROM public.refund_requests r WHERE r.ticket_id = v_ticket.id FOR UPDATE;
  IF v_request.id IS NOT NULL THEN
    IF v_request.status IN ('approved', 'processing') THEN
      RAISE EXCEPTION 'refund_in_progress' USING ERRCODE = '55000';
    END IF;
    IF v_request.status = 'refunded' THEN
      RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';
    END IF;
    IF v_request.status = 'failed' THEN
      PERFORM public.admin_retry_refund(v_request.id);
      UPDATE public.refund_requests
         SET decision_note = COALESCE(decision_note, v_note)
       WHERE id = v_request.id;
      RETURN v_request.id;
    END IF;
    -- 'pending' o 'rejected': aprobada ahora por Pasify.
    UPDATE public.refund_requests
       SET status = 'approved',
           order_id = v_ticket.order_id,
           event_id = v_ticket.event_id,
           org_id = v_org,
           requester_user_id = v_holder,
           requester_email = v_email,
           amount_cents = v_ticket.amount_paid_cents,
           currency = v_ticket.currency,
           auto_approved = FALSE,
           auto_approve_reason = NULL,
           decided_by = v_uid,
           decided_at = now(),
           decision_note = v_note,
           stripe_refund_id = NULL,
           stripe_refund_status = NULL,
           stripe_failure_reason = NULL,
           processed_at = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'admin_refund', jsonb_build_object('by', v_uid, 'at', now(), 'previous_status', v_request.status::text)),
           updated_at = now()
     WHERE id = v_request.id;
    RETURN v_request.id;
  END IF;

  INSERT INTO public.refund_requests (
    ticket_id, order_id, event_id, org_id, requester_user_id, requester_email,
    amount_cents, currency, reason, reason_code, status, auto_approved,
    decided_by, decided_at, decision_note, metadata
  ) VALUES (
    v_ticket.id, v_ticket.order_id, v_ticket.event_id, v_org, v_holder, v_email,
    v_ticket.amount_paid_cents, v_ticket.currency, 'Reembolso tramitado por Pasify', 'admin_refund', 'approved', FALSE,
    v_uid, now(), v_note, jsonb_build_object('source', 'admin', 'created_by', v_uid)
  )
  RETURNING id INTO v_id;

  -- El trigger de auditoría de refund_requests solo recoge UPDATE y DELETE:
  -- el alta hecha por un admin se apunta aquí.
  INSERT INTO public.audit_logs (actor_user_id, actor_role, action, target_kind, target_id, before, after)
  SELECT v_uid, 'admin', 'INSERT_refund_requests', 'refund_requests', v_id, NULL, to_jsonb(r)
    FROM public.refund_requests r WHERE r.id = v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_refund_request(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_refund_request(UUID, TEXT) TO authenticated;

-- ============================================================================
-- 4) Baja de un local desde el admin (delete-user)
-- ============================================================================
-- partner_close_account (20260923120200) con el usuario como parámetro. La
-- llama delete-user con el JWT del admin antes de borrar la cuenta:
--   * con eventos futuros con entradas vendidas se niega
--     (partner_has_upcoming_sales): primero hay que cancelarlos y reembolsar;
--   * cancela sus eventos futuros sin ventas, cierra sus organizaciones,
--     da de baja a los miembros y cancela las suscripciones;
--   * a un admin no se le cierra nada (target_is_admin).
CREATE OR REPLACE FUNCTION public.admin_close_partner_account(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin UUID := auth.uid();
  v_orgs UUID[];
  v_cancelled INT := 0;
  v_closed INT := 0;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_required' USING ERRCODE = '22023'; END IF;
  IF public.has_role(_user_id, 'admin') THEN
    RAISE EXCEPTION 'target_is_admin' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}') INTO v_orgs FROM public.organizations o WHERE o.owner_id = _user_id;

  IF EXISTS (
    SELECT 1 FROM public.events e
     WHERE (e.partner_id = _user_id OR e.org_id = ANY (v_orgs))
       AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') > now()
       AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used'))
  ) THEN
    RAISE EXCEPTION 'partner_has_upcoming_sales';
  END IF;

  UPDATE public.events e
     SET status = 'cancelled',
         metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object(
           'cancelled_at', now(), 'cancelled_by', v_admin, 'cancel_reason', 'Baja de la cuenta del local')
   WHERE (e.partner_id = _user_id OR e.org_id = ANY (v_orgs))
     AND e.status IN ('draft', 'published')
     AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') > now();
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.organizations o
     SET status = 'closed',
         metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object(
           'closed_at', now(), 'closed_by', v_admin, 'closed_by_admin', TRUE)
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

REVOKE EXECUTE ON FUNCTION public.admin_close_partner_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_partner_account(UUID) TO authenticated;
