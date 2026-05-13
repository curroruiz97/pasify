-- Pasify · 0006 RLS: user inserta propia row user_roles client/partner
CREATE POLICY "user_roles_self_insert"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND role IN ('client', 'partner')
  );
