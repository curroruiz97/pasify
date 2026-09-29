-- Pasify · Ola 3 · plataforma: rendimiento de la BD (B6-15) y SQL muerto (B6-14)
--
-- 1) Índices para las 6 claves foráneas sin índice que señalan los asesores
--    de Supabase (unindexed_foreign_keys). Sin índice, cada DELETE o UPDATE
--    de la fila referenciada (una organización, una etiqueta, un código de
--    referido, un miembro del equipo) recorre la tabla entera para comprobar
--    la FK. Solo si la tabla y la columna existen y ningún índice empieza ya
--    por esa columna.
--
-- 2) Realtime: la publicación supabase_realtime tenía 24 tablas y la app solo
--    escucha 6 (postgres_changes en src/, revisado en la Ola 3):
--      ai_kill_switches       admin · consola de IA (adminQueries.ts)
--      refund_requests        cliente, local y admin (useRefundRequests.ts,
--                             partnerData.ts, adminQueries.ts)
--      support_conversations  admin · bandeja de soporte (adminQueries.ts)
--      support_messages       chat de soporte y bandeja (SupportChat.tsx,
--                             adminQueries.ts)
--      ticket_orders          cliente · vuelta del pago (ClientDashboard.tsx)
--      tickets                local · directo y asistentes (LiveWarRoom.tsx,
--                             PartnerAttendees.tsx)
--    Las otras 18 salen de la publicación: Realtime decodificaba del WAL cada
--    cambio suyo para nadie. Las 6 que se escuchan se aseguran dentro.
--    Calendar.tsx escucha `events`, que nunca ha estado publicada: no se
--    añade (cada venta cambia events.tickets_sold y refrescaría el calendario
--    de todo el mundo).
--    Una tabla que necesite Realtime: se añade aquí (o en su migración) y en
--    tests/db/o3_plataforma.sql.
--
-- 3) SQL muerto (nadie lo usa en src/, supabase/functions/ ni en otras
--    funciones, vistas, políticas o cron jobs):
--      - v_partner_kpis_daily: multiplicaba filas (pedido × entradas en el
--        mismo GROUP BY) y anon tenía SELECT.
--      - v_event_revenue_summary.
--      - mark_ticket_used(uuid) y cashless_pay(uuid, int, jsonb, uuid):
--        heredadas, solo service_role desde 20260923120100. La puerta usa
--        scan_ticket / scan_ticket_by_code.
--    Se quedan:
--      - v_admin_platform_kpis: la usa la portada del admin desde la Ola 1
--        (adminQueries.ts). Solo se le quita anon (heredaba todos los
--        permisos por defecto; es security_invoker, pero nada sin sesión la
--        necesita).
--      - door_scan(uuid): sin uso, pero tests/db/review_fixes.sql comprueba sus
--        permisos por firma y fallaría si no existe. Ya era solo service_role
--        (20260923120500); se vuelve a asegurar. Borrarla cuando ese test
--        compruebe antes que existe.
--    Sin CASCADE: si algo dependiera de ellas, la migración falla en vez de
--    llevárselo por delante.
--
-- Sin cambios de RLS: las políticas permisivas duplicadas (multiple_permissive_
-- policies) se consolidan más adelante.

-- ============================================================================
-- 1) Índices de las claves foráneas
-- ============================================================================
DO $$
DECLARE
  r      record;
  v_rel  regclass;
  v_att  smallint;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('crm_activities',   'org_id',        'idx_crm_activities_org'),
      ('crm_contact_tags', 'tag_id',        'idx_crm_contact_tags_tag'),
      ('crm_notes',        'org_id',        'idx_crm_notes_org'),
      ('referral_claims',  'referral_code', 'idx_referral_claims_referral_code'),
      ('rrpp_payouts',     'org_id',        'idx_rrpp_payouts_org'),
      ('team_shifts',      'member_id',     'idx_team_shifts_member')
    ) AS t(tabla, columna, indice)
  LOOP
    v_rel := to_regclass(format('public.%I', r.tabla));
    IF v_rel IS NULL THEN
      RAISE NOTICE 'Índice % sin crear: no existe la tabla public.%', r.indice, r.tabla;
      CONTINUE;
    END IF;
    SELECT a.attnum INTO v_att
      FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attname = r.columna AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_att IS NULL THEN
      RAISE NOTICE 'Índice % sin crear: public.% no tiene la columna %', r.indice, r.tabla, r.columna;
      CONTINUE;
    END IF;
    -- Otro índice que ya empiece por la columna sirve igual para la FK.
    IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = v_rel AND i.indkey[0] = v_att)
       AND to_regclass(format('public.%I', r.indice)) IS NULL THEN
      RAISE NOTICE 'Índice % sin crear: public.%(%) ya tiene un índice que empieza por ella', r.indice, r.tabla, r.columna;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', r.indice, r.tabla, r.columna);
  END LOOP;
END $$;

-- ============================================================================
-- 2) Publicación de Realtime: solo lo que escucha la app
-- ============================================================================
DO $$
DECLARE
  v_tabla  text;
  v_quedan text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que cambiar';
    RETURN;
  END IF;

  -- Fuera: nadie las escucha.
  FOREACH v_tabla IN ARRAY ARRAY[
    'ai_anomalies', 'ai_audit_log', 'ai_decisions',
    'cashless_transactions', 'cashless_wallets',
    'door_scans', 'door_vision_events',
    'forecast_predictions', 'marketing_campaigns', 'notifications',
    'partner_subscriptions', 'pos_sales', 'pricing_proposals',
    'refund_request_messages', 'service_status_snapshots',
    'stripe_webhook_events', 'support_attachments', 'vip_bookings'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tabla) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_tabla);
    END IF;
  END LOOP;

  -- Dentro: las que escucha la app.
  FOREACH v_tabla IN ARRAY ARRAY[
    'ai_kill_switches', 'refund_requests', 'support_conversations',
    'support_messages', 'ticket_orders', 'tickets'
  ] LOOP
    IF to_regclass(format('public.%I', v_tabla)) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tabla) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabla);
    END IF;
  END LOOP;

  -- En el log del despliegue: lo que queda publicado (en producción puede
  -- haber alguna tabla añadida a mano que no esté en las listas).
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY schemaname, tablename)
    INTO v_quedan
    FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
  RAISE NOTICE 'supabase_realtime publica: %', coalesce(v_quedan, '(nada)');
END $$;

-- ============================================================================
-- 3) SQL muerto
-- ============================================================================
DROP VIEW IF EXISTS public.v_partner_kpis_daily;
DROP VIEW IF EXISTS public.v_event_revenue_summary;

DROP FUNCTION IF EXISTS public.mark_ticket_used(uuid);
DROP FUNCTION IF EXISTS public.cashless_pay(uuid, integer, jsonb, uuid);

DO $$
BEGIN
  IF to_regprocedure('public.door_scan(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.door_scan(uuid) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regclass('public.v_admin_platform_kpis') IS NOT NULL THEN
    REVOKE ALL ON public.v_admin_platform_kpis FROM anon;
  END IF;
END $$;
