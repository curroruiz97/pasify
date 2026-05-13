-- Pasify · 0001 init: roles, profiles, user_roles, helpers, auth trigger

CREATE TYPE public.app_role AS ENUM ('admin', 'partner', 'client');
CREATE TYPE public.account_status_t AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  city TEXT,
  country TEXT DEFAULT 'ES',
  avatar_url TEXT,
  cover_image_url TEXT,
  business_name TEXT,
  business_category TEXT,
  business_description TEXT,
  stripe_customer_id TEXT,
  stripe_connect_account_id TEXT,
  stripe_connect_onboarded BOOLEAN DEFAULT FALSE,
  subscription_status TEXT,
  subscription_current_period_end TIMESTAMPTZ,
  account_status public.account_status_t NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_city ON public.profiles(city);
CREATE INDEX idx_profiles_account_status ON public.profiles(account_status);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_self_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_self_read"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.auto_approve_if_allowed(_role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN FALSE; END IF;
  IF _role = 'client' THEN
    UPDATE public.profiles SET account_status = 'approved' WHERE id = v_uid;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_if_allowed(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
