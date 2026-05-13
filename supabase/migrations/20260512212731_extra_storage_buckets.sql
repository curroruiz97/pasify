-- Pasify · 0026 storage buckets extra (12 buckets)

INSERT INTO storage.buckets (id, name, public) VALUES
  ('partner-branding',     'partner-branding',     false),
  ('partner-galleries',    'partner-galleries',    true),
  ('ticket-receipts',      'ticket-receipts',      false),
  ('event-reports',        'event-reports',        false),
  ('stripe-invoices',      'stripe-invoices',      false),
  ('kyc-documents',        'kyc-documents',        false),
  ('support-attachments',  'support-attachments',  false),
  ('compliance-reports',   'compliance-reports',   false),
  ('tax-reports',          'tax-reports',          false),
  ('door-vision-snapshots','door-vision-snapshots',false),
  ('audit-exports',        'audit-exports',        false),
  ('gdpr-exports',         'gdpr-exports',         false),
  ('db-backups',           'db-backups',           false),
  ('marketing-assets',     'marketing-assets',     false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- partner-branding: privado, org owners/admins
-- ============================================================================
DROP POLICY IF EXISTS "partner_branding_member_read" ON storage.objects;
DROP POLICY IF EXISTS "partner_branding_owner_write" ON storage.objects;

CREATE POLICY "partner_branding_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'partner-branding' AND public.is_member_of_org((storage.foldername(name))[1]::uuid));

CREATE POLICY "partner_branding_owner_write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'partner-branding' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin']::public.org_member_role_t[]))
  WITH CHECK (bucket_id = 'partner-branding' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin']::public.org_member_role_t[]));

-- ============================================================================
-- partner-galleries: lectura pública, escritura org members
-- ============================================================================
DROP POLICY IF EXISTS "partner_galleries_public_read" ON storage.objects;
DROP POLICY IF EXISTS "partner_galleries_member_write" ON storage.objects;

CREATE POLICY "partner_galleries_public_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'partner-galleries');

CREATE POLICY "partner_galleries_member_write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'partner-galleries' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (bucket_id = 'partner-galleries' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

-- ============================================================================
-- ticket-receipts: solo signed URL del owner via service_role
-- ============================================================================
DROP POLICY IF EXISTS "ticket_receipts_admin_all" ON storage.objects;
CREATE POLICY "ticket_receipts_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'ticket-receipts' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'ticket-receipts' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- event-reports: org owners/admins read; admin all
-- ============================================================================
DROP POLICY IF EXISTS "event_reports_member_read" ON storage.objects;
DROP POLICY IF EXISTS "event_reports_admin_all" ON storage.objects;

CREATE POLICY "event_reports_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'event-reports' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

CREATE POLICY "event_reports_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'event-reports' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'event-reports' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- stripe-invoices: org owners; admin all
-- ============================================================================
DROP POLICY IF EXISTS "stripe_invoices_member_read" ON storage.objects;
CREATE POLICY "stripe_invoices_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'stripe-invoices' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin']::public.org_member_role_t[]));

DROP POLICY IF EXISTS "stripe_invoices_admin_all" ON storage.objects;
CREATE POLICY "stripe_invoices_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'stripe-invoices' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'stripe-invoices' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- kyc-documents: solo service_role (Stripe Identity)
-- ============================================================================
DROP POLICY IF EXISTS "kyc_admin_all" ON storage.objects;
CREATE POLICY "kyc_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'kyc-documents' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'kyc-documents' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- support-attachments: participantes de la conversación
-- ============================================================================
DROP POLICY IF EXISTS "support_attach_participant_read" ON storage.objects;
DROP POLICY IF EXISTS "support_attach_participant_insert" ON storage.objects;
DROP POLICY IF EXISTS "support_attach_admin_all" ON storage.objects;

CREATE POLICY "support_attach_participant_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'support-attachments' AND EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id::text = (storage.foldername(name))[1] AND (c.client_id = auth.uid() OR c.partner_id = auth.uid())));

CREATE POLICY "support_attach_participant_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-attachments' AND EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id::text = (storage.foldername(name))[1] AND (c.client_id = auth.uid() OR c.partner_id = auth.uid())));

CREATE POLICY "support_attach_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'support-attachments' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'support-attachments' AND public.has_role(auth.uid(),'admin'));

-- ============================================================================
-- compliance-reports, tax-reports, door-vision-snapshots, audit-exports, db-backups: admin only
-- ============================================================================
DROP POLICY IF EXISTS "compliance_reports_admin_all" ON storage.objects;
CREATE POLICY "compliance_reports_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'compliance-reports' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'compliance-reports' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "tax_reports_member_read" ON storage.objects;
CREATE POLICY "tax_reports_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tax-reports' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin']::public.org_member_role_t[]));

DROP POLICY IF EXISTS "tax_reports_admin_all" ON storage.objects;
CREATE POLICY "tax_reports_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'tax-reports' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'tax-reports' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "door_vision_admin_all" ON storage.objects;
CREATE POLICY "door_vision_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'door-vision-snapshots' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'door-vision-snapshots' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "door_vision_member_read" ON storage.objects;
CREATE POLICY "door_vision_member_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'door-vision-snapshots' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

DROP POLICY IF EXISTS "audit_exports_admin_all" ON storage.objects;
CREATE POLICY "audit_exports_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'audit-exports' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'audit-exports' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "gdpr_exports_admin_all" ON storage.objects;
CREATE POLICY "gdpr_exports_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'gdpr-exports' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'gdpr-exports' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "db_backups_admin_all" ON storage.objects;
CREATE POLICY "db_backups_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'db-backups' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'db-backups' AND public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "marketing_assets_member_all" ON storage.objects;
CREATE POLICY "marketing_assets_member_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'marketing-assets' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (bucket_id = 'marketing-assets' AND public.has_org_role((storage.foldername(name))[1]::uuid, ARRAY['owner','admin','manager']::public.org_member_role_t[]));
