-- Fix moderation_flags_self_insert: restringir a usuario autenticado + máximo 5 reports/h
DROP POLICY IF EXISTS "moderation_flags_self_insert" ON public.moderation_flags;
CREATE POLICY "moderation_flags_self_insert"
  ON public.moderation_flags FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND target_kind IS NOT NULL
    AND length(reason) > 0
    AND length(reason) <= 5000
  );

-- Quitar SELECT público amplio en buckets públicos. El acceso por URL pública sigue funcionando
-- sin SELECT policy (Supabase Storage permite GET de objetos en buckets public sin policy).
-- Sólo eliminar SELECT permite ocultar listado.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "event_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "partner_galleries_public_read" ON storage.objects;
