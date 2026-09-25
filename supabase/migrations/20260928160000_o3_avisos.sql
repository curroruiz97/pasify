-- Pasify · Ola 3 · avisos que salen de verdad
--
--   T1 · B5-2, B4-08, B6-09  Lo que se encolaba en SQL con
--        enqueue_notification (respuestas de soporte, cancelaciones,
--        solicitudes de reembolso, liquidaciones…) se quedaba en
--        notifications: nadie llamaba a dispatch-notification. Ahora:
--          * cada aviso nuevo deja un envío pendiente por canal en
--            notification_dispatches (trg_notifications_queue_dispatch):
--            email siempre, push si el usuario tiene dispositivos, SMS si es
--            crítico. Los avisos anteriores a esta migración no se envían;
--          * claim_notification_dispatches reparte lo pendiente sin que dos
--            ejecuciones cojan lo mismo (FOR UPDATE SKIP LOCKED y un plazo),
--            con límite por pasada, reintentos con next_retry_at y
--            attempt_count, y caducidad (48 h sin salir: ya no se manda);
--          * schedule_dispatch_notifications(): pg_cron cada minuto llama a
--            dispatch-notification (solo si hay algo pendiente), con el mismo
--            patrón y los mismos secretos de Vault que
--            schedule_reconcile_pending_orders (20260927110000).
--        support_notify_reply: el enlace del cliente lleva a su Soporte
--        (/#/client-dashboard/support) y una ráfaga de respuestas (10 min)
--        es un solo aviso.
--        cron_cleanup_old_notifications purga por antigüedad: leídas a los
--        90 días y todas a los 180 (read_at casi nunca se rellenaba).
--   T2 · B5-1  Un usuario escribe a soporte y el contador de no leídos del
--        admin pasa de 0 a 1 → notify-admin-message por pg_net con la
--        cabecera interna (trg_support_notify_admin). Sin el secreto en
--        Vault no hace nada; nunca rompe el INSERT.
--   T4 · B6-08  schedule_health_check(): health-check completo cada 15
--        minutos. record_service_status guarda cada pasada y devuelve el
--        estado anterior de cada servicio: la función avisa a los admins solo
--        cuando cambia.
--   T5 · B6-09  refunds_to_retake + schedule_retake_stale_refunds(): la edge
--        retake-stale-refunds retoma cada 10 minutos los reembolsos
--        atascados (process-refund solo admite llamadas con sesión).
--   T6 · B5-15  Local nuevo (organización creada) → aviso a los admins de
--        plataforma (partner_registered, trg_organizations_notify_new_partner).
--
-- Acción manual (una vez, en el SQL editor de producción), si esta migración
-- avisó de que no había secreto:
--   1. Secreto de las edge functions PASIFY_INTERNAL_SECRET (32+ caracteres).
--   2. El mismo valor en Vault:
--        SELECT vault.create_secret('<mismo valor>', 'pasify_internal_secret');
--   3. SELECT public.schedule_dispatch_notifications();
--      SELECT public.schedule_health_check();
--      SELECT public.schedule_retake_stale_refunds();
-- Repetirlas no duplica nada (cron.schedule reemplaza el trabajo del mismo
-- nombre). Para parar uno: SELECT cron.unschedule('<nombre>').

-- ============================================================================
-- 1) Llamadas internas a las edge functions (Vault + pg_net)
-- ============================================================================

-- Base de las edge functions: secreto pasify_project_url de Vault o, si no
-- está, la de producción (lo mismo que schedule_reconcile_pending_orders).
CREATE OR REPLACE FUNCTION public.pasify_functions_base_url()
RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_base TEXT;
BEGIN
  BEGIN
    SELECT s.decrypted_secret INTO v_base
      FROM vault.decrypted_secrets s
     WHERE s.name = 'pasify_project_url'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_base := NULL;
  END;
  RETURN rtrim(COALESCE(NULLIF(btrim(v_base), ''), 'https://ixkyfwzkknehvsqpopof.supabase.co'), '/')
         || '/functions/v1/';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasify_functions_base_url() FROM PUBLIC, anon, authenticated;

