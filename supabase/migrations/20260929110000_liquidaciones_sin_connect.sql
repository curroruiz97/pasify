-- Pasify · liquidaciones: los pedidos cobrados con Stripe Connect no son deuda de Pasify
--
--   Un pedido con stripe_destination_account (cargo con destino de Stripe
--   Connect) le llega al local directamente por Stripe; Pasify solo retiene
--   fees_cents. Aun así partner_balance_v sumaba todos los pedidos pagados, y
--   admin_settlement_overview y admin_record_settlement calculaban lo pendiente
--   como neto − liquidado: un admin podía transferir otra vez lo que el local ya
--   había cobrado. Hasta ahora solo lo frenaba un aviso en el panel.
--
--     * partner_balance_v: las 6 columnas de siempre (mismo orden y tipos) y, al
--       final, connect_gross_cents, connect_refunded_cents, connect_fee_cents y
--       connect_net_cents (bruto − reembolsos − comisión de los pedidos con
--       stripe_destination_account). net_cents sigue siendo el neto de todos.
--     * admin_record_settlement: el control de lo pendiente compara con
--       net_cents − connect_net_cents.
--     * admin_settlement_overview: columna nueva connect_net_cents, y
--       pending_cents, el filtro _only_pending, el orden y total_pending_cents
--       pasan a neto − connect − liquidado. net_cents es el neto total.
--
-- La pantalla Cobros del local lee solo las 5 columnas antiguas de la vista: no
-- cambia. El panel de admin tolera la base sin esta migración (el front sale
-- antes): si connect_net_cents no llega, mantiene su aviso de descontar a mano.
--
-- Cambios que obligan a algo más que CREATE OR REPLACE:
--   * admin_settlement_overview gana una columna de salida: cambia el tipo de
--     retorno, así que DROP + CREATE y se repiten sus REVOKE/GRANT.
--   * Para volver atrás, la vista no puede perder columnas con CREATE OR REPLACE:
--     DROP VIEW + CREATE VIEW con la definición de 20260925110100, y las dos
--     funciones con las de 20260927160000 (la de resumen, tras un DROP).

-- ============================================================================
-- 1) Saldo por local: lo cobrado con Connect, aparte
-- ============================================================================
-- La definición de 20260925110100 (security_invoker, sin pagos de prueba si
-- live_payments_required()) con cuatro columnas más al final. Los pedidos
-- Connect se agregan con FILTER en la misma pasada que los demás, así que
-- comparten filtro de estado y de livemode. Sus reembolsos van en su propio CTE
-- (el de siempre, refunded, no se toca): la solicitud se une a su pedido para
-- saber si fue Connect, con el mismo criterio de livemode, y se agrupa por la
-- organización de la solicitud como refunded (así connect_refunded_cents nunca
-- supera refunded_cents). El reembolso de un cargo Connect lo asume el local
-- (reverse_transfer) y Pasify se queda la comisión (refund_application_fee
-- false): por eso connect_net_cents es lo que el local ya cobró por Stripe.
CREATE OR REPLACE VIEW public.partner_balance_v
WITH (security_invoker = true)
AS
WITH paid AS (
  SELECT o.org_id,
         count(*) AS paid_orders,
         COALESCE(sum(o.total_cents), 0) AS gross_cents,
         COALESCE(sum(o.fees_cents), 0) AS fee_cents,
         COALESCE(sum(o.total_cents) FILTER (WHERE o.stripe_destination_account IS NOT NULL), 0) AS connect_gross_cents,
         COALESCE(sum(o.fees_cents) FILTER (WHERE o.stripe_destination_account IS NOT NULL), 0) AS connect_fee_cents
  FROM public.ticket_orders o
  WHERE o.org_id IS NOT NULL
    AND o.status IN ('paid', 'partial_refund', 'refunded')
    AND (o.livemode IS NOT FALSE OR NOT (SELECT public.live_payments_required()))
  GROUP BY o.org_id
),
refunded AS (
  SELECT r.org_id, COALESCE(sum(r.amount_cents), 0) AS refunded_cents
  FROM public.refund_requests r
  WHERE r.org_id IS NOT NULL AND r.status = 'refunded'
    AND (NOT (SELECT public.live_payments_required())
         OR NOT EXISTS (SELECT 1 FROM public.ticket_orders t
                         WHERE t.id = r.order_id AND t.livemode IS FALSE))
  GROUP BY r.org_id
),
connect_refunded AS (
  SELECT r.org_id, COALESCE(sum(r.amount_cents), 0) AS refunded_cents
  FROM public.refund_requests r
  JOIN public.ticket_orders t ON t.id = r.order_id AND t.stripe_destination_account IS NOT NULL
  WHERE r.org_id IS NOT NULL AND r.status = 'refunded'
    AND (NOT (SELECT public.live_payments_required()) OR t.livemode IS NOT FALSE)
  GROUP BY r.org_id
)
SELECT p.org_id,
       p.paid_orders,
       p.gross_cents,
       COALESCE(r.refunded_cents, 0) AS refunded_cents,
       p.fee_cents,
       p.gross_cents - COALESCE(r.refunded_cents, 0) - p.fee_cents AS net_cents,
       p.connect_gross_cents,
       COALESCE(cr.refunded_cents, 0) AS connect_refunded_cents,
       p.connect_fee_cents,
       p.connect_gross_cents - COALESCE(cr.refunded_cents, 0) - p.connect_fee_cents AS connect_net_cents
