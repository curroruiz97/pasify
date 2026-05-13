-- Pasify · 0033 start_partner_trial v2
-- La versión 0015 devolvía sólo UUID (subscription_id). Los consumers
-- (PartnerChoosePlan.tsx) ya intentaban parsear el resultado como fecha,
-- lo que rompía silenciosamente. Esta migration lo refactoriza para
-- devolver un TABLE con la información completa que el frontend necesita.

DROP FUNCTION IF EXISTS public.start_partner_trial(UUID);

CREATE OR REPLACE FUNCTION public.start_partner_trial(_org_id UUID DEFAULT NULL)
RETURNS TABLE (
  subscription_id UUID,
  org_id UUID,
  plan_id UUID,
  plan_code TEXT,
  status TEXT,
  trial_starts_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org_id UUID := _org_id;
  v_plan_starter public.subscription_plans%ROWTYPE;
  v_trial_days INT;
  v_sub_id UUID;
  v_now TIMESTAMPTZ := now();
  v_trial_end TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Si no se pasa org_id, resolver desde owner_id
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM public.organizations
      WHERE owner_id = v_uid LIMIT 1;
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No organization for user' USING ERRCODE = '02000';
    END IF;
  END IF;

  -- Autorización: sólo owner o admin/manager pueden iniciar trial
  IF NOT public.has_org_role(
    v_org_id,
    ARRAY['owner','admin']::public.org_member_role_t[]
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  -- Trial deshabilitado por app_settings
  IF NOT public.get_app_setting_bool('partner_trial_enabled') THEN
    RAISE EXCEPTION 'Trial disabled' USING ERRCODE = '57014';
  END IF;

  v_trial_days := COALESCE(public.get_app_setting_int('partner_trial_days'), 14);
  v_trial_end := v_now + (v_trial_days || ' days')::interval;

  SELECT * INTO v_plan_starter
    FROM public.subscription_plans WHERE code = 'starter' LIMIT 1;

  -- Upsert: si la org ya tiene partner_subscriptions, lo "rehabilitamos"
  -- a trialing sólo si estaba cancelled; si está activo, no tocamos
  INSERT INTO public.partner_subscriptions (
    org_id, plan_id, plan_code, status, billing_interval,
    trial_starts_at, trial_ends_at,
    current_period_start, current_period_end
  )
  VALUES (
    v_org_id, v_plan_starter.id, v_plan_starter.code,
    'trialing'::public.partner_subscription_status_t, 'monthly',
    v_now, v_trial_end, v_now, v_trial_end
  )
  ON CONFLICT (org_id) DO UPDATE
    SET status = CASE
          WHEN partner_subscriptions.status = 'cancelled'
            THEN 'trialing'::public.partner_subscription_status_t
          ELSE partner_subscriptions.status
        END,
        updated_at = v_now
  RETURNING id INTO v_sub_id;

  -- Devolver fila completa
  RETURN QUERY
    SELECT ps.id, ps.org_id, ps.plan_id, ps.plan_code,
           ps.status::text, ps.trial_starts_at, ps.trial_ends_at,
           ps.current_period_start, ps.current_period_end
    FROM public.partner_subscriptions ps
    WHERE ps.id = v_sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_partner_trial(UUID) TO authenticated;
