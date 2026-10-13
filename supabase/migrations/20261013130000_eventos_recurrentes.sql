-- Pasify · eventos de varios días y recurrentes (series de sesiones)
--
-- Una SERIE es un grupo de SESIONES y cada sesión es un evento de verdad
-- (`events`): con su propia fecha, tipos de entrada, aforo, ventas, puerta,
-- informes y reembolsos. Así los pedidos, los pagos (Stripe), el control de
-- entradas, la cancelación con reembolso y el límite de 10 entradas por
-- persona y evento siguen funcionando por sesión SIN CAMBIOS: una compra es de
-- una sesión, la capacidad de una fecha no resta de otra y cancelar una fecha
-- no toca las demás.
--
--   * event_series: la serie (la regla tal como la escribió el local, zona
--     horaria y horas locales). La regla solo sirve para enseñarla; lo que
--     cuenta son las sesiones.
--   * events.series_id / series_date / series_exception: a qué serie
--     pertenece una sesión, el día de la serie (hora local) al que corresponde
--     (no cambia si la sesión se mueve) y si se editó por separado (las
--     ediciones de toda la serie la respetan).
--   * Sin duplicados ni choques: una sola sesión por día de serie (índice
--     único) y las sesiones vivas de una serie no pueden solaparse (trigger).
--   * create_event_series: crea la serie con todas sus sesiones y los tipos de
--     entrada de cada una, en una sola transacción y de forma idempotente (un
--     doble clic o un reintento no crea dos series).
--   * update_event_series: aplica los cambios comunes (título, descripción,
--     imagen, categoría, lugar y horas) a las sesiones que quedan por celebrar
--     (de una fecha en adelante, o todas) sin tocar las editadas por separado.
--   * apply_event_tiers_to_series: copia los tipos de entrada de una sesión a
--     las demás que aún no tienen ninguna entrada ni reserva.
--   * cancel_event_series: cancela las sesiones por celebrar. Las que no tienen
--     ni entradas ni reservas se cancelan aquí, de una vez; las que sí las
--     tienen se devuelven para que el panel las cancele una a una con
--     partner-cancel-event (que es quien reembolsa en Stripe).
-- create_event_series, update_event_series y apply_event_tiers_to_series son
-- SECURITY INVOKER: las escrituras pasan por la RLS y los triggers de siempre
-- (quién puede crear y publicar, tenant, mínimo de precio, aforo por tipos…),
-- igual que si el editor las hiciera una a una.

-- ============================================================================
-- 1) La serie
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Clave de idempotencia de la creación (la genera el editor por intento).
  request_id UUID UNIQUE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- Quien la creó (events.partner_id de sus sesiones).
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('multi_day', 'recurring')),
  -- La regla como la escribió el local (frecuencia, días, fechas…).
  rule JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(rule) = 'object' AND octet_length(rule::text) <= 8000),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  -- Horas de reloj locales de las sesiones nuevas (si fin <= inicio, el día siguiente).
  start_time TIME NOT NULL,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_series_org ON public.event_series (org_id);
CREATE INDEX IF NOT EXISTS idx_event_series_partner ON public.event_series (partner_id);

DROP TRIGGER IF EXISTS trg_event_series_updated_at ON public.event_series;
CREATE TRIGGER trg_event_series_updated_at BEFORE UPDATE ON public.event_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;

-- Quién la ve: el equipo del local y quien la creó; el público, la de las
-- series con alguna sesión a la venta (lo que enseña la página del evento).
DROP POLICY IF EXISTS "event_series_member_read" ON public.event_series;
CREATE POLICY "event_series_member_read" ON public.event_series FOR SELECT TO authenticated
  USING (partner_id = auth.uid() OR (org_id IS NOT NULL AND public.is_member_of_org(org_id)));

DROP POLICY IF EXISTS "event_series_member_insert" ON public.event_series;
CREATE POLICY "event_series_member_insert" ON public.event_series FOR INSERT TO authenticated
  WITH CHECK (
    partner_id = auth.uid()
    AND (org_id IS NULL OR public.has_org_role(org_id, ARRAY['owner', 'admin', 'manager', 'rrpp']::public.org_member_role_t[]))
  );