FROM paid p
LEFT JOIN refunded r ON r.org_id = p.org_id
LEFT JOIN connect_refunded cr ON cr.org_id = p.org_id;

GRANT SELECT ON public.partner_balance_v TO authenticated;

COMMENT ON VIEW public.partner_balance_v IS
  'Saldo por local: bruto, reembolsos, comisión y neto de los pedidos pagados (sin pagos de prueba si require_live_payments). connect_*: la parte cobrada con el Stripe del propio local (stripe_destination_account); ese dinero ya le llegó, así que Pasify le debe net_cents - connect_net_cents - lo liquidado.';

COMMENT ON TABLE public.partner_settlements IS
  'Transferencias de Pasify a los locales (liquidación manual por lo que Pasify cobra por ellos). Pendiente = partner_balance_v.net_cents - connect_net_cents - suma de estas.';

-- ============================================================================
-- 2) Registrar una transferencia: lo pendiente descuenta lo cobrado con Connect
-- ============================================================================
-- La de 20260927160000; el único cambio es el neto que se compara.
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
  -- Lo pendiente no incluye los pedidos cobrados con Stripe Connect: ese
  -- dinero ya le llegó al local (net_cents - connect_net_cents).
  -- partner_balance_v es security_invoker: aquí se evalúa como el dueño de
  -- la función y ve la fila de cualquier organización.
  SELECT b.net_cents - b.connect_net_cents INTO v_net FROM public.partner_balance_v b WHERE b.org_id = _org_id;
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

-- ============================================================================
-- 3) Resumen por organización: pendiente sin lo cobrado con Connect
-- ============================================================================
-- La de 20260927160000 con connect_net_cents (después de connect_orders) y el
-- pendiente como neto − connect − liquidado en sus cuatro sitios: el filtro
-- _only_pending, pending_cents, el orden y total_pending_cents. net_cents y
-- total_net_cents siguen siendo el neto de todos los pedidos.
-- Los totales (total_*) son los de todo el filtro, no solo los de la página.
-- connect_orders: pedidos cobrados con el Stripe del propio local (cargo con
-- destino); connect_net_cents: su neto (cobrado − reembolsos − comisión), que
-- ya le llegó por Stripe y por eso no cuenta en lo pendiente.
-- Una columna de salida más cambia el tipo de retorno: se borra la anterior.
DROP FUNCTION IF EXISTS public.admin_settlement_overview(TEXT, BOOLEAN, INT, INT);

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
  connect_net_cents BIGINT,
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
             COALESCE(b.connect_net_cents, 0)::BIGINT AS b_cnet,
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
       WHERE NOT COALESCE(_only_pending, FALSE) OR b_net - b_cnet - l_settled <> 0
    )
    SELECT f.oid, f.oname, f.ostatus, f.osusp_at, f.osusp_reason, f.oowner, f.pemail, f.pname,
           f.b_orders, f.b_gross, f.b_refunded, f.b_fee, f.b_net,
           f.l_settled, f.b_net - f.b_cnet - f.l_settled, f.l_n, f.l_last, f.c_n, f.b_cnet,
           count(*) OVER (),
           (sum(f.b_net) OVER ())::BIGINT,
           (sum(f.l_settled) OVER ())::BIGINT,
           -- Lo que se debe: un local al que se le transfirió de más no lo resta.
           (sum(GREATEST(f.b_net - f.b_cnet - f.l_settled, 0)) OVER ())::BIGINT
      FROM filtrado f
     -- Lo que más se debe, primero.
     ORDER BY f.b_net - f.b_cnet - f.l_settled DESC, f.oname, f.oid
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_settlement_overview(TEXT, BOOLEAN, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_settlement_overview(TEXT, BOOLEAN, INT, INT) TO authenticated;
