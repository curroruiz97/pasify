-- Pasify · 0040 claim_partner_free_plan
-- Permite al partner activar el plan gratuito sin pasar por Stripe.
-- Crea org minima si no existe + UPSERT partner_subscriptions
-- con plan_code='free', status='active'. Idempotente.
--
-- Notas:
-- * Output columns con prefijo `out_` para evitar ambigüedad con las
--   columnas de partner_subscriptions (org_id/plan_code/status). Sin
--   este prefijo, el ON CONFLICT/DO UPDATE confunde la columna del
--   RETURNS TABLE con la columna real de la tabla.
-- * INSERT con alias `AS ps` para poder referenciar partner_subscriptions
--   en el UPDATE de forma inequívoca.
-- * Idempotente: re-aplicar la migración no rompe nada.

DROP FUNCTION IF EXISTS public.claim_partner_free_plan();

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
  v_email  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1) Localizar la org del partner (owner o miembro activo). Si no hay,
  --    crear una placeholder usando email/uid para que el onboarding
  --    posterior pueda renombrarla.
  SELECT o.id INTO v_org_id
  FROM public.organizations o
  WHERE o.owner_id = v_uid
  ORDER BY o.created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id
    FROM public.organization_members m
    WHERE m.user_id = v_uid AND m.status = 'active'
    ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    v_org_id := public.create_organization(
      COALESCE(split_part(v_email, '@', 1), 'Mi local'),
      'ES',
      NULL
    );
  END IF;

  -- 2) UPSERT partner_subscriptions a plan free + active.
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
    jsonb_build_object('claimed_via', 'free_plan_button', 'claimed_at', now())
  )
  ON CONFLICT (org_id) DO UPDATE SET
    plan_code = 'free',
    status    = 'active'::public.partner_subscription_status_t,
    current_period_start = COALESCE(ps.current_period_start, now()),
    metadata  = ps.metadata || jsonb_build_object('reclaimed_at', now())
  RETURNING ps.id INTO v_sub_id;

  RETURN QUERY SELECT v_sub_id, v_org_id, 'free'::TEXT, 'active'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_partner_free_plan() TO authenticated;
