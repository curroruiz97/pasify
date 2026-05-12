-- Pasify · 0006 RLS: permette a un utente autenticato di inserire la propria
-- row user_roles solo per client/partner (mai admin). Necessario per il flow
-- di registrazione (RegisterClient / RegisterPartner) e per il fallback in
-- ProtectedRoute.
CREATE POLICY "user_roles_self_insert"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND role IN ('client', 'partner')
  );
