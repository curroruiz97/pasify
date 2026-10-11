-- Pasify · Ola 4, equipo: el rol 'owner' y el dueño real de la organización
-- (organizations.owner_id) solo los asigna o toca el propio dueño o un admin de
-- plataforma (WP9 · 9a), y las funciones sin llamadores event_has_sales y
-- tier_has_sales ya no las ejecuta ningún cliente (WP9 · 9c). Migración
-- 20260929140000. Datos sintéticos y ROLLBACK; un fallo lanza RAISE EXCEPTION 'FAIL …'.
--
-- Local (con las migraciones posteriores a 20260925110000 en la misma
-- transacción, la 20260929140000 incluida):
--   $env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o4_org_members_guard.sql','-c','ROLLBACK;'); & psql @a

BEGIN;

-- Entra como `_uid` (JWT de usuario autenticado). Sin _uid, sin usuario (anon / servidor).
CREATE OR REPLACE FUNCTION pg_temp.como(_uid UUID) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _uid IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  END IF;
END $$;

-- Ejecuta `_sql` con el rol de la API `_rol` y el usuario `_uid`. Devuelve
-- 'ok:<filas>' o '<SQLSTATE> <mensaje>'. Una RLS que filtra deja 'ok:0': por eso
-- cada caso comprueba además la fila desde el servidor.
CREATE OR REPLACE FUNCTION pg_temp.intentar(_rol TEXT, _uid UUID, _sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_res  TEXT;
  v_rows BIGINT;
BEGIN
  PERFORM pg_temp.como(_uid);
  EXECUTE format('SET LOCAL ROLE %I', _rol);
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_res := 'ok:' || v_rows;
  EXCEPTION WHEN OTHERS THEN
    v_res := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.esperar(_que TEXT, _res TEXT, _esperado TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF _res IS DISTINCT FROM _esperado THEN
    RAISE EXCEPTION 'FAIL %: esperaba [%] y llegó [%]', _que, _esperado, _res;
  END IF;
END $$;

DO $$
DECLARE
  -- Lo que dice el guard (no la RLS: un admin de la organización sí pasa la policy)
  c_bloqueo CONSTANT TEXT := '42501 Solo el dueño de la organización o un admin de Pasify puede asignar el rol de dueño o cambiar al dueño';
  v_owner     UUID := gen_random_uuid();  -- dueño real de la organización A (organizations.owner_id)
  v_admin     UUID := gen_random_uuid();  -- admin de la A
  v_admin2    UUID := gen_random_uuid();  -- otro admin de la A
  v_manager   UUID := gen_random_uuid();  -- manager de la A
  v_coowner   UUID := gen_random_uuid();  -- fila 'owner' que no es el dueño real
  v_friend    UUID := gen_random_uuid();  -- usuario con perfil al que se invita
  v_friend2   UUID := gen_random_uuid();
  v_platform  UUID := gen_random_uuid();  -- admin de plataforma, sin ser miembro de la A
  v_outsider  UUID := gen_random_uuid();  -- dueño real de la organización B
  v_invitado  UUID := gen_random_uuid();  -- acepta una invitación como 'owner'
  v_org       UUID;
  v_org2      UUID;
  v_org3      UUID;                       -- segunda organización del dueño de la A, sin fila propia suya
  v_org4      UUID;                       -- organización sin dueño (owner_id NULL: borró su cuenta)
  e_owner     TEXT;
  e_admin     TEXT;
  e_manager   TEXT;
  e_coowner   TEXT;
  e_friend    TEXT;
  e_friend2   TEXT;
  e_outsider  TEXT;
  e_invitado  TEXT;
  e_rrpp      TEXT;
  e_puerta    TEXT;
  e_plat      TEXT;
  v_res       TEXT;
  v_text      TEXT;
  v_count     INT;
  v_token     UUID;
  v_rec       RECORD;
BEGIN
  -- ------------------------------------------------------------------
  -- 0) Usuarios, organizaciones y equipo
  -- ------------------------------------------------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role, instance_id, created_at, updated_at)
  VALUES
    (v_owner,    'o4-dueno-'    || v_owner    || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin,    'o4-admin-'    || v_admin    || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_admin2,   'o4-admin2-'   || v_admin2   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_manager,  'o4-manager-'  || v_manager  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_coowner,  'o4-codueno-'  || v_coowner  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_friend,   'o4-amigo-'    || v_friend   || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_friend2,  'o4-amigo2-'   || v_friend2  || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_platform, 'o4-plataforma-' || v_platform || '@pasify.test', '{}',                       'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_outsider, 'o4-ajeno-'    || v_outsider || '@pasify.test', '{"initial_role":"partner"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now()),
    (v_invitado, 'o4-invitado-' || v_invitado || '@pasify.test', '{}',                         'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_platform, 'admin') ON CONFLICT DO NOTHING;

  SELECT email INTO e_owner    FROM public.profiles WHERE id = v_owner;
  SELECT email INTO e_admin    FROM public.profiles WHERE id = v_admin;
  SELECT email INTO e_manager  FROM public.profiles WHERE id = v_manager;
  SELECT email INTO e_coowner  FROM public.profiles WHERE id = v_coowner;
  SELECT email INTO e_friend   FROM public.profiles WHERE id = v_friend;
  SELECT email INTO e_friend2  FROM public.profiles WHERE id = v_friend2;
  SELECT email INTO e_outsider FROM public.profiles WHERE id = v_outsider;
  SELECT email INTO e_invitado FROM public.profiles WHERE id = v_invitado;
  -- Sin perfil: invitaciones pendientes
  e_rrpp   := 'o4-rrpp-'   || v_owner || '@pasify.test';
  e_puerta := 'o4-puerta-' || v_owner || '@pasify.test';
  IF e_owner IS NULL OR e_friend IS NULL OR e_outsider IS NULL THEN
    RAISE EXCEPTION 'FAIL preparación: los usuarios no tienen perfil con email';
  END IF;

  PERFORM pg_temp.como(v_owner);
  SET LOCAL ROLE authenticated;
  v_org := public.create_organization('O4 Local A', 'ES', NULL);
  RESET ROLE;
  PERFORM pg_temp.como(v_outsider);
  SET LOCAL ROLE authenticated;
  v_org2 := public.create_organization('O4 Local B', 'ES', NULL);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org AND owner_id = v_owner) THEN
    RAISE EXCEPTION 'FAIL preparación: el dueño real de la organización A no es v_owner';
  END IF;
  -- Lo normal: create_organization no crea fila 'owner' para el dueño (la A, en cambio, lleva una explícita más abajo).
  PERFORM pg_temp.como(v_owner);
  SET LOCAL ROLE authenticated;
  v_org3 := public.create_organization('O4 Local A2', 'ES', NULL);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_org3) THEN
    RAISE EXCEPTION 'FAIL preparación: create_organization ya crea filas de equipo';
  END IF;
  -- Una organización cuyo dueño ya no existe (organizations.owner_id es ON DELETE SET NULL)
  INSERT INTO public.organizations (slug, name, owner_id)
  VALUES ('o4-sin-dueno-' || v_owner, 'O4 sin dueño', NULL)
  RETURNING id INTO v_org4;
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org3, v_admin, e_admin, 'admin', 'active'),
         (v_org4, v_admin, e_admin, 'admin', 'active');

  -- Escribir desde el servidor (SQL directo: este test corre como postgres, sin usuario
  -- en el JWT) no pasa por el guard.
  PERFORM pg_temp.como(NULL);
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_admin,   e_admin,   'admin',   'active'),
         (v_org, v_admin2,  'o4-admin2@pasify.test', 'admin', 'active'),
         (v_org, v_manager, e_manager, 'manager', 'active'),
         (v_org, v_coowner, e_coowner, 'owner',   'active'),   -- un 'owner' que no es el dueño real
         (v_org, v_owner,   e_owner,   'admin',   'active');   -- fila explícita del dueño real

  -- ------------------------------------------------------------------
  -- 1) Un admin de la organización NO puede fabricar 'owner' ni tocar al dueño
  -- ------------------------------------------------------------------
  -- 1a) Por la RPC invite_member
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''owner'')', v_org, e_friend));
  PERFORM pg_temp.esperar('invite_member(owner) de un admin', v_res, c_bloqueo);
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_org AND email = e_friend) THEN
    RAISE EXCEPTION 'FAIL invite_member rechazó el rol owner pero dejó la fila';
  END IF;

  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''owner'')', v_org, 'o4-sin-perfil-' || v_owner || '@pasify.test'));
  PERFORM pg_temp.esperar('invite_member(owner) a un email sin perfil', v_res, c_bloqueo);

  -- al dueño real, con el rol que sea
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org, e_owner));
  PERFORM pg_temp.esperar('invite_member sobre la fila del dueño real', v_res, c_bloqueo);
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_owner;
  IF v_text IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FAIL invite_member cambió el rol de la fila del dueño: %', v_text; END IF;

  -- sobre una fila 'owner' existente (el ON CONFLICT la degradaría)
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org, e_coowner));
  PERFORM pg_temp.esperar('invite_member sobre una fila owner (ON CONFLICT)', v_res, c_bloqueo);
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_coowner;
  IF v_text IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'FAIL invite_member degradó una fila owner: %', v_text; END IF;

  -- 1b) Por INSERT directo (PostgREST)
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org, v_friend, e_friend));
  PERFORM pg_temp.esperar('INSERT de una fila owner', v_res, c_bloqueo);

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''pending'')',
    v_org, NULL, 'o4-pendiente-' || v_owner || '@pasify.test'));
  PERFORM pg_temp.esperar('INSERT de una invitación owner pendiente', v_res, c_bloqueo);

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''manager'', ''active'')',
    v_org, v_owner, 'o4-otro-email-del-dueno-' || v_owner || '@pasify.test'));
  PERFORM pg_temp.esperar('INSERT de otra fila a nombre del dueño real', v_res, c_bloqueo);

  -- Upsert (el ON CONFLICT … DO UPDATE de PostgREST) sobre una fila owner
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''manager'', ''active'') '
    'ON CONFLICT (org_id, email) DO UPDATE SET role = EXCLUDED.role',
    v_org, v_coowner, e_coowner));
  PERFORM pg_temp.esperar('upsert sobre una fila owner', v_res, c_bloqueo);

  -- 1c) Por UPDATE directo
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET role = ''owner'' WHERE org_id = %L AND user_id = %L', v_org, v_manager));
  PERFORM pg_temp.esperar('UPDATE: ascender a owner', v_res, c_bloqueo);
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND user_id = v_manager;
  IF v_text IS DISTINCT FROM 'manager' THEN RAISE EXCEPTION 'FAIL un admin ascendió a un manager a owner: %', v_text; END IF;

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET role = ''manager'' WHERE org_id = %L AND user_id = %L', v_org, v_coowner));
  PERFORM pg_temp.esperar('UPDATE: degradar una fila owner', v_res, c_bloqueo);

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET venue_id = NULL WHERE org_id = %L AND user_id = %L', v_org, v_coowner));
  PERFORM pg_temp.esperar('UPDATE: tocar cualquier cosa de una fila owner', v_res, c_bloqueo);

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET role = ''read_only'' WHERE org_id = %L AND user_id = %L', v_org, v_owner));
  PERFORM pg_temp.esperar('UPDATE: la fila del dueño real', v_res, c_bloqueo);

  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET user_id = %L WHERE org_id = %L AND user_id = %L', v_owner, v_org, v_manager));
  PERFORM pg_temp.esperar('UPDATE: reasignar una fila al dueño real', v_res, c_bloqueo);

  -- 1d) Por DELETE directo
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND user_id = %L', v_org, v_coowner));
  PERFORM pg_temp.esperar('DELETE de una fila owner', v_res, c_bloqueo);
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND user_id = %L', v_org, v_owner));
  PERFORM pg_temp.esperar('DELETE de la fila del dueño real', v_res, c_bloqueo);

  -- Nada de lo anterior cambió una sola fila
  SELECT string_agg(role::text, ',' ORDER BY role::text) INTO v_text FROM public.organization_members WHERE org_id = v_org;
  IF v_text IS DISTINCT FROM 'admin,admin,admin,manager,owner' THEN
    RAISE EXCEPTION 'FAIL los intentos de un admin cambiaron el equipo: %', v_text;
  END IF;

  -- 1e) El dueño real SIN fila propia (lo normal): no se le puede invitar ni darle una
  --     fila, aunque no haya nada que el ON CONFLICT pueda machacar.
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org3, e_owner));
  PERFORM pg_temp.esperar('invite_member al dueño real sin fila propia', v_res, c_bloqueo);
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''manager'', ''active'')',
    v_org3, v_owner, e_owner));
  PERFORM pg_temp.esperar('INSERT de una fila para el dueño real sin fila propia', v_res, c_bloqueo);
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_org3 AND (user_id = v_owner OR email = e_owner)) THEN
    RAISE EXCEPTION 'FAIL se creó una fila para el dueño real';
  END IF;

  -- 1f) Una organización sin dueño: nadie de su equipo puede dar el rol owner (solo un
  --     admin de plataforma); lo demás sigue igual.
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''owner'')', v_org4, e_friend));
  PERFORM pg_temp.esperar('invite_member(owner) en una organización sin dueño', v_res, c_bloqueo);
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org4, v_friend, e_friend));
  PERFORM pg_temp.esperar('INSERT de una fila owner en una organización sin dueño', v_res, c_bloqueo);
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org4, e_friend));
  PERFORM pg_temp.esperar('invite_member(manager) en una organización sin dueño', v_res, 'ok:1');
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_org4 AND email = e_friend AND role = 'manager') THEN
    RAISE EXCEPTION 'FAIL no se invitó a un manager a la organización sin dueño';
  END IF;

  -- ------------------------------------------------------------------
  -- 2) ... pero sigue gestionando al resto del equipo
  -- ------------------------------------------------------------------
  -- RPC: manager, rrpp y door_staff (con perfil nace activo; sin perfil, pendiente)
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org, e_friend));
  PERFORM pg_temp.esperar('invite_member(manager)', v_res, 'ok:1');
  SELECT role::text || '|' || status INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_friend;
  IF v_text IS DISTINCT FROM 'manager|active' THEN RAISE EXCEPTION 'FAIL invite_member(manager): %', v_text; END IF;

  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''rrpp'')', v_org, e_rrpp));
  PERFORM pg_temp.esperar('invite_member(rrpp)', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''door_staff'')', v_org, e_puerta));
  PERFORM pg_temp.esperar('invite_member(door_staff)', v_res, 'ok:1');
  SELECT string_agg(role::text || '|' || status, ',' ORDER BY role::text) INTO v_text
    FROM public.organization_members WHERE org_id = v_org AND email IN (e_rrpp, e_puerta);
  IF v_text IS DISTINCT FROM 'door_staff|pending,rrpp|pending' THEN RAISE EXCEPTION 'FAIL invitaciones pendientes: %', v_text; END IF;

  -- ...y cambia el rol con otra invitación (ON CONFLICT sobre una fila que no es owner)
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''rrpp'')', v_org, e_friend));
  PERFORM pg_temp.esperar('invite_member: manager -> rrpp', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.invite_member(%L, %L, ''door_staff'')', v_org, e_friend));
  PERFORM pg_temp.esperar('invite_member: rrpp -> door_staff', v_res, 'ok:1');
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_friend;
  IF v_text IS DISTINCT FROM 'door_staff' THEN RAISE EXCEPTION 'FAIL el cambio de rol por invite_member no se aplicó: %', v_text; END IF;

  -- Directo (PostgREST): alta de manager, rrpp y door_staff
  FOR v_rec IN SELECT * FROM (VALUES ('manager'), ('rrpp'), ('door_staff')) AS t(rol) LOOP
    v_res := pg_temp.intentar('authenticated', v_admin, format(
      'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, NULL, %L, %L, ''pending'')',
      v_org, 'o4-directo-' || v_rec.rol || '-' || v_owner || '@pasify.test', v_rec.rol));
    PERFORM pg_temp.esperar('INSERT directo de ' || v_rec.rol, v_res, 'ok:1');
  END LOOP;
  -- ...cambio de rol...
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET role = ''door_staff'' WHERE org_id = %L AND user_id = %L', v_org, v_manager));
  PERFORM pg_temp.esperar('UPDATE directo: manager -> door_staff', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'UPDATE public.organization_members SET role = ''manager'' WHERE org_id = %L AND user_id = %L', v_org, v_manager));
  PERFORM pg_temp.esperar('UPDATE directo: door_staff -> manager', v_res, 'ok:1');
  -- ...y baja de un miembro que no es owner
  v_res := pg_temp.intentar('authenticated', v_admin, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND email = %L', v_org, 'o4-directo-rrpp-' || v_owner || '@pasify.test'));
  PERFORM pg_temp.esperar('DELETE directo de un rrpp', v_res, 'ok:1');

  -- ------------------------------------------------------------------
  -- 3) El dueño real sí puede
  -- ------------------------------------------------------------------
  v_res := pg_temp.intentar('authenticated', v_owner, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org, v_friend2, e_friend2));
  PERFORM pg_temp.esperar('el dueño crea un owner (INSERT)', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_owner, format(
    'UPDATE public.organization_members SET role = ''admin'' WHERE org_id = %L AND user_id = %L', v_org, v_friend2));
  PERFORM pg_temp.esperar('el dueño degrada un owner (UPDATE)', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_owner, format(
    'UPDATE public.organization_members SET role = ''owner'' WHERE org_id = %L AND user_id = %L', v_org, v_friend2));
  PERFORM pg_temp.esperar('el dueño asciende a owner (UPDATE)', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_owner, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND user_id = %L', v_org, v_friend2));
  PERFORM pg_temp.esperar('el dueño borra un owner (DELETE)', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_owner, format('SELECT public.invite_member(%L, %L, ''owner'')', v_org, e_friend2));
  PERFORM pg_temp.esperar('el dueño invita a un owner (RPC)', v_res, 'ok:1');
  -- re-invitar con otro rol cambia una fila owner (ON CONFLICT)
  v_res := pg_temp.intentar('authenticated', v_owner, format('SELECT public.invite_member(%L, %L, ''manager'')', v_org, e_friend2));
  PERFORM pg_temp.esperar('el dueño cambia un owner por RPC (ON CONFLICT)', v_res, 'ok:1');
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_friend2;
  IF v_text IS DISTINCT FROM 'manager' THEN RAISE EXCEPTION 'FAIL el dueño no pudo cambiar un owner por RPC: %', v_text; END IF;

  -- ------------------------------------------------------------------
  -- 4) Un admin de plataforma también (sin ser miembro de la organización)
  -- ------------------------------------------------------------------
  e_plat := 'o4-plataforma-owner-' || v_owner || '@pasify.test';
  v_res := pg_temp.intentar('authenticated', v_platform, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org, v_friend2, e_plat));
  PERFORM pg_temp.esperar('admin de plataforma: INSERT owner', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_platform, format(
    'UPDATE public.organization_members SET role = ''manager'' WHERE org_id = %L AND email = %L', v_org, e_plat));
  PERFORM pg_temp.esperar('admin de plataforma: UPDATE de una fila owner', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_platform, format(
    'UPDATE public.organization_members SET role = ''owner'' WHERE org_id = %L AND user_id = %L', v_org, v_manager));
  PERFORM pg_temp.esperar('admin de plataforma: UPDATE a owner', v_res, 'ok:1');
  v_res := pg_temp.intentar('authenticated', v_platform, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND user_id = %L', v_org, v_owner));
  PERFORM pg_temp.esperar('admin de plataforma: DELETE de la fila del dueño real', v_res, 'ok:1');
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = v_org AND user_id = v_owner) THEN
    RAISE EXCEPTION 'FAIL el admin de plataforma no pudo borrar la fila del dueño';
  END IF;
  -- Como miembro admin de la organización, también por RPC
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org, v_platform, 'o4-plataforma@pasify.test', 'admin', 'active');
  v_res := pg_temp.intentar('authenticated', v_platform, format('SELECT public.invite_member(%L, %L, ''owner'')', v_org, e_friend));
  PERFORM pg_temp.esperar('admin de plataforma: invite_member(owner)', v_res, 'ok:1');
  SELECT role::text INTO v_text FROM public.organization_members WHERE org_id = v_org AND email = e_friend;
  IF v_text IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'FAIL el admin de plataforma no pudo crear un owner por RPC: %', v_text; END IF;
  -- ...y en una organización sin dueño, donde nadie más puede
  v_res := pg_temp.intentar('authenticated', v_platform, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org4, v_friend2, e_friend2));
  PERFORM pg_temp.esperar('admin de plataforma: INSERT owner en una organización sin dueño', v_res, 'ok:1');

  -- ------------------------------------------------------------------
  -- 5) Lo que no es la API sigue como siempre
  -- ------------------------------------------------------------------
  -- service_role (las edge functions)
  v_res := pg_temp.intentar('service_role', NULL, format(
    'INSERT INTO public.organization_members (org_id, user_id, email, role, status) VALUES (%L, %L, %L, ''owner'', ''active'')',
    v_org2, v_friend2, e_friend2));
  PERFORM pg_temp.esperar('service_role: INSERT owner', v_res, 'ok:1');
  v_res := pg_temp.intentar('service_role', NULL, format(
    'DELETE FROM public.organization_members WHERE org_id = %L AND user_id = %L', v_org2, v_friend2));
  PERFORM pg_temp.esperar('service_role: DELETE owner', v_res, 'ok:1');

  -- accept_invitation (DEFINER): quien acepta una invitación 'owner' pendiente
  INSERT INTO public.organization_members (org_id, user_id, email, role, status, invitation_expires_at)
  VALUES (v_org2, NULL, e_invitado, 'owner', 'pending', now() + INTERVAL '1 day')
  RETURNING invitation_token INTO v_token;
  PERFORM pg_temp.como(v_invitado);
  PERFORM public.accept_invitation(v_token);
  PERFORM pg_temp.como(NULL);
  SELECT role::text || '|' || status INTO v_text FROM public.organization_members WHERE org_id = v_org2 AND user_id = v_invitado;
  IF v_text IS DISTINCT FROM 'owner|active' THEN RAISE EXCEPTION 'FAIL accept_invitation no activó la invitación owner: %', v_text; END IF;

  -- partner_close_account (DEFINER, con la sesión del dueño): da de baja a todo el equipo, owner incluidos
  INSERT INTO public.organization_members (org_id, user_id, email, role, status)
  VALUES (v_org2, v_outsider, e_outsider, 'admin', 'active');
  v_res := pg_temp.intentar('authenticated', v_outsider, 'SELECT public.partner_close_account()');
  PERFORM pg_temp.esperar('partner_close_account del dueño', v_res, 'ok:1');
  SELECT count(*) INTO v_count FROM public.organization_members WHERE org_id = v_org2 AND status <> 'removed';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL partner_close_account dejó % miembros sin dar de baja (el guard no debe frenar las funciones DEFINER)', v_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org2 AND status = 'closed') THEN
    RAISE EXCEPTION 'FAIL partner_close_account no cerró la organización';
  END IF;

  -- ------------------------------------------------------------------
  -- 6) Catálogo: trigger, EXECUTE de cada función tocada
  -- ------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.organization_members'::regclass
                    AND tgname = 'trg_org_members_guard_owner' AND tgenabled = 'O'
                    AND (tgtype & 1) = 1          -- por fila
                    AND (tgtype & 2) = 2          -- BEFORE
                    AND (tgtype & 4) = 4          -- INSERT
                    AND (tgtype & 8) = 8          -- DELETE
                    AND (tgtype & 16) = 16) THEN  -- UPDATE
    RAISE EXCEPTION 'FAIL falta trg_org_members_guard_owner (BEFORE INSERT OR UPDATE OR DELETE, por fila, activo)';
  END IF;

  FOR v_rec IN
    SELECT * FROM (VALUES
      ('public.org_members_guard_owner()',                                       'anon',          FALSE),
      ('public.org_members_guard_owner()',                                       'authenticated', FALSE),
      ('public.invite_member(uuid,text,org_member_role_t,uuid,uuid)',            'anon',          FALSE),
      ('public.invite_member(uuid,text,org_member_role_t,uuid,uuid)',            'authenticated', TRUE),
      ('public.event_has_sales(uuid)',                                           'anon',          FALSE),
      ('public.event_has_sales(uuid)',                                           'authenticated', FALSE),
      ('public.event_has_sales(uuid)',                                           'service_role',  TRUE),
      ('public.tier_has_sales(uuid)',                                            'anon',          FALSE),
      ('public.tier_has_sales(uuid)',                                            'authenticated', FALSE),
      ('public.tier_has_sales(uuid)',                                            'service_role',  TRUE)
    ) AS t(fn, rol, esperado)
  LOOP
    IF has_function_privilege(v_rec.rol, v_rec.fn, 'EXECUTE') IS DISTINCT FROM v_rec.esperado THEN
      RAISE EXCEPTION 'FAIL EXECUTE de % sobre %: esperaba %', v_rec.rol, v_rec.fn, v_rec.esperado;
    END IF;
  END LOOP;

  -- 9c: un usuario de la API ya no puede preguntar si un evento o un tipo tiene ventas...
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.event_has_sales(%L)', gen_random_uuid()));
  IF v_res NOT LIKE '42501 %' THEN RAISE EXCEPTION 'FAIL authenticated sigue ejecutando event_has_sales: %', v_res; END IF;
  v_res := pg_temp.intentar('authenticated', v_admin, format('SELECT public.tier_has_sales(%L)', gen_random_uuid()));
  IF v_res NOT LIKE '42501 %' THEN RAISE EXCEPTION 'FAIL authenticated sigue ejecutando tier_has_sales: %', v_res; END IF;
  -- ...y el servidor sí, con la misma respuesta de siempre
  v_res := pg_temp.intentar('service_role', NULL, format('SELECT public.event_has_sales(%L)', gen_random_uuid()));
  PERFORM pg_temp.esperar('service_role: event_has_sales', v_res, 'ok:1');
  v_res := pg_temp.intentar('service_role', NULL, format('SELECT public.tier_has_sales(%L)', gen_random_uuid()));
  PERFORM pg_temp.esperar('service_role: tier_has_sales', v_res, 'ok:1');
  IF public.event_has_sales(gen_random_uuid()) IS DISTINCT FROM FALSE OR public.tier_has_sales(gen_random_uuid()) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'FAIL event_has_sales o tier_has_sales dejaron de responder false para un id sin ventas';
  END IF;

  -- El dueño real sigue siendo el mismo
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org AND owner_id = v_owner) THEN
    RAISE EXCEPTION 'FAIL cambió organizations.owner_id';
  END IF;

  RAISE NOTICE 'PASS o4_org_members_guard: un admin de la organización no crea ni toca owners (INSERT, UPDATE, DELETE, upsert y RPC) y sigue gestionando al resto; el dueño y un admin de plataforma sí; accept_invitation, partner_close_account y service_role no se frenan; event_has_sales y tier_has_sales sin clientes';
END $$;

ROLLBACK;
