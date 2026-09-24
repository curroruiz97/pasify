import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { clearSessionUiState } from "@/lib/useSessionState";
import { clearDrafts } from "@/lib/drafts";
import { queryClient } from "./queryClient";
import { perteneceA } from "./policy";
import {
  borrarCacheGuardada,
  limpiarCachesAntiguas,
  persistirCache,
  restaurarCache,
  type Persistencia,
} from "./persistence";
import { useCurrentUserId, useSessionReady } from "./session";

/** Lo más que se retiene el splash esperando a la caché guardada. */
const RESTAURAR_TIMEOUT_MS = 1500;
/** Red de seguridad: pase lo que pase, la app se pinta. */
const ARRANQUE_TIMEOUT_MS = 4000;

interface Activa {
  userId: string | null;
  persistencia: Persistencia | null;
}

/**
 * Ciclo de vida de la caché ligado a la sesión.
 *
 *  - Arranque: restaura lo guardado del usuario ANTES de pintar la app (el
 *    splash se mantiene unos milisegundos): la primera pantalla sale ya con
 *    datos en vez de encadenar loaders. Devuelve `true` cuando ya se puede
 *    pintar.
 *  - Cambio de cuenta: fuera de memoria todo lo que no sea del usuario nuevo
 *    (lo del anterior sigue guardado para cuando vuelva, multi-cuenta).
 *  - Cierre de sesión: fuera de memoria y BORRADO del dispositivo.
 *
 * Una sola instancia, en App.
 */
export function useCacheLifecycle(): boolean {
  const sesionLista = useSessionReady();
  const userId = useCurrentUserId();
  const [lista, setLista] = useState(false);
  const activaRef = useRef<Activa | null>(null);

  useEffect(() => {
    void limpiarCachesAntiguas();
    const t = setTimeout(() => setLista(true), ARRANQUE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!sesionLista) return;
    const anterior = activaRef.current;
    if (anterior && anterior.userId === userId) return;

    const actual: Activa = { userId, persistencia: null };
    activaRef.current = actual;

    if (anterior) {
      // Ya, sin esperar a nada: ni un render con datos de otra cuenta.
      queryClient.removeQueries({ predicate: (q) => !perteneceA(q.queryKey, userId) });
      // Filtros y búsquedas guardados de la pestaña (pueden llevar nombres).
      clearSessionUiState();
      // Al cerrar sesión, también los borradores de formularios.
      if (userId === null) clearDrafts();
    }

    void (async () => {
      if (anterior) {
        // Primero que deje de escribir (y termine lo que tenga en curso):
        // si no, podría volver a guardar lo que vamos a borrar.
        await anterior.persistencia?.dispose();
        if (userId === null && anterior.userId !== null) await borrarCacheGuardada(anterior.userId);
      }
      try {
        await withTimeout(restaurarCache(queryClient, userId), RESTAURAR_TIMEOUT_MS, "cache.restaurar");
      } catch (err) {
        console.warn("[cache] restauración lenta o fallida; se sigue sin ella:", err);
      }
      if (activaRef.current !== actual) return; // cambió otra vez mientras tanto
      actual.persistencia = persistirCache(queryClient, userId);
      setLista(true);
    })();
  }, [sesionLista, userId]);

  useEffect(
    () => () => {
      void activaRef.current?.persistencia?.dispose();
    },
    [],
  );

  return lista;
}
