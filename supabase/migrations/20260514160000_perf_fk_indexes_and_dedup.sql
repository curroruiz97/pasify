-- Pasify · 0048 performance: índices FK + drop de índices duplicados
--
-- El advisor 0001 (`unindexed_foreign_keys`) marca 8 FK sin índice
-- cubriente. JOIN/DELETE/UPDATE cascada por esas FK escanean toda la
-- tabla destino. Añadimos índice btree estándar por FK column.
--
-- El advisor 0009 (`duplicate_index`) marca 6 pares de índices idénticos.
-- Postgres mantiene los dos en cada INSERT/UPDATE — overhead duplicado
-- sin beneficio. Dropamos el con nombre más nuevo (legacy histórico).
--
-- Idempotente via CREATE INDEX IF NOT EXISTS / DROP INDEX IF EXISTS.

-- ===========================================================================
-- 1) Unindexed foreign keys
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_door_scans_scanner_user
  ON public.door_scans (scanner_user_id);

CREATE INDEX IF NOT EXISTS idx_favorites_v2_venue
  ON public.favorites_v2 (venue_id);

CREATE INDEX IF NOT EXISTS idx_music_genres_parent_code
  ON public.music_genres (parent_code);

CREATE INDEX IF NOT EXISTS idx_partner_onboarding_state_org
  ON public.partner_onboarding_state (org_id);

CREATE INDEX IF NOT EXISTS idx_partner_onboarding_state_venue
  ON public.partner_onboarding_state (venue_id);

CREATE INDEX IF NOT EXISTS idx_profiles_last_active_venue
  ON public.profiles (last_active_venue_id);

CREATE INDEX IF NOT EXISTS idx_ticket_scan_logs_venue
  ON public.ticket_scan_logs (venue_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

-- ===========================================================================
-- 2) Duplicate indexes — drop redundancy
-- ===========================================================================
-- Pares detectados; mantenemos el primero (legacy histórico), dropamos
-- el con sufijo `_idx` o similar.
DROP INDEX IF EXISTS public.idx_compliance_age_event;
DROP INDEX IF EXISTS public.idx_events_partner_idx;
DROP INDEX IF EXISTS public.idx_organizations_owner_idx;
DROP INDEX IF EXISTS public.idx_support_attachments_message;
DROP INDEX IF EXISTS public.idx_ticket_orders_org_idx;
DROP INDEX IF EXISTS public.idx_vip_areas_venue_idx;
