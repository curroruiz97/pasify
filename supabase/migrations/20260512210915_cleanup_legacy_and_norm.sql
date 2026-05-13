-- Pasify · 0010 cleanup legacy + normalización
SET session_replication_role = replica;

-- Drops idempotentes
DROP TABLE IF EXISTS public.post_views        CASCADE;
DROP TABLE IF EXISTS public.post_shares       CASCADE;
DROP TABLE IF EXISTS public.saved_posts       CASCADE;
DROP TABLE IF EXISTS public.likes             CASCADE;
DROP TABLE IF EXISTS public.comments          CASCADE;
DROP TABLE IF EXISTS public.posts             CASCADE;
DROP TABLE IF EXISTS public.story_views       CASCADE;
DROP TABLE IF EXISTS public.stories           CASCADE;
DROP TABLE IF EXISTS public.typing_indicators CASCADE;
DROP TABLE IF EXISTS public.messages          CASCADE;
DROP TABLE IF EXISTS public.conversation_participants CASCADE;
DROP TABLE IF EXISTS public.conversations     CASCADE;
DROP TABLE IF EXISTS public.poll_options      CASCADE;
DROP TABLE IF EXISTS public.quiz_answers      CASCADE;
DROP TABLE IF EXISTS public.quiz_leaderboard  CASCADE;
DROP TABLE IF EXISTS public.quiz_matches      CASCADE;
DROP TABLE IF EXISTS public.quiz_matchmaking  CASCADE;
DROP TABLE IF EXISTS public.quiz_questions    CASCADE;
DROP TABLE IF EXISTS public.stamp_history     CASCADE;
DROP TABLE IF EXISTS public.client_stamps     CASCADE;
DROP TABLE IF EXISTS public.user_badges       CASCADE;
DROP TABLE IF EXISTS public.user_stats        CASCADE;
DROP TABLE IF EXISTS public.badges            CASCADE;
DROP TABLE IF EXISTS public.loyalty_cards     CASCADE;
DROP TABLE IF EXISTS public.reviews           CASCADE;
DROP TABLE IF EXISTS public.event_participants CASCADE;
DROP TABLE IF EXISTS public.partner_views     CASCADE;
DROP TABLE IF EXISTS public.favorites         CASCADE;
DROP TABLE IF EXISTS public.discount_scans    CASCADE;
DROP TABLE IF EXISTS public.qr_codes          CASCADE;
DROP TABLE IF EXISTS public.discounts         CASCADE;
DROP TABLE IF EXISTS public.gallery           CASCADE;
DROP TABLE IF EXISTS public.categories        CASCADE;
DROP TABLE IF EXISTS public.access_logs       CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='content_flags') THEN
    ALTER TABLE public.content_flags RENAME TO moderation_flags;
  END IF;
END $$;

DROP VIEW IF EXISTS public.public_profiles CASCADE;

DROP TYPE IF EXISTS public.badge_type      CASCADE;
DROP TYPE IF EXISTS public.badge_user_type CASCADE;

DROP FUNCTION IF EXISTS public.generate_qr_code()        CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_post(uuid)   CASCADE;
DROP FUNCTION IF EXISTS public.is_conversation_participant(uuid, uuid) CASCADE;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS allergens;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS university;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS contact_email;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone_number;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS profile_image_url;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS last_payment_amount;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS last_payment_date;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS latitude;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS longitude;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_venue_id UUID;

SET session_replication_role = DEFAULT;

-- moderation_flags
CREATE TABLE IF NOT EXISTS public.moderation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_kind TEXT NOT NULL,
  target_id UUID,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_flags_status ON public.moderation_flags(status);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_target ON public.moderation_flags(target_kind, target_id);

ALTER TABLE public.moderation_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moderation_flags_admin_all" ON public.moderation_flags;
CREATE POLICY "moderation_flags_admin_all"
  ON public.moderation_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "moderation_flags_self_insert" ON public.moderation_flags;
CREATE POLICY "moderation_flags_self_insert"
  ON public.moderation_flags FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- user_fcm_tokens
CREATE TABLE IF NOT EXISTS public.user_fcm_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user ON public.user_fcm_tokens(user_id);

ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_fcm_tokens_self_all" ON public.user_fcm_tokens;
CREATE POLICY "user_fcm_tokens_self_all"
  ON public.user_fcm_tokens FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_fcm_tokens_admin_all" ON public.user_fcm_tokens;
CREATE POLICY "user_fcm_tokens_admin_all"
  ON public.user_fcm_tokens FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- user_blocks
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_self_read" ON public.user_blocks;
CREATE POLICY "user_blocks_self_read" ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_self_insert" ON public.user_blocks;
CREATE POLICY "user_blocks_self_insert" ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_self_delete" ON public.user_blocks;
CREATE POLICY "user_blocks_self_delete" ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_admin_all" ON public.user_blocks;
CREATE POLICY "user_blocks_admin_all" ON public.user_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
