-- Pasify · 0031 performance: auth_rls_initplan fix + FK indexes faltantes
-- Patron: cambiar `auth.uid()` por `(SELECT auth.uid())` en USING/WITH CHECK clauses
-- para que PostgreSQL lo evalúe 1x por query en vez de por fila.

-- ============================================================================
-- profiles
-- ============================================================================
DROP POLICY IF EXISTS "profiles_self_read" ON public.profiles;
CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "profiles_public_partner_read" ON public.profiles;
CREATE POLICY "profiles_public_partner_read" ON public.profiles FOR SELECT TO anon, authenticated USING (account_status = 'approved' AND business_name IS NOT NULL);

-- ============================================================================
-- user_roles
-- ============================================================================
DROP POLICY IF EXISTS "user_roles_self_read" ON public.user_roles;
CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_roles_self_insert" ON public.user_roles;
CREATE POLICY "user_roles_self_insert" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND role IN ('client', 'partner'));

DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- events
-- ============================================================================
DROP POLICY IF EXISTS "events_member_read" ON public.events;
CREATE POLICY "events_member_read" ON public.events FOR SELECT TO authenticated
  USING (partner_id = (SELECT auth.uid()) OR (org_id IS NOT NULL AND public.is_member_of_org(org_id)));

DROP POLICY IF EXISTS "events_member_insert" ON public.events;
CREATE POLICY "events_member_insert" ON public.events FOR INSERT TO authenticated
  WITH CHECK (partner_id = (SELECT auth.uid()) OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager','rrpp']::public.org_member_role_t[])));

DROP POLICY IF EXISTS "events_member_update" ON public.events;
CREATE POLICY "events_member_update" ON public.events FOR UPDATE TO authenticated
  USING (partner_id = (SELECT auth.uid()) OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])))
  WITH CHECK (partner_id = (SELECT auth.uid()) OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])));

DROP POLICY IF EXISTS "events_member_delete" ON public.events;
CREATE POLICY "events_member_delete" ON public.events FOR DELETE TO authenticated
  USING (partner_id = (SELECT auth.uid()) OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin']::public.org_member_role_t[])));

DROP POLICY IF EXISTS "events_admin_all" ON public.events;
CREATE POLICY "events_admin_all" ON public.events FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- tickets
-- ============================================================================
DROP POLICY IF EXISTS "tickets_buyer_read_own" ON public.tickets;
CREATE POLICY "tickets_buyer_read_own" ON public.tickets FOR SELECT TO authenticated
  USING (buyer_user_id = (SELECT auth.uid()) OR transferred_to_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "tickets_member_read" ON public.tickets;
CREATE POLICY "tickets_member_read" ON public.tickets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = (SELECT auth.uid()) OR (e.org_id IS NOT NULL AND public.is_member_of_org(e.org_id)))));

DROP POLICY IF EXISTS "tickets_door_staff_update" ON public.tickets;
CREATE POLICY "tickets_door_staff_update" ON public.tickets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = (SELECT auth.uid()) OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = tickets.event_id AND (e.partner_id = (SELECT auth.uid()) OR (e.org_id IS NOT NULL AND public.has_org_role(e.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])))));

DROP POLICY IF EXISTS "tickets_admin_all" ON public.tickets;
CREATE POLICY "tickets_admin_all" ON public.tickets FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- ticket_orders
-- ============================================================================
DROP POLICY IF EXISTS "ticket_orders_buyer_read" ON public.ticket_orders;
CREATE POLICY "ticket_orders_buyer_read" ON public.ticket_orders FOR SELECT TO authenticated USING (buyer_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "ticket_orders_admin_all" ON public.ticket_orders;
CREATE POLICY "ticket_orders_admin_all" ON public.ticket_orders FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- refund_requests
-- ============================================================================
DROP POLICY IF EXISTS "refund_requests_requester_read" ON public.refund_requests;
CREATE POLICY "refund_requests_requester_read" ON public.refund_requests FOR SELECT TO authenticated USING (requester_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "refund_requests_requester_insert" ON public.refund_requests;
CREATE POLICY "refund_requests_requester_insert" ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = refund_requests.ticket_id AND (t.buyer_user_id = (SELECT auth.uid()) OR t.transferred_to_user_id = (SELECT auth.uid())) AND t.status = 'paid'));

DROP POLICY IF EXISTS "refund_requests_admin_all" ON public.refund_requests;
CREATE POLICY "refund_requests_admin_all" ON public.refund_requests FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- support_messages + support_conversations
-- ============================================================================
DROP POLICY IF EXISTS "support_msg_client_read_own" ON public.support_messages;
CREATE POLICY "support_msg_client_read_own" ON public.support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id = support_messages.conversation_id AND c.client_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "support_msg_client_insert_own" ON public.support_messages;
CREATE POLICY "support_msg_client_insert_own" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_kind = 'client' AND sender_id = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.support_conversations c WHERE c.id = support_messages.conversation_id AND c.client_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "support_msg_admin_all" ON public.support_messages;
CREATE POLICY "support_msg_admin_all" ON public.support_messages FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

