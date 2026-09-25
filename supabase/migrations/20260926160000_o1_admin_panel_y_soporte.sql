-- Pasify · panel de admin honesto y soporte que se entera (auditoría, ola 1)
--
--   B5-10 Módulos maqueta del admin (Organizaciones, Finanzas, IA, Trust &
--         Safety, Compliance, Benchmarks, Live Pulse): solo con el flag
--         admin_showcase, apagado por defecto y activable por admin
--         (tenant_overrides con clave = uid del admin).
--   B5-6  Portada del admin: listados paginados y filtrados en el servidor.
--         admin_list_users devuelve también teléfono, categoría y el total
--         para paginar, y el rol ya no sale al azar (LIMIT 1 sin ORDER BY).
--   B5-5  Reembolsos: cola del admin con los seis estados, los atascados
--         (aprobados sin ejecutar y 'processing' sin reembolso en Stripe) y
--         admin_retry_refund para volver a lanzar uno fallido. Denegar exige
--         motivo (decision_note).
--   B5-8  mark_conversation_read rellena read_at (el doble check no salía).
--   B5-1  Una conversación cerrada se reabre si el usuario vuelve a escribir.
--   B5-16 Soporte: se cierran los duplicados abiertos, una sola conversación
--         abierta por usuario, tipo y organización (índice único),
--         open_conversation idempotente y partner_admin solo para locales.
--         El INSERT directo ya no admite partner_admin.
--   B5-13 audit_user_roles_change: rol del actor con has_role (antes un
--         LIMIT 1 cualquiera) y 'system' cuando no hay usuario en el JWT
--         (alta de cuenta, servidor) en vez de 'anon'.

-- ============================================================================
-- 1) Flag admin_showcase (mismo patrón que partner_showcase)
-- ============================================================================
INSERT INTO public.feature_flags (code, name, description, enabled, rollout_pct, tenant_overrides)
SELECT 'admin_showcase',
       'Módulos demo del panel de admin',
       'Enseña los módulos maqueta del panel de admin (Organizaciones, Finanzas, Inteligencia, Trust & Safety, Compliance, Benchmarks y Live Pulse) con la franja DEMO solo a los admins listados en tenant_overrides ({"<uid del admin>": true}).',
       FALSE,
       0,
       '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE code = 'admin_showcase');

-- ============================================================================
-- 2) Reembolsos
-- ============================================================================