DROP POLICY IF EXISTS "event_series_member_update" ON public.event_series;
CREATE POLICY "event_series_member_update" ON public.event_series FOR UPDATE TO authenticated
  USING (
    partner_id = auth.uid()
    OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner', 'admin', 'manager']::public.org_member_role_t[]))
  )
  WITH CHECK (
    partner_id = auth.uid()
    OR (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner', 'admin', 'manager']::public.org_member_role_t[]))
  );

DROP POLICY IF EXISTS "event_series_admin_all" ON public.event_series;
CREATE POLICY "event_series_admin_all" ON public.event_series FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Privilegios mínimos: desde la API solo se crea una serie y se reescribe lo
-- que enseña (regla y horas); el estado lo pone el trigger de cancelación y
-- nada se borra. El público lee solo lo que enseña la página del evento.
REVOKE ALL ON public.event_series FROM anon, authenticated;
GRANT SELECT, INSERT ON public.event_series TO authenticated;
GRANT UPDATE (rule, start_time, end_time) ON public.event_series TO authenticated;
GRANT SELECT (id, kind, rule, time_zone, start_time, end_time, status, created_at) ON public.event_series TO anon;
GRANT ALL ON public.event_series TO service_role;

-- ============================================================================
-- 2) La sesión: su serie
-- ============================================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.event_series(id),
  ADD COLUMN IF NOT EXISTS series_date DATE,
  ADD COLUMN IF NOT EXISTS series_exception BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_series_coherente;
ALTER TABLE public.events
  ADD CONSTRAINT events_series_coherente CHECK ((series_id IS NULL) = (series_date IS NULL));

-- El público ve la serie de las que tienen alguna sesión a la venta (o ya
-- celebrada): lo que enseña la página del evento. Va aquí porque la policy
-- mira events.series_id, que existe desde el ALTER de arriba.
DROP POLICY IF EXISTS "event_series_public_read" ON public.event_series;
CREATE POLICY "event_series_public_read" ON public.event_series FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.series_id = event_series.id AND e.status IN ('published', 'past')
  ));

-- Una sola sesión por día de la serie: sin duplicados (cuentan también las
-- canceladas, así una fecha cancelada no vuelve a salir de la misma serie).
CREATE UNIQUE INDEX IF NOT EXISTS events_series_date_uidx
  ON public.events (series_id, series_date) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_series_idx
  ON public.events (series_id, date_start) WHERE series_id IS NOT NULL;

-- Las sesiones vivas de una serie no se solapan. Mismo fin por defecto que la
-- venta de entradas: 12 h después de empezar. SECURITY DEFINER para ver todas
-- las sesiones, no solo las que deja ver la RLS de quien escribe.
CREATE OR REPLACE FUNCTION public.events_series_no_overlap()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.series_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  -- GREATEST: un evento con el fin antes del inicio (dato mal escrito) cuenta como
  -- de duración cero en vez de romper el rango con un error que no dice nada.
  IF EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.series_id = NEW.series_id
       AND e.id <> NEW.id
       AND e.status <> 'cancelled'
       AND tstzrange(e.date_start, GREATEST(COALESCE(e.date_end, e.date_start + INTERVAL '12 hours'), e.date_start), '[)')
        && tstzrange(NEW.date_start, GREATEST(COALESCE(NEW.date_end, NEW.date_start + INTERVAL '12 hours'), NEW.date_start), '[)')
  ) THEN
    RAISE EXCEPTION 'series_sessions_overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_series_no_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_events_series_no_overlap ON public.events;
CREATE TRIGGER trg_events_series_no_overlap
  BEFORE INSERT OR UPDATE OF date_start, date_end, status ON public.events
  FOR EACH ROW
  WHEN (NEW.series_id IS NOT NULL)
  EXECUTE FUNCTION public.events_series_no_overlap();

-- La serie de un evento no se cambia desde la API: ni mover un evento a otra
-- serie, ni colgar uno existente de la serie de otro local (aparecería en sus
-- «otras fechas»). Al crear una sesión, la serie tiene que ser de quien la
-- crea o de su organización. SECURITY INVOKER a propósito: como los demás
-- guards de events, se salta con el servidor (service_role) y con un admin.
CREATE OR REPLACE FUNCTION public.events_guard_series()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.series_id IS DISTINCT FROM OLD.series_id OR NEW.series_date IS DISTINCT FROM OLD.series_date THEN
      RAISE EXCEPTION 'La serie de un evento no se puede cambiar' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.series_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_series s
     WHERE s.id = NEW.series_id
       AND (s.partner_id = NEW.partner_id OR (s.org_id IS NOT NULL AND s.org_id = NEW.org_id))
  ) THEN
    RAISE EXCEPTION 'No puedes añadir eventos a esa serie' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_guard_series() FROM PUBLIC, anon, authenticated;

