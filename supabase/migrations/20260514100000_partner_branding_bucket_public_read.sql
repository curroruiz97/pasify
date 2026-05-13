-- Pasify · 0042 partner-branding bucket: lectura pública
--
-- Antes: el bucket `partner-branding` era privado (creado en mig 0026).
-- Sólo miembros de la org podían leer logo/cover. Eso obligaba a firmar
-- URLs cada vez que un cliente veía un evento, una página pública de
-- partner o una card de marketplace — añadía latencia + complejidad
-- (signed URLs caducan, hay que renovar, hay que llevar el JWT del
-- bucket).
--
-- Ahora: branding (logo + portada) es **brand asset público**. La
-- escritura sigue restringida a owners/admins de la org (RLS de path
-- `{org_id}/...` ya vigente en mig 0026). Sólo se abre el SELECT a anon
-- y authenticated, igual que `partner-galleries`.
--
-- Idempotente: re-aplicar la migración no rompe nada.

-- 1) Marca el bucket como público (URL directa sin firmar)
UPDATE storage.buckets
   SET public = true
 WHERE id = 'partner-branding';

-- 2) Política de lectura pública (anon + authenticated). El write sigue
--    en mig 0026 (`partner_branding_owner_write`), que comprueba
--    `has_org_role(folder_uuid, owner/admin)`.
DROP POLICY IF EXISTS "partner_branding_member_read"  ON storage.objects;
DROP POLICY IF EXISTS "partner_branding_public_read"  ON storage.objects;

CREATE POLICY "partner_branding_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'partner-branding');
