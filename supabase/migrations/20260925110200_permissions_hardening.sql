-- Pasify · permisos de funciones, auditoría, soporte y buckets (Ola 0)
--
--   B3-06/B6-02 check_rate_limit la ejecutaban anon y authenticated, con _max
--         y _window_sec a su gusto: cualquiera dejaba bloqueado años a un
--         local con claves como cancel_event:<uid>, connect_onboard:,
--         checkout: o sms:. Ahora solo service_role (las edge functions la
--         llaman con el cliente de servicio, _shared/rate-limit.ts), la
--         ventana no pasa de 24 h y se borran las filas con ventanas mayores.
--   B6-06 SECURITY DEFINER al alcance de anon: solo quedan get_feature_flag,
--         public_partner_rows, resolve_whitelabel_host y
--         live_payments_required (ninguna pantalla sin sesión llama a otra).
--         get_app_setting_bool/int/text pasan a SECURITY INVOKER para que
--         mande la RLS de app_settings (anon leía las 15 claves, comisión y
--         teléfono de soporte incluidos). has_role, get_user_role,
--         loyalty_balance e is_super_admin solo responden por uno mismo, a
--         un admin o al servidor. accept_invitation, global_search y
--         rls_auto_enable no las llama nadie desde el cliente.
--   B3-08/B5-12 set_admin_by_email: cualquier admin creaba admins y, sin
--         ninguno, cualquiera se hacía admin. Ahora solo service_role.
--   B5-9  audit_changes usaba NEW.id y cuatro tablas auditadas no tienen
--         columna id: todo UPDATE o DELETE de app_settings, feature_flags,
--         ai_kill_switches y whitelabel_configs fallaba (no se podía cambiar
--         la comisión con set_app_setting ni el kill-switch de IA).
--   B6-10 support_messages.sender_id era NOT NULL con ON DELETE SET NULL:
--         borrar una cuenta que había escrito en una conversación ajena daba
--         500.
--   B6-13 get_user_role solo estaba en producción (con otro orden que el de
--         las migraciones): se versiona tal cual, con el control de _user_id.
--   B6-16 support-attachments y marketing-assets sin límite de tamaño ni tipo.
--
-- "El servidor" en los controles de _user_id es una llamada sin usuario en el
-- JWT (auth.uid() NULL): service_role, SQL directo y pg_cron. anon no llega:
-- ninguna de esas funciones es ejecutable por anon, ni directamente ni desde
-- las que sí lo son.

-- ============================================================================
-- 1) check_rate_limit: solo service_role y ventana de 24 h como mucho
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_rate_limit(_key TEXT, _max INT, _window_sec INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.rate_limits%ROWTYPE;
  -- Entre 1 segundo y 24 horas, pida lo que pida quien llama.
  v_window INT := LEAST(GREATEST(COALESCE(_window_sec, 60), 1), 86400);
BEGIN
  -- Garbage collect expirados
  DELETE FROM public.rate_limits WHERE expires_at < now();
  SELECT * INTO v_row FROM public.rate_limits WHERE key = _key FOR UPDATE;
  IF v_row.key IS NULL THEN
    INSERT INTO public.rate_limits (key, count, window_start, expires_at) VALUES (_key, 1, now(), now() + make_interval(secs => v_window));
    RETURN TRUE;
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.rate_limits SET count = 1, window_start = now(), expires_at = now() + make_interval(secs => v_window) WHERE key = _key;
    RETURN TRUE;
  END IF;
  IF v_row.count >= _max THEN RETURN FALSE; END IF;
  UPDATE public.rate_limits SET count = count + 1 WHERE key = _key;
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO service_role;

-- Bloqueos sembrados con ventanas de más de 24 h: fuera.
DELETE FROM public.rate_limits
 WHERE expires_at > now() + INTERVAL '1 day'
    OR expires_at - window_start > INTERVAL '1 day';

-- ============================================================================
-- 2) get_app_setting_*: SECURITY INVOKER (manda la RLS de app_settings)
-- ============================================================================
-- anon y un usuario normal solo leen las claves públicas (policy
-- app_settings_public_read); un admin, todas (app_settings_admin_all). Desde
-- el servidor (service_role tiene BYPASSRLS) o desde otra función SECURITY
-- DEFINER se sigue leyendo todo: stripe-create-checkout lee así la comisión.
-- En el cliente solo las usa AppSettingsCard, que es del panel de admin.
ALTER FUNCTION public.get_app_setting_bool(TEXT) SECURITY INVOKER;
ALTER FUNCTION public.get_app_setting_int(TEXT) SECURITY INVOKER;
ALTER FUNCTION public.get_app_setting_text(TEXT) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 3) Funciones con _user_id: uno mismo, un admin o el servidor
-- ============================================================================
-- Ninguna policy RLS las llama con un id distinto de auth.uid() (revisado en
-- el catálogo: todas pasan auth.uid()), así que la RLS no cambia. Tampoco las
-- funciones SECURITY DEFINER, salvo loyalty_grant_points con loyalty_balance
-- (redeem_referral_code da puntos a quien invitó): ver más abajo.

