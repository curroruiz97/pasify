-- Migration 20260522062956 · team_shifts_and_marketing_automations
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

-- Backend para Turnos/Nómina (team_shifts) y Automatizaciones (marketing_automations).
-- Org-scoped, RLS vía has_org_role (owner/admin/manager).

DO $$ BEGIN
  CREATE TYPE public.team_shift_status AS ENUM ('scheduled','completed','settled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketing_automation_status AS ENUM ('active','paused','draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.team_shifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_user_id  uuid,
  member_name     text NOT NULL,
  role            text,
  venue_id        uuid,
  starts_at       timestamptz NOT NULL,
  hours           numeric(5,2) NOT NULL DEFAULT 0,
  hourly_cents    integer NOT NULL DEFAULT 0,
  status          public.team_shift_status NOT NULL DEFAULT 'scheduled',
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_shifts_org_idx ON public.team_shifts (org_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS public.marketing_automations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  trigger     text NOT NULL,
  action      text NOT NULL,
  channel     text,
  status      public.marketing_automation_status NOT NULL DEFAULT 'active',
  runs_count  integer NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_automations_org_idx ON public.marketing_automations (org_id, created_at DESC);

CREATE TRIGGER trg_team_shifts_updated_at BEFORE UPDATE ON public.team_shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_marketing_automations_updated_at BEFORE UPDATE ON public.marketing_automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.team_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_shifts_member_all" ON public.team_shifts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "marketing_automations_member_all" ON public.marketing_automations FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