-- POST inmediato a una edge function con la cabecera x-pasify-internal
-- (requireServiceRole de _shared/internal-auth.ts). Sin el secreto
-- pasify_internal_secret en Vault no hace nada y devuelve NULL. Nunca lanza:
-- la llaman triggers que no deben romper su INSERT. pg_net manda la petición
-- cuando la transacción se confirma (si se deshace, no sale nada).
CREATE OR REPLACE FUNCTION public.pasify_internal_post(_function TEXT, _body JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF _function IS NULL OR _function !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE WARNING 'pasify_internal_post: nombre de función no válido (%)', _function;
    RETURN NULL;
  END IF;
  BEGIN
    SELECT s.decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets s
     WHERE s.name = 'pasify_internal_secret'
     LIMIT 1;
    IF NULLIF(v_secret, '') IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN net.http_post(
      url := public.pasify_functions_base_url() || _function,
      body := COALESCE(_body, '{}'::jsonb),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pasify-internal', v_secret),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pasify_internal_post(%): %', _function, SQLERRM;
    RETURN NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasify_internal_post(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Programa una llamada periódica (pg_cron + pg_net) a una edge function con
-- la cabecera x-pasify-internal: el patrón de schedule_reconcile_pending_orders.
-- El secreto se lee de Vault en cada ejecución: no queda escrito en cron.job.
-- _only_if: condición SQL opcional; sin ella cumplida no se llama (así no se
-- gasta una invocación por minuto cuando no hay nada que hacer).
CREATE OR REPLACE FUNCTION public.pasify_schedule_internal_call(
  _job_name TEXT,
  _schedule TEXT,
  _function TEXT,
  _body JSONB DEFAULT '{}'::jsonb,
  _only_if TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_url TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret') THEN
    RAISE EXCEPTION 'Falta el secreto pasify_internal_secret en Vault (el mismo valor que PASIFY_INTERNAL_SECRET de las edge functions)';
  END IF;
  IF _function IS NULL OR _function !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'Nombre de edge function no válido: %', _function;
  END IF;

  v_url := public.pasify_functions_base_url() || _function;

  PERFORM cron.schedule(
    _job_name,
    _schedule,
    format(
      $job$SELECT net.http_post(
  url := %L,
  body := %L::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-pasify-internal', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret' LIMIT 1)
  ),
  timeout_milliseconds := 55000
)%s$job$,
      v_url,
      COALESCE(_body, '{}'::jsonb)::text,
      CASE WHEN NULLIF(btrim(COALESCE(_only_if, '')), '') IS NULL THEN '' ELSE E'\nWHERE ' || _only_if END
    )
  );
  RETURN _job_name || ': ' || _schedule || ' contra ' || v_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasify_schedule_internal_call(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2) Cola de envíos (T1)
-- ============================================================================
-- notification_dispatches pasa a ser también la cola: una fila por aviso y
-- canal. 'pending' + next_retry_at = cuándo toca (re)intentarlo;
-- attempt_count = intentos empezados. dispatch-notification la cierra con
-- sent / skipped / failed o la deja 'pending' con el siguiente reintento.
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_due
  ON public.notification_dispatches (next_retry_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.notification_dispatches.next_retry_at IS
  'Con status pending: cuándo toca enviarlo (al crearse, ya). Mientras una ejecución de dispatch-notification lo tiene, el final de su plazo; tras un fallo, el siguiente reintento.';

-- Cada aviso nuevo deja sus envíos pendientes. Push solo si el usuario tiene
-- algún dispositivo (sin tokens no se hace nada) y SMS solo en los críticos,
-- como dispatch-notification. Si algo falla aquí, el aviso se guarda igual.
CREATE OR REPLACE FUNCTION public.notifications_queue_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notification_dispatches (notification_id, channel, status, next_retry_at)
    SELECT NEW.id, c.channel, 'pending'::public.notification_status_t, now()
      FROM (
        SELECT 'email'::public.notification_channel_t AS channel
        UNION ALL
        SELECT 'push'::public.notification_channel_t
         WHERE EXISTS (SELECT 1 FROM public.user_fcm_tokens t WHERE t.user_id = NEW.user_id)
        UNION ALL
        SELECT 'sms'::public.notification_channel_t
         WHERE NEW.priority = 'critical' OR NEW.category IN ('critical', 'security')
      ) c;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_queue_dispatch(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_queue_dispatch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_queue_dispatch ON public.notifications;
CREATE TRIGGER trg_notifications_queue_dispatch
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_queue_dispatch();

-- Reparto de envíos (solo dispatch-notification, con la service role):
--   1. caducan los que llevan 48 h sin salir (o cuyo aviso ya expiró);
--   2. los que agotaron los intentos (la ejecución se cortó sin apuntar el
--      resultado) quedan 'failed';
--   3. hasta _limit filas vencidas, cada una a una sola ejecución: suma un
--      intento y aparta la fila _lease_seconds. Si esa ejecución no apunta el
--      resultado, pasado el plazo se vuelve a repartir.
-- Con _notification_id, solo los de ese aviso (el envío inmediato de
-- _shared/notify.ts).
CREATE OR REPLACE FUNCTION public.claim_notification_dispatches(
  _limit INT DEFAULT 10,
  _notification_id UUID DEFAULT NULL,
  _lease_seconds INT DEFAULT 300,
  _max_attempts INT DEFAULT 6
)
RETURNS TABLE (dispatch_id UUID, notification_id UUID, channel TEXT, attempt_count INT)
LANGUAGE plpgsql SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_max INT := LEAST(GREATEST(COALESCE(_max_attempts, 6), 1), 20);
  v_lease INTERVAL := make_interval(secs => LEAST(GREATEST(COALESCE(_lease_seconds, 300), 30), 3600));
BEGIN
  WITH caducados AS (
    SELECT d.id
      FROM public.notification_dispatches d
      JOIN public.notifications n ON n.id = d.notification_id
     WHERE d.status = 'pending'
       AND d.next_retry_at <= now()
       AND (_notification_id IS NULL OR d.notification_id = _notification_id)
       AND (n.created_at < now() - INTERVAL '48 hours' OR n.expires_at <= now())
     FOR UPDATE OF d SKIP LOCKED
  )
  UPDATE public.notification_dispatches d
     SET status = 'skipped',
         error_message = 'expired',
         next_retry_at = NULL
    FROM caducados c
   WHERE d.id = c.id;

  WITH agotados AS (
    SELECT d.id
      FROM public.notification_dispatches d
     WHERE d.status = 'pending'
       AND d.next_retry_at <= now()
       AND d.attempt_count >= v_max
       AND (_notification_id IS NULL OR d.notification_id = _notification_id)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_dispatches d
     SET status = 'failed',
         error_message = left(COALESCE(d.error_message || ' · ', '') || 'max_attempts', 500),
         next_retry_at = NULL
    FROM agotados a
   WHERE d.id = a.id;

  RETURN QUERY
  WITH due AS (
    SELECT d.id
      FROM public.notification_dispatches d
     WHERE d.status = 'pending'
       AND d.next_retry_at <= now()
       AND d.attempt_count < v_max
       AND (_notification_id IS NULL OR d.notification_id = _notification_id)
     ORDER BY d.next_retry_at, d.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 200)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_dispatches d
     SET attempt_count = d.attempt_count + 1,
         next_retry_at = now() + v_lease
    FROM due
   WHERE d.id = due.id
  RETURNING d.id, d.notification_id, d.channel::text, d.attempt_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_dispatches(INT, UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_dispatches(INT, UUID, INT, INT) TO service_role;

-- pg_cron cada minuto → dispatch-notification en lotes, solo si hay algún
-- envío vencido (índice idx_notification_dispatches_due).
CREATE OR REPLACE FUNCTION public.schedule_dispatch_notifications()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-dispatch-notifications',
    '* * * * *',
    'dispatch-notification',
    '{"mode": "batch"}'::jsonb,
    'EXISTS (SELECT 1 FROM public.notification_dispatches d WHERE d.status = ''pending'' AND d.next_retry_at <= now())'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_dispatch_notifications() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3) Soporte: respuesta de Pasify → aviso al usuario (enlace y ráfagas)
-- ============================================================================
-- La definición de 20260923120300 con dos cambios:
--   * el cliente va a su Soporte (/#/client-dashboard/support; antes a la
--     portada del panel); el local, a /#/partner-dashboard/soporte;
--   * varias respuestas seguidas (10 minutos) son un solo aviso: ahora cada
--     aviso sale por email.
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
  IF EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = v_conv.client_id
       AND n.kind = 'support_reply'
       AND n.created_at > now() - INTERVAL '10 minutes'
       AND n.payload->>'conversation_id' = v_conv.id::text
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_notification(
    v_conv.client_id,
    'support',
    'support_reply',
    'Te ha respondido el equipo de Pasify',
    left(NEW.body, 140),
    CASE WHEN v_conv.kind = 'partner_admin' THEN '/#/partner-dashboard/soporte' ELSE '/#/client-dashboard/support' END,
    jsonb_build_object('conversation_id', v_conv.id)
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.support_notify_reply() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4) Soporte: mensaje de un usuario → email al admin (T2)
-- ============================================================================
-- Después de trg_support_msg_update_conv (los triggers AFTER van por orden
-- alfabético): el contador ya incluye este mensaje. Solo cuando pasa de 0 a
-- 1, así una conversación larga no manda un email por mensaje; cuando el
-- admin la lee (mark_conversation_read) vuelve a 0. notify-admin-message
-- carga el mensaje por su id. Nunca rompe el INSERT.
CREATE OR REPLACE FUNCTION public.support_notify_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv public.support_conversations%ROWTYPE;
BEGIN
  IF NEW.sender_kind IS DISTINCT FROM 'client' THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO v_conv FROM public.support_conversations c WHERE c.id = NEW.conversation_id;
    IF v_conv.id IS NOT NULL
       AND v_conv.kind IN ('client_admin'::public.support_kind_t, 'partner_admin'::public.support_kind_t)
       AND v_conv.unread_for_admin = 1 THEN
      PERFORM public.pasify_internal_post('notify-admin-message', jsonb_build_object('message_id', NEW.id));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'support_notify_admin(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.support_notify_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_notify_admin ON public.support_messages;
CREATE TRIGGER trg_support_notify_admin
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_notify_admin();

-- ============================================================================
-- 5) Purga de avisos por antigüedad
-- ============================================================================
-- La definición de 20260512212906 borraba solo los leídos hace 90 días y
-- read_at casi nunca se rellena: la tabla crecía sin límite. Ahora, por
-- fecha del aviso: leídos a los 90 días y todos a los 180. Sus envíos
-- (notification_dispatches) se van con ellos (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION public.cron_cleanup_old_notifications()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('cleanup_old_notifications', 'running') RETURNING id INTO v_run_id;
  DELETE FROM public.notifications
   WHERE created_at < now() - INTERVAL '180 days'
      OR (read_at IS NOT NULL AND created_at < now() - INTERVAL '90 days');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs
     SET finished_at = now(), status = 'success', metadata = jsonb_build_object('deleted', v_count)
   WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_cleanup_old_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_cleanup_old_notifications() TO service_role;

-- ============================================================================
-- 6) Monitorización (T4)
-- ============================================================================
-- Guarda una pasada de health-check (una fila por servicio en
-- service_status_snapshots) y devuelve, de cada servicio, el último estado
-- guardado antes de esta (NULL si no había). Con el candado, dos pasadas a la
-- vez no ven el mismo "estado anterior" y no avisan dos veces. Solo
-- health-check (service role).
-- _checks: [{ "service", "status", "latency_ms"?, "message"? }]
CREATE OR REPLACE FUNCTION public.record_service_status(_checks JSONB)
RETURNS TABLE (service TEXT, previous_status TEXT, previous_at TIMESTAMPTZ)
LANGUAGE plpgsql SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF _checks IS NULL OR jsonb_typeof(_checks) <> 'array' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pasify_record_service_status'));

  RETURN QUERY
  WITH nuevos AS (
    SELECT DISTINCT ON (x->>'service')
           x->>'service' AS svc,
           x->>'status' AS st,
           CASE WHEN (x->>'latency_ms') ~ '^\d{1,9}$' THEN (x->>'latency_ms')::INT END AS latency,
           left(x->>'message', 500) AS msg
      FROM jsonb_array_elements(_checks) x
     WHERE NULLIF(btrim(x->>'service'), '') IS NOT NULL
     ORDER BY x->>'service'
  ),
  previos AS (
    SELECT n.svc, p.status AS prev_status, p.recorded_at AS prev_at
      FROM nuevos n
      LEFT JOIN LATERAL (
        SELECT s.status, s.recorded_at
          FROM public.service_status_snapshots s
         WHERE s.service = n.svc
         ORDER BY s.recorded_at DESC
         LIMIT 1
      ) p ON TRUE
  ),
  guardados AS (
    INSERT INTO public.service_status_snapshots (service, status, latency_ms, message)
    SELECT n.svc, n.st, n.latency, n.msg FROM nuevos n
    RETURNING 1
  )
  SELECT pv.svc, pv.prev_status, pv.prev_at FROM previos pv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_service_status(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_service_status(JSONB) TO service_role;

-- pg_cron cada 15 minutos → health-check completo (con la cabecera interna
-- health-check hace todas las comprobaciones, las guarda y avisa).
CREATE OR REPLACE FUNCTION public.schedule_health_check()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-health-check',
    '*/15 * * * *',
    'health-check',
    '{"mode": "full"}'::jsonb,
    NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_health_check() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 7) Reembolsos atascados (T5)
-- ============================================================================
-- Lote de solicitudes a retomar (solo retake-stale-refunds):
--   * 'processing' sin reembolso de Stripe apuntado y 10 minutos sin moverse
--     (STALE_PROCESSING_MS de _shared/refund.ts): resumeStaleRefund;
--   * 'approved' que nadie ejecutó en 10 minutos (el panel no llegó a llamar
--     a process-refund). Solo las de las últimas 48 h: una que no se puede
--     ejecutar (entrada ya usada…) no se reintenta para siempre y la ve el
--     admin en "Con incidencia".
-- Las más antiguas primero; _exclude son las ya vistas en esta pasada.
CREATE OR REPLACE FUNCTION public.refunds_to_retake(_limit INT DEFAULT 10, _exclude UUID[] DEFAULT '{}')
RETURNS TABLE (request_id UUID, status TEXT)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT r.id, r.status::text
    FROM public.refund_requests r
   WHERE r.stripe_refund_id IS NULL
     AND r.id <> ALL (COALESCE(_exclude, '{}'::UUID[]))
     AND (
       (r.status = 'processing' AND r.updated_at < now() - INTERVAL '10 minutes')
       OR (r.status = 'approved'
           AND r.updated_at < now() - INTERVAL '10 minutes'
           AND r.updated_at > now() - INTERVAL '48 hours')
     )
   ORDER BY r.updated_at, r.id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.refunds_to_retake(INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refunds_to_retake(INT, UUID[]) TO service_role;

-- pg_cron cada 10 minutos → retake-stale-refunds, solo si hay alguna.
CREATE OR REPLACE FUNCTION public.schedule_retake_stale_refunds()
RETURNS TEXT
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RETURN public.pasify_schedule_internal_call(
    'pasify-retake-stale-refunds',
    '*/10 * * * *',
    'retake-stale-refunds',
    '{}'::jsonb,
    'EXISTS (SELECT 1 FROM public.refunds_to_retake(1))'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_retake_stale_refunds() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 8) Local nuevo → aviso a los admins (T6)
-- ============================================================================
-- Al crearse una organización (el alta de un local la crea al momento), un
-- aviso a cada admin de plataforma, que dispatch-notification manda también
-- por email. Antes el admin recibía un email "pendiente de aprobación" por
-- cada alta de CLIENTE y ninguno por la de un local. Nunca rompe el INSERT.
CREATE OR REPLACE FUNCTION public.organizations_notify_new_partner()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.profiles%ROWTYPE;
  v_admin UUID;
  v_name TEXT := COALESCE(NULLIF(btrim(NEW.name), ''), 'Local sin nombre');
  v_detalle TEXT;
BEGIN
  BEGIN
    IF NEW.owner_id IS NOT NULL THEN
      SELECT * INTO v_owner FROM public.profiles p WHERE p.id = NEW.owner_id;
    END IF;
    v_detalle := concat_ws(' · ',
      NULLIF(btrim(COALESCE(v_owner.business_category, '')), ''),
      NULLIF(btrim(COALESCE(NEW.city, v_owner.business_city, v_owner.city, '')), ''),
      NULLIF(btrim(COALESCE(v_owner.email, NEW.contact_email, '')), ''));

    FOR v_admin IN
      SELECT DISTINCT ur.user_id
        FROM public.user_roles ur
       WHERE ur.role = 'admin'::public.app_role
         AND ur.user_id IS DISTINCT FROM NEW.owner_id
    LOOP
      PERFORM public.enqueue_notification(
        v_admin,
        'system',
        'partner_registered',
        left('Nuevo local en Pasify: ' || v_name, 200),
        left(CASE WHEN v_detalle <> '' THEN v_detalle || '. ' ELSE '' END
             || 'Ya puede publicar eventos y vender. Lo tienes en Locales del panel de admin.', 280),
        '/#/admin',
        jsonb_build_object('org_id', NEW.id, 'owner_id', NEW.owner_id),
        'normal'
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'organizations_notify_new_partner(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.organizations_notify_new_partner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organizations_notify_new_partner ON public.organizations;
CREATE TRIGGER trg_organizations_notify_new_partner
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_notify_new_partner();

-- ============================================================================
-- 9) Programar los trabajos si Vault ya tiene el secreto
-- ============================================================================
DO $$
DECLARE
  v_ready BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'pasify_internal_secret') INTO v_ready;
  EXCEPTION WHEN OTHERS THEN
    v_ready := FALSE;
  END;

  IF v_ready THEN
    RAISE NOTICE '%', public.schedule_dispatch_notifications();
    RAISE NOTICE '%', public.schedule_health_check();
    RAISE NOTICE '%', public.schedule_retake_stale_refunds();
  ELSE
    RAISE NOTICE 'Avisos, health-check y reembolsos atascados sin programar: falta el secreto pasify_internal_secret en Vault. Tras crearlo: SELECT public.schedule_dispatch_notifications(); SELECT public.schedule_health_check(); SELECT public.schedule_retake_stale_refunds();';
  END IF;
END $$;
