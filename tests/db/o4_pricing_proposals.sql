-- Pasify · Ola 4, propuestas de precio de la IA (WP10): una sola propuesta
-- pendiente por tipo de entrada y nada por debajo de 0,50 €. Migración
-- 20260929150000_o4_pricing_proposals_una_pendiente.
-- Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- El test carga la migración él mismo (\i) sobre duplicados reales: quita el
-- índice, deja varias `pending` por tipo como había antes y comprueba lo que
-- la migración hace con ellas. Por eso se lanza desde la raíz del repo, como
-- en el CI, y sirve igual si la base ya la tenía aplicada (es idempotente):
--   psql … -v ON_ERROR_STOP=1 -f tests/db/o4_pricing_proposals.sql

BEGIN;

-- Entra como `_uid` (JWT de usuario autenticado).
CREATE OR REPLACE FUNCTION pg_temp.como(_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
END $$;

-- Ids que pasan de un bloque DO al siguiente (el \i de la migración va en medio).
CREATE TEMP TABLE o4_ids (k TEXT PRIMARY KEY, id UUID NOT NULL) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.id(_k TEXT) RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT id FROM o4_ids WHERE k = _k
$$;

-- Aplica una propuesta como `_uid` y dice qué pasó: 'ok:<precio nuevo>' o
-- 'error:<sqlstate>:<mensaje>'. Cada llamada es un subbloque: si falla, no
-- deja nada a medias ni el rol puesto.
CREATE OR REPLACE FUNCTION pg_temp.aplicar(_uid UUID, _prop UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_res   RECORD;
  v_state TEXT;
  v_msg   TEXT;
BEGIN
  PERFORM pg_temp.como(_uid);
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT * INTO v_res FROM public.apply_pricing_proposal(_prop);
    RESET ROLE;
    RETURN 'ok:' || v_res.new_price_cents;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RESET ROLE;
    RETURN 'error:' || v_state || ':' || v_msg;
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 1) Estado previo a la migración: sin el índice y con propuestas repetidas
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_partner UUID := gen_random_uuid();
  v_org     UUID;
  v_event   UUID;
  v_event2  UUID;
  v_tier    UUID;
  v_k       TEXT;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES (v_partner, 'o4-partner-' || v_partner || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());

  PERFORM pg_temp.como(v_partner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O4 Local', 'ES', NULL);
  RESET ROLE;

  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O4 Evento', 'Madrid', now() + INTERVAL '3 days', now() + INTERVAL '3 days 6 hours', 'published', 2500)
  RETURNING id INTO v_event;
  INSERT INTO public.events (partner_id, org_id, title, city, date_start, date_end, status, price_cents)
  VALUES (v_partner, v_org, 'O4 Evento 2', 'Madrid', now() + INTERVAL '4 days', now() + INTERVAL '4 days 6 hours', 'published', 2500)
  RETURNING id INTO v_event2;
  INSERT INTO o4_ids VALUES ('partner', v_partner), ('event', v_event), ('event2', v_event2);

  -- Todos los tipos cuestan 25 €. dup_*: los de las propuestas repetidas;
  -- ap_*: los de apply_pricing_proposal; uni_*: los del índice.
  FOREACH v_k IN ARRAY ARRAY['dup_a', 'dup_b', 'dup_c', 'dup_d', 'dup_e', 'ap_30', 'ap_49', 'ap_1', 'ap_0', 'ap_50',
                             'ap_sube', 'ap_neg', 'ap_ventas', 'uni_1', 'uni_2']
  LOOP
    INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event, v_k, 2500, 100) RETURNING id INTO v_tier;
    INSERT INTO o4_ids VALUES (v_k, v_tier);
  END LOOP;
  INSERT INTO public.ticket_tiers (event_id, name, price_cents, capacity) VALUES (v_event2, 'dup_f', 2500, 100) RETURNING id INTO v_tier;
  INSERT INTO o4_ids VALUES ('dup_f', v_tier);

  -- Como antes de la migración: sin el índice único
  DROP INDEX IF EXISTS public.pricing_proposals_one_pending_per_tier;

  -- A: tres pendientes; la más reciente es a3
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_a'), 2500, 2700, 'pending', now() - INTERVAL '3 hours');
  INSERT INTO o4_ids SELECT 'a1', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_a') AND suggested_price_cents = 2700;
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_a'), 2500, 2800, 'pending', now() - INTERVAL '2 hours');
  INSERT INTO o4_ids SELECT 'a2', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_a') AND suggested_price_cents = 2800;
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_a'), 2500, 2900, 'pending', now() - INTERVAL '1 hour');
  INSERT INTO o4_ids SELECT 'a3', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_a') AND suggested_price_cents = 2900;

  -- B: dos pendientes con la misma fecha de creación (decide el id)
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_b'), 2500, 2100, 'pending', now() - INTERVAL '5 hours'),
         (v_event, pg_temp.id('dup_b'), 2500, 2200, 'pending', now() - INTERVAL '5 hours');

  -- C: una sola pendiente, no se toca
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_c'), 2500, 2300, 'pending', now() - INTERVAL '1 hour');
  INSERT INTO o4_ids SELECT 'c1', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_c');

  -- D: una pendiente y una propuesta de cada uno de los otros estados (no se tocan)
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, pg_temp.id('dup_d'), 2500, 2400, 'pending',    now() - INTERVAL '1 hour'),
         (v_event, pg_temp.id('dup_d'), 2500, 2400, 'applied',    now() - INTERVAL '5 hours'),
         (v_event, pg_temp.id('dup_d'), 2500, 2400, 'rejected',   now() - INTERVAL '6 hours'),
         (v_event, pg_temp.id('dup_d'), 2500, 2400, 'expired',    now() - INTERVAL '7 hours'),
         (v_event, pg_temp.id('dup_d'), 2500, 2400, 'superseded', now() - INTERVAL '8 hours'),
         (v_event, pg_temp.id('dup_d'), 2500, 2400, 'accepted',   now() - INTERVAL '9 hours');

  -- E: dos pendientes ya caducadas: la migración solo quita repetidas, no caduca
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at, expires_at)
  VALUES (v_event, pg_temp.id('dup_e'), 2500, 2000, 'pending', now() - INTERVAL '3 days', now() - INTERVAL '2 days');
  INSERT INTO o4_ids SELECT 'e1', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_e') AND suggested_price_cents = 2000;
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at, expires_at)
  VALUES (v_event, pg_temp.id('dup_e'), 2500, 2050, 'pending', now() - INTERVAL '2 days', now() - INTERVAL '1 day');
  INSERT INTO o4_ids SELECT 'e2', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_e') AND suggested_price_cents = 2050;

  -- F: otro evento del mismo local; se agrupa por tipo, no por evento
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event2, pg_temp.id('dup_f'), 2500, 2600, 'pending', now() - INTERVAL '2 hours');
  INSERT INTO o4_ids SELECT 'f1', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_f') AND suggested_price_cents = 2600;
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event2, pg_temp.id('dup_f'), 2500, 2650, 'pending', now() - INTERVAL '1 hour');
  INSERT INTO o4_ids SELECT 'f2', id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_f') AND suggested_price_cents = 2650;

  -- Sin tipo (de evento): dos pendientes que no son duplicadas de ningún tipo
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status, created_at)
  VALUES (v_event, NULL, 2500, 2500, 'pending', now() - INTERVAL '2 hours'),
         (v_event, NULL, 2500, 2500, 'pending', now() - INTERVAL '1 hour');

  -- Sin el índice, el estado de partida tiene de verdad duplicados
  IF (SELECT count(*) FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_a') AND status = 'pending') <> 3 THEN
    RAISE EXCEPTION 'FAIL el estado previo no tiene las 3 pendientes repetidas';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- La migración, sobre esos duplicados (si falla, psql corta: ON_ERROR_STOP)
-- ----------------------------------------------------------------------------
\i supabase/migrations/20260929150000_o4_pricing_proposals_una_pendiente.sql

-- ----------------------------------------------------------------------------
-- 2) Qué hizo la migración con los duplicados
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_text  TEXT;
  v_count INT;
  v_rec   RECORD;