-- Por orden alfabético, después de trg_events_set_org_chain (que rellena org_id)
-- y de trg_zz_events_guard (que comprueba el tenant).
DROP TRIGGER IF EXISTS trg_zz_events_series_guard ON public.events;
CREATE TRIGGER trg_zz_events_series_guard
  BEFORE INSERT OR UPDATE OF series_id, series_date ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_guard_series();

-- Cuando se cancela la última sesión viva, la serie queda cancelada.
CREATE OR REPLACE FUNCTION public.events_series_after_cancel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.event_series s
     SET status = 'cancelled'
   WHERE s.id = NEW.series_id
     AND s.status <> 'cancelled'
     AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.series_id = s.id AND e.status <> 'cancelled');
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_series_after_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_events_series_after_cancel ON public.events;
CREATE TRIGGER trg_events_series_after_cancel
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW
  WHEN (NEW.series_id IS NOT NULL AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.events_series_after_cancel();

-- ============================================================================
-- 3) create_event_series
-- ============================================================================
-- _request_id  clave de idempotencia (la genera el editor por intento).
-- _kind        'multi_day' (días seguidos) o 'recurring'.
-- _rule        la regla tal como la escribió el local (JSON, solo para enseñarla).
-- _time_zone   zona horaria IANA con la que se calcularon las sesiones.
-- _event       lo común de las sesiones: title, description, city, venue_name,
--              address, image_url, venue_id, category y status ('draft' o
--              'published').
-- _tiers       los tipos de entrada de CADA sesión: [{name, description,
--              price_cents, currency, capacity, per_user_max, status,
--              sort_order, refundable_until_hours_before, transfer_allowed}].
-- _sessions    [{date (día de la serie, hora local), start, end}] ya calculadas
--              (con el cambio de hora resuelto) por el editor.
-- Devuelve {series_id, event_ids, already_created}.
-- Errores (RAISE EXCEPTION '<código>'): not_authenticated, series_invalid_*,
-- series_no_sessions, series_too_many_sessions (HINT = el máximo),
-- series_duplicate_dates (HINT = la fecha), series_invalid_session_times,
-- series_session_in_past, series_title_required, series_city_required,
-- series_sessions_overlap y los de siempre de events y ticket_tiers.
CREATE OR REPLACE FUNCTION public.create_event_series(
  _request_id UUID,
  _kind TEXT,
  _rule JSONB,
  _time_zone TEXT,
  _event JSONB,
  _tiers JSONB,
  _sessions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  -- Mismo tope que MAX_SERIES_SESSIONS (src/lib/recurrence.ts).
  c_max CONSTANT INT := 100;
  v_uid UUID := auth.uid();
  v_existing UUID;
  v_series UUID;
  v_n INT;
  v_status TEXT;
  v_title TEXT;
  v_venue UUID;
  v_org UUID;
  v_min_price INT;
  v_dup TEXT;
  v_first_start TIMESTAMPTZ;
  v_first_end TIMESTAMPTZ;
  v_session RECORD;
  v_event_id UUID;
  v_ids UUID[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('multi_day', 'recurring') THEN RAISE EXCEPTION 'series_invalid_kind'; END IF;
  IF _event IS NULL OR jsonb_typeof(_event) <> 'object' THEN RAISE EXCEPTION 'series_invalid_event'; END IF;
  IF _rule IS NULL OR jsonb_typeof(_rule) <> 'object' THEN RAISE EXCEPTION 'series_invalid_rule'; END IF;
  IF _tiers IS NULL OR jsonb_typeof(_tiers) <> 'array' OR jsonb_array_length(_tiers) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'series_invalid_tiers';
  END IF;
  IF _sessions IS NULL OR jsonb_typeof(_sessions) <> 'array' THEN RAISE EXCEPTION 'series_invalid_sessions'; END IF;
  IF _time_zone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = _time_zone) THEN
    RAISE EXCEPTION 'series_invalid_time_zone';
  END IF;

  v_n := jsonb_array_length(_sessions);
  IF v_n < 1 THEN RAISE EXCEPTION 'series_no_sessions'; END IF;
  IF v_n > c_max THEN RAISE EXCEPTION 'series_too_many_sessions' USING HINT = c_max::TEXT; END IF;

  v_status := COALESCE(_event->>'status', 'draft');
  IF v_status NOT IN ('draft', 'published') THEN RAISE EXCEPTION 'series_invalid_status'; END IF;
  v_title := btrim(COALESCE(_event->>'title', ''));
  IF v_title = '' THEN RAISE EXCEPTION 'series_title_required'; END IF;
  IF btrim(COALESCE(_event->>'city', '')) = '' THEN RAISE EXCEPTION 'series_city_required'; END IF;

  -- Idempotencia: el mismo intento (doble clic, reintento tras un corte) no crea otra serie.
  IF _request_id IS NOT NULL THEN
    SELECT s.id INTO v_existing FROM public.event_series s WHERE s.request_id = _request_id AND s.partner_id = v_uid;
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'series_id', v_existing,
        'event_ids', COALESCE((SELECT jsonb_agg(e.id ORDER BY e.date_start) FROM public.events e WHERE e.series_id = v_existing), '[]'::jsonb),
        'already_created', TRUE
      );
    END IF;
  END IF;

  -- Los tipos de entrada: nombre, precio y estado válidos (el resto lo
  -- comprueban las restricciones y los triggers de ticket_tiers al insertar).
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_tiers) AS t(name TEXT, price_cents INT, status TEXT)
     WHERE btrim(COALESCE(t.name, '')) = '' OR t.price_cents IS NULL OR t.price_cents < 0
        OR COALESCE(NULLIF(t.status, ''), 'active') NOT IN ('active', 'hidden')
  ) THEN
    RAISE EXCEPTION 'series_invalid_tiers';
  END IF;

  -- Las sesiones: fecha y comienzo obligatorios, fin posterior al comienzo, ni
  -- dos el mismo día y, si se publica, ninguna ya terminada.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
     WHERE x.date IS NULL OR x.start IS NULL
  ) THEN
    RAISE EXCEPTION 'series_invalid_sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
     WHERE x."end" IS NOT NULL AND x."end" <= x.start
  ) THEN
    RAISE EXCEPTION 'series_invalid_session_times';
  END IF;
  SELECT x.date::TEXT INTO v_dup
    FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
   GROUP BY x.date HAVING count(*) > 1 LIMIT 1;
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'series_duplicate_dates' USING HINT = v_dup; END IF;
  IF v_status = 'published' AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
     WHERE COALESCE(x."end", x.start + INTERVAL '12 hours') < now()
  ) THEN
    RAISE EXCEPTION 'series_session_in_past';
  END IF;

  v_venue := NULLIF(_event->>'venue_id', '')::UUID;
  IF v_venue IS NOT NULL THEN
    SELECT v.org_id INTO v_org FROM public.venues v WHERE v.id = v_venue;
  END IF;
  SELECT COALESCE(min(t.price_cents) FILTER (WHERE COALESCE(NULLIF(t.status, ''), 'active') = 'active'), 0)
    INTO v_min_price
    FROM jsonb_to_recordset(_tiers) AS t(price_cents INT, status TEXT);

  SELECT x.start, x."end" INTO v_first_start, v_first_end
    FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
   ORDER BY x.start LIMIT 1;

  BEGIN
    INSERT INTO public.event_series (request_id, org_id, partner_id, kind, rule, time_zone, start_time, end_time)
    VALUES (
      _request_id, v_org, v_uid, _kind, _rule, _time_zone,
      (v_first_start AT TIME ZONE _time_zone)::TIME,
      CASE WHEN v_first_end IS NULL THEN NULL ELSE (v_first_end AT TIME ZONE _time_zone)::TIME END
    )
    RETURNING id INTO v_series;
  EXCEPTION WHEN unique_violation THEN
    -- Dos llamadas a la vez con el mismo intento: gana la primera, esta devuelve su resultado.
    SELECT s.id INTO v_existing FROM public.event_series s WHERE s.request_id = _request_id AND s.partner_id = v_uid;
    IF v_existing IS NULL THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'series_id', v_existing,
      'event_ids', COALESCE((SELECT jsonb_agg(e.id ORDER BY e.date_start) FROM public.events e WHERE e.series_id = v_existing), '[]'::jsonb),
      'already_created', TRUE
    );
  END;

  FOR v_session IN
    SELECT x.date AS d, x.start AS s, x."end" AS e
      FROM jsonb_to_recordset(_sessions) AS x(date DATE, start TIMESTAMPTZ, "end" TIMESTAMPTZ)
     ORDER BY x.start
  LOOP
    INSERT INTO public.events (
      partner_id, title, description, city, venue_name, address, date_start, date_end,
      price_cents, image_url, venue_id, category, status, series_id, series_date
    )
    VALUES (
      v_uid, v_title, NULLIF(_event->>'description', ''), btrim(_event->>'city'),
      NULLIF(_event->>'venue_name', ''), NULLIF(_event->>'address', ''), v_session.s, v_session.e,
      v_min_price, NULLIF(_event->>'image_url', ''), v_venue, NULLIF(_event->>'category', ''),
      v_status::public.event_status_t, v_series, v_session.d
    )
    RETURNING id INTO v_event_id;
    v_ids := v_ids || v_event_id;

    INSERT INTO public.ticket_tiers (
      event_id, name, description, price_cents, currency, capacity, per_user_max, status,
      sort_order, refundable_until_hours_before, transfer_allowed
    )
    SELECT v_event_id, btrim(t.name), NULLIF(t.description, ''), t.price_cents,
           COALESCE(NULLIF(t.currency, ''), 'EUR'), t.capacity, COALESCE(t.per_user_max, 10),
           COALESCE(NULLIF(t.status, ''), 'active')::public.ticket_tier_status_t,
           COALESCE(t.sort_order, 0), t.refundable_until_hours_before, COALESCE(t.transfer_allowed, TRUE)
      FROM jsonb_to_recordset(_tiers) AS t(
        name TEXT, description TEXT, price_cents INT, currency TEXT, capacity INT, per_user_max INT,
        status TEXT, sort_order INT, refundable_until_hours_before INT, transfer_allowed BOOLEAN
      );
  END LOOP;

  RETURN jsonb_build_object('series_id', v_series, 'event_ids', to_jsonb(v_ids), 'already_created', FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event_series(UUID, TEXT, JSONB, TEXT, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_series(UUID, TEXT, JSONB, TEXT, JSONB, JSONB, JSONB) TO authenticated, service_role;

-- ============================================================================
-- 4) update_event_series
-- ============================================================================
-- Cambios comunes para las sesiones de la serie que aún no han terminado (ni
-- están canceladas), de `_from` en adelante o todas si `_from` es NULL. Las
-- editadas por separado (series_exception) se saltan salvo `_include_exceptions`.
-- _patch (solo lo que venga se cambia): title, description, image_url,
-- category, venue_id, venue_name, city, address y las horas locales start_time
-- y end_time ("HH:mm"; end_time vacío = sin hora de fin). Las horas se
-- recalculan sobre el día actual de cada sesión en la zona de la serie, con el
-- cambio de hora resuelto por Postgres. Devuelve {updated, skipped_exceptions}.
CREATE OR REPLACE FUNCTION public.update_event_series(
  _series_id UUID,
  _from TIMESTAMPTZ,
  _patch JSONB,
  _include_exceptions BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  s public.event_series%ROWTYPE;
  r RECORD;
  v_updated INT := 0;
  v_skipped INT := 0;
  v_rows INT;
  v_set_start BOOLEAN;
  v_set_end BOOLEAN;
  v_start TIME;
  v_end TIME;
  v_day DATE;
  v_new_start TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
  v_start_local TIME;
  v_end_local TIME;
BEGIN
  SELECT * INTO s FROM public.event_series WHERE id = _series_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'series_invalid_patch'; END IF;
  IF _patch ? 'title' AND btrim(COALESCE(_patch->>'title', '')) = '' THEN RAISE EXCEPTION 'series_title_required'; END IF;
  IF _patch ? 'city' AND btrim(COALESCE(_patch->>'city', '')) = '' THEN RAISE EXCEPTION 'series_city_required'; END IF;

  v_set_start := _patch ? 'start_time';
  v_set_end := _patch ? 'end_time';
  IF v_set_start THEN
    v_start := NULLIF(_patch->>'start_time', '')::TIME;
    IF v_start IS NULL THEN RAISE EXCEPTION 'series_invalid_patch'; END IF;
  END IF;
  IF v_set_end THEN v_end := NULLIF(_patch->>'end_time', '')::TIME; END IF;

  SELECT count(*) INTO v_skipped
    FROM public.events e
   WHERE e.series_id = _series_id AND e.status IN ('draft', 'published')
     AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') >= now()
     AND (_from IS NULL OR e.date_start >= _from)
     AND e.series_exception AND NOT COALESCE(_include_exceptions, FALSE);

  FOR r IN
    SELECT e.id, e.date_start, e.date_end
      FROM public.events e
     WHERE e.series_id = _series_id AND e.status IN ('draft', 'published')
       AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') >= now()
       AND (_from IS NULL OR e.date_start >= _from)
       AND (NOT e.series_exception OR COALESCE(_include_exceptions, FALSE))
     ORDER BY e.date_start
       FOR UPDATE
  LOOP
    v_new_start := r.date_start;
    v_new_end := r.date_end;
    IF v_set_start OR v_set_end THEN
      v_day := (r.date_start AT TIME ZONE s.time_zone)::DATE;
      v_start_local := COALESCE(v_start, (r.date_start AT TIME ZONE s.time_zone)::TIME);
      IF v_set_start THEN
        v_new_start := ((v_day + v_start_local) AT TIME ZONE s.time_zone);
      END IF;
      IF v_set_end THEN
        v_new_end := CASE WHEN v_end IS NULL THEN NULL
          ELSE ((v_day + v_end + CASE WHEN v_end <= v_start_local THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE s.time_zone)
        END;
      ELSIF r.date_end IS NOT NULL THEN
        -- Solo cambia el comienzo: el fin se mantiene como hora de reloj (y pasa al día siguiente si hace falta).
        v_end_local := (r.date_end AT TIME ZONE s.time_zone)::TIME;
        v_new_end := ((v_day + v_end_local + CASE WHEN v_end_local <= v_start_local THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
                      AT TIME ZONE s.time_zone);
      END IF;
    END IF;

    UPDATE public.events e SET
      title       = CASE WHEN _patch ? 'title'       THEN btrim(_patch->>'title') ELSE e.title END,
      description = CASE WHEN _patch ? 'description' THEN NULLIF(_patch->>'description', '') ELSE e.description END,
      image_url   = CASE WHEN _patch ? 'image_url'   THEN NULLIF(_patch->>'image_url', '') ELSE e.image_url END,
      category    = CASE WHEN _patch ? 'category'    THEN NULLIF(_patch->>'category', '') ELSE e.category END,
      venue_id    = CASE WHEN _patch ? 'venue_id'    THEN NULLIF(_patch->>'venue_id', '')::UUID ELSE e.venue_id END,
      venue_name  = CASE WHEN _patch ? 'venue_name'  THEN NULLIF(_patch->>'venue_name', '') ELSE e.venue_name END,
      city        = CASE WHEN _patch ? 'city'        THEN btrim(_patch->>'city') ELSE e.city END,
      address     = CASE WHEN _patch ? 'address'     THEN NULLIF(_patch->>'address', '') ELSE e.address END,
      date_start  = v_new_start,
      date_end    = v_new_end
     WHERE e.id = r.id;
    -- La RLS puede dejar una sesión sin cambiar sin dar error: solo cuenta las que cambian.
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_updated := v_updated + v_rows;
  END LOOP;

  -- Toda la serie con horas nuevas: las sesiones que se creen después las usarán.
  IF _from IS NULL AND (v_set_start OR v_set_end) THEN
    UPDATE public.event_series
       SET start_time = COALESCE(v_start, start_time),
           end_time = CASE WHEN v_set_end THEN v_end ELSE end_time END
     WHERE id = _series_id;
  END IF;

  RETURN jsonb_build_object('updated', v_updated, 'skipped_exceptions', v_skipped);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_event_series(UUID, TIMESTAMPTZ, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event_series(UUID, TIMESTAMPTZ, JSONB, BOOLEAN) TO authenticated, service_role;

-- ============================================================================
-- 5) apply_event_tiers_to_series
-- ============================================================================
-- Copia los tipos de entrada de la sesión `_event_id` a las demás de su serie
-- que aún no han terminado (`following`: las posteriores; `all`: todas). Una
-- sesión con cualquier entrada o reserva (pagada, usada, pendiente, devuelta…)
-- se salta: sus tipos no se tocan. Un tipo agotado o cerrado en la sesión de
-- origen se copia como activo (el cupo vuelve a ser el de partida).
-- Devuelve {applied, skipped_with_sales}.
CREATE OR REPLACE FUNCTION public.apply_event_tiers_to_series(_event_id UUID, _scope TEXT)
RETURNS JSONB
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  src public.events%ROWTYPE;
  r RECORD;
  v_applied INT := 0;
  v_skipped INT := 0;
BEGIN
  IF _scope IS NULL OR _scope NOT IN ('following', 'all') THEN RAISE EXCEPTION 'series_invalid_scope'; END IF;
  SELECT * INTO src FROM public.events WHERE id = _event_id;
  IF NOT FOUND OR src.series_id IS NULL THEN RAISE EXCEPTION 'series_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_tiers t WHERE t.event_id = src.id) THEN
    RAISE EXCEPTION 'series_invalid_tiers';
  END IF;

  FOR r IN
    SELECT e.id
      FROM public.events e
     WHERE e.series_id = src.series_id AND e.id <> src.id
       AND e.status IN ('draft', 'published')
       AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') >= now()
       AND (_scope = 'all' OR e.date_start > src.date_start)
     ORDER BY e.date_start
       FOR UPDATE
  LOOP
    IF EXISTS (SELECT 1 FROM public.tickets tk WHERE tk.event_id = r.id)
       OR EXISTS (SELECT 1 FROM public.ticket_orders o WHERE o.event_id = r.id) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    DELETE FROM public.ticket_tiers WHERE event_id = r.id;
    INSERT INTO public.ticket_tiers (
      event_id, name, description, price_cents, currency, capacity, per_user_max, status,
      sort_order, refundable_until_hours_before, transfer_allowed
    )
    SELECT r.id, t.name, t.description, t.price_cents, t.currency, t.capacity, t.per_user_max,
           CASE WHEN t.status = 'hidden' THEN 'hidden'::public.ticket_tier_status_t ELSE 'active'::public.ticket_tier_status_t END,
           t.sort_order, t.refundable_until_hours_before, t.transfer_allowed
      FROM public.ticket_tiers t WHERE t.event_id = src.id;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped_with_sales', v_skipped);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_event_tiers_to_series(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_event_tiers_to_series(UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 6) cancel_event_series
-- ============================================================================
-- Cancela las sesiones de la serie que aún no han terminado (de `_from` en
-- adelante, o todas si es NULL). Las que no tienen ninguna entrada ni reserva
-- se cancelan aquí, en una sola transacción, con partner_cancel_event (que
-- comprueba los permisos de quien llama, evento a evento). Las que sí las
-- tienen NO se tocan: se devuelven en `needs_refunds` para que el panel las
-- cancele una a una con la edge function partner-cancel-event, que es quien
-- reembolsa en Stripe (y cuyo límite de 30 llamadas por hora así solo cuenta
-- las sesiones con ventas). Devuelve {cancelled, needs_refunds}.
-- SECURITY DEFINER para ver todas las entradas y reservas de las sesiones (la
-- RLS de quien llama podría esconder alguna y se cancelaría sin reembolsarla).
CREATE OR REPLACE FUNCTION public.cancel_event_series(_series_id UUID, _from TIMESTAMPTZ, _reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  s public.event_series%ROWTYPE;
  r RECORD;
  v_cancelled INT := 0;
  v_with_sales UUID[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'cancel_reason_required'; END IF;
  SELECT * INTO s FROM public.event_series WHERE id = _series_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found'; END IF;
  IF NOT (
    public.has_role(v_uid, 'admin'::public.app_role)
    OR s.partner_id = v_uid
    OR (s.org_id IS NOT NULL
        AND public.has_org_role(s.org_id, ARRAY['owner', 'admin', 'manager']::public.org_member_role_t[]))
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT e.id
      FROM public.events e
     WHERE e.series_id = _series_id AND e.status IN ('draft', 'published')
       AND COALESCE(e.date_end, e.date_start + INTERVAL '12 hours') >= now()
       AND (_from IS NULL OR e.date_start >= _from)
     ORDER BY e.date_start
  LOOP
    IF EXISTS (SELECT 1 FROM public.tickets tk WHERE tk.event_id = r.id)
       OR EXISTS (SELECT 1 FROM public.ticket_orders o WHERE o.event_id = r.id) THEN
      v_with_sales := v_with_sales || r.id;
    ELSE
      PERFORM public.partner_cancel_event(r.id, _reason);
      v_cancelled := v_cancelled + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'needs_refunds', to_jsonb(v_with_sales));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_event_series(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_event_series(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
