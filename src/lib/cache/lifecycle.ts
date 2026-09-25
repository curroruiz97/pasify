import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { clearSessionUiState } from "@/lib/useSessionState";
import { clearDrafts } from "@/lib/drafts";
import { clearDoorLock } from "@/lib/doorLock";
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

/** Usuario cuyo cierre de sesión terminó recargando la app (ver anotarCierreForzado). */
const CIERRE_FORZADO_KEY = "pasify.cache.cierre-forzado";

/**
 * signOutLocal sin red y con auth-js ocupado: la sesión ya se ha borrado del
 * dispositivo pero auth-js no ha podido avisar (SIGNED_OUT), así que la app
 * se recarga. Tras la recarga nadie sabría de quién era lo guardado: esto lo
 * apunta para terminar la limpieza al arrancar, si de verdad no hay sesión.
 */
export function anotarCierreForzado(userId: string): void {
  try {
    localStorage.setItem(CIERRE_FORZADO_KEY, userId);
  } catch {
    /* sin storage: lo guardado se queda hasta el próximo cierre de sesión */
  }
}

function tomarCierreForzado(): string | null {
  try {
    const userId = localStorage.getItem(CIERRE_FORZADO_KEY);
    if (userId !== null) localStorage.removeItem(CIERRE_FORZADO_KEY);
    return userId;
  } catch {
    return null;
  }
}

/**
 * Lo que se borra del dispositivo cuando ya no hay sesión: filtros y
 * búsquedas guardados de la pestaña (pueden llevar nombres), borradores de
 * formularios y el bloqueo del modo puerta. El bloqueo solo se quita aquí, con
 * la sesión ya borrada: si cerrar sesión falla, la puerta sigue cerrada.
 */
function limpiarAlQuedarSinSesion() {
  clearSessionUiState();
  clearDrafts();
  clearDoorLock();
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
 *  - Cierre de sesión: fuera de memoria y BORRADO del dispositivo, y fuera el
 *    bloqueo del modo puerta.
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

    // Primera sesión conocida en esta carga: si venimos de un cierre de sesión
    // que acabó en recarga (anotarCierreForzado) y de verdad no hay sesión, lo
    // que no pudo hacerse antes de recargar. Si la sesión sigue (no se pudo
    // borrar), no se toca nada: la puerta sigue bloqueada.
    const cerrado = anterior ? null : tomarCierreForzado();
    if (cerrado && userId === null) {
      limpiarAlQuedarSinSesion();
    }

    if (anterior) {
      // Ya, sin esperar a nada: ni un render con datos de otra cuenta.
      queryClient.removeQueries({ predicate: (q) => !perteneceA(q.queryKey, userId) });
      if (userId === null) {
        limpiarAlQuedarSinSesion();
      } else {
        // Cambio de cuenta: filtros y búsquedas de la pestaña (pueden llevar nombres).
        clearSessionUiState();
      }
    }

    void (async () => {
      if (cerrado && userId === null) await borrarCacheGuardada(cerrado);
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