BEGIN
  -- A: se queda la más reciente; las demás, superseded, con fecha y sin decisor
  SELECT string_agg(status, ',' ORDER BY created_at) INTO v_text
    FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_a');
  IF v_text IS DISTINCT FROM 'superseded,superseded,pending' THEN
    RAISE EXCEPTION 'FAIL tres pendientes del mismo tipo quedaron en %', v_text;
  END IF;
  IF (SELECT status FROM public.pricing_proposals WHERE id = pg_temp.id('a3')) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL no se conservó la más reciente';
  END IF;
  FOR v_rec IN SELECT * FROM public.pricing_proposals WHERE id IN (pg_temp.id('a1'), pg_temp.id('a2')) LOOP
    IF v_rec.status <> 'superseded' OR v_rec.decided_at IS NULL OR v_rec.decided_by IS NOT NULL OR v_rec.applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL una repetida no quedó como superseded con decided_at y sin decisor: %', row_to_json(v_rec);
    END IF;
  END LOOP;

  -- B: con la misma fecha de creación se queda la de id mayor (resultado estable)
  SELECT count(*) INTO v_count FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_b') AND status = 'pending';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL con empate quedaron % pendientes (esperaba 1)', v_count; END IF;
  IF (SELECT id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_b') AND status = 'pending')
     IS DISTINCT FROM (SELECT id FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_b') ORDER BY id DESC LIMIT 1) THEN
    RAISE EXCEPTION 'FAIL con empate no se conservó la de id mayor';
  END IF;

  -- C: la única pendiente no se toca
  IF (SELECT status FROM public.pricing_proposals WHERE id = pg_temp.id('c1')) <> 'pending'
     OR (SELECT decided_at FROM public.pricing_proposals WHERE id = pg_temp.id('c1')) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL se tocó la única pendiente de un tipo';
  END IF;

  -- D: los otros estados siguen como estaban
  SELECT string_agg(status, ',' ORDER BY created_at) INTO v_text FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_d');
  IF v_text IS DISTINCT FROM 'accepted,superseded,expired,rejected,applied,pending' THEN
    RAISE EXCEPTION 'FAIL se alteraron propuestas que no estaban pendientes: %', v_text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_d') AND decided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL se les puso decided_at a propuestas que no eran repetidas';
  END IF;

  -- E: caducadas, pero repetidas: se queda la más reciente (la caducidad la cierra la función)
  SELECT string_agg(status, ',' ORDER BY created_at) INTO v_text FROM public.pricing_proposals WHERE tier_id = pg_temp.id('dup_e');
  IF v_text IS DISTINCT FROM 'superseded,pending' OR (SELECT status FROM public.pricing_proposals WHERE id = pg_temp.id('e2')) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL pendientes caducadas repetidas: %', v_text;
  END IF;

  -- F: se agrupa por tipo, no por evento
  IF (SELECT status FROM public.pricing_proposals WHERE id = pg_temp.id('f1')) <> 'superseded'
     OR (SELECT status FROM public.pricing_proposals WHERE id = pg_temp.id('f2')) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL repetidas del tipo de otro evento';
  END IF;

  -- Sin tipo: no son repetidas de nada
  SELECT count(*) INTO v_count FROM public.pricing_proposals WHERE tier_id IS NULL AND status = 'pending'
     AND event_id = pg_temp.id('event');
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL las propuestas sin tipo se trataron como repetidas (quedan %)', v_count; END IF;

  -- Ningún tipo con más de una pendiente
  IF EXISTS (SELECT 1 FROM public.pricing_proposals WHERE status = 'pending' AND tier_id IS NOT NULL GROUP BY tier_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'FAIL queda algún tipo con varias pendientes';
  END IF;

  -- Solo se retiraron las 5 repetidas: a1, a2, una de B, e1 y f1 (la d5 ya era
  -- superseded de antes y no tiene decided_at)
  SELECT count(*) INTO v_count FROM public.pricing_proposals WHERE status = 'superseded' AND decided_at IS NOT NULL AND tier_id IN
    (SELECT id FROM o4_ids WHERE k LIKE 'dup\_%');
  IF v_count <> 5 THEN RAISE EXCEPTION 'FAIL se esperaban 5 repetidas retiradas y hay %', v_count; END IF;
END $$;

-- Idempotente: aplicarla otra vez no cambia nada
\i supabase/migrations/20260929150000_o4_pricing_proposals_una_pendiente.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.pricing_proposals WHERE status = 'superseded' AND decided_at IS NOT NULL AND tier_id IN
        (SELECT id FROM o4_ids WHERE k LIKE 'dup\_%')) <> 5 THEN
    RAISE EXCEPTION 'FAIL aplicar la migración dos veces cambió las repetidas';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) El índice único parcial: una sola pendiente por tipo
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_event   UUID := pg_temp.id('event');
  v_uni1    UUID := pg_temp.id('uni_1');
  v_uni2    UUID := pg_temp.id('uni_2');
  v_first   UUID;
  v_other   UUID;
  v_cons    TEXT;
  v_text    TEXT;
  v_count   INT;
BEGIN
  -- Es un índice único y parcial (solo mira las pendientes)
  SELECT indexdef INTO v_text FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'pricing_proposals' AND indexname = 'pricing_proposals_one_pending_per_tier';
  IF v_text IS NULL OR v_text NOT LIKE 'CREATE UNIQUE INDEX%(tier_id) WHERE (status = ''pending''::text)' THEN
    RAISE EXCEPTION 'FAIL índice único parcial de pendientes por tipo: %', v_text;
  END IF;

  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, v_uni1, 2500, 2700, 'pending') RETURNING id INTO v_first;

  -- Una segunda pendiente del mismo tipo no entra, y la rechaza ese índice
  v_cons := NULL;
  BEGIN
    INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
    VALUES (v_event, v_uni1, 2500, 2800, 'pending');
    RAISE EXCEPTION 'FAIL se insertaron dos pendientes del mismo tipo';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
  END;
  IF v_cons IS DISTINCT FROM 'pricing_proposals_one_pending_per_tier' THEN
    RAISE EXCEPTION 'FAIL la segunda pendiente la rechazó %, no el índice nuevo', v_cons;
  END IF;

  -- Tampoco vale pasar a pendiente una propuesta ya decidida si hay otra pendiente
  BEGIN
    INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
    VALUES (v_event, v_uni1, 2500, 2800, 'rejected') RETURNING id INTO v_other;
    UPDATE public.pricing_proposals SET status = 'pending' WHERE id = v_other;
    RAISE EXCEPTION 'FAIL se reabrió una propuesta como segunda pendiente';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Otro tipo, aunque sea del mismo evento: sin problema
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, v_uni2, 2500, 2700, 'pending');

  -- Las que no están pendientes se pueden repetir todo lo que haga falta
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, v_uni1, 2500, 2800, 'applied'),   (v_event, v_uni1, 2500, 2800, 'applied'),
         (v_event, v_uni1, 2500, 2800, 'rejected'),  (v_event, v_uni1, 2500, 2800, 'rejected'),
         (v_event, v_uni1, 2500, 2800, 'expired'),   (v_event, v_uni1, 2500, 2800, 'expired'),
         (v_event, v_uni1, 2500, 2800, 'superseded'), (v_event, v_uni1, 2500, 2800, 'superseded'),
         (v_event, v_uni1, 2500, 2800, 'accepted'),  (v_event, v_uni1, 2500, 2800, 'accepted');

  -- Al decidir la pendiente, el hueco queda libre para otra
  UPDATE public.pricing_proposals SET status = 'rejected', decided_at = now() WHERE id = v_first;
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, v_uni1, 2500, 2900, 'pending');
  SELECT count(*) INTO v_count FROM public.pricing_proposals WHERE tier_id = v_uni1 AND status = 'pending';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL tras decidir la pendiente debía quedar una nueva, hay %', v_count; END IF;

  -- Las propuestas sin tipo (de evento) no chocan entre sí
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, NULL, 2500, 2500, 'pending');
END $$;