-- has_role: el control de permisos de toda la app. Sigue devolviendo false,
-- nunca NULL (un IF NOT has_role(...) con NULL dejaría pasar).
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN FALSE
    WHEN _user_id = auth.uid()
      OR auth.uid() IS NULL
      OR EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = auth.uid() AND a.role = 'admin')
      THEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = _role)
    ELSE FALSE
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- get_user_role: la definición de producción (el rol más alto, no uno
-- cualquiera) con el control de _user_id. La usa Login.tsx con el id propio.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT role::text FROM public.user_roles
  WHERE user_id = _user_id
    AND (_user_id = auth.uid()
         OR auth.uid() IS NULL
         OR EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = auth.uid() AND a.role = 'admin'))
  ORDER BY CASE role::text WHEN 'admin' THEN 1 WHEN 'partner' THEN 2 WHEN 'client' THEN 3 ELSE 4 END
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, service_role;

-- loyalty_balance: NULL si se pregunta por el saldo de otro.
CREATE OR REPLACE FUNCTION public.loyalty_balance(_user_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id = auth.uid()
      OR auth.uid() IS NULL
      OR EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = auth.uid() AND a.role = 'admin')
      THEN (SELECT COALESCE(SUM(lp.change_amount), 0)::INT
              FROM public.loyalty_points lp
             WHERE lp.user_id = _user_id AND (lp.expires_at IS NULL OR lp.expires_at > now()))
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.loyalty_balance(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loyalty_balance(UUID) TO authenticated, service_role;

-- loyalty_grant_points (solo servidor) calcula el saldo ella misma: la llama
-- redeem_referral_code con el JWT de quien canjea para dar puntos también a
-- quien le invitó, y loyalty_balance ya no le contestaría por otro usuario.
CREATE OR REPLACE FUNCTION public.loyalty_grant_points(
  _user_id UUID,
  _amount INT,
  _reason TEXT,
  _reason_code TEXT DEFAULT NULL,
  _event_id UUID DEFAULT NULL,
  _ticket_id UUID DEFAULT NULL,
  _org_id UUID DEFAULT NULL,
  _expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_balance INT;
BEGIN
  IF _amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  SELECT COALESCE(SUM(lp.change_amount), 0)::INT + _amount INTO v_new_balance
    FROM public.loyalty_points lp
   WHERE lp.user_id = _user_id AND (lp.expires_at IS NULL OR lp.expires_at > now());
  INSERT INTO public.loyalty_points (user_id, change_amount, reason, reason_code, event_id, ticket_id, org_id, balance_after, expires_at)
  VALUES (_user_id, _amount, _reason, _reason_code, _event_id, _ticket_id, _org_id, v_new_balance, _expires_at);
  RETURN v_new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.loyalty_grant_points(UUID, INT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_grant_points(UUID, INT, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;

-- is_super_admin: false si se pregunta por otro. useAuth la llama con el id
-- propio; is_super_admin_self() con auth.uid().
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN FALSE
    WHEN _user_id = auth.uid()
      OR auth.uid() IS NULL
      OR EXISTS (SELECT 1 FROM public.user_roles a WHERE a.user_id = auth.uid() AND a.role = 'admin')
      THEN EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = _user_id
          AND lower(p.email) IN ('francisco@avenuemedia.io')
          AND public.has_role(_user_id, 'admin'::public.app_role)
      )
    ELSE FALSE
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;

-- ============================================================================
-- 4) RPC sin uso desde el cliente
-- ============================================================================
-- accept_invitation: accept-team-invitation acepta con service role sin
-- llamarla y el cliente nunca la ha usado.
REVOKE EXECUTE ON FUNCTION public.accept_invitation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(UUID) TO service_role;

-- accept_ticket_transfer: la llama accept-ticket-transfer con el JWT del
-- usuario (usa auth.uid()), así que authenticated la conserva.
REVOKE EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) TO authenticated, service_role;

-- global_search: solo la usaba GlobalSearchSheet, que no se monta en ningún sitio.
REVOKE EXECUTE ON FUNCTION public.global_search(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(TEXT, INT) TO service_role;

-- rls_auto_enable: función de event trigger que existe en producción (creada
-- desde el panel de Supabase, sin migración) y no en una base nueva. Nadie la
-- llama: la ejecuta el propio event trigger.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ============================================================================
-- 5) anon: solo la lista blanca
-- ============================================================================
-- Red de seguridad para lo que no se haya tratado arriba (p. ej. funciones
-- creadas a mano en producción): cualquier otra SECURITY DEFINER de public
-- deja de ser ejecutable por anon. authenticated y service_role conservan lo
-- que tuvieran (aunque les llegara solo por PUBLIC).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('get_feature_flag', 'public_partner_rows', 'resolve_whitelabel_host', 'live_payments_required')
  LOOP
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    RAISE NOTICE 'anon ya no ejecuta %', r.sig;
  END LOOP;
END $$;

-- ============================================================================
-- 6) set_admin_by_email: solo el servidor
-- ============================================================================
-- Nadie la llama con sesión: /admin-setup se retira. Desde service_role o SQL
-- directo da el rol admin sin más (antes solo funcionaba si no había admins).
CREATE OR REPLACE FUNCTION public.set_admin_by_email(_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID;
BEGIN
  -- Con usuario en el JWT, nunca (aunque alguien volviera a darle EXECUTE).
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT id INTO v_uid FROM public.profiles WHERE lower(email) = lower(_email) LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'User no encontrado'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_admin_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_by_email(TEXT) TO service_role;

-- ============================================================================
-- 7) audit_changes sin NEW.id
-- ============================================================================
-- El id sale de la fila en JSON: la columna id si existe; si no, la primera
-- columna de la clave primaria (whitelabel_configs.org_id) o la columna key.
-- target_id es UUID: una clave de texto (app_settings.key, feature_flags.code,
-- ai_kill_switches.capability_code) deja target_id a NULL y queda en
-- before/after, como el resto de la fila.
CREATE OR REPLACE FUNCTION public.audit_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_role TEXT;
  v_before JSONB;
  v_after JSONB;
  v_row JSONB;
  v_key TEXT;
  v_target UUID;
