-- Pasify · 0052 referrals (refer-a-friend)
--
-- Tabla minimal para sacar el CTA "Refer a friend" de Beta. Cada
-- usuario tiene UN código permanente; otros usuarios pueden canjearlo
-- una sola vez tras signup. El canje otorga loyalty points a ambos via
-- la RPC existente `loyalty_grant_points` (mig 0021).
--
-- Schema:
--   * `referral_codes(user_id, code)` — uno por usuario, código UPPERCASE
--     único alfanumérico de 8 chars.
--   * `referral_claims(id, code, referee_user_id, claimed_at)` — fila
--     creada cuando un nuevo usuario canjea. UNIQUE(referee_user_id)
--     porque cada cliente solo puede aprovechar UN refer-a-friend.
--
-- RPCs:
--   * `get_or_create_my_referral_code()` — devuelve el code del usuario
--     auth. Si no tiene, genera uno random de 8 chars y lo persiste.
--   * `redeem_referral_code(_code TEXT)` — usuario actual canjea un code
--     ajeno. Valida: code existe, no es el propio, usuario aún no canjeó
--     ningún otro. Otorga 500 loyalty points (5€) a ambos via
--     `loyalty_grant_points` con reason='referral'.

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Lectura: el dueño ve su código (para enseñarlo en UI). NO permitimos
-- listar todos los códigos a anyone — solo el dueño.
CREATE POLICY "referral_codes_owner_read" ON public.referral_codes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Lectura admin: para soporte si hace falta.
CREATE POLICY "referral_codes_admin_read" ON public.referral_codes
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- NO permisos de INSERT/UPDATE/DELETE a authenticated — las RPCs
-- (SECURITY DEFINER) manejan la creación. Esto evita que un cliente
-- intente crear códigos repetidos / chocar slugs.

CREATE TABLE IF NOT EXISTS public.referral_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code TEXT NOT NULL REFERENCES public.referral_codes(code) ON DELETE CASCADE,
  referrer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  reward_points INT NOT NULL DEFAULT 500,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_claims_referrer ON public.referral_claims(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_claims_referee ON public.referral_claims(referee_user_id);

ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;

-- El referrer ve sus claims (contador de invitados).
CREATE POLICY "referral_claims_referrer_read" ON public.referral_claims
  FOR SELECT TO authenticated
  USING (referrer_user_id = (SELECT auth.uid()));

-- El referee ve su propio claim (1 por usuario).
CREATE POLICY "referral_claims_referee_read" ON public.referral_claims
  FOR SELECT TO authenticated
  USING (referee_user_id = (SELECT auth.uid()));

-- Admin all.
CREATE POLICY "referral_claims_admin_all" ON public.referral_claims
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- =========================================================================
-- RPC: get_or_create_my_referral_code
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_or_create_my_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_existing TEXT;
  v_code TEXT;
  v_attempts INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Existente?
  SELECT code INTO v_existing FROM public.referral_codes WHERE user_id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Generar nuevo único (alfanumérico mayúsculas, 8 chars). Reintentar
  -- hasta 5 veces en colisión (probabilidad < 1e-12).
  LOOP
    v_attempts := v_attempts + 1;
    -- 8 hex chars sobre random gen_random_uuid() → 16^8 ≈ 4B opciones
    v_code := upper(substring(replace(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));
    BEGIN
      INSERT INTO public.referral_codes (user_id, code) VALUES (v_uid, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Could not generate unique referral code after 5 attempts';
      END IF;
      -- continue loop
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_my_referral_code() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_my_referral_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_referral_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_my_referral_code() TO service_role;

-- =========================================================================
-- RPC: redeem_referral_code
-- =========================================================================
-- Canjea un código ajeno. Otorga 500 points (5€ equiv) a ambos vía
-- loyalty_grant_points. Valida:
--   - usuario autenticado
--   - code existe
--   - code != propio
--   - usuario aún no canjeó NINGÚN otro code (referee_user_id UNIQUE)
CREATE OR REPLACE FUNCTION public.redeem_referral_code(_code TEXT)
RETURNS TABLE (
  claim_id UUID,
  reward_points INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clean_code TEXT;
  v_referrer UUID;
  v_claim_id UUID;
  v_already_claimed UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_code := upper(trim(_code));
  IF v_clean_code = '' OR length(v_clean_code) <> 8 THEN
    RAISE EXCEPTION 'Invalid referral code format';
  END IF;

  SELECT user_id INTO v_referrer FROM public.referral_codes WHERE code = v_clean_code;
  IF v_referrer IS NULL THEN
    RAISE EXCEPTION 'Referral code not found';
  END IF;

  IF v_referrer = v_uid THEN
    RAISE EXCEPTION 'You cannot redeem your own referral code';
  END IF;

  SELECT id INTO v_already_claimed FROM public.referral_claims WHERE referee_user_id = v_uid;
  IF v_already_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'You have already redeemed a referral code';
  END IF;

  INSERT INTO public.referral_claims (
    referral_code, referrer_user_id, referee_user_id, reward_points
  ) VALUES (
    v_clean_code, v_referrer, v_uid, 500
  )
  RETURNING id INTO v_claim_id;

  -- Grant points a ambos
  PERFORM public.loyalty_grant_points(
    v_referrer, 500, 'Refer a friend · invitaste a un amigo', 'referral_referrer'
  );
  PERFORM public.loyalty_grant_points(
    v_uid, 500, 'Refer a friend · te invitó un amigo', 'referral_referee'
  );

  RETURN QUERY SELECT v_claim_id, 500;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_referral_code(TEXT) TO service_role;
