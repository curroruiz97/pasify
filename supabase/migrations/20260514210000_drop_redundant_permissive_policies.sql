-- Pasify · 0053 drop policies RLS redundantes (perf advisor 0002)
--
-- El advisor 0002 (multiple_permissive_policies) lista 171 ocurrencias
-- donde varias policies PERMISSIVE compiten en (table, role, command).
-- Postgres evalúa todas con OR → coste extra por cada query.
--
-- Análisis policy-by-policy revela que algunas son DUPLICADAS estrictas
-- (una policy es subset de otra). Aquí dropeamos las redundantes
-- confirmadas:
--
--   venues.venues_org_member_select  (SUBSET de venues_member_read)
--   brands.brands_org_member_select  (SUBSET de brands_member_read)
--
-- Justificación: `is_member_of_org(org_id)` cubre owner + cualquier
-- organization_member.status='active' (cualquier rol). El OR complejo
-- de las _select policies sólo cubre owner + has_org_role con 4 roles
-- específicos — es estrictamente más restrictivo, por tanto subset de
-- is_member_of_org. Dropearlas no quita acceso a NADIE.
--
-- NO se tocan otras "duplicadas":
--   * support_canned_replies tiene 3 SELECT policies pero son
--     condicionales por owner_role (admin/client/partner) — son
--     intencionalmente disjuntas, no redundantes.
--   * Las patron (member + admin_all) en otras tablas tampoco se
--     tocan porque admin_all es el escape hatch del sistema.
--
-- Idempotente: DROP POLICY IF EXISTS.

DROP POLICY IF EXISTS "venues_org_member_select" ON public.venues;
DROP POLICY IF EXISTS "brands_org_member_select" ON public.brands;