-- 2a) decide_refund: denegar exige motivo. Lo demás, igual que antes.
CREATE OR REPLACE FUNCTION public.decide_refund(_request_id UUID, _decision TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request public.refund_requests%ROWTYPE;
  v_note TEXT := NULLIF(btrim(_note), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id = _request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Request no encontrada'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Request ya decidida'; END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR (v_request.org_id IS NOT NULL AND public.has_org_role(v_request.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF _decision IS NULL OR _decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Decision inválida'; END IF;
  -- El comprador tiene que saber por qué: el motivo se guarda en decision_note.
  IF _decision = 'reject' AND (v_note IS NULL OR char_length(v_note) < 5) THEN
    RAISE EXCEPTION 'Para denegar un reembolso hace falta un motivo (5 caracteres o más)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.refund_requests
     SET status = CASE WHEN _decision = 'approve' THEN 'approved'::public.refund_request_status_t ELSE 'rejected'::public.refund_request_status_t END,
         decided_by = v_uid,
         decided_at = now(),
         decision_note = v_note,
         updated_at = now()
   WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_refund(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_refund(UUID, TEXT, TEXT) TO authenticated;

-- 2b) Cola del admin. Un aprobado lleva 2 minutos sin pasar a 'processing'
-- (process-refund no llegó a ejecutarse) o un 'processing' sin reembolso en
-- Stripe lleva más de 10 minutos (STALE_PROCESSING_MS de _shared/refund.ts):
-- los dos van a "Con incidencia" y el admin los retoma llamando otra vez a
-- process-refund. Un 'processing' con reembolso en Stripe espera al webhook.
CREATE OR REPLACE FUNCTION public.admin_refund_bucket(
  _status public.refund_request_status_t,
  _stripe_refund_id TEXT,
  _updated_at TIMESTAMPTZ
)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _status = 'pending' THEN 'pending'
    WHEN _status = 'failed' THEN 'attention'
    WHEN _status = 'approved' AND _updated_at < now() - INTERVAL '2 minutes' THEN 'attention'
    WHEN _status = 'processing' AND _stripe_refund_id IS NULL AND _updated_at < now() - INTERVAL '10 minutes' THEN 'attention'
    WHEN _status IN ('approved', 'processing') THEN 'in_progress'
    ELSE 'done'
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_refund_bucket(public.refund_request_status_t, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_refund_queue(_queue TEXT DEFAULT 'pending', _limit INT DEFAULT 20, _offset INT DEFAULT 0)
RETURNS TABLE (
  id UUID,
  ticket_id UUID,
  event_id UUID,
  requester_email TEXT,
  amount_cents INT,
  currency TEXT,
  reason TEXT,
  reason_code TEXT,
  status TEXT,
  auto_approved BOOLEAN,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  stripe_refund_id TEXT,
  stripe_refund_status TEXT,
  stripe_failure_reason TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  retry_count INT,
  event_title TEXT,
  event_date TIMESTAMPTZ,
  venue_name TEXT,
  queue TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  IF _queue IS NULL OR _queue NOT IN ('pending', 'attention', 'in_progress', 'done', 'all') THEN
    RAISE EXCEPTION 'Cola desconocida: %', _queue USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT r.*, public.admin_refund_bucket(r.status, r.stripe_refund_id, r.updated_at) AS bucket
      FROM public.refund_requests r
    )
    SELECT b.id, b.ticket_id, b.event_id, b.requester_email, b.amount_cents, b.currency,
           b.reason, b.reason_code, b.status::text, b.auto_approved, b.decided_at, b.decision_note,
           b.stripe_refund_id, b.stripe_refund_status, b.stripe_failure_reason, b.processed_at,
           b.created_at, b.updated_at,
           CASE WHEN jsonb_typeof(b.metadata->'retries') = 'array' THEN jsonb_array_length(b.metadata->'retries') ELSE 0 END,
           e.title, e.date_start, e.venue_name,
           b.bucket,
           count(*) OVER ()
      FROM base b
      LEFT JOIN public.events e ON e.id = b.event_id
     WHERE _queue = 'all' OR b.bucket = _queue
     -- Lo que espera, por orden de llegada; el histórico, lo último primero.
     ORDER BY CASE WHEN _queue IN ('done', 'all') THEN b.updated_at END DESC NULLS LAST,
              b.created_at ASC,
              b.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100)
    OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_refund_queue(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_queue(TEXT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_refund_queue_counts()
RETURNS TABLE (queue TEXT, total BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT public.admin_refund_bucket(r.status, r.stripe_refund_id, r.updated_at), count(*)::BIGINT
      FROM public.refund_requests r
     GROUP BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_refund_queue_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_queue_counts() TO authenticated;

-- 2c) Reintentar un reembolso fallido: vuelve a 'approved' y el admin llama a
-- process-refund. El reembolso fallido de Stripe (si lo hubo) y el motivo se
-- guardan en metadata.retries; stripe_refund_id se libera porque
-- executeRefund no lanza otro si la solicitud ya tiene uno. Antes de crear,
-- executeRefund busca en Stripe uno de esta solicitud que no haya fallado:
-- si existiera, lo adopta en vez de devolver dos veces.
CREATE OR REPLACE FUNCTION public.admin_retry_refund(_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_request public.refund_requests%ROWTYPE;
  v_retries JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.refund_requests WHERE id = _request_id FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Request no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_request.status <> 'failed' THEN
    RAISE EXCEPTION 'Solo se reintenta un reembolso fallido (estado: %)', v_request.status USING ERRCODE = '22023';
  END IF;

  v_retries := CASE WHEN jsonb_typeof(v_request.metadata->'retries') = 'array'
                    THEN v_request.metadata->'retries' ELSE '[]'::jsonb END;
  v_retries := v_retries || jsonb_build_array(jsonb_build_object(
    'at', now(),
    'by', v_uid,
    'failure_reason', v_request.stripe_failure_reason,
    'stripe_refund_id', v_request.stripe_refund_id,
    'stripe_refund_status', v_request.stripe_refund_status
  ));

  UPDATE public.refund_requests
     SET status = 'approved',
         stripe_refund_id = NULL,
         stripe_refund_status = NULL,
         stripe_failure_reason = NULL,
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{retries}', v_retries),
         updated_at = now()
   WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_retry_refund(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_refund(UUID) TO authenticated;

-- ============================================================================
-- 3) Listados del admin paginados en el servidor
-- ============================================================================
-- Cambian las columnas que devuelve: hay que borrarla y crearla de nuevo.
-- Los argumentos de antes siguen valiendo (los nuevos son opcionales).
DROP FUNCTION IF EXISTS public.admin_list_users(TEXT, TEXT, TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.admin_list_users(
  _search TEXT DEFAULT NULL,
  _role_filter TEXT DEFAULT NULL,
  _status_filter TEXT DEFAULT NULL,
  _limit INT DEFAULT 50,
  _offset INT DEFAULT 0,
  _city TEXT DEFAULT NULL,
  _category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  business_name TEXT,
  account_status TEXT,
  role TEXT,
  city TEXT,
  country TEXT,
  created_at TIMESTAMPTZ,
  phone TEXT,
  business_category TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_search TEXT := NULLIF(btrim(_search), '');
  v_pattern TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  -- % y _ de lo que se teclea se buscan tal cual.
  IF v_search IS NOT NULL THEN
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.first_name, p.last_name, p.business_name, p.account_status::text,
           (SELECT ur.role::text FROM public.user_roles ur
             WHERE ur.user_id = p.id
             ORDER BY CASE ur.role::text WHEN 'admin' THEN 1 WHEN 'partner' THEN 2 WHEN 'client' THEN 3 ELSE 4 END
             LIMIT 1),
           p.city, p.country, p.created_at, p.phone, p.business_category,
           count(*) OVER ()
      FROM public.profiles p
     WHERE (v_pattern IS NULL
            OR p.email ILIKE v_pattern ESCAPE '\'
            OR COALESCE(p.business_name, '') ILIKE v_pattern ESCAPE '\'
            OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) ILIKE v_pattern ESCAPE '\')
       AND (_role_filter IS NULL OR EXISTS (
             SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _role_filter))
       AND (_status_filter IS NULL OR p.account_status::text = _status_filter)
       AND (_city IS NULL OR p.city = _city)
       AND (_category IS NULL OR p.business_category = _category)
     ORDER BY p.created_at DESC, p.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
    OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, INT, INT, TEXT, TEXT) TO authenticated;

-- Opciones de los filtros de Locales (ciudades y categorías que existen).
CREATE OR REPLACE FUNCTION public.admin_user_facets(_role_filter TEXT)
RETURNS TABLE (cities TEXT[], categories TEXT[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    WITH usuarios AS (
      SELECT p.city, p.business_category
        FROM public.profiles p
       WHERE _role_filter IS NULL
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _role_filter)
    )
    SELECT
      ARRAY(SELECT DISTINCT u.city FROM usuarios u WHERE NULLIF(btrim(u.city), '') IS NOT NULL ORDER BY 1),
      ARRAY(SELECT DISTINCT u.business_category FROM usuarios u WHERE NULLIF(btrim(u.business_category), '') IS NOT NULL ORDER BY 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_user_facets(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_facets(TEXT) TO authenticated;

-- ============================================================================
-- 4) Soporte: una conversación abierta por usuario, tipo y organización
-- ============================================================================

-- 4a) Duplicados abiertos. Se queda abierta la que tiene mensajes y actividad
-- más reciente (en la que el usuario escribía); las demás se cierran. No se
-- borra nada: los mensajes siguen en su conversación (el admin la ve en
-- "Cerradas") y sus contadores de no leídos se conservan.
CREATE OR REPLACE FUNCTION public.support_close_duplicate_open_conversations()
RETURNS INT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_closed INT;
BEGIN
  WITH ranked AS (
    SELECT c.id,
           row_number() OVER (
             PARTITION BY c.client_id, c.kind, COALESCE(c.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
             ORDER BY (EXISTS (SELECT 1 FROM public.support_messages m WHERE m.conversation_id = c.id)) DESC,
                      c.last_message_at DESC NULLS LAST,
                      c.created_at DESC,
                      c.id
           ) AS rn
      FROM public.support_conversations c
     WHERE c.status = 'open'
       AND c.kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t)
  )
  UPDATE public.support_conversations c
     SET status = 'closed',
         subject = COALESCE(c.subject, 'Duplicada: cerrada al unificar las conversaciones abiertas')
    FROM ranked r
   WHERE r.id = c.id AND r.rn > 1;
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.support_close_duplicate_open_conversations() FROM PUBLIC, anon, authenticated;

SELECT public.support_close_duplicate_open_conversations();

CREATE UNIQUE INDEX IF NOT EXISTS support_conv_one_open_per_user
  ON public.support_conversations (client_id, kind, (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status = 'open'
    AND kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t);

-- 4b) open_conversation idempotente. partner_admin solo para quien tiene el
-- rol de local (y, con organización, si es miembro de ella). client_partner
-- no cambia: cada llamada abre una conversación nueva.
CREATE OR REPLACE FUNCTION public.open_conversation(
  _kind public.support_kind_t,
  _partner_id UUID DEFAULT NULL,
  _org_id UUID DEFAULT NULL,
  _event_id UUID DEFAULT NULL,
  _subject TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv_id UUID;
  v_org UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;

  IF _kind = 'client_partner' THEN
    INSERT INTO public.support_conversations (client_id, kind, partner_id, org_id, event_id, subject, status)
    VALUES (v_uid, 'client_partner', _partner_id, _org_id, _event_id, _subject, 'open')
    RETURNING id INTO v_conv_id;
    RETURN v_conv_id;
  END IF;

  IF _kind = 'partner_admin' THEN
    IF NOT public.has_role(v_uid, 'partner') THEN
      RAISE EXCEPTION 'Solo un local puede abrir una conversación de local' USING ERRCODE = '42501';
    END IF;
    IF _org_id IS NOT NULL AND NOT public.is_member_of_org(_org_id) THEN
      RAISE EXCEPTION 'No perteneces a esa organización' USING ERRCODE = '42501';
    END IF;
    v_org := _org_id;
  ELSE
    v_org := NULL; -- client_admin: sin organización
  END IF;

  -- Dos pestañas a la vez: el índice único deja entrar a una y la otra
  -- recibe la misma conversación.
  INSERT INTO public.support_conversations (client_id, kind, partner_id, org_id, subject, status)
  VALUES (v_uid, _kind, CASE WHEN _kind = 'partner_admin' THEN v_uid END, v_org, _subject, 'open')
  ON CONFLICT (client_id, kind, (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    WHERE status = 'open'
      AND kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t)
  DO NOTHING
  RETURNING id INTO v_conv_id;

  IF v_conv_id IS NULL THEN
    SELECT c.id INTO v_conv_id
      FROM public.support_conversations c
     WHERE c.client_id = v_uid
       AND c.kind = _kind
       AND c.status = 'open'
       AND COALESCE(c.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(v_org, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;
  RETURN v_conv_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_conversation(public.support_kind_t, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_conversation(public.support_kind_t, UUID, UUID, UUID, TEXT) TO authenticated;

-- 4c) INSERT directo: solo client_admin "en blanco" (las versiones de la app
-- que aún no usan open_conversation) y client_partner. partner_admin solo por
-- open_conversation, que comprueba el rol.
DROP POLICY IF EXISTS "support_conv_client_insert" ON public.support_conversations;
CREATE POLICY "support_conv_client_insert" ON public.support_conversations FOR INSERT TO authenticated
  WITH CHECK (
    (kind = 'client_admin'
      AND client_id = (SELECT auth.uid())
      AND partner_id IS NULL
      AND org_id IS NULL
      AND event_id IS NULL
      AND assigned_admin_id IS NULL
      AND status = 'open'
      AND unread_for_admin = 0
      AND unread_for_client = 0
      AND last_message_at IS NULL
      AND last_message_preview IS NULL)
    OR (kind = 'client_partner' AND client_id = (SELECT auth.uid()))
  );

-- 4d) Leído de verdad: además de poner a cero el contador, read_at en los
-- mensajes de la otra parte (el doble check del chat). Solo toca la
-- conversación si había algo sin leer: cada UPDATE es un aviso de Realtime.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id UUID, _as_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv public.support_conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_conv FROM public.support_conversations WHERE id = _conversation_id;
  IF v_conv.id IS NULL THEN RETURN; END IF;

  IF _as_kind = 'client' THEN
    IF v_conv.client_id IS DISTINCT FROM v_uid THEN RETURN; END IF;
    UPDATE public.support_messages
       SET read_at = now()
     WHERE conversation_id = _conversation_id AND sender_kind = 'admin' AND read_at IS NULL;
    UPDATE public.support_conversations
       SET unread_for_client = 0
     WHERE id = _conversation_id AND unread_for_client <> 0;
  ELSIF _as_kind = 'admin' THEN
    IF NOT public.has_role(v_uid, 'admin') THEN RETURN; END IF;
    UPDATE public.support_messages
       SET read_at = now()
     WHERE conversation_id = _conversation_id AND sender_kind <> 'admin' AND read_at IS NULL;
    UPDATE public.support_conversations
       SET unread_for_admin = 0
     WHERE id = _conversation_id AND unread_for_admin <> 0;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT) TO authenticated;

-- 4e) Un mensaje del usuario reabre su conversación cerrada (como un ticket
-- de soporte), salvo que ya tenga otra abierta: entonces se queda en esta y
-- cuenta como no leído.
CREATE OR REPLACE FUNCTION public.update_support_conv_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv public.support_conversations%ROWTYPE;
BEGIN
  UPDATE public.support_conversations
     SET last_message_at = NEW.created_at,
         last_message_preview = LEFT(NEW.body, 120),
         unread_for_admin = CASE WHEN NEW.sender_kind = 'client' THEN unread_for_admin + 1 ELSE unread_for_admin END,
         unread_for_client = CASE WHEN NEW.sender_kind = 'admin' THEN unread_for_client + 1 ELSE unread_for_client END
   WHERE id = NEW.conversation_id
  RETURNING * INTO v_conv;

  IF NEW.sender_kind <> 'admin'
     AND v_conv.status IS DISTINCT FROM 'open'
     AND v_conv.kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t) THEN
    BEGIN
      UPDATE public.support_conversations SET status = 'open' WHERE id = v_conv.id;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_support_conv_on_message() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 5) Auditoría de user_roles: rol del actor fiable
-- ============================================================================
-- Sin usuario en el JWT (alta de cuenta con el trigger de auth, servidor,
-- SQL directo) el actor es 'system': antes 'anon', y cada alta salía como
-- "escalada" en el visor. Un admin con varios roles es 'admin'.
CREATE OR REPLACE FUNCTION public.audit_user_roles_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  IF v_actor IS NULL THEN
    v_actor_role := 'system';
  ELSIF public.has_role(v_actor, 'admin') THEN
    v_actor_role := 'admin';
  ELSE
    SELECT ur.role::text INTO v_actor_role
      FROM public.user_roles ur
     WHERE ur.user_id = v_actor
     ORDER BY CASE ur.role::text WHEN 'partner' THEN 1 WHEN 'client' THEN 2 ELSE 3 END
     LIMIT 1;
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, action, target_kind, target_id, before, after)
  VALUES (
    v_actor,
    COALESCE(v_actor_role, 'sin_rol'),
    TG_OP || '_user_roles',
    'user_roles',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_user_roles_change() FROM PUBLIC, anon, authenticated;
