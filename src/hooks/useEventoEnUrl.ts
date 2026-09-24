import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Evento elegido en el panel, en la URL (`?evento=<id>`).
 *
 * Lo comparten Asistentes y En vivo: se conserva al cambiar de sección (el
 * panel lo arrastra al navegar), al volver atrás y al recargar. Antes vivía
 * en el estado de cada sección y se perdía al salir de ella.
 */
export function useEventoEnUrl(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const evento = params.get("evento");
  const setEvento = useCallback(
    (id: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("evento", id);
          else next.delete("evento");
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [evento, setEvento];
}
