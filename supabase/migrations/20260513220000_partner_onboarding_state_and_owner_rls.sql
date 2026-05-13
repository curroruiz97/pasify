-- Pasify · 0039 partner onboarding server-side state + brand/venue owner RLS
--
-- Resuelve dos problemas que rompen la experiencia del partner:
--
-- 1) El onboarding se reabre al recargar porque solo se marcaba "done"
--    en localStorage. Cualquier dispositivo nuevo o limpieza de cache
--    lo disparaba otra vez. Creamos `partner_onboarding_state` como
--    fuente de verdad server-side por (user, org, venue).
--
-- 2) Las tablas `brands` y `venues` tenían RLS para SELECT publico +
--    admin-all, pero NO tenian policies INSERT/UPDATE para el owner
--    de la organizacion. Eso forzaba a meter los datos del local en
--    `profiles.business_*` (mezclando persona con local) y dejaba
--    `Configuracion` sin persistencia real. Anadimos las policies
--    minimas para que owner/admin/manager de la org puedan crear y
--    editar sus propios brands y venues.
--
-- 3) RPCs:
--    - `partner_onboarding_status()`: devuelve si el current user
--      ha completado el onboarding (server-truth).
--    - `complete_partner_onboarding(_org, _venue, _data)`: marca
--      `partner_onboarding_state.status = 'completed'` atomicamente.
--
-- Idempotente: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` +
-- `CREATE POLICY` antes de cada policy, `CREATE OR REPLACE FUNCTION`.

-- ============================================================================
-- 1) partner_onboarding_state — fuente de verdad server-side
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.partner_onboarding_state (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id        UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  venue_id      UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','skipped')),
  current_step  TEXT,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un partner puede tener varias filas (una por org distinta), pero solo
-- una fila por (user_id, org_id). Si org_id es NULL (super-admin/dev sin
-- org propia todavía) permitimos hasta una fila NULL por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_onboarding_state_user_org
  ON public.partner_onboarding_state (user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_partner_onboarding_state_status
  ON public.partner_onboarding_state (status);
CREATE INDEX IF NOT EXISTS idx_partner_onboarding_state_user
  ON public.partner_onboarding_state (user_id);

ALTER TABLE public.partner_onboarding_state ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_partner_onboarding_state_updated_at ON public.partner_onboarding_state;
CREATE TRIGGER trg_partner_onboarding_state_updated_at
  BEFORE UPDATE ON public.partner_onboarding_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: el propio usuario lee y escribe sus filas; admin global ve todo.
DROP POLICY IF EXISTS "partner_onboarding_state_owner_select" ON public.partner_onboarding_state;
CREATE POLICY "partner_onboarding_state_owner_select"
  ON public.partner_onboarding_state FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "partner_onboarding_state_owner_insert" ON public.partner_onboarding_state;
CREATE POLICY "partner_onboarding_state_owner_insert"
  ON public.partner_onboarding_state FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "partner_onboarding_state_owner_update" ON public.partner_onboarding_state;
CREATE POLICY "partner_onboarding_state_owner_update"
  ON public.partner_onboarding_state FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "partner_onboarding_state_admin_all" ON public.partner_onboarding_state;
CREATE POLICY "partner_onboarding_state_admin_all"
  ON public.partner_onboarding_state FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.partner_onboarding_state TO authenticated;

-- ============================================================================
-- 2) Fix RLS: brands + venues — owner/manager de la org puede escribir
-- ============================================================================

-- Brands: INSERT + UPDATE para owner de la org (organizations.owner_id)
-- o miembros activos con rol owner/admin/manager. Mantenemos las policies
-- existentes (public_read + admin_all).
DROP POLICY IF EXISTS "brands_org_member_insert" ON public.brands;
CREATE POLICY "brands_org_member_insert"
  ON public.brands FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = brands.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(brands.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

DROP POLICY IF EXISTS "brands_org_member_update" ON public.brands;
CREATE POLICY "brands_org_member_update"
  ON public.brands FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = brands.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(brands.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = brands.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(brands.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

-- Lectura para members (no solo public read; tambien para paused/archived)
DROP POLICY IF EXISTS "brands_org_member_select" ON public.brands;
CREATE POLICY "brands_org_member_select"
  ON public.brands FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = brands.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(brands.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])
  );

-- Venues: idem
DROP POLICY IF EXISTS "venues_org_member_insert" ON public.venues;
CREATE POLICY "venues_org_member_insert"
  ON public.venues FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = venues.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(venues.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

DROP POLICY IF EXISTS "venues_org_member_update" ON public.venues;
CREATE POLICY "venues_org_member_update"
  ON public.venues FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = venues.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(venues.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = venues.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(venues.org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
  );

DROP POLICY IF EXISTS "venues_org_member_select" ON public.venues;
CREATE POLICY "venues_org_member_select"
  ON public.venues FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = venues.org_id AND o.owner_id = (SELECT auth.uid())
    )
    OR public.has_org_role(venues.org_id, ARRAY['owner','admin','manager','door_staff']::public.org_member_role_t[])
  );

-- ============================================================================
-- 3) RPC partner_onboarding_status()
--    Devuelve el estado del onboarding del current user en una unica row.
--    Sintetiza state explicito + senales reales (org/venue/events) para
--    que el front sepa SI hay que mostrar el wizard sin tener que hacer
--    varias queries.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.partner_onboarding_status()
RETURNS TABLE (
  user_id              UUID,
  has_org              BOOLEAN,
  has_venue            BOOLEAN,
  has_event            BOOLEAN,
  onboarding_status    TEXT,
  completed_at         TIMESTAMPTZ,
  primary_org_id       UUID,
  primary_venue_id     UUID,
  should_show_wizard   BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_venue UUID;
  v_has_org BOOLEAN := FALSE;
  v_has_venue BOOLEAN := FALSE;
  v_has_event BOOLEAN := FALSE;
  v_status TEXT;
  v_completed TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Primary org: la org de la que el user es owner, o la primera donde
  -- es miembro activo. Si tiene varias, devolvemos la mas antigua para
  -- estabilidad entre sesiones.
  SELECT o.id INTO v_org
  FROM public.organizations o
  WHERE o.owner_id = v_uid
  ORDER BY o.created_at ASC
  LIMIT 1;

  IF v_org IS NULL THEN
    SELECT m.org_id INTO v_org
    FROM public.organization_members m
    WHERE m.user_id = v_uid AND m.status = 'active'
    ORDER BY m.created_at ASC
    LIMIT 1;
  END IF;

  v_has_org := v_org IS NOT NULL;

  -- Primary venue
  IF v_has_org THEN
    SELECT v.id INTO v_venue
    FROM public.venues v
    WHERE v.org_id = v_org AND v.status = 'active'
    ORDER BY v.created_at ASC
    LIMIT 1;
    v_has_venue := v_venue IS NOT NULL;
  END IF;

  -- Has event (cualquier evento, incluso draft)
  IF v_has_org THEN
    SELECT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.org_id = v_org OR e.partner_id = v_uid
      LIMIT 1
    ) INTO v_has_event;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.partner_id = v_uid
      LIMIT 1
    ) INTO v_has_event;
  END IF;

  -- State explicito
  SELECT s.status, s.completed_at INTO v_status, v_completed
  FROM public.partner_onboarding_state s
  WHERE s.user_id = v_uid
    AND (
      (s.org_id IS NOT NULL AND s.org_id = v_org)
      OR (s.org_id IS NULL AND v_org IS NULL)
    )
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_status IS NULL THEN
    v_status := 'in_progress';
  END IF;

  RETURN QUERY SELECT
    v_uid,
    v_has_org,
    v_has_venue,
    v_has_event,
    v_status,
    v_completed,
    v_org,
    v_venue,
    -- Mostrar wizard SOLO si NO esta completado/skipped Y no hay org+venue real
    (v_status NOT IN ('completed','skipped') AND NOT (v_has_org AND v_has_venue));
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_onboarding_status() TO authenticated;

-- ============================================================================
-- 4) RPC complete_partner_onboarding(_org_id, _venue_id, _data)
--    Marca el onboarding como completado para el current user. Se debe
--    llamar al final del wizard, una vez creados org y venue.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_partner_onboarding(
  _org_id    UUID DEFAULT NULL,
  _venue_id  UUID DEFAULT NULL,
  _data      JSONB DEFAULT '{}'::jsonb
)
RETURNS public.partner_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.partner_onboarding_state;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Si pasan org_id, verificar ownership o miembro activo con rol >=manager.
  IF _org_id IS NOT NULL THEN
    IF NOT (
      EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _org_id AND o.owner_id = v_uid)
      OR public.has_org_role(_org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[])
      OR public.has_role(v_uid, 'admin'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Forbidden: no eres propietario ni manager de esta organizacion';
    END IF;
  END IF;

  INSERT INTO public.partner_onboarding_state (user_id, org_id, venue_id, status, data, completed_at)
  VALUES (v_uid, _org_id, _venue_id, 'completed', COALESCE(_data, '{}'::jsonb), now())
  ON CONFLICT (user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    status        = 'completed',
    org_id        = COALESCE(EXCLUDED.org_id, partner_onboarding_state.org_id),
    venue_id      = COALESCE(EXCLUDED.venue_id, partner_onboarding_state.venue_id),
    data          = partner_onboarding_state.data || COALESCE(EXCLUDED.data, '{}'::jsonb),
    completed_at  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_partner_onboarding(UUID, UUID, JSONB) TO authenticated;

-- ============================================================================
-- 5) RPC save_partner_onboarding_progress(_org_id, _data)
--    Guarda un snapshot en `data` mientras el partner avanza pasos
--    (resume si se cierra el modal y vuelve).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_partner_onboarding_progress(
  _org_id  UUID DEFAULT NULL,
  _step    TEXT DEFAULT NULL,
  _data    JSONB DEFAULT '{}'::jsonb
)
RETURNS public.partner_onboarding_state
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.partner_onboarding_state;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.partner_onboarding_state (user_id, org_id, current_step, data)
  VALUES (v_uid, _org_id, _step, COALESCE(_data, '{}'::jsonb))
  ON CONFLICT (user_id, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    current_step = COALESCE(EXCLUDED.current_step, partner_onboarding_state.current_step),
    data         = partner_onboarding_state.data || COALESCE(EXCLUDED.data, '{}'::jsonb),
    org_id       = COALESCE(EXCLUDED.org_id, partner_onboarding_state.org_id)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_partner_onboarding_progress(UUID, TEXT, JSONB) TO authenticated;
