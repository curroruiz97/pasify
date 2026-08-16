-- Migration 20260521123440 · crm_contact_purchases
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

CREATE OR REPLACE FUNCTION public.crm_contact_purchases(p_org_id uuid, p_email text)
RETURNS TABLE (
  ticket_id uuid,
  event_title text,
  event_date timestamptz,
  amount_cents integer,
  status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_owner uuid;
BEGIN
  IF NOT public.has_org_role(p_org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'not authorized for org %', p_org_id;
  END IF;
  SELECT owner_id INTO v_owner FROM public.organizations WHERE id = p_org_id;

  RETURN QUERY
  SELECT t.id, e.title, e.date_start, t.amount_paid_cents, t.status::text, t.paid_at
  FROM public.tickets t
  JOIN public.events e ON e.id = t.event_id
  WHERE (e.org_id = p_org_id OR (v_owner IS NOT NULL AND e.partner_id = v_owner))
    AND lower(t.buyer_email) = lower(p_email)
  ORDER BY t.paid_at DESC NULLS LAST
  LIMIT 100;
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_contact_purchases(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_contact_purchases(uuid, text) TO authenticated;
