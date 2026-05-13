-- Pasify · 0007 RLS: profili partner approvati leggibili pubblici
CREATE POLICY "profiles_public_partner_read"
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (
    account_status = 'approved' AND business_name IS NOT NULL
  );
