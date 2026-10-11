-- Pasify · Ola 4, guards SQL: equipo, plan gratuito y funciones expuestas (WP9)
--
--   9a · Equipo. Un admin de la organización podía, por la policy
--         org_members_owner_admin_write (FOR ALL) y por invite_member, crear
--         filas 'owner' sin consentimiento del dueño y tocar la del dueño. El
--         dueño real es organizations.owner_id (implícito: create_organization
--         no crea fila 'owner'; has_org_role lo reconoce por owner_id) y sus
--         columnas ya las protege organizations_protect_columns. Ahora el rol
--         'owner' y cualquier fila cuyo usuario sea el dueño solo los asigna o
--         toca el propio dueño o un admin de plataforma (has_role 'admin'); los
--         admins siguen gestionando al resto del equipo (manager, rrpp,
--         door_staff…), igual que hasta ahora. Hacen falta las dos capas:
--           * invite_member (SECURITY DEFINER) lleva su propia comprobación,
--             también cuando el ON CONFLICT machacaría una fila 'owner'. Dentro
--             de una función DEFINER current_user es el dueño de la función, así
--             que el trigger no la vería.
--           * Trigger BEFORE INSERT OR UPDATE OR DELETE para las escrituras
--             directas (PostgREST: authenticated y anon), igual que
--             organizations_protect_columns: solo actúa con
--             current_user IN ('authenticated', 'anon'). Las funciones DEFINER
--             (accept_invitation, partner_close_account,
--             admin_close_partner_account), service_role y SQL directo no pasan
--             por él.
--         OJO: la función de trigger es SECURITY INVOKER a propósito. Si fuera
--         SECURITY DEFINER, current_user dentro valdría siempre el dueño de la
--         función (postgres) y la condición current_user IN ('authenticated',
--         'anon') no se cumpliría nunca: el trigger no bloquearía nada.
--         Solo toca el rol 'owner' y al dueño real: una fila 'owner' que no es
--         el dueño real (un co-dueño) cuenta como protegida, y quien la tiene
--         sin ser el dueño real no puede asignar 'owner' a otros. Queda como
--         estaba (decisión de producto, fuera de este fix mínimo): un admin
--         puede invitar a un usuario que ya tiene perfil y la fila nace activa
--         al instante, y puede cambiar el rol de otro admin.
--
--   9b · Plan gratuito. claim_partner_free_plan (la llama PartnerGate cada vez
--         que la suscripción no da acceso, vía complete_partner_signup) hacía
--         ON CONFLICT … DO UPDATE SET status = 'active': pisaba un plan en
--         pausa y, con la organización cerrada, devolvía «plan activado»
--         aunque no se pueda vender. Ahora:
--           * Organización 'closed' (la dejan así partner_close_account y
--             admin_close_partner_account): org_closed, SQLSTATE 55000.
--           * Un plan 'paused' no se toca (DO UPDATE … WHERE ps.status <>
--             'paused'); si el UPSERT no devuelve fila se lee la existente.
--           * Devuelve el plan y el estado reales (antes siempre 'free' y
--             'active'). Los consumidores (el asistente de alta y
--             start_partner_trial) solo usan out_org_id y out_subscription_id.
--         start_partner_trial(_org_id) sigue ignorando _org_id y delegando en
--         claim_partner_free_plan: queda como está (la versión actual de la app
--         ya no la llama; la firma se conserva por las ya publicadas). Hereda
--         el org_closed y el plan en pausa de claim_partner_free_plan.
--
--   9c · Funciones expuestas. event_has_sales y tier_has_sales (SECURITY
--         DEFINER, sin comprobar quién llama, con GRANT a authenticated)
--         dicen si un evento o un tipo de entrada tiene ventas, sea de quien
--         sea. No las llama nada de src/ y ninguna policy, vista, trigger,
--         valor por defecto ni función las usa (revisado en las migraciones y
--         en el catálogo de una base con todas aplicadas): fuera
--         authenticated. service_role y postgres las conservan.

-- ============================================================================
-- 9a) Equipo
-- ============================================================================

