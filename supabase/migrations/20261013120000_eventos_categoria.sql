-- Pasify · clasificación de eventos (bar, discoteca, festival)
--
-- events.category existía (texto libre) y nada la usaba: el editor no la
-- pedía, ningún evento la tiene (en producción, los 24 eventos la tienen a
-- NULL) y los filtros públicos (bar, discoteca, festival) solo miraban la
-- categoría del LOCAL. Ahora el editor la pide al crear y deja cambiarla al
-- editar, y el calendario y la home filtran los eventos con ella (si un
-- evento no la tiene, con la de su local cuando coincide: src/lib/eventCategories.ts).
--
-- Aquí, el dato cerrado: NULL (los eventos anteriores, que NO se reescriben) o
-- una de las categorías. Para añadir una, se cambia este CHECK y la lista de
-- src/lib/eventCategories.ts.
--
-- ADD CONSTRAINT valida las filas existentes: si alguna tuviera una categoría
-- fuera de la lista, la migración fallaría en vez de dejar un dato que el
-- editor no sabe mostrar (en producción no hay ninguna).

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_category_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_category_check
  CHECK (category IS NULL OR category IN ('bar', 'discoteca', 'festival'));

COMMENT ON COLUMN public.events.category IS
  'Categoría del evento: bar, discoteca o festival (NULL = sin clasificar, eventos anteriores). Ver src/lib/eventCategories.ts.';
