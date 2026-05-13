-- Pasify · 0012 organization_members + sub-roles + RLS

CREATE TYPE public.org_member_role_t AS ENUM (
  'owner','admin','manager','rrpp','door_staff','pos_staff','read_only'
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.org_member_role_t NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','removed')),
  venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invitation_token UUID UNIQUE DEFAULT gen_random_uuid(),
  invitation_expires_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_members_email ON public.organization_members(email);
CREATE INDEX IF NOT EXISTS idx_org_members_invitation_token ON public.organization_members(invitation_token);
CREATE INDEX IF NOT EXISTS idx_org_members_status ON public.organization_members(status);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_org_members_updated_at BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_member_of_org(_org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = auth.uid() AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organizations WHERE id = _org_id AND owner_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_member_of_org(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id UUID, _roles public.org_member_role_t[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = _org_id AND user_id = auth.uid() AND status = 'active' AND role = ANY(_roles)
  ) OR EXISTS (
    SELECT 1 FROM public.organizations WHERE id = _org_id AND owner_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_org_role(UUID, public.org_member_role_t[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_member_of_venue(_venue_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.venues v
    LEFT JOIN public.organization_members om ON om.org_id = v.org_id AND om.user_id = auth.uid() AND om.status = 'active'
    LEFT JOIN public.organizations o ON o.id = v.org_id
    WHERE v.id = _venue_id
      AND (
        o.owner_id = auth.uid()
        OR (om.id IS NOT NULL AND (om.venue_id IS NULL OR om.venue_id = _venue_id))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_member_of_venue(UUID) TO authenticated;

CREATE POLICY "org_members_self_read" ON public.organization_members FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "org_members_org_read" ON public.organization_members FOR SELECT TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "org_members_owner_admin_write" ON public.organization_members FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[]));
CREATE POLICY "org_members_platform_admin_all" ON public.organization_members FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Reforzar policies con membership
CREATE POLICY "organizations_member_read" ON public.organizations FOR SELECT TO authenticated USING (public.is_member_of_org(id));
CREATE POLICY "brands_member_read" ON public.brands FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "brands_member_write" ON public.brands FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "venues_member_read" ON public.venues FOR SELECT TO authenticated USING (public.is_member_of_org(org_id));
CREATE POLICY "venues_member_write" ON public.venues FOR ALL TO authenticated USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])) WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

-- Reemplazar policies tickets/events con membership-aware
DROP POLICY IF EXISTS "events_partner_read_own" ON public.events;
DROP POLICY IF EXISTS "events_partner_insert_own" ON public.events;
DROP POLICY IF EXISTS "events_partner_update_own" ON public.events;
DROP POLICY IF EXISTS "events_partner_delete_own" ON public.events;

CREATE POLICY "events_member_read" ON public.events FOR SELECT TO authenticated USING (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.is_member_of_org(org_id)));
CREATE POLICY "events_member_insert" ON public.events FOR INSERT TO authenticated WITH CHECK (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[])));
CREATE POLICY "events_member_update" ON public.events FOR UPDATE TO authenticated USING (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))) WITH CHECK (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));
CREATE POLICY "events_member_delete" ON public.events FOR DELETE TO authenticated USING (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])));

DROP POLICY IF EXISTS "tickets_partner_read_own_events" ON public.tickets;
DROP POLICY IF EXISTS "tickets_partner_mark_used" ON public.tickets;

CREATE POLICY "tickets_member_read" ON public.tickets FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.is_member_of_org(e.org_id)))));
CREATE POLICY "tickets_door_staff_update" ON public.tickets FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[]))))) WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = auth.uid() OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])))));

-- RPCs
CREATE OR REPLACE FUNCTION public.invite_member(
  _org_id UUID, _email TEXT, _role public.org_member_role_t,
  _venue_id UUID DEFAULT NULL, _brand_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_member_id UUID;
  v_existing_user UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_org_role(_org_id, ARRAY['owner','admin']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  SELECT id INTO v_existing_user FROM public.profiles WHERE email = _email LIMIT 1;
  INSERT INTO public.organization_members (org_id, user_id, email, role, venue_id, brand_id, invited_by, invitation_expires_at, status)
  VALUES (_org_id, v_existing_user, _email, _role, _venue_id, _brand_id, v_uid, now() + INTERVAL '14 days',
          CASE WHEN v_existing_user IS NOT NULL THEN 'active' ELSE 'pending' END)
  ON CONFLICT (org_id, email) DO UPDATE
    SET role = EXCLUDED.role, venue_id = EXCLUDED.venue_id, brand_id = EXCLUDED.brand_id,
        invited_by = EXCLUDED.invited_by, invitation_expires_at = EXCLUDED.invitation_expires_at,
        invitation_token = gen_random_uuid(), status = EXCLUDED.status, updated_at = now()
  RETURNING id INTO v_member_id;
  RETURN v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_member(UUID, TEXT, public.org_member_role_t, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation(_token UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_member_row public.organization_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  SELECT * INTO v_member_row FROM public.organization_members
    WHERE invitation_token = _token AND status = 'pending'
      AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
      AND lower(email) = lower(v_email)
    LIMIT 1;
  IF v_member_row.id IS NULL THEN RAISE EXCEPTION 'Invalid or expired invitation'; END IF;
  UPDATE public.organization_members SET user_id = v_uid, status = 'active', accepted_at = now() WHERE id = v_member_row.id;
  RETURN v_member_row.org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_invitation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.switch_active_venue(_venue_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venues v
    JOIN public.organizations o ON o.id = v.org_id
    WHERE v.id = _venue_id
      AND (o.owner_id = v_uid OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.org_id = v.org_id AND om.user_id = v_uid AND om.status = 'active'
      ))
  ) THEN RAISE EXCEPTION 'No access to this venue'; END IF;
  UPDATE public.profiles SET last_active_venue_id = _venue_id WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_active_venue(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_for_user()
RETURNS TABLE (org_id UUID, org_name TEXT, brand_id UUID, brand_name TEXT, venue_id UUID, venue_name TEXT, role public.org_member_role_t)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ctx AS (
    SELECT p.id AS user_id, p.last_active_venue_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1
  ),
  membership AS (
    SELECT o.id AS org_id, o.name AS org_name, 'owner'::public.org_member_role_t AS role
    FROM public.organizations o WHERE o.owner_id = auth.uid()
    UNION
    SELECT om.org_id, o.name, om.role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.org_id
    WHERE om.user_id = auth.uid() AND om.status = 'active'
  ),
  primary_membership AS (
    SELECT * FROM membership ORDER BY (role = 'owner') DESC, (role = 'admin') DESC LIMIT 1
  )
  SELECT pm.org_id, pm.org_name, b.id, b.name,
         COALESCE(c.last_active_venue_id, v.id),
         COALESCE(av.name, v.name),
         pm.role
  FROM primary_membership pm
  LEFT JOIN public.brands b ON b.org_id = pm.org_id
  LEFT JOIN public.venues v ON v.brand_id = b.id
  LEFT JOIN ctx c ON true
  LEFT JOIN public.venues av ON av.id = c.last_active_venue_id
  ORDER BY b.sort_order, v.created_at
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_for_user() TO authenticated;
