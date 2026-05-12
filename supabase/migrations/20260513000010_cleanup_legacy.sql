-- ============================================================================
-- Pasify · 0010 cleanup legacy (Students Life)
-- Drops de tablas heredadas que no tienen sentido en Pasify (eventos/ticketing).
-- IMPORTANTE: ejecutar SOLO después de confirmar que no hay datos productivos
-- a conservar. Si los hay, exportar via pg_dump primero.
-- ============================================================================

-- Desactivamos triggers temporalmente para evitar cascadas inesperadas
-- al limpiar relaciones legacy.
SET session_replication_role = replica;

-- ============================================================================
-- 1. Social legacy: posts, stories, comments, likes, conversaciones, quizzes
-- ============================================================================
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

-- ============================================================================
-- 2. Loyalty / badges legacy
-- ============================================================================
DROP TABLE IF EXISTS public.stamp_history     CASCADE;
DROP TABLE IF EXISTS public.client_stamps     CASCADE;
DROP TABLE IF EXISTS public.user_badges       CASCADE;
DROP TABLE IF EXISTS public.user_stats        CASCADE;
DROP TABLE IF EXISTS public.badges            CASCADE;
DROP TABLE IF EXISTS public.loyalty_cards     CASCADE;

-- ============================================================================
-- 3. Reviews / event_participants / partner_views / favorites (legacy)
-- ============================================================================
DROP TABLE IF EXISTS public.reviews           CASCADE;
DROP TABLE IF EXISTS public.event_participants CASCADE;
DROP TABLE IF EXISTS public.partner_views     CASCADE;
DROP TABLE IF EXISTS public.favorites         CASCADE;  -- nueva versión backend-backed se creará en otra migration
DROP TABLE IF EXISTS public.discount_scans    CASCADE;

-- ============================================================================
-- 4. QR codes legacy → reemplazada por tickets.qr_token
-- ============================================================================
DROP TABLE IF EXISTS public.qr_codes          CASCADE;

-- ============================================================================
-- 5. Discounts legacy → reemplazada por ticket_tiers (Fase 2)
-- ============================================================================
DROP TABLE IF EXISTS public.discounts         CASCADE;

-- ============================================================================
-- 6. Gallery legacy → reemplazada por partner_galleries
-- ============================================================================
DROP TABLE IF EXISTS public.gallery           CASCADE;

-- ============================================================================
-- 7. Categories legacy → reemplazada por event_categories más adelante
-- ============================================================================
DROP TABLE IF EXISTS public.categories        CASCADE;

-- ============================================================================
-- 8. Access logs legacy → reemplazada por audit_logs (Fase 8)
-- ============================================================================
DROP TABLE IF EXISTS public.access_logs       CASCADE;

-- ============================================================================
-- 9. Content flags / user blocks → renombrar a moderation_flags y conservar
-- ============================================================================
-- Renombramos en lugar de dropear porque la tabla puede tener historial real.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='content_flags') THEN
    ALTER TABLE public.content_flags RENAME TO moderation_flags;
  END IF;
END $$;

-- user_blocks: mantener tal cual (semantica idéntica en Pasify)

-- ============================================================================
-- 10. Vista pública legacy
-- ============================================================================
DROP VIEW IF EXISTS public.public_profiles CASCADE;

-- ============================================================================
-- 11. Enums legacy
-- ============================================================================
DROP TYPE IF EXISTS public.badge_type      CASCADE;
DROP TYPE IF EXISTS public.badge_user_type CASCADE;

-- ============================================================================
-- 12. Funciones legacy
-- ============================================================================
DROP FUNCTION IF EXISTS public.generate_qr_code()        CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_post(uuid)   CASCADE;
DROP FUNCTION IF EXISTS public.is_conversation_participant(uuid, uuid) CASCADE;

-- ============================================================================
-- 13. Columnas legacy en profiles
-- ============================================================================
-- Hacemos drop solo si existen (idempotencia)
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

-- Asegurar que las columnas Pasify objetivo existen (idempotente)
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

-- Asegurar que account_status usa el enum Pasify
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='account_status_t') THEN
    CREATE TYPE public.account_status_t AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- Si account_status está como TEXT (legacy), lo migramos a enum.
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles' AND column_name='account_status';

  IF col_type = 'text' THEN
    ALTER TABLE public.profiles
      ALTER COLUMN account_status DROP DEFAULT,
      ALTER COLUMN account_status TYPE public.account_status_t
        USING (
          CASE
            WHEN account_status IN ('approved','active') THEN 'approved'::public.account_status_t
            WHEN account_status IN ('rejected','banned') THEN 'rejected'::public.account_status_t
            ELSE 'pending'::public.account_status_t
          END
        ),
      ALTER COLUMN account_status SET DEFAULT 'pending';
  END IF;
END $$;

-- ============================================================================
-- 14. Reactivamos triggers
-- ============================================================================
SET session_replication_role = DEFAULT;

-- ============================================================================
-- 15. moderation_flags · esquema Pasify
-- ============================================================================
ALTER TABLE IF EXISTS public.moderation_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "moderation_flags_admin_all" ON public.moderation_flags;
CREATE POLICY "moderation_flags_admin_all"
  ON public.moderation_flags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "moderation_flags_self_insert" ON public.moderation_flags;
-- Permitir que cualquier autenticado reporte (insert) flagging
CREATE POLICY "moderation_flags_self_insert"
  ON public.moderation_flags FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 16. user_fcm_tokens · esquema Pasify
-- ============================================================================
-- Si la tabla existe legacy, normalizamos columnas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_fcm_tokens') THEN
    ALTER TABLE public.user_fcm_tokens
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS fcm_token TEXT,
      ADD COLUMN IF NOT EXISTS platform TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  ELSE
    CREATE TABLE public.user_fcm_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      fcm_token TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, platform)
    );
  END IF;
END $$;

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

-- ============================================================================
-- 17. user_blocks · normalización
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_blocks') THEN
    CREATE TABLE public.user_blocks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (blocker_id, blocked_id)
    );
  END IF;
END $$;

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_self_read" ON public.user_blocks;
CREATE POLICY "user_blocks_self_read"
  ON public.user_blocks FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_self_insert" ON public.user_blocks;
CREATE POLICY "user_blocks_self_insert"
  ON public.user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_self_delete" ON public.user_blocks;
CREATE POLICY "user_blocks_self_delete"
  ON public.user_blocks FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_admin_all" ON public.user_blocks;
CREATE POLICY "user_blocks_admin_all"
  ON public.user_blocks FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
