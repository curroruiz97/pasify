-- Pasify · 0034 partner_subscriptions admin grant
-- Permite a admin extender el acceso de un partner sin tarjeta (override
-- temporal). Las columnas se añaden a partner_subscriptions; nunca a
-- profiles. El frontend lee `admin_granted_until > now()` para conceder
-- acceso fuera de los caminos trial/active.
--
-- Contexto: el código actual ya intenta leer `granted_by_admin` /
-- `admin_granted_until` desde partner_subscriptions pero esas columnas
-- nunca existieron en migrations Pasify (sólo en la rama mental
-- StudentsLife). Resultado: la columna no existía → todos los hooks
-- rompían silenciosamente y devolvían hasAccess=false.

ALTER TABLE public.partner_subscriptions
  ADD COLUMN IF NOT EXISTS admin_granted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_grant_note TEXT;

CREATE INDEX IF NOT EXISTS idx_partner_subs_admin_grant
  ON public.partner_subscriptions(admin_granted_until)
  WHERE admin_granted_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partner_subs_admin_granted_by
  ON public.partner_subscriptions(admin_granted_by)
  WHERE admin_granted_by IS NOT NULL;

-- RPC para conceder acceso por admin (única superficie autorizada para
-- escribir admin_granted_*). Sólo plataforma admin puede usarla.
CREATE OR REPLACE FUNCTION public.admin_grant_partner_access_until(
  _org_id UUID,
  _until TIMESTAMPTZ,
  _note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sub_id UUID;
  v_plan_starter public.subscription_plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _until IS NOT NULL AND _until < now() THEN
    RAISE EXCEPTION 'admin_granted_until must be in the future' USING ERRCODE = '22023';
  END IF;

  -- Upsert: si no existe partner_subscriptions, lo creamos con plan starter
  -- y status 'trialing' (el grant actúa como trial admin-extendido).
  SELECT * INTO v_plan_starter FROM public.subscription_plans WHERE code = 'starter' LIMIT 1;

  INSERT INTO public.partner_subscriptions (
    org_id, plan_id, plan_code, status, billing_interval,
    admin_granted_until, admin_granted_by, admin_grant_note
  )
  VALUES (
    _org_id, v_plan_starter.id, v_plan_starter.code,
    'trialing'::public.partner_subscription_status_t, 'monthly',
    _until, v_uid, _note
  )
  ON CONFLICT (org_id) DO UPDATE SET
    admin_granted_until = EXCLUDED.admin_granted_until,
    admin_granted_by    = EXCLUDED.admin_granted_by,
    admin_grant_note    = EXCLUDED.admin_grant_note,
    updated_at          = now()
  RETURNING id INTO v_sub_id;

  RETURN v_sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_grant_partner_access_until(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- RPC para revocar el grant (drop admin_granted_*).
CREATE OR REPLACE FUNCTION public.admin_revoke_partner_grant(_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.partner_subscriptions
    SET admin_granted_until = NULL,
        admin_granted_by    = NULL,
        admin_grant_note    = NULL,
        updated_at          = now()
    WHERE org_id = _org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_partner_grant(UUID) TO authenticated;
