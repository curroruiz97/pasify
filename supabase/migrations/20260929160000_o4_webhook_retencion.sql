-- Pasify · Ola 4 · retención del payload de stripe_webhook_events
--
-- stripe-webhook guarda cada evento de Stripe entero en
-- stripe_webhook_events.payload (jsonb NOT NULL) para poder inspeccionarlo si
-- algo falla. Un checkout.session.completed lleva los datos del comprador
-- (nombre, email, teléfono y dirección de facturación) y nada de eso hace
-- falta una vez tratado el evento: Stripe solo reintenta durante 3 días y el
-- pedido, la entrada y el pago ya los guardan sus propias tablas.
--
-- cron_purge_webhook_payloads() deja payload = '{}' en los eventos ya tratados
-- (processed, ignored, duplicate) recibidos hace más de 30 días. No borra
-- filas: event_id, tipo, estado, intentos y fechas se conservan para la
-- auditoría. Los failed y los received no se tocan: son eventos sin resolver
-- y su payload sigue haciendo falta. El borrado de las filas, a los 180 días,
-- sigue siendo cosa de cron_cleanup_logs (20260512212906). Repetirla no
-- cambia nada: solo toca lo que aún lleva datos.
--
-- pg_cron: pasify-purge-webhook-payloads, cada día a las 04:30 UTC. Cada
-- ejecución queda en cron_runs ('purge_webhook_payloads', con los payloads
-- vaciados en metadata.purged). Sin pg_cron la migración sigue adelante con un
-- aviso y la función se puede llamar a mano: SELECT public.cron_purge_webhook_payloads();
-- Para pararlo: SELECT cron.unschedule('pasify-purge-webhook-payloads');

CREATE OR REPLACE FUNCTION public.cron_purge_webhook_payloads()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT;
  v_run_id UUID;
BEGIN
  INSERT INTO public.cron_runs (job_name, status) VALUES ('purge_webhook_payloads', 'running') RETURNING id INTO v_run_id;
  UPDATE public.stripe_webhook_events
     SET payload = '{}'::jsonb
   WHERE status IN ('processed', 'ignored', 'duplicate')
     AND received_at < now() - INTERVAL '30 days'
     AND payload <> '{}'::jsonb;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.cron_runs
     SET finished_at = now(), status = 'success', metadata = jsonb_build_object('purged', v_count)
   WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cron_purge_webhook_payloads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_purge_webhook_payloads() TO service_role;

COMMENT ON COLUMN public.stripe_webhook_events.payload IS
  'Evento de Stripe tal como llegó; lleva datos del comprador. cron_purge_webhook_payloads() lo deja en {} a los 30 días en los eventos ya tratados.';

-- cron.schedule reemplaza el trabajo del mismo nombre: repetir esto no duplica nada.
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron no está instalada: pasify-purge-webhook-payloads sin programar. Con pg_cron: SELECT cron.schedule(''pasify-purge-webhook-payloads'', ''30 4 * * *'', $cmd$SELECT public.cron_purge_webhook_payloads()$cmd$);';
    RETURN;
  END IF;
  PERFORM cron.schedule('pasify-purge-webhook-payloads', '30 4 * * *', $cmd$SELECT public.cron_purge_webhook_payloads()$cmd$);
END $$;
