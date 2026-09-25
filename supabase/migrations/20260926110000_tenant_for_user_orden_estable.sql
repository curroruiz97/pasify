-- Pasify · tenant_for_user con un orden estable (Ola 1 · Servidor)
--
-- Con dos organizaciones (p. ej. una segunda creada sin querer desde Ayuda,
-- ver PartnerOnboardingWizard) la función elegía entre ellas sin orden fijo:
-- ORDER BY (role = 'owner') DESC, (role = 'admin') DESC dejaba empates y el
-- panel podía abrir una organización distinta en cada carga. Ahora elige:
--   1. la organización propia (organizations.owner_id) antes que aquellas en
--      las que solo se es miembro;
--   2. dentro de cada grupo, la más antigua (organizations.created_at);
--   3. el id como último desempate.
-- partner_onboarding_status también se queda con la propia más antigua: el
-- asistente de alta y el panel hablan de la misma organización.
--
-- El local activo (profiles.last_active_venue_id) solo cuenta si es de la
-- organización elegida. create_organization lo mueve al local de la última
-- organización creada, y con dos organizaciones se devolvía la A con un
-- local de la B. La marca es la de ese local. Sin local activo válido, el
-- primer local de la primera marca, también con desempates fijos.

CREATE OR REPLACE FUNCTION public.tenant_for_user()
RETURNS TABLE (org_id UUID, org_name TEXT, brand_id UUID, brand_name TEXT, venue_id UUID, venue_name TEXT, role public.org_member_role_t)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH membership AS (
    SELECT o.id AS org_id, o.name AS org_name, 'owner'::public.org_member_role_t AS role,
           TRUE AS own, o.created_at AS org_created_at
    FROM public.organizations o
    WHERE o.owner_id = auth.uid()
    UNION ALL
    SELECT o.id, o.name, om.role, FALSE, o.created_at
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.org_id
    WHERE om.user_id = auth.uid()
      AND om.status = 'active'
      AND o.owner_id IS DISTINCT FROM auth.uid()
  ),
  primary_membership AS (
    SELECT m.org_id, m.org_name, m.role
    FROM membership m
    ORDER BY m.own DESC, m.org_created_at ASC, m.org_id ASC
    LIMIT 1
  ),
  active_venue AS (
    SELECT v.id, v.name, v.brand_id
    FROM public.profiles p
    JOIN public.venues v ON v.id = p.last_active_venue_id
    JOIN primary_membership pm ON pm.org_id = v.org_id
    WHERE p.id = auth.uid()
  )
  SELECT pm.org_id,
         pm.org_name,
         COALESCE(ab.id, b.id),
         COALESCE(ab.name, b.name),
         COALESCE(av.id, v.id),
         COALESCE(av.name, v.name),
         pm.role
  FROM primary_membership pm
  LEFT JOIN active_venue av ON TRUE
  LEFT JOIN public.brands ab ON ab.id = av.brand_id
  LEFT JOIN public.brands b ON b.org_id = pm.org_id
  LEFT JOIN public.venues v ON v.brand_id = b.id
  ORDER BY b.sort_order ASC, b.created_at ASC, b.id ASC, v.created_at ASC, v.id ASC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_for_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_for_user() TO authenticated, service_role;
