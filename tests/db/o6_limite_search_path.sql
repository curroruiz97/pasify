-- Pasify · Ola 6 · máximo de entradas por persona y evento: search_path fijo.
-- Migración 20261013150000_limite_entradas_search_path.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- max_tickets_per_buyer_event() fija el search_path (aviso
-- function_search_path_mutable del asesor de Supabase), sigue devolviendo 10 y
-- conserva sus permisos: solo service_role la ejecuta.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20261013150000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o6_limite_search_path.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

DO $$
DECLARE
  v_config TEXT[];
BEGIN
  SELECT p.proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'max_tickets_per_buyer_event';

  IF v_config IS NULL OR NOT ('search_path=public' = ANY (v_config)) THEN
    RAISE EXCEPTION 'FAIL 1: max_tickets_per_buyer_event no fija el search_path (proconfig = %)', v_config;
  END IF;

  IF public.max_tickets_per_buyer_event() IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'FAIL 2: el tope por persona y evento ya no es 10';
  END IF;

  IF has_function_privilege('anon', 'public.max_tickets_per_buyer_event()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.max_tickets_per_buyer_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 3: anon o authenticated pueden ejecutar max_tickets_per_buyer_event';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.max_tickets_per_buyer_event()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 4: service_role ya no puede ejecutar max_tickets_per_buyer_event';
  END IF;

  RAISE NOTICE 'o6_limite_search_path: OK';
END $$;

ROLLBACK;
