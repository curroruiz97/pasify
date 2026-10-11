-- Pasify · Ola 4 · propuestas de precio de la IA (WP10)
--
-- «Generar ahora» (ai-pricing-propose) dejaba una propuesta `pending` nueva por
-- tipo de entrada en cada pasada, y apply_pricing_proposal aceptaba cualquier
-- precio sugerido mayor o igual que 0 (de 1 a 49 c solo lo frenaba el trigger
-- de ticket_tiers, trg_ticket_tiers_guard_min_price de 20260926150000, con un
-- mensaje que no habla de la propuesta).
--
-- 1) Las propuestas `pending` repetidas de un mismo tipo pasan a `superseded`
--    (el estado que apply_pricing_proposal ya usa para «sustituida por otra»),
--    conservando la más reciente de cada tipo. Las que no tienen tipo
--    (tier_id NULL) no se tocan. decided_by queda vacío: no las decidió nadie.
-- 2) Índice único parcial: como mucho una `pending` por tipo. Va después del
--    paso 1; con duplicados, crearlo fallaría. La edge function cierra antes
--    (`expired`) las caducadas que siguen `pending`, para que no impidan
--    proponer otra, y salta el tipo si ya tiene una vigente.
-- 3) apply_pricing_proposal rechaza un precio sugerido de 1 a 49 c con un
--    mensaje claro (SQLSTATE 23514, el mismo del trigger). 0 € sigue valiendo.
--    Mismo cuerpo, firma y permisos que la de 20260923120100; solo se añade
--    esa comprobación (CREATE OR REPLACE conserva los permisos).
--
-- Se puede volver a aplicar: el paso 1 no encuentra nada que cambiar, el
-- índice se crea una sola vez y la función se reemplaza por sí misma.

-- ============================================================================
-- 1) Duplicadas: se queda la más reciente de cada tipo
-- ============================================================================
UPDATE public.pricing_proposals p
   SET status = 'superseded',
       decided_at = now()
  FROM (
    SELECT id,
           row_number() OVER (PARTITION BY tier_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.pricing_proposals
     WHERE status = 'pending'
       AND tier_id IS NOT NULL
  ) d
 WHERE p.id = d.id
   AND d.rn > 1;

-- ============================================================================
-- 2) Una sola propuesta pendiente por tipo
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS pricing_proposals_one_pending_per_tier
  ON public.pricing_proposals (tier_id)
  WHERE status = 'pending';

-- ============================================================================
-- 3) apply_pricing_proposal: nada entre 1 y 49 c
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_pricing_proposal(_proposal_id UUID)
RETURNS TABLE (proposal_id UUID, tier_id UUID, new_price_cents INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_proposal public.pricing_proposals%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_updated INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_proposal FROM public.pricing_proposals p WHERE p.id = _proposal_id FOR UPDATE;
  IF v_proposal.id IS NULL THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Proposal is not pending (status: %)', v_proposal.status;
  END IF;
  IF v_proposal.expires_at IS NOT NULL AND v_proposal.expires_at < now() THEN
    UPDATE public.pricing_proposals p SET status = 'expired' WHERE p.id = _proposal_id;
    RAISE EXCEPTION 'Proposal expired';
  END IF;
  IF v_proposal.tier_id IS NULL THEN RAISE EXCEPTION 'Proposal has no associated tier'; END IF;
  IF v_proposal.suggested_price_cents IS NULL OR v_proposal.suggested_price_cents < 0 THEN
    RAISE EXCEPTION 'Invalid suggested price';
  END IF;
  -- Stripe no cobra menos de 0,50 €: un precio de 1 a 49 c no se podría vender.
  -- (0 € sigue valiendo: tipos gratuitos.) Se rechaza antes de tocar nada; el
  -- trigger de ticket_tiers lo frenaría igual, pero con un mensaje que no habla
  -- de la propuesta.
  IF v_proposal.suggested_price_cents BETWEEN 1 AND 49 THEN
    RAISE EXCEPTION 'El precio sugerido (% €) está por debajo del mínimo de 0,50 € que admite el pago con tarjeta. Rechaza la propuesta.',
      replace(to_char(v_proposal.suggested_price_cents / 100.0, 'FM990.00'), '.', ',')
      USING ERRCODE = '23514', HINT = 'Stripe no admite cobros de menos de 0,50 €.';
  END IF;

  SELECT * INTO v_event FROM public.events e WHERE e.id = v_proposal.event_id;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'Linked event not found'; END IF;
  IF NOT (
    v_event.partner_id IS NOT DISTINCT FROM v_uid
    OR (v_event.org_id IS NOT NULL
        AND public.has_org_role(v_event.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
    OR public.has_role(v_uid, 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized to apply this proposal';
  END IF;

  UPDATE public.ticket_tiers t
     SET price_cents = v_proposal.suggested_price_cents, updated_at = now()
   WHERE t.id = v_proposal.tier_id
     AND t.event_id = v_proposal.event_id
     AND (v_proposal.current_price_cents IS NULL OR t.price_cents = v_proposal.current_price_cents);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'El tipo de entrada no es de este evento o su precio ha cambiado desde la propuesta';
  END IF;

  UPDATE public.pricing_proposals p
     SET status = 'applied', decided_by = v_uid, decided_at = now(), applied_at = now()
   WHERE p.id = _proposal_id;
  UPDATE public.pricing_proposals p
     SET status = 'superseded', decided_by = v_uid, decided_at = now()
   WHERE p.tier_id = v_proposal.tier_id AND p.status = 'pending' AND p.id <> _proposal_id;

  RETURN QUERY SELECT v_proposal.id, v_proposal.tier_id, v_proposal.suggested_price_cents;
END;
$$;
