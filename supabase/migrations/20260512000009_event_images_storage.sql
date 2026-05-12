-- Pasify · 0009 storage event-images bucket
-- Convenzione path: <partner_id>/<filename>
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "event_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "event_images_partner_insert" ON storage.objects;
DROP POLICY IF EXISTS "event_images_partner_update" ON storage.objects;
DROP POLICY IF EXISTS "event_images_partner_delete" ON storage.objects;

CREATE POLICY "event_images_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'event-images');

CREATE POLICY "event_images_partner_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "event_images_partner_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'event-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "event_images_partner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'event-images' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
