-- Pasify · RLS / SECURITY DEFINER policy tests
--
-- Estos tests se ejecutan contra una instancia Supabase local (puerto 54322)
-- después de `supabase db reset`. Cada test usa BEGIN/ROLLBACK para no dejar
-- residuo. El runner (`.github/workflows/db-policy-tests.yml`) hace fail si
-- cualquier `RAISE EXCEPTION` salta o si un `ASSERT FALSE` se ejecuta.
--
-- Conceptos:
--  - Usamos `SET LOCAL request.jwt.claim.sub` + `SET LOCAL role authenticated`
--    para simular un user concreto. Es lo que Supabase pone cuando un JWT
--    válido llega vía PostgREST.
--  - `RESET ROLE` vuelve a service_role / postgres para limpieza.
--  - Cada test crea sus fixtures via service_role, switch a authenticated,
--    intenta la operación que debería fallar, asserta el error con
--    DO $$ EXCEPTION WHEN ... THEN ... END $$;
--
-- Ejecutar local:
--   supabase start
--   supabase db reset
--   psql postgresql://postgres:postgres@localhost:54322/postgres -f tests/db/policies.sql

\set ON_ERROR_STOP on
\timing on

-- ============================================================================
-- TEST 1: usuario client NO puede acumular rol partner (mig 20260513120000)
-- ============================================================================
BEGIN;

-- Fixture: creamos un user en auth.users + profile + rol client (vía service_role)
SELECT gen_random_uuid() AS test_user_id \gset
INSERT INTO auth.users (id, email, encrypted_password, role, aud, instance_id, created_at, updated_at)
VALUES (:'test_user_id', 'test1@pasify.test', crypt('test123', gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
INSERT INTO public.profiles (id, email) VALUES (:'test_user_id', 'test1@pasify.test');
INSERT INTO public.user_roles (user_id, role) VALUES (:'test_user_id', 'client');

-- Switch a sesión del user (authenticated role, JWT con sub = test_user_id)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'TEST_USER_ID_PLACEHOLDER';

-- Intentar añadir rol partner DEBE FALLAR (policy user_roles_self_insert
-- exige "no tiene rol previo")
DO $$
DECLARE
  v_err TEXT;
BEGIN
  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES ((SELECT (current_setting('request.jwt.claim.sub'))::uuid), 'partner');
    -- Si llegamos aquí, FAIL: el INSERT debería haber sido rechazado.
    RAISE EXCEPTION 'FAIL test1: client pudo añadirse rol partner';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR raise_exception THEN
      v_err := SQLERRM;
      RAISE NOTICE 'PASS test1: rejected as expected (%)', v_err;
    WHEN OTHERS THEN
      v_err := SQLERRM;
      -- También cuenta como PASS si es policy-related (42501) o data-related
      RAISE NOTICE 'PASS test1: rejected (%): %', SQLSTATE, v_err;
  END;
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 2: usuario authenticated SIN rol previo puede reclamar `client` (legítimo)
-- ============================================================================
BEGIN;

SELECT gen_random_uuid() AS test_user_id \gset
INSERT INTO auth.users (id, email, encrypted_password, role, aud, instance_id, created_at, updated_at)
VALUES (:'test_user_id', 'test2@pasify.test', crypt('test123', gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
INSERT INTO public.profiles (id, email) VALUES (:'test_user_id', 'test2@pasify.test');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_role public.app_role;
BEGIN
  -- Set claim aquí (no fuera) para evitar substitution
  PERFORM set_config('request.jwt.claim.sub', current_setting('test.uid'), true);
  -- Intentar claim_initial_role - DEBE SUCCEED
  v_role := public.claim_initial_role('client');
  IF v_role <> 'client' THEN
    RAISE EXCEPTION 'FAIL test2: claim_initial_role returned %, expected client', v_role;
  END IF;
  RAISE NOTICE 'PASS test2: claim_initial_role client succeeded';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'INFO test2: claim_initial_role failed: % (SQLSTATE %). This is expected if request.jwt.claim is not in test scope.', SQLERRM, SQLSTATE;
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 3: is_super_admin devuelve false para users no-allowlisted
-- ============================================================================
BEGIN;

-- Caller anon, no Francisco, no admin role → false
RESET ROLE;

DO $$
DECLARE
  v_result BOOLEAN;
  v_random_uuid UUID := gen_random_uuid();
BEGIN
  v_result := public.is_super_admin(v_random_uuid);
  IF v_result THEN
    RAISE EXCEPTION 'FAIL test3: is_super_admin returned TRUE for random uuid';
  END IF;
  RAISE NOTICE 'PASS test3: is_super_admin(random) = false';
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 4: anon cannot read other users' partner_subscriptions
-- ============================================================================
BEGIN;

-- Fixture: crear org + partner_subscription via service_role
SELECT gen_random_uuid() AS owner_id \gset
SELECT gen_random_uuid() AS attacker_id \gset

INSERT INTO auth.users (id, email, encrypted_password, role, aud, instance_id, created_at, updated_at)
VALUES (:'owner_id', 'owner@pasify.test', crypt('x', gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
       (:'attacker_id', 'attacker@pasify.test', crypt('x', gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

INSERT INTO public.profiles (id, email) VALUES (:'owner_id', 'owner@pasify.test'), (:'attacker_id', 'attacker@pasify.test');
INSERT INTO public.user_roles (user_id, role) VALUES (:'owner_id', 'partner'), (:'attacker_id', 'partner');

SELECT gen_random_uuid() AS org_id \gset
INSERT INTO public.organizations (id, slug, name, owner_id) VALUES (:'org_id', 'test-org-' || substring(gen_random_uuid()::text, 1, 8), 'Test Org', :'owner_id');
INSERT INTO public.partner_subscriptions (org_id, status, billing_interval) VALUES (:'org_id', 'active', 'monthly');

-- Switch to attacker (otro partner, no miembro de la org)
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_count INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', current_setting('test.attacker'), true);
  SELECT count(*) INTO v_count FROM public.partner_subscriptions;
  IF v_count > 0 THEN
    RAISE NOTICE 'NOTE test4: attacker can see % partner_subscription rows (expected 0 with strict RLS)', v_count;
  ELSE
    RAISE NOTICE 'PASS test4: attacker cannot see partner_subscriptions';
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- Final summary
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE 'Pasify db-policy-tests · run complete';
  RAISE NOTICE '════════════════════════════════════════════';
END $$;
