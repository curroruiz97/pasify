-- Pasify · Ola 4, retención del payload de stripe_webhook_events
-- (cron_purge_webhook_payloads). Migración 20260929160000_o4_webhook_retencion.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260929160000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o4_webhook_retencion.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  -- Un evento como el de un pago: lleva email y teléfono del comprador.
  v_pii       JSONB := jsonb_build_object(
                'id', 'evt_o4',
                'type', 'checkout.session.completed',
                'data', jsonb_build_object('object', jsonb_build_object(
                  'customer_details', jsonb_build_object('email', 'comprador-o4@pasify.test', 'phone', '+34 600 000 004'))));
  v_ids       TEXT[] := ARRAY[
                'evt_o4_processed_viejo', 'evt_o4_ignored_viejo', 'evt_o4_duplicate_viejo',
                'evt_o4_justo_pasado', 'evt_o4_justo_dentro', 'evt_o4_processed_reciente',
                'evt_o4_failed_viejo', 'evt_o4_received_viejo', 'evt_o4_ya_vacio'];
  v_antes     INT;   -- lo que ya hubiera elegible en la base antes de este test
  v_count     INT;
  v_total     INT;
  v_payload   JSONB;
  v_purged    INT[];
  v_rec       RECORD;
BEGIN
  -- ------------------------------------------------------------------
  -- 0) Eventos sintéticos
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_antes FROM public.stripe_webhook_events
   WHERE status IN ('processed', 'ignored', 'duplicate')
     AND received_at < now() - INTERVAL '30 days'
     AND payload <> '{}'::jsonb;

  INSERT INTO public.stripe_webhook_events (event_id, event_type, livemode, payload, status, attempt_count, last_error, received_at, processed_at) VALUES
    -- Tratados y con más de 30 días: se vacían.
    ('evt_o4_processed_viejo',    'checkout.session.completed',    TRUE,  v_pii, 'processed', 3, NULL, now() - INTERVAL '31 days', now() - INTERVAL '31 days'),
    ('evt_o4_ignored_viejo',      'customer.subscription.updated', TRUE,  v_pii, 'ignored',   1, NULL, now() - INTERVAL '45 days', now() - INTERVAL '45 days'),
    ('evt_o4_duplicate_viejo',    'charge.refunded',               FALSE, v_pii, 'duplicate', 1, NULL, now() - INTERVAL '40 days', now() - INTERVAL '40 days'),
    -- El límite: un minuto pasados los 30 días se vacía; una hora antes, no.
    ('evt_o4_justo_pasado',       'checkout.session.completed',    TRUE,  v_pii, 'processed', 1, NULL, now() - INTERVAL '30 days' - INTERVAL '1 minute', now() - INTERVAL '30 days'),
    ('evt_o4_justo_dentro',       'checkout.session.completed',    TRUE,  v_pii, 'processed', 1, NULL, now() - INTERVAL '30 days' + INTERVAL '1 hour',   now() - INTERVAL '29 days'),
    -- Recientes: se quedan.
    ('evt_o4_processed_reciente', 'checkout.session.completed',    TRUE,  v_pii, 'processed', 1, NULL, now() - INTERVAL '2 days', now() - INTERVAL '2 days'),
    -- Sin resolver, aunque sean viejos: se quedan con su payload.
    ('evt_o4_failed_viejo',       'checkout.session.completed',    TRUE,  v_pii, 'failed',    4, 'mark_order_paid_v2_failed: x', now() - INTERVAL '60 days', NULL),
    ('evt_o4_received_viejo',     'checkout.session.completed',    TRUE,  v_pii, 'received',  1, NULL, now() - INTERVAL '60 days', NULL),
    -- Ya vacío: no cuenta como vaciado.
    ('evt_o4_ya_vacio',           'payout.paid',                   TRUE,  '{}'::jsonb, 'processed', 1, NULL, now() - INTERVAL '100 days', now() - INTERVAL '100 days');

  -- ------------------------------------------------------------------
  -- 1) Primera pasada: vacía justo los tratados con más de 30 días
  -- ------------------------------------------------------------------
  v_count := public.cron_purge_webhook_payloads();
  IF v_count IS DISTINCT FROM v_antes + 4 THEN
    RAISE EXCEPTION 'FAIL la primera pasada vació % payloads, esperaba % (4 míos + % que ya había)', v_count, v_antes + 4, v_antes;
  END IF;

  FOR v_rec IN
    SELECT * FROM (VALUES
      ('evt_o4_processed_viejo',    TRUE),
      ('evt_o4_ignored_viejo',      TRUE),
      ('evt_o4_duplicate_viejo',    TRUE),
      ('evt_o4_justo_pasado',       TRUE),
      ('evt_o4_justo_dentro',       FALSE),
      ('evt_o4_processed_reciente', FALSE),
      ('evt_o4_failed_viejo',       FALSE),
      ('evt_o4_received_viejo',     FALSE),
      ('evt_o4_ya_vacio',           TRUE)
    ) AS t(event_id, vaciado)
  LOOP
    SELECT payload INTO v_payload FROM public.stripe_webhook_events WHERE event_id = v_rec.event_id;
    IF v_rec.vaciado AND v_payload IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'FAIL % debía quedar con el payload vacío y tiene %', v_rec.event_id, v_payload;
    END IF;
    IF NOT v_rec.vaciado AND v_payload IS DISTINCT FROM v_pii THEN
      RAISE EXCEPTION 'FAIL % debía conservar su payload y ahora tiene %', v_rec.event_id, v_payload;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 2) No se borra ninguna fila y el resto de columnas no se toca
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_total FROM public.stripe_webhook_events WHERE event_id = ANY (v_ids);
  IF v_total <> 9 THEN
    RAISE EXCEPTION 'FAIL la limpieza dejó % de los 9 eventos', v_total;
  END IF;
  -- now() es el de la transacción: las fechas tienen que seguir siendo exactamente las insertadas.
  SELECT * INTO v_rec FROM public.stripe_webhook_events WHERE event_id = 'evt_o4_processed_viejo';
  IF v_rec.event_type IS DISTINCT FROM 'checkout.session.completed' OR v_rec.livemode IS NOT TRUE
     OR v_rec.status IS DISTINCT FROM 'processed' OR v_rec.attempt_count IS DISTINCT FROM 3
     OR v_rec.last_error IS NOT NULL
     OR v_rec.received_at IS DISTINCT FROM now() - INTERVAL '31 days'
     OR v_rec.processed_at IS DISTINCT FROM now() - INTERVAL '31 days' THEN
    RAISE EXCEPTION 'FAIL la limpieza tocó otras columnas de evt_o4_processed_viejo: %', to_jsonb(v_rec) - 'payload';
  END IF;
  SELECT * INTO v_rec FROM public.stripe_webhook_events WHERE event_id = 'evt_o4_failed_viejo';
  IF v_rec.status IS DISTINCT FROM 'failed' OR v_rec.attempt_count IS DISTINCT FROM 4
     OR v_rec.last_error IS DISTINCT FROM 'mark_order_paid_v2_failed: x' OR v_rec.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL la limpieza tocó un evento failed: %', to_jsonb(v_rec) - 'payload';
  END IF;

  -- ------------------------------------------------------------------
  -- 3) Segunda pasada: no queda nada que vaciar. Las dos quedan en cron_runs
  --    (started_at = now(): las de esta transacción)
  -- ------------------------------------------------------------------
  v_count := public.cron_purge_webhook_payloads();
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL la segunda pasada vació % payloads, esperaba 0', v_count;
  END IF;
  SELECT array_agg((metadata->>'purged')::INT ORDER BY (metadata->>'purged')::INT) INTO v_purged
    FROM public.cron_runs
   WHERE job_name = 'purge_webhook_payloads' AND status = 'success' AND finished_at IS NOT NULL AND started_at = now();
  IF v_purged IS DISTINCT FROM ARRAY[0, v_antes + 4] THEN
    RAISE EXCEPTION 'FAIL cron_runs debería anotar dos pasadas con purged = {0, %}: %', v_antes + 4, v_purged;
  END IF;

  -- ------------------------------------------------------------------
  -- 4) Permisos: solo el servidor
  -- ------------------------------------------------------------------
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('anon',          FALSE),
      ('authenticated', FALSE),
      ('service_role',  TRUE)
    ) AS t(rol, esperado)
  LOOP
    IF has_function_privilege(v_rec.rol, 'public.cron_purge_webhook_payloads()', 'EXECUTE') IS DISTINCT FROM v_rec.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre cron_purge_webhook_payloads(): esperaba %', v_rec.rol, v_rec.esperado;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 5) pg_cron: un trabajo diario que llama a la función
  -- ------------------------------------------------------------------
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT count(*) INTO v_total FROM cron.job WHERE jobname = 'pasify-purge-webhook-payloads';
    IF v_total <> 1 THEN
      RAISE EXCEPTION 'FAIL pasify-purge-webhook-payloads está programado % veces, esperaba 1', v_total;
    END IF;
    SELECT j.schedule, j.command INTO v_rec FROM cron.job j WHERE j.jobname = 'pasify-purge-webhook-payloads';
    IF v_rec.schedule IS DISTINCT FROM '30 4 * * *' OR v_rec.command NOT LIKE '%cron_purge_webhook_payloads()%' THEN
      RAISE EXCEPTION 'FAIL pasify-purge-webhook-payloads mal programado: % · %', v_rec.schedule, v_rec.command;
    END IF;
  ELSE
    RAISE NOTICE 'cron.job no existe en esta base: sin comprobar el trabajo programado';
  END IF;

  RAISE NOTICE 'PASS o4_webhook_retencion: vacía el payload de los eventos tratados con más de 30 días (límite incluido), deja los recientes y los sin resolver, no borra filas ni toca otras columnas, es idempotente, solo la ejecuta el servidor y está programada a diario';
END $$;

ROLLBACK;
