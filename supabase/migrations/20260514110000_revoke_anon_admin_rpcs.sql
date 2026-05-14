-- Pasify · 0043 REVOKE EXECUTE de RPCs admin/sensibles al rol `anon`
--
-- El Supabase advisor 0028 (`anon_security_definer_function_executable`)
-- flagea múltiples funciones SECURITY DEFINER ejecutables sin login.
-- Aunque la mayoría comprueban `has_role(auth.uid(),'admin')` por dentro,
-- la superficie de ataque debe estar cerrada por defecto: revocamos
-- EXECUTE del rol `anon` para que ni siquiera lleguen al body.
--
-- Funciones afectadas (cubrir las explícitamente listadas por el advisor
-- + las relacionadas evidentes):
--   admin_grant_partner_access(UUID)
--   admin_grant_partner_access_until(UUID, TIMESTAMPTZ, TEXT)
--   admin_revoke_partner_access(UUID)
--   admin_revoke_partner_grant(UUID)
--   admin_list_users(TEXT, TEXT, TEXT, INT, INT)
--   admin_metrics_timeseries(INT)
--   admin_top_events(INT, INT)
--   admin_subscription_funnel()
--   set_admin_by_email(TEXT)
--   assign_admin_to_conversation(UUID, UUID)
--
-- Excepciones (NO se revocan a anon, design intencional):
--   * accept_invitation(_token UUID) — usa token único, debe ser anon-callable
--   * accept_ticket_transfer(_token UUID) — idem
--
-- Idempotente: REVOKE no falla si el privilegio ya no existe.

REVOKE EXECUTE ON FUNCTION public.admin_grant_partner_access(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_grant_partner_access_until(UUID, TIMESTAMPTZ, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_partner_access(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_partner_grant(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, TEXT, INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_metrics_timeseries(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_top_events(INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_subscription_funnel() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_admin_by_email(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assign_admin_to_conversation(UUID, UUID) FROM anon;
