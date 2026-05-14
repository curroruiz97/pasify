-- Pasify · 0044 partner-branding bucket: restringir LIST API
--
-- El advisor 0025 (`public_bucket_allows_listing`) flagea que el bucket
-- `partner-branding` permite a anyclient listar todos los archivos via
-- `/storage/v1/object/list/partner-branding/...`. Esto expone metadata
-- (orgs existentes, paths, timestamps) que no es necesario para servir
-- los assets.
--
-- Solución: mantener `public=true` (las URLs directas siguen funcionando
-- porque el CDN sirve sin pasar por RLS cuando el path es exacto), pero
-- REEMPLAZAR la policy de SELECT amplia (mig 0042) por una que sólo
-- permita LIST a miembros de la org dueña del folder.
--
-- Resultado:
--   * `<img src="https://...partner-branding/{orgX}/logo.png">` → carga (CDN bypass RLS).
--   * `supabase.storage.from('partner-branding').list('orgX/')` como anon → 0 rows.
--   * Idem como auth de otra org → 0 rows.
--   * Como auth de orgX → ve sus propios archivos.
--
-- Idempotente: usa DROP POLICY IF EXISTS + CREATE.

DROP POLICY IF EXISTS "partner_branding_public_read" ON storage.objects;
DROP POLICY IF EXISTS "partner_branding_member_list" ON storage.objects;

CREATE POLICY "partner_branding_member_list" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'partner-branding'
    AND public.is_member_of_org((storage.foldername(name))[1]::uuid)
  );
