-- Pasify · 0005 colonne business extra su profiles (separate da quelle personali)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_address TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT,
  ADD COLUMN IF NOT EXISTS business_city TEXT,
  ADD COLUMN IF NOT EXISTS business_phone TEXT;
