-- Pasify · 0032 super_admin + role hardening
-- Convierte el "multi-rol abierto" actual en un modo super-admin/dev exclusivo
-- para Francisco, validado en SQL (no sólo UI). Endurece user_roles para que
-- ningún usuario normal pueda acumular roles ni escalar privilegios.

-- ============================================================================
-- 1) is_super_admin: fuente única de verdad. Frontend espeja, pero el gate
-- definitivo es backend (SECURITY DEFINER + SET search_path = public).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND lower(p.email) IN ('francisco@avenuemedia.io')
      AND public.has_role(_user_id, 'admin'::public.app_role)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, anon;

-- Helper sin parámetro: resuelve para el caller. Útil en RLS si queremos.
CREATE OR REPLACE FUNCTION public.is_super_admin_self()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin((SELECT auth.uid()));
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin_self() TO authenticated;

-- ============================================================================
-- 2) Endurecer user_roles_self_insert: sólo permite reclamar UN rol y sólo
-- si el usuario NO tiene rol previo. Esto bloquea la escalada client→partner
-- y la acumulación silenciosa de roles que activaba el PanelSwitcher.
--
-- Nota: la política previa creada en 20260512210718 y reescrita por
-- 20260512213708 permitía role IN ('client','partner') sin chequear si ya
-- existía otro rol del usuario — riesgo confirmado.
-- ============================================================================
DROP POLICY IF EXISTS "user_roles_self_insert" ON public.user_roles;

CREATE POLICY "user_roles_self_insert"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role IN ('client', 'partner')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- 3) RPC pública claim_initial_role: único camino legítimo para que un
-- usuario nuevo reclame su rol inicial (client o partner). Idempotente,
-- atómica, y aplica el side-effect de auto-approve para client.
--
-- RegisterClient/RegisterPartner deberían usar esta RPC en vez de un INSERT
-- directo (Fase 2). El INSERT directo sigue disponible vía la policy de §2
-- como compatibilidad, pero el camino canónico es esta RPC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_initial_role(_role TEXT)
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF _role NOT IN ('client', 'partner') THEN
    RAISE EXCEPTION 'Role not claimable: %', _role USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'User already has a role assigned' USING ERRCODE = '23505';
  END IF;

  v_role := _role::public.app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, v_role);

  -- Auto-approve para client (el flujo partner lo deja en 'approved'
  -- explícitamente desde RegisterPartner.tsx para auditoría).
  IF v_role = 'client' THEN
    UPDATE public.profiles SET account_status = 'approved' WHERE id = v_uid;
  END IF;

  RETURN v_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_initial_role(TEXT) TO authenticated;

-- ============================================================================
-- 4) Audit trail: cualquier cambio en user_roles queda registrado en
-- audit_logs (tabla existente en migración 20260512212525). Esto permite
-- detectar intentos de escalada (tabla principal de la alerta
-- unauthorized_role_escalation_attempt que añadiremos en Fase 5).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.audit_user_roles_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role TEXT;
BEGIN
  SELECT role::text INTO v_actor_role
  FROM public.user_roles
  WHERE user_id = v_actor
  LIMIT 1;

  INSERT INTO public.audit_logs (
    actor_user_id, actor_role, action, target_kind, target_id, before, after
  )
  VALUES (
    v_actor,
    COALESCE(v_actor_role, 'anon'),
    TG_OP || '_user_roles',
    'user_roles',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles_change();
