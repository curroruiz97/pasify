-- Pasify · 0030 fix security advisors
-- 1) Cambiar las 3 vistas a security_invoker (default Postgres 15+)
ALTER VIEW public.v_admin_platform_kpis SET (security_invoker = true);
ALTER VIEW public.v_event_revenue_summary SET (security_invoker = true);
ALTER VIEW public.v_partner_kpis_daily SET (security_invoker = true);

-- 2) Fix function_search_path_mutable en set_updated_at (la creada en 0001 sin SET search_path)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 3) Fix function_search_path_mutable en otras funciones triggers no protegidas
-- (audit_changes, seed_default_notification_prefs, update_support_conv_on_message, events_set_org_chain, tickets_update_counters, handle_new_user — ya tienen SET search_path, revisamos las que pueda faltar)
CREATE OR REPLACE FUNCTION public.update_support_conv_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.body, 120),
      unread_for_admin = CASE WHEN NEW.sender_kind = 'client' THEN unread_for_admin + 1 ELSE unread_for_admin END,
      unread_for_client = CASE WHEN NEW.sender_kind = 'admin' THEN unread_for_client + 1 ELSE unread_for_client END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tickets_update_counters()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'paid' THEN
      UPDATE public.events SET tickets_sold = tickets_sold + 1, updated_at = now() WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = sold + 1, updated_at = now() WHERE id = NEW.tier_id;
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'paid' AND NEW.status = 'paid' THEN
      UPDATE public.events SET tickets_sold = tickets_sold + 1, updated_at = now() WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = sold + 1, updated_at = now() WHERE id = NEW.tier_id;
      END IF;
    END IF;
    IF OLD.status = 'paid' AND NEW.status IN ('refunded','cancelled') THEN
      UPDATE public.events SET tickets_sold = GREATEST(0, tickets_sold - 1), updated_at = now() WHERE id = NEW.event_id;
      IF NEW.tier_id IS NOT NULL THEN
        UPDATE public.ticket_tiers SET sold = GREATEST(0, sold - 1), updated_at = now() WHERE id = NEW.tier_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.events_set_org_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand UUID;
  v_org UUID;
BEGIN
  IF NEW.venue_id IS NOT NULL AND (NEW.brand_id IS NULL OR NEW.org_id IS NULL) THEN
    SELECT brand_id, org_id INTO v_brand, v_org FROM public.venues WHERE id = NEW.venue_id;
    NEW.brand_id := COALESCE(NEW.brand_id, v_brand);
    NEW.org_id   := COALESCE(NEW.org_id, v_org);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Fix rls_policy_always_true: política con USING(true) — la convertimos a más restrictiva donde aplica.
-- partner_galleries_public_read tiene USING(true) intencional (público). En su lugar damos uno explícito.
DROP POLICY IF EXISTS "partner_galleries_public_read" ON public.partner_galleries;
CREATE POLICY "partner_galleries_public_read"
  ON public.partner_galleries FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.brands b WHERE b.id = partner_galleries.brand_id AND b.status = 'active')
  );
