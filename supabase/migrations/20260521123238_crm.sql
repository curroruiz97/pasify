-- Migration 20260521123238 · crm
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

-- CRM (B2C) para Partner/Local · F0 schema + F1 sync RPC

DO $$ BEGIN
  CREATE TYPE public.crm_contact_source AS ENUM ('purchase', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_lifecycle AS ENUM ('lead', 'customer', 'vip', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_activity_type AS ENUM
    ('purchase', 'refund', 'note', 'email', 'call', 'meeting', 'tag', 'campaign', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            uuid,
  email              text NOT NULL,
  first_name         text,
  last_name          text,
  phone              text,
  city               text,
  avatar_url         text,
  source             public.crm_contact_source NOT NULL DEFAULT 'purchase',
  lifecycle_stage    public.crm_lifecycle NOT NULL DEFAULT 'customer',
  marketing_opt_in   boolean NOT NULL DEFAULT false,
  sms_opt_in         boolean NOT NULL DEFAULT false,
  orders_count       integer NOT NULL DEFAULT 0,
  events_count       integer NOT NULL DEFAULT 0,
  total_spent_cents  bigint  NOT NULL DEFAULT 0,
  first_purchase_at  timestamptz,
  last_purchase_at   timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_org_email_uq ON public.crm_contacts (org_id, lower(email));
CREATE INDEX IF NOT EXISTS crm_contacts_org_idx ON public.crm_contacts (org_id);
CREATE INDEX IF NOT EXISTS crm_contacts_org_last_purchase_idx ON public.crm_contacts (org_id, last_purchase_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#E8542A',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_tags_org_name_uq ON public.crm_tags (org_id, lower(name));

CREATE TABLE IF NOT EXISTS public.crm_contact_tags (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES public.crm_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX IF NOT EXISTS crm_contact_tags_org_idx ON public.crm_contact_tags (org_id);

CREATE TABLE IF NOT EXISTS public.crm_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  author_id  uuid,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_notes_contact_idx ON public.crm_notes (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  type        public.crm_activity_type NOT NULL,
  title       text NOT NULL,
  detail      text,
  amount_cents integer,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ref_type    text,
  ref_id      uuid,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_activities_contact_idx ON public.crm_activities (contact_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_segments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_segments_org_idx ON public.crm_segments (org_id);

CREATE TRIGGER trg_crm_contacts_updated_at BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_crm_notes_updated_at BEFORE UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_crm_segments_updated_at BEFORE UPDATE ON public.crm_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_segments     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_contacts_member_all" ON public.crm_contacts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "crm_tags_member_all" ON public.crm_tags FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "crm_contact_tags_member_all" ON public.crm_contact_tags FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "crm_notes_member_all" ON public.crm_notes FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "crm_activities_member_all" ON public.crm_activities FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
CREATE POLICY "crm_segments_member_all" ON public.crm_segments FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

CREATE OR REPLACE FUNCTION public.crm_sync_contacts(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_owner uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.has_org_role(p_org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'not authorized for org %', p_org_id;
  END IF;

  SELECT owner_id INTO v_owner FROM public.organizations WHERE id = p_org_id;

  WITH ev AS (
    SELECT id FROM public.events
    WHERE org_id = p_org_id OR (v_owner IS NOT NULL AND partner_id = v_owner)
  ),
  agg AS (
    SELECT
      max(coalesce(t.buyer_email, ''))      AS email,
      max(t.buyer_user_id::text)::uuid      AS user_id,
      max(t.buyer_first_name)               AS first_name,
      max(t.buyer_last_name)                AS last_name,
      max(t.buyer_phone)                    AS phone,
      count(*)                              AS orders_count,
      count(DISTINCT t.event_id)            AS events_count,
      sum(coalesce(t.amount_paid_cents, 0)) AS total_spent_cents,
      min(t.paid_at)                        AS first_purchase_at,
      max(t.paid_at)                        AS last_purchase_at
    FROM public.tickets t
    JOIN ev ON ev.id = t.event_id
    WHERE t.status IN ('paid', 'used')
      AND coalesce(t.buyer_email, '') <> ''
    GROUP BY lower(t.buyer_email)
  )
  INSERT INTO public.crm_contacts AS c
    (org_id, user_id, email, first_name, last_name, phone, source,
     orders_count, events_count, total_spent_cents, first_purchase_at, last_purchase_at)
  SELECT
    p_org_id, a.user_id, a.email, a.first_name, a.last_name, a.phone, 'purchase',
    a.orders_count, a.events_count, a.total_spent_cents, a.first_purchase_at, a.last_purchase_at
  FROM agg a
  ON CONFLICT (org_id, lower(email)) DO UPDATE SET
    user_id           = COALESCE(EXCLUDED.user_id, c.user_id),
    first_name        = COALESCE(EXCLUDED.first_name, c.first_name),
    last_name         = COALESCE(EXCLUDED.last_name, c.last_name),
    phone             = COALESCE(EXCLUDED.phone, c.phone),
    orders_count      = EXCLUDED.orders_count,
    events_count      = EXCLUDED.events_count,
    total_spent_cents = EXCLUDED.total_spent_cents,
    first_purchase_at = EXCLUDED.first_purchase_at,
    last_purchase_at  = EXCLUDED.last_purchase_at,
    updated_at        = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_sync_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sync_contacts(uuid) TO authenticated;
