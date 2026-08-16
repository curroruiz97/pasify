-- Migration 20260522082234 · team_members
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

CREATE TABLE IF NOT EXISTS public.team_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  first_name     text NOT NULL,
  last_name      text,
  email          text,
  phone          text,
  role           text,
  contract_type  text,
  hourly_cents   integer NOT NULL DEFAULT 0,
  national_id    text,
  start_date     date,
  notes          text,
  status         text NOT NULL DEFAULT 'active',
  avatar_color   text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_members_org_idx ON public.team_members (org_id, status);

ALTER TABLE public.team_shifts
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE TRIGGER trg_team_members_updated_at BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_members_member_all" ON public.team_members FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