-- ============================================================================
-- notifications
-- ============================================================================
DROP POLICY IF EXISTS "notifications_self_read" ON public.notifications;
CREATE POLICY "notifications_self_read" ON public.notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications_self_update" ON public.notifications;
CREATE POLICY "notifications_self_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;
CREATE POLICY "notifications_admin_all" ON public.notifications FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "user_notification_prefs_self_all" ON public.user_notification_prefs;
CREATE POLICY "user_notification_prefs_self_all" ON public.user_notification_prefs FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "favorites_v2_self_all" ON public.favorites_v2;
CREATE POLICY "favorites_v2_self_all" ON public.favorites_v2 FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "loyalty_points_self_read" ON public.loyalty_points;
CREATE POLICY "loyalty_points_self_read" ON public.loyalty_points FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "partner_favorites_self_all" ON public.partner_favorites;
CREATE POLICY "partner_favorites_self_all" ON public.partner_favorites FOR ALL TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- FK INDEXES — añadir índices a foreign keys hot que están sin cubrir
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ai_anomalies_org              ON public.ai_anomalies(org_id);
CREATE INDEX IF NOT EXISTS idx_ai_anomalies_resolved_by      ON public.ai_anomalies(resolved_by);
CREATE INDEX IF NOT EXISTS idx_ai_audit_decision             ON public.ai_audit_log(decision_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_venue            ON public.ai_decisions(venue_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_decided_by       ON public.ai_decisions(decided_by);
CREATE INDEX IF NOT EXISTS idx_ai_kill_switches_killed_by    ON public.ai_kill_switches(killed_by);
CREATE INDEX IF NOT EXISTS idx_ai_policies_updated_by        ON public.ai_policies(updated_by);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by       ON public.app_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org                ON public.audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user              ON public.bug_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_triaged_by        ON public.bug_reports(triaged_by);
CREATE INDEX IF NOT EXISTS idx_cashless_topups_partner       ON public.cashless_topups(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_cashless_tx_partner           ON public.cashless_transactions(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_cashless_tx_pos_sale          ON public.cashless_transactions(pos_sale_id);
CREATE INDEX IF NOT EXISTS idx_compliance_age_venue          ON public.compliance_age_policies(venue_id);
CREATE INDEX IF NOT EXISTS idx_compliance_age_event          ON public.compliance_age_policies(event_id);
CREATE INDEX IF NOT EXISTS idx_dsar_completed_by             ON public.compliance_dsar_requests(completed_by);
CREATE INDEX IF NOT EXISTS idx_door_scans_venue              ON public.door_scans(venue_id);
CREATE INDEX IF NOT EXISTS idx_door_vision_venue             ON public.door_vision_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_door_vision_ticket            ON public.door_vision_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_door_vision_scanner           ON public.door_vision_events(scanner_user_id);
CREATE INDEX IF NOT EXISTS idx_door_vision_reviewed_by       ON public.door_vision_events(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_installed_apps_app            ON public.installed_apps(app_id);
CREATE INDEX IF NOT EXISTS idx_installed_apps_installed_by   ON public.installed_apps(installed_by);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_ticket         ON public.loyalty_points(ticket_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_org            ON public.loyalty_points(org_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_by ON public.marketing_campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_reporter     ON public.moderation_flags(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_resolved_by  ON public.moderation_flags(resolved_by);
CREATE INDEX IF NOT EXISTS idx_music_licenses_venue          ON public.music_licenses(venue_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id         ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_invited_by        ON public.organization_members(invited_by);
CREATE INDEX IF NOT EXISTS idx_org_members_venue             ON public.organization_members(venue_id);
CREATE INDEX IF NOT EXISTS idx_org_members_brand             ON public.organization_members(brand_id);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_idx       ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_closures_partner     ON public.pos_cash_closures(partner_user_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_ticket              ON public.pos_sales(ticket_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_cashier             ON public.pos_sales(cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_voided_by           ON public.pos_sales(voided_by);
CREATE INDEX IF NOT EXISTS idx_pricing_proposals_decided_by  ON public.pricing_proposals(decided_by);
CREATE INDEX IF NOT EXISTS idx_refund_requests_decided_by    ON public.refund_requests(decided_by);
CREATE INDEX IF NOT EXISTS idx_refund_msg_sender             ON public.refund_request_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_attach_message        ON public.support_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_support_canned_replies_org    ON public.support_canned_replies(org_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_partner_idx      ON public.support_conversations(partner_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_org              ON public.support_conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_event            ON public.support_conversations(event_id);
CREATE INDEX IF NOT EXISTS idx_support_conv_assigned_admin   ON public.support_conversations(assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender       ON public.support_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_tax_filings_filed_by          ON public.tax_filings(filed_by);
CREATE INDEX IF NOT EXISTS idx_ticket_orders_org_idx         ON public.ticket_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_to_user      ON public.ticket_transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_used_by_partner       ON public.tickets(used_by_partner_id);
CREATE INDEX IF NOT EXISTS idx_vip_areas_venue_idx           ON public.vip_areas(venue_id);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_holder_user      ON public.vip_bookings(holder_user_id);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_venue            ON public.vip_bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_vip_bookings_vip_area         ON public.vip_bookings(vip_area_id);
CREATE INDEX IF NOT EXISTS idx_events_partner_idx            ON public.events(partner_id);
CREATE INDEX IF NOT EXISTS idx_cashless_wallets_venue        ON public.cashless_wallets(venue_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_event               ON public.pos_sales(event_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_closures_event       ON public.pos_cash_closures(event_id);