-- invite_member: la definición de 20260512211056 (única, nadie la ha vuelto a
-- tocar) más el control del dueño. Lo demás, tal cual.
CREATE OR REPLACE FUNCTION public.invite_member(
  _org_id UUID, _email TEXT, _role public.org_member_role_t,
  _venue_id UUID DEFAULT NULL, _brand_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_member_id UUID;
  v_existing_user UUID;
  v_owner UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_org_role(_org_id, ARRAY['owner','admin']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  SELECT id INTO v_existing_user FROM public.profiles WHERE email = _email LIMIT 1;

  -- El rol 'owner' y el dueño real de la organización (organizations.owner_id)
  -- solo los asigna o toca el propio dueño o un admin de plataforma. Cubre
  -- también al ON CONFLICT: re-invitar a quien ya es 'owner' le cambiaría el rol.
  SELECT o.owner_id INTO v_owner FROM public.organizations o WHERE o.id = _org_id;
  IF v_owner IS DISTINCT FROM v_uid AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    IF _role = 'owner'
       OR (v_owner IS NOT NULL AND v_existing_user IS NOT DISTINCT FROM v_owner)
       OR EXISTS (
         SELECT 1 FROM public.organization_members m
          WHERE m.org_id = _org_id AND m.email = _email
            AND (m.role = 'owner' OR (v_owner IS NOT NULL AND m.user_id IS NOT DISTINCT FROM v_owner))
       ) THEN
      RAISE EXCEPTION 'Solo el dueño de la organización o un admin de Pasify puede asignar el rol de dueño o cambiar al dueño'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.organization_members (org_id, user_id, email, role, venue_id, brand_id, invited_by, invitation_expires_at, status)
  VALUES (_org_id, v_existing_user, _email, _role, _venue_id, _brand_id, v_uid, now() + INTERVAL '14 days',
          CASE WHEN v_existing_user IS NOT NULL THEN 'active' ELSE 'pending' END)
  ON CONFLICT (org_id, email) DO UPDATE
    SET role = EXCLUDED.role, venue_id = EXCLUDED.venue_id, brand_id = EXCLUDED.brand_id,
        invited_by = EXCLUDED.invited_by, invitation_expires_at = EXCLUDED.invitation_expires_at,
        invitation_token = gen_random_uuid(), status = EXCLUDED.status, updated_at = now()
  RETURNING id INTO v_member_id;
  RETURN v_member_id;
END;
$$;

-- Escrituras directas sobre organization_members (PostgREST). Función de
-- trigger SECURITY INVOKER: ver la nota de la cabecera.
CREATE OR REPLACE FUNCTION public.org_members_guard_owner()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_owner_old UUID;
  v_owner_new UUID;
  v_toca_old  BOOLEAN := FALSE;
  v_toca_new  BOOLEAN := FALSE;
  v_permitido BOOLEAN;
BEGIN
  -- Solo la API: authenticated y anon. Las funciones DEFINER, service_role y
  -- SQL directo (migraciones, cron) no pasan por aquí.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- ¿La fila que había es un 'owner' o es el dueño real?
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT o.owner_id INTO v_owner_old FROM public.organizations o WHERE o.id = OLD.org_id;
    v_toca_old := OLD.role = 'owner'
      OR (v_owner_old IS NOT NULL AND OLD.user_id IS NOT DISTINCT FROM v_owner_old);
  END IF;
  -- ¿Y la que queda?
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT o.owner_id INTO v_owner_new FROM public.organizations o WHERE o.id = NEW.org_id;
    v_toca_new := NEW.role = 'owner'
      OR (v_owner_new IS NOT NULL AND NEW.user_id IS NOT DISTINCT FROM v_owner_new);
  END IF;

  IF v_toca_old OR v_toca_new THEN
    -- Permitido: el dueño real de la organización de cada lado, o un admin de
    -- plataforma. Todo lo que quede en NULL cuenta como no permitido.
    v_permitido := COALESCE(
      v_uid IS NOT NULL
      AND (NOT v_toca_old OR v_uid = v_owner_old)
      AND (NOT v_toca_new OR v_uid = v_owner_new),
      FALSE);
    IF NOT v_permitido AND v_uid IS NOT NULL THEN
      v_permitido := COALESCE(public.has_role(v_uid, 'admin'::public.app_role), FALSE);
    END IF;
    IF NOT v_permitido THEN
      RAISE EXCEPTION 'Solo el dueño de la organización o un admin de Pasify puede asignar el rol de dueño o cambiar al dueño'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.org_members_guard_owner() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.org_members_guard_owner() IS
  'Trigger de organization_members: el rol owner y la fila del dueño real (organizations.owner_id) solo los toca, desde la API, el propio dueño o un admin de plataforma. SECURITY INVOKER a propósito (con DEFINER, current_user nunca sería authenticated). invite_member lleva su propia comprobación.';

DROP TRIGGER IF EXISTS trg_org_members_guard_owner ON public.organization_members;
CREATE TRIGGER trg_org_members_guard_owner
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.org_members_guard_owner();

-- ============================================================================
-- 9b) Plan gratuito
-- ============================================================================
-- La definición de 20260923120100 (la última; 20260513230000 y la v1 de
-- 20260512211724 son anteriores) con tres cambios: org_closed, el plan en
-- pausa no se pisa y el resultado dice lo que hay de verdad.
CREATE OR REPLACE FUNCTION public.claim_partner_free_plan()
RETURNS TABLE (
  out_subscription_id  UUID,
  out_org_id           UUID,
  out_plan_code        TEXT,
  out_status           TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_org_id UUID;
  v_sub_id UUID;
  v_plan   TEXT;
  v_status TEXT;
  v_email  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_uid, 'partner'::public.app_role) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Solo las cuentas de local tienen plan' USING ERRCODE = '42501';
  END IF;

  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.owner_id = v_uid
  ORDER BY o.created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id
    FROM public.organization_members m
    WHERE m.user_id = v_uid AND m.status = 'active' AND m.role IN ('owner', 'admin')
    ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    v_org_id := public.create_organization(
      COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'Mi local'),
      'ES',
      NULL
    );
  END IF;

  -- Una organización cerrada (partner_close_account, admin_close_partner_account)
  -- no puede vender: no se «activa» un plan que no sirve.
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org_id AND o.status = 'closed') THEN
    RAISE EXCEPTION 'org_closed' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.partner_subscriptions AS ps (
    org_id, plan_code, status,
    current_period_start, current_period_end,
    trial_starts_at, trial_ends_at,
    metadata
  )
  VALUES (
    v_org_id, 'free', 'active'::public.partner_subscription_status_t,
    now(), NULL,
    NULL, NULL,
    jsonb_build_object('claimed_via', 'free_plan', 'claimed_at', now())
  )
  ON CONFLICT (org_id) DO UPDATE SET
    plan_code = CASE WHEN ps.status = 'active' THEN ps.plan_code ELSE 'free' END,
    status    = 'active'::public.partner_subscription_status_t,
    current_period_start = COALESCE(ps.current_period_start, now()),
    metadata  = ps.metadata || jsonb_build_object('reclaimed_at', now())
  WHERE ps.status <> 'paused'::public.partner_subscription_status_t
  RETURNING ps.id, ps.plan_code, ps.status::text INTO v_sub_id, v_plan, v_status;

  -- Un plan en pausa lo decide Pasify: el UPSERT lo deja como está y no
  -- devuelve fila. Se lee el que hay para contestar con su id y su estado.
  IF v_sub_id IS NULL THEN
    SELECT ps.id, ps.plan_code, ps.status::text INTO v_sub_id, v_plan, v_status
    FROM public.partner_subscriptions ps
    WHERE ps.org_id = v_org_id;
  END IF;

  RETURN QUERY SELECT v_sub_id, v_org_id, v_plan, v_status;
END;
$$;

COMMENT ON FUNCTION public.claim_partner_free_plan() IS
  'Plan gratuito de la organización de quien llama (la crea si no tiene): activo si faltaba, estaba cancelado, vencido… Un plan en pausa no se toca y una organización cerrada da 55000 org_closed. Devuelve id de suscripción, organización, plan y estado reales.';

-- ============================================================================
-- 9c) Funciones expuestas
-- ============================================================================
-- Sin llamadores: fuera authenticated (y PUBLIC y anon, por si acaso). El
-- servidor las conserva.
REVOKE EXECUTE ON FUNCTION public.event_has_sales(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tier_has_sales(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_has_sales(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.tier_has_sales(UUID) TO service_role;
