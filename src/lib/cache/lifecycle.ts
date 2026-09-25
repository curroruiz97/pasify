import { useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/withTimeout";
import { clearSessionUiState } from "@/lib/useSessionState";
import { clearDrafts } from "@/lib/drafts";
import { clearDoorLock } from "@/lib/doorLock";
import { queryClient } from "./queryClient";
import { perteneceA } from "./policy";
import {
  borrarCacheGuardada,
  borrarCachesDeOtrosUsuarios,
  limpiarCachesAntiguas,
  persistirCache,
  restaurarCache,
  type Persistencia,
} from "./persistence";
import { leerSesionGuardada, useCurrentUserId, useSessionReady } from "./session";

/** Lo más que se retiene el splash esperando a la caché guardada. */
const RESTAURAR_TIMEOUT_MS = 1500;
/** Red de seguridad: pase lo que pase, la app se pinta. */
const ARRANQUE_TIMEOUT_MS = 4000;
/** Cuánto vale el aviso de cierre voluntario (signOutLocal) si la sesión no llega a irse. */
const CIERRE_VOLUNTARIO_MS = 60_000;

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

let cierreVoluntario: { userId: string; at: number } | null = null;

/**
 * El usuario cierra sesión porque quiere (signOutLocal). Solo entonces se
 * borran sus borradores de formularios: si la sesión caduca o la revoca el
 * servidor, se conservan para cuando vuelva a entrar.
 */
export function anotarCierreVoluntario(userId: string): void {
  cierreVoluntario = { userId, at: Date.now() };
}

function esCierreVoluntario(userId: string): boolean {
  const c = cierreVoluntario;
  return !!c && c.userId === userId && Date.now() - c.at < CIERRE_VOLUNTARIO_MS;
}

/**
 * Lo que se borra del dispositivo cuando ya no hay sesión: filtros y
 * búsquedas guardados de la pestaña (pueden llevar nombres) y el bloqueo del
 * modo puerta; si la salida es voluntaria, también los borradores de
 * formularios del usuario. El bloqueo solo se quita aquí, con la sesión ya
 * borrada: si cerrar sesión falla, la puerta sigue cerrada.
 */
function limpiarAlQuedarSinSesion(userIdSaliente: string | null, voluntario: boolean) {
  clearSessionUiState();
  if (voluntario && userIdSaliente) clearDrafts(userIdSaliente);
  clearDoorLock();
}

/**
 * Arranque sin sesión: lo guardado de usuarios que ya no están en este
 * dispositivo (un cierre que no llegó a limpiar, un cambio de cuenta de una
 * versión anterior) sobra. Solo si el dispositivo confirma que no hay ninguna
 * sesión guardada: una lectura que no responde no es "sin sesión".
 */
async function borrarCachesHuerfanas(): Promise<void> {
  if ((await leerSesionGuardada()) !== null) return;
  await borrarCachesDeOtrosUsuarios(null);
}

/**
 * Ciclo de vida de la caché ligado a la sesión.
 *
 *  - Arranque: restaura lo guardado del usuario ANTES de pintar la app (el
 *    splash se mantiene unos milisegundos): la primera pantalla sale ya con
 *    datos en vez de encadenar loaders. Devuelve `true` cuando ya se puede
 *    pintar. Sin sesión, borra lo guardado de otros usuarios.
 *  - Cambio de cuenta: fuera de memoria y del dispositivo todo lo que no sea
 *    del usuario nuevo. Ya no hay multi-cuenta: cambiar de cuenta es cerrar
 *    sesión y entrar con otra.
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
      // Solo signOutLocal anota un cierre forzado: era voluntario.
      limpiarAlQuedarSinSesion(cerrado, true);
    }

    if (anterior) {
      // Ya, sin esperar a nada: ni un render con datos de otra cuenta.
      queryClient.removeQueries({ predicate: (q) => !perteneceA(q.queryKey, userId) });
      if (userId === null) {
        const saliente = anterior.userId;
        limpiarAlQuedarSinSesion(saliente, !!saliente && esCierreVoluntario(saliente));
        cierreVoluntario = null;
      } else {
        // Cambio de cuenta: filtros y búsquedas de la pestaña (pueden llevar nombres).
        clearSessionUiState();
      }
    }

    // En segundo plano: no retrasa la primera pantalla y nunca toca lo público (anon).
    if (!anterior && userId === null) void borrarCachesHuerfanas();

    void (async () => {
      if (cerrado && userId === null) await borrarCacheGuardada(cerrado);
      if (anterior) {
        // Primero que deje de escribir (y termine lo que tenga en curso):
        // si no, podría volver a guardar lo que vamos a borrar.
        await anterior.persistencia?.dispose();
        // Fuera del dispositivo lo del usuario que sale, cierre o cambio de cuenta.
        if (anterior.userId !== null && anterior.userId !== userId) await borrarCacheGuardada(anterior.userId);
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
