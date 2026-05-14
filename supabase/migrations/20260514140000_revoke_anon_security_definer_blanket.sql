-- Pasify · 0046 REVOKE EXECUTE de TODAS las SECURITY DEFINER a anon + whitelist
--
-- Contexto: el Supabase advisor 0028 marca 83 funciones SECURITY DEFINER
-- de `public` como ejecutables por `anon` (sin login). Aunque la mayoría
-- comprueban `auth.uid()` o `has_role(...)` por dentro, la superficie
-- de ataque debe cerrarse por defecto.
--
-- Estrategia:
--   1. Blanket REVOKE EXECUTE FROM anon en TODAS las funciones de
--      `public` que sean SECURITY DEFINER (prosecdef = true).
--   2. GRANT EXECUTE TO anon SOLO en la whitelist:
--      - accept_invitation / accept_ticket_transfer: usan token UUID,
--        deben ser anon-callable por diseño (invitación / transferencia
--        de ticket sin sesión).
--      - resolve_whitelabel_host: lookup multi-tenant en arranque público.
--      - get_app_setting_* / get_feature_flag: config pública (landing).
--      - global_search: búsqueda en landing.
--      - check_rate_limit: utility de rate limiting que el anon puede
--        invocar (auto-limit en pre-auth).
--
-- El rol `authenticated` mantiene sus GRANTs existentes (no se tocan)
-- y `service_role` siempre tiene EXECUTE incondicional.
--
-- Idempotente: re-ejecutar no rompe nada (REVOKE/GRANT son seguros).

-- 1) Blanket REVOKE
DO $$
DECLARE
  r record;
  v_func_sig text;
BEGIN
  FOR r IN
    SELECT
      p.proname AS name,
      oidvectortypes(p.proargtypes) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    v_func_sig := format('public.%I(%s)', r.name, r.args);
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_func_sig);
    EXCEPTION WHEN OTHERS THEN
      -- Algunas funciones pueden no tener GRANT a anon que revocar:
      -- ignoramos silenciosamente, la idea es asegurar el estado final.
      RAISE NOTICE 'Skip revoke %: %', v_func_sig, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2) Whitelist explícita: funciones que SÍ deben ser anon-callable
--    (sin auth.uid o con token único en argumento).

-- Tokens UUID single-use:
GRANT EXECUTE ON FUNCTION public.accept_invitation(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer(UUID) TO anon;

-- Multi-tenant resolver (arranque del cliente):
GRANT EXECUTE ON FUNCTION public.resolve_whitelabel_host(TEXT) TO anon;

-- Config / feature flags (utility de landing pre-auth):
GRANT EXECUTE ON FUNCTION public.get_app_setting_bool(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_setting_int(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_setting_text(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_feature_flag(TEXT, UUID) TO anon;

-- Búsqueda pública (landing search):
GRANT EXECUTE ON FUNCTION public.global_search(TEXT, INT) TO anon;

-- Rate limit utility (anon puede auto-limitarse antes de auth):
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO anon;
