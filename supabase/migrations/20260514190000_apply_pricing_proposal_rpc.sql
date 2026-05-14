-- Pasify · 0051 RPC apply_pricing_proposal
--
-- Aplicar una pricing proposal pending: actualiza el precio del tier
-- y marca la proposal como applied. Atómico, valida ownership.
--
-- Antes este flujo estaba en frontend (PartnerDynamicPricing.tsx era
-- mock puro). Ahora el partner aprueba desde la UI → llamada a esta
-- RPC → BD coherente. La policy de UPDATE en pricing_proposals
-- (mig 0021) ya permite al partner/org member modificar; este wrapper
-- añade atomicidad al cambio doble (proposal + tier).
--
-- Idempotente: re-aplicar sobre una proposal ya en estado != pending
-- devuelve error con mensaje claro, no corrompe estado.

CREATE OR REPLACE FUNCTION public.apply_pricing_proposal(_proposal_id UUID)
RETURNS TABLE (
  proposal_id UUID,
  tier_id UUID,
  new_price_cents INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_proposal RECORD;
  v_event RECORD;
  v_authorized BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_proposal
  FROM public.pricing_proposals
  WHERE id = _proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending (status: %)', v_proposal.status;
  END IF;

  IF v_proposal.tier_id IS NULL THEN
    RAISE EXCEPTION 'Proposal has no associated tier';
  END IF;

  -- Verificar autorización vía evento.partner_id O org member
  SELECT e.id, e.partner_id, e.org_id INTO v_event
  FROM public.events e
  WHERE e.id = v_proposal.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked event not found';
  END IF;

  v_authorized :=
    v_event.partner_id = v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin');

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to apply this proposal';
  END IF;

  -- Actualizar tier
  UPDATE public.ticket_tiers
  SET price_cents = v_proposal.suggested_price_cents,
      updated_at = now()
  WHERE id = v_proposal.tier_id;

  -- Marcar proposal applied
  UPDATE public.pricing_proposals
  SET status = 'applied',
      decided_by = v_uid,
      decided_at = now(),
      applied_at = now()
  WHERE id = _proposal_id;

  -- Marcar otras proposals pending del mismo tier como superseded
  -- (evita aplicar dos a la vez).
  UPDATE public.pricing_proposals
  SET status = 'superseded',
      decided_by = v_uid,
      decided_at = now()
  WHERE tier_id = v_proposal.tier_id
    AND status = 'pending'
    AND id <> _proposal_id;

  RETURN QUERY SELECT v_proposal.id, v_proposal.tier_id, v_proposal.suggested_price_cents;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pricing_proposal(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_pricing_proposal(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_pricing_proposal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_proposal(UUID) TO service_role;