BEGIN
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
  IF TG_OP = 'UPDATE' THEN v_before := to_jsonb(OLD); v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN v_before := to_jsonb(OLD); v_after := NULL;
  ELSE v_before := NULL; v_after := to_jsonb(NEW); END IF;

  v_row := COALESCE(v_after, v_before);
  v_key := v_row->>'id';
  IF v_key IS NULL THEN
    SELECT v_row->>a.attname INTO v_key
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = TG_RELID AND i.indisprimary;
  END IF;
  v_key := COALESCE(v_key, v_row->>'key');
  IF v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_target := v_key::uuid;
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, action, target_kind, target_id, before, after)
  VALUES (v_actor, COALESCE(v_role,'service'), TG_OP || '_' || TG_TABLE_NAME, TG_TABLE_NAME, v_target, v_before, v_after);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_changes() TO service_role;

-- ============================================================================
-- 8) Soporte: el mensaje sobrevive a la cuenta que lo escribió
-- ============================================================================
ALTER TABLE public.support_messages ALTER COLUMN sender_id DROP NOT NULL;

COMMENT ON COLUMN public.support_messages.sender_id IS
  'Autor del mensaje. NULL si su cuenta se borró (ON DELETE SET NULL): el mensaje sigue en la conversación.';

-- ============================================================================
-- 9) Storage: tamaño y tipo en support-attachments y marketing-assets
-- ============================================================================
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf']
 WHERE id IN ('support-attachments', 'marketing-assets');
