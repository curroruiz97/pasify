-- Pasify · versionar get_user_roles
--
-- useAuth carga los roles con rpc('get_user_roles'), pero la función solo
-- existía en producción (creada a mano, sin migración). Una base nueva
-- (Supabase local, CI, ramas) no la tenía y el login se quedaba sin roles.
--
-- Si ya existe con otro tipo de retorno se conserva tal cual (CREATE OR
-- REPLACE no puede cambiarlo); en ambos casos se cierran los permisos.
-- Solo devuelve los roles propios, salvo a un admin o al servidor.

DO $$
DECLARE
  v_ret regtype;
BEGIN
  SELECT p.prorettype::regtype INTO v_ret
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.get_user_roles(uuid)')
    AND NOT p.proretset;

  IF to_regprocedure('public.get_user_roles(uuid)') IS NULL OR v_ret = 'text[]'::regtype THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.get_user_roles(_user_id uuid)
      RETURNS text[]
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $b$
        SELECT COALESCE(array_agg(ur.role::text ORDER BY ur.role::text), ARRAY[]::text[])
        FROM public.user_roles ur
        WHERE ur.user_id = _user_id
          AND (auth.uid() IS NULL
               OR auth.uid() = _user_id
               OR public.has_role(auth.uid(), 'admin'::public.app_role))
      $b$
    $f$;
  ELSE
    RAISE NOTICE 'get_user_roles(uuid) ya existe con otro retorno; se conserva';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_user_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_roles(uuid) TO authenticated, service_role;
