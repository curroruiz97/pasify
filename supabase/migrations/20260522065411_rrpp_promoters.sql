-- Migration 20260522065411 · rrpp_promoters
-- Recuperada desde produccion (se aplico via MCP sin commitear el fichero).

DO $$ BEGIN
  CREATE TYPE public.rrpp_status AS ENUM ('active','paused','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.rrpp_promoters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id               uuid,
  name                  text NOT NULL,
  email                 text NOT NULL,
  phone                 text,
  code                  text NOT NULL,
  commission_pct        numeric(5,2) NOT NULL DEFAULT 10,
  status                public.rrpp_status NOT NULL DEFAULT 'active',
  avatar_color          text,
  sold_count            integer NOT NULL DEFAULT 0,
  commission_cents      bigint NOT NULL DEFAULT 0,
  pending_payout_cents  bigint NOT NULL DEFAULT 0,
  joined_at             timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rrpp_promoters_org_code_uidx
  ON public.rrpp_promoters (org_id, lower(code));
CREATE INDEX IF NOT EXISTS rrpp_promoters_org_idx
  ON public.rrpp_promoters (org_id, sold_count DESC);

CREATE TABLE IF NOT EXISTS public.rrpp_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  promoter_id   uuid NOT NULL REFERENCES public.rrpp_promoters(id) ON DELETE CASCADE,
  amount_cents  bigint NOT NULL,
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rrpp_payouts_promoter_idx
  ON public.rrpp_payouts (promoter_id, created_at DESC);

CREATE TRIGGER trg_rrpp_promoters_updated_at BEFORE UPDATE ON public.rrpp_promoters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.rrpp_promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrpp_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rrpp_promoters_member_all" ON public.rrpp_promoters FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

CREATE POLICY "rrpp_payouts_member_all" ON public.rrpp_payouts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

CREATE OR REPLACE FUNCTION public.rrpp_settle_payout(p_promoter_id uuid, p_note text DEFAULT NULL)
RETURNS TABLE (payout_id uuid, amount_cents bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org      uuid;
  v_pending  bigint;
  v_payout   uuid;
BEGIN
  SELECT org_id, pending_payout_cents INTO v_org, v_pending
  FROM public.rrpp_promoters WHERE id = p_promoter_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Promoter not found';
  END IF;
  IF NOT public.has_org_role(v_org, ARRAY['owner','admin','manager']::public.org_member_role_t[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_pending <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.rrpp_payouts (org_id, promoter_id, amount_cents, note, created_by)
  VALUES (v_org, p_promoter_id, v_pending, p_note, auth.uid())
  RETURNING id INTO v_payout;

  UPDATE public.rrpp_promoters SET pending_payout_cents = 0 WHERE id = p_promoter_id;

  RETURN QUERY SELECT v_payout, v_pending;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.rrpp_settle_payout(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rrpp_settle_payout(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rrpp_settle_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rrpp_settle_payout(uuid, text) TO service_role;
