-- Pasify · el lugar de un evento sigue a su local
--
-- Un evento guarda una copia del lugar de su local (events.city,
-- events.venue_name, events.address) y todas las pantallas, entradas y emails
-- leen esa copia. Al cambiar el local de un evento (events.venue_id) la copia
-- se quedaba con el lugar del local anterior («Principal · Madrid», el local
-- por defecto de cada cuenta), y brand_id con la marca del anterior:
-- events_set_org_chain solo rellena lo que está a NULL.
--
-- El editor ya manda el lugar completo del local nuevo; esto es la red de
-- seguridad en la base de datos para cualquier otro cliente (API, scripts,
-- una versión vieja de la app):
--   * si en el mismo UPDATE cambia venue_id y no se toca ninguna de las tres
--     columnas del lugar, el lugar pasa a ser el del local nuevo;
--   * si el UPDATE toca alguna de las tres, es el cliente quien decide el
--     lugar y no se pisa nada;
--   * brand_id pasa a ser la marca del local nuevo (solo si el local es de la
--     misma organización que el evento; un local de otra organización no se
--     mezcla aquí).
-- No toca los eventos que ya existen: solo actúa al cambiar venue_id.
-- SECURITY INVOKER: lee el local con los permisos de quien edita el evento.

CREATE OR REPLACE FUNCTION public.events_sync_venue_place()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v public.venues%ROWTYPE;
BEGIN
  IF NEW.venue_id IS NULL OR NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v FROM public.venues WHERE id = NEW.venue_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.city IS NOT DISTINCT FROM OLD.city
     AND NEW.venue_name IS NOT DISTINCT FROM OLD.venue_name
     AND NEW.address IS NOT DISTINCT FROM OLD.address THEN
    NEW.city := v.city;
    NEW.venue_name := v.name;
    NEW.address := v.address;
  END IF;

  IF NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id
     AND (NEW.org_id IS NULL OR NEW.org_id IS NOT DISTINCT FROM v.org_id) THEN
    NEW.brand_id := v.brand_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.events_sync_venue_place() FROM PUBLIC, anon, authenticated;

-- Por orden alfabético va después de trg_events_set_org_chain y antes de
-- trg_zz_events_guard (el guard ve ya el evento terminado).
DROP TRIGGER IF EXISTS trg_events_sync_venue_place ON public.events;
CREATE TRIGGER trg_events_sync_venue_place
  BEFORE UPDATE OF venue_id ON public.events
  FOR EACH ROW
  WHEN (NEW.venue_id IS DISTINCT FROM OLD.venue_id)
  EXECUTE FUNCTION public.events_sync_venue_place();
