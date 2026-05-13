-- Pasify · 0027 realtime publications master
-- Añade todas las tablas que necesitan suscripción realtime a supabase_realtime.
DO $$
DECLARE
  tbl TEXT;
  tables_to_add TEXT[] := ARRAY[
    'ticket_orders',
    'tickets',
    'refund_requests',
    'refund_request_messages',
    'notifications',
    'door_scans',
    'door_vision_events',
    'pos_sales',
    'cashless_transactions',
    'cashless_wallets',
    'vip_bookings',
    'ai_decisions',
    'ai_anomalies',
    'ai_audit_log',
    'ai_kill_switches',
    'pricing_proposals',
    'stripe_webhook_events',
    'partner_subscriptions',
    'service_status_snapshots',
    'forecast_predictions',
    'marketing_campaigns',
    'support_attachments'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_add LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename=tbl) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;
