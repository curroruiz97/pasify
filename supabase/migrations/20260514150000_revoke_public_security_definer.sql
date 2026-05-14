-- Pasify · 0047 REVOKE FROM PUBLIC (no solo de anon) + GRANT explícito
--
-- Bug del intento anterior (mig 0046): REVOKE EXECUTE ... FROM anon no
-- tuvo efecto porque Postgres da GRANT EXECUTE TO PUBLIC por defecto a
-- las funciones, y `anon` hereda de PUBLIC. La verificación SQL confirma
-- que has_function_privilege('anon', oid, 'EXECUTE') seguía siendo true
-- tras 0046.
--
-- Fix: revocar de PUBLIC (lo cual quita el privilegio heredado por anon)
-- y luego re-grant explícito a `authenticated` y `service_role`. Para
-- las funciones legítimamente anon-callable se hace whitelist.
--
-- Resultado final tras esta migration:
--   anon → solo whitelist (9 funciones)
--   authenticated → todas (igual que antes)
--   service_role → todas (igual que antes)

-- 1) REVOKE FROM PUBLIC + GRANT explícito a authenticated/service_role
DO $$
DECLARE
  r record;
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.proname AS name, oidvectortypes(p.proargtypes) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    v_sig := format('public.%I(%s)', r.name, r.args);
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip %: %', v_sig, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2) Whitelist explícita anon (idempotente: si ya está, no falla):
GRANT EXECUTE ON FUNCTION public.accept_invitation(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_whitelabel_host(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_feature_flag(TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.global_search(TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO anon;
