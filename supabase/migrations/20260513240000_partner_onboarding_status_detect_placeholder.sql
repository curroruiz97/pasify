-- Pasify · 0041 partner_onboarding_status: detectar venue placeholder
--
-- Antes: `should_show_wizard` era false si HAS org + venue (cualquiera).
-- Problema: `claim_partner_free_plan` crea una org+venue placeholder
-- (org name = email-slug, venue name = 'Principal', sin direccion, sin
-- categoria) para satisfacer al PartnerGate. Con la lógica vieja, eso
-- bastaba para esconder el wizard, dejando al partner sin oportunidad
-- de rellenar sus datos reales.
--
-- Ahora: distinguimos venue placeholder (nombre 'Principal' + sin
-- direccion + sin business_category) de venue real (con datos
-- introducidos por el partner). El wizard se abre si:
--   - No esta marcado completed/skipped explicitamente Y
--   - No hay org / no hay venue REAL
--
-- Para users que YA tienen venue real (Francisco con Avenue Media,
-- partners migrados) no abrimos el wizard aunque no haya fila en
-- partner_onboarding_state — su realidad operativa lo dice.

CREATE OR REPLACE FUNCTION public.partner_onboarding_status()
RETURNS TABLE (
  user_id              UUID,
  has_org              BOOLEAN,
  has_venue            BOOLEAN,
  has_event            BOOLEAN,
  onboarding_status    TEXT,
  completed_at         TIMESTAMPTZ,
  primary_org_id       UUID,
  primary_venue_id     UUID,
  should_show_wizard   BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_venue UUID;
  v_has_org BOOLEAN := FALSE;
  v_has_venue BOOLEAN := FALSE;
  v_has_real_venue BOOLEAN := FALSE;
  v_has_event BOOLEAN := FALSE;
  v_status TEXT;
  v_completed TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT o.id INTO v_org FROM public.organizations o WHERE o.owner_id = v_uid ORDER BY o.created_at ASC LIMIT 1;
  IF v_org IS NULL THEN
    SELECT m.org_id INTO v_org FROM public.organization_members m
    WHERE m.user_id = v_uid AND m.status = 'active' ORDER BY m.created_at ASC LIMIT 1;
  END IF;
  v_has_org := v_org IS NOT NULL;

  IF v_has_org THEN
    -- Primary venue (cualquiera, incluso placeholder)
    SELECT v.id INTO v_venue FROM public.venues v
    WHERE v.org_id = v_org AND v.status = 'active' ORDER BY v.created_at ASC LIMIT 1;
    v_has_venue := v_venue IS NOT NULL;

    -- Venue real: tiene direccion O categoria O nombre distinto al placeholder
    SELECT EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.org_id = v_org AND v.status = 'active'
        AND (
          (v.address IS NOT NULL AND TRIM(v.address) <> '')
          OR (v.business_category IS NOT NULL AND TRIM(v.business_category) <> '')
          OR (v.name IS NOT NULL AND v.name <> 'Principal')
        )
    ) INTO v_has_real_venue;
  END IF;

  IF v_has_org THEN
    SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.org_id = v_org OR e.partner_id = v_uid LIMIT 1) INTO v_has_event;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.partner_id = v_uid LIMIT 1) INTO v_has_event;
  END IF;

  SELECT s.status, s.completed_at INTO v_status, v_completed
  FROM public.partner_onboarding_state s
  WHERE s.user_id = v_uid
    AND ((s.org_id IS NOT NULL AND s.org_id = v_org) OR (s.org_id IS NULL AND v_org IS NULL))
  ORDER BY s.created_at DESC LIMIT 1;

  IF v_status IS NULL THEN v_status := 'in_progress'; END IF;

  RETURN QUERY SELECT v_uid, v_has_org, v_has_venue, v_has_event, v_status, v_completed, v_org, v_venue,
    (v_status NOT IN ('completed','skipped') AND NOT (v_has_org AND v_has_real_venue));
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_onboarding_status() TO authenticated;
