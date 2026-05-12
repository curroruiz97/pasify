-- Pasify · 0007 RLS: i profili dei locali approvati sono leggibili dal pubblico
-- (anon + authenticated). Necessario per il feed di scoperta nel ClientDashboard
-- e per la calendar pubblica.
CREATE POLICY "profiles_public_partner_read"
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (
    account_status = 'approved' AND business_name IS NOT NULL
  );