-- ----------------------------------------------------------------------------
-- 4) apply_pricing_proposal: nada entre 1 y 49 c; 0 y desde 50 siguen como antes
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_partner UUID := pg_temp.id('partner');
  v_event   UUID := pg_temp.id('event');
  v_rec     RECORD;
  v_prop    UUID;
  v_res     TEXT;
  v_price   INT;
  v_status  TEXT;
  v_decider UUID;
BEGIN
  -- Mismos permisos que antes de la migración
  FOR v_rec IN
    SELECT * FROM (VALUES ('anon', FALSE), ('authenticated', TRUE), ('service_role', TRUE)) AS t(rol, esperado)
  LOOP
    IF has_function_privilege(v_rec.rol, 'public.apply_pricing_proposal(uuid)', 'EXECUTE') IS DISTINCT FROM v_rec.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre apply_pricing_proposal: esperaba %', v_rec.rol, v_rec.esperado;
    END IF;
  END LOOP;

  -- 4.1) De 1 a 49 c: error propio, y no se toca ni la propuesta ni el precio
  FOR v_rec IN
    SELECT * FROM (VALUES ('ap_30', 30, '0,30'), ('ap_49', 49, '0,49'), ('ap_1', 1, '0,01')) AS t(clave, sugerido, euros)
  LOOP
    INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
    VALUES (v_event, pg_temp.id(v_rec.clave), 2500, v_rec.sugerido, 'pending') RETURNING id INTO v_prop;

    v_res := pg_temp.aplicar(v_partner, v_prop);
    IF v_res NOT LIKE 'error:23514:El precio sugerido (' || v_rec.euros || ' €) está por debajo del mínimo de 0,50 €%' THEN
      RAISE EXCEPTION 'FAIL aplicar una propuesta de % c debía dar el error propio y dio: %', v_rec.sugerido, v_res;
    END IF;
    SELECT price_cents INTO v_price FROM public.ticket_tiers WHERE id = pg_temp.id(v_rec.clave);
    SELECT status INTO v_status FROM public.pricing_proposals WHERE id = v_prop;
    IF v_price <> 2500 OR v_status <> 'pending' THEN
      RAISE EXCEPTION 'FAIL tras el rechazo de % c el precio es % y la propuesta %', v_rec.sugerido, v_price, v_status;
    END IF;

    -- Sin los triggers de ticket_tiers (que ya lo frenarían por su cuenta), la comprobación de la
    -- propia función sigue rechazándola
    SET LOCAL session_replication_role = replica;
    v_res := pg_temp.aplicar(v_partner, v_prop);
    SET LOCAL session_replication_role = origin;
    IF v_res NOT LIKE 'error:23514:El precio sugerido (' || v_rec.euros || ' €) está por debajo del mínimo de 0,50 €%' THEN
      RAISE EXCEPTION 'FAIL sin los triggers, aplicar % c debía rechazarlo la función y dio: %', v_rec.sugerido, v_res;
    END IF;
    SELECT price_cents INTO v_price FROM public.ticket_tiers WHERE id = pg_temp.id(v_rec.clave);
    IF v_price <> 2500 THEN RAISE EXCEPTION 'FAIL sin los triggers, la propuesta de % c cambió el precio a %', v_rec.sugerido, v_price; END IF;
  END LOOP;

  -- 4.2) 0 € (tipo gratuito) y 50 c o más siguen aplicándose
  FOR v_rec IN
    SELECT * FROM (VALUES ('ap_0', 0), ('ap_50', 50), ('ap_sube', 2750)) AS t(clave, sugerido)
  LOOP
    INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
    VALUES (v_event, pg_temp.id(v_rec.clave), 2500, v_rec.sugerido, 'pending') RETURNING id INTO v_prop;

    v_res := pg_temp.aplicar(v_partner, v_prop);
    IF v_res IS DISTINCT FROM 'ok:' || v_rec.sugerido THEN
      RAISE EXCEPTION 'FAIL aplicar una propuesta de % c debía funcionar y dio: %', v_rec.sugerido, v_res;
    END IF;
    SELECT price_cents INTO v_price FROM public.ticket_tiers WHERE id = pg_temp.id(v_rec.clave);
    SELECT status, decided_by INTO v_status, v_decider FROM public.pricing_proposals WHERE id = v_prop;
    IF v_price <> v_rec.sugerido OR v_status <> 'applied' OR v_decider IS DISTINCT FROM v_partner THEN
      RAISE EXCEPTION 'FAIL tras aplicar % c: precio %, propuesta %, decisor %', v_rec.sugerido, v_price, v_status, v_decider;
    END IF;
  END LOOP;

  -- 4.3) Lo que ya rechazaba sigue igual: precio negativo
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, pg_temp.id('ap_neg'), 2500, -5, 'pending') RETURNING id INTO v_prop;
  v_res := pg_temp.aplicar(v_partner, v_prop);
  IF v_res IS DISTINCT FROM 'error:P0001:Invalid suggested price' THEN
    RAISE EXCEPTION 'FAIL un precio negativo debía seguir dando Invalid suggested price y dio: %', v_res;
  END IF;

  -- 4.4) Un tipo con una entrada pagada no admite cambio de precio (trigger de ticket_tiers):
  --      por eso la edge function no propone nada para los tipos con ventas
  INSERT INTO public.tickets (event_id, tier_id, buyer_email, status, amount_paid_cents, paid_at)
  VALUES (v_event, pg_temp.id('ap_ventas'), 'o4-comprador@pasify.test', 'paid', 2500, now());
  INSERT INTO public.pricing_proposals (event_id, tier_id, current_price_cents, suggested_price_cents, status)
  VALUES (v_event, pg_temp.id('ap_ventas'), 2500, 2750, 'pending') RETURNING id INTO v_prop;
  v_res := pg_temp.aplicar(v_partner, v_prop);
  IF v_res NOT LIKE 'error:23514:%' THEN
    RAISE EXCEPTION 'FAIL cambiar el precio de un tipo con ventas debía fallar y dio: %', v_res;
  END IF;
  SELECT price_cents INTO v_price FROM public.ticket_tiers WHERE id = pg_temp.id('ap_ventas');
  IF v_price <> 2500 THEN RAISE EXCEPTION 'FAIL un tipo con ventas cambió de precio a %', v_price; END IF;

  RAISE NOTICE 'PASS o4_pricing_proposals: repetidas resueltas por la migración (se queda la más reciente), una sola pendiente por tipo (índice único parcial) y apply_pricing_proposal sin precios de 1 a 49 c (0 y desde 50 siguen)';
END $$;

ROLLBACK;
