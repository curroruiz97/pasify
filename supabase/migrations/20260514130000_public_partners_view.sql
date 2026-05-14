-- Pasify · 0045 view public_partners
--
-- Antes: ClientDashboard y PublicPartnerPage leen directamente
-- `profiles.business_*` con un WHERE filter. Eso expone toda la fila
-- de profile (PII potencial) y mezcla legacy (business_*) con el
-- modelo enterprise (organizations → brands → venues).
--
-- Ahora: una VIEW `public_partners` que selecciona SOLO las columnas
-- necesarias para el listing público y aplica los filtros canónicos
-- (account_status='approved', business_name not null). El frontend
-- consume la view; cuando dropemos los campos `business_*` del profile
-- (P2.2 next step) solo cambia la definición de la view.
--
-- La view hereda RLS de `profiles`. La policy `profiles_select_self_or_approved_partners`
-- (mig 0011 y derivados) permite SELECT a clientes/anon sobre filas
-- approved con business_name — por eso la view es legible sin auth.
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE VIEW public.public_partners
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.business_name,
  p.business_category,
  p.business_description,
  p.city,
  p.avatar_url,
  p.cover_image_url
FROM public.profiles p
WHERE p.account_status = 'approved'
  AND p.business_name IS NOT NULL;

COMMENT ON VIEW public.public_partners IS
  'Listado público de partners aprobados con datos mínimos. ClientDashboard y PublicPartnerPage leen de aquí en vez de profiles directamente. security_invoker=true hereda RLS del caller (no SECURITY DEFINER).';

GRANT SELECT ON public.public_partners TO anon, authenticated;
