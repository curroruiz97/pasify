import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import { MAX_PERSIST_AGE_MS, debePersistir, perteneceA, vigente } from "./policy";

/**
 * Caché de datos guardada en el dispositivo (IndexedDB), una entrada por
 * usuario: `v<esquema>:<uid>` (o `:anon` sin sesión, solo datos públicos).
 *
 * - Escribe como mucho una vez por segundo y, además, en cuanto la pestaña
 *   se oculta: es justo antes de que el navegador pueda descartarla.
 * - Al restaurar descarta lo caducado (policy.ts) y lo que no sea de ese
 *   usuario. Una entrada corrupta se borra.
 * - Si IndexedDB no está disponible (modo privado antiguo, WebView raro) todo
 *   sigue funcionando, solo que sin guardar nada.
 *
 * Sube CACHE_SCHEMA cuando cambie la forma de algún dato guardado: lo de
 * versiones anteriores se descarta al arrancar.
 */
export const CACHE_SCHEMA = 1;
const PREFIJO = `v${CACHE_SCHEMA}:`;
const ESPERA_ESCRITURA_MS = 1000;
/** Caché global de antes (sin separar por usuario): se borra al arrancar. */
const CLAVE_LEGADA = "react-query-cache-v3";

interface Guardado {
  schema: number;
  timestamp: number;
  userId: string | null;
  state: DehydratedState;
}

let almacenCache: UseStore | null | undefined;
function almacen(): UseStore | null {
  if (almacenCache !== undefined) return almacenCache;
  try {
    almacenCache = typeof indexedDB === "undefined" ? null : createStore("pasify-cache", "queries");
  } catch {
    almacenCache = null;
  }
  return almacenCache;
}

const claveDe = (userId: string | null) => `${PREFIJO}${userId ?? "anon"}`;

function esGuardadoValido(valor: unknown): valor is Guardado {
  const g = valor as Guardado | undefined;
  return (
    !!g &&
    g.schema === CACHE_SCHEMA &&
    typeof g.timestamp === "number" &&
    Array.isArray(g.state?.queries)
  );
}

/**
 * Carga en `queryClient` lo guardado para `userId`. Devuelve cuántas
 * consultas se han restaurado. Nunca lanza.
 */
export async function restaurarCache(queryClient: QueryClient, userId: string | null): Promise<number> {
  const s = almacen();
  if (!s) return 0;
  const clave = claveDe(userId);
  try {
    const guardado = await get<unknown>(clave, s);
    if (guardado === undefined) return 0;
    if (
      !esGuardadoValido(guardado) ||
      guardado.userId !== userId ||
      Date.now() - guardado.timestamp > MAX_PERSIST_AGE_MS
    ) {
      await del(clave, s);
      return 0;
    }
    const queries = guardado.state.queries.filter(
      (q) => perteneceA(q.queryKey, userId) && vigente(q.queryKey, q.state.dataUpdatedAt),
    );
    // hydrate no pisa datos más recientes que ya estén en memoria.
    hydrate(queryClient, { mutations: [], queries });
    return queries.length;
  } catch (err) {
    console.warn("[cache] no se pudo restaurar la caché guardada; se descarta:", err);
    await del(clave, s).catch(() => undefined);
    return 0;
  }
}

export interface Persistencia {
  /** Deja de guardar y espera a la escritura en curso (si la hay). */
  dispose(): Promise<void>;
  /** Escribe ya lo pendiente. */
  flush(): Promise<void>;
}

/** Guarda en el dispositivo, a partir de ahora, lo que la política permita de `userId`. */
export function persistirCache(queryClient: QueryClient, userId: string | null): Persistencia {
  const s = almacen();
  let activo = true;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enCurso: Promise<void> = Promise.resolve();

  const escribir = () => {
    temporizador = null;
    if (!activo || !s) return enCurso;
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (q) => debePersistir(q, userId),
      shouldDehydrateMutation: () => false,
    });
    const guardado: Guardado = { schema: CACHE_SCHEMA, timestamp: Date.now(), userId, state };
    enCurso = enCurso
      .then(() => set(claveDe(userId), guardado, s))
      .catch((err) => {
        // Cuota llena o dato no clonable: se sigue sin guardar, nunca rompe la app.
        console.warn("[cache] no se pudo guardar la caché:", err);
      });
    return enCurso;
  };

  const programar = () => {
    if (!activo || temporizador) return;
    temporizador = setTimeout(() => void escribir(), ESPERA_ESCRITURA_MS);
  };

  const escribirYa = () => {
    if (temporizador) {
      clearTimeout(temporizador);
      void escribir();
    }
  };
  const alCambiarVisibilidad = () => {
    if (document.visibilityState === "hidden") escribirYa();
  };

  const desuscribir = queryClient.getQueryCache().subscribe((evento) => {
    if (evento.type === "added" || evento.type === "removed" || evento.type === "updated") programar();
  });
  document.addEventListener("visibilitychange", alCambiarVisibilidad);
  window.addEventListener("pagehide", escribirYa);

  return {
    async dispose() {
      activo = false;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      desuscribir();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("pagehide", escribirYa);
      await enCurso;
    },
    async flush() {
      if (temporizador) clearTimeout(temporizador);
      await escribir();
    },
  };
}

/** Borra lo guardado de un usuario (al cerrar sesión). Nunca lanza. */
export async function borrarCacheGuardada(userId: string | null): Promise<void> {
  const s = almacen();
  if (!s) return;
  await del(claveDe(userId), s).catch(() => undefined);
}

/**
 * Limpieza al arrancar: la caché global de antes (mezclaba usuarios y nunca
 * se borraba al cerrar sesión) y las entradas de esquemas anteriores.
 */
export async function limpiarCachesAntiguas(): Promise<void> {
  try {
    await del(CLAVE_LEGADA);
  } catch {
    /* sin IndexedDB */
  }
  const s = almacen();
  if (!s) return;
  try {
    const todas = await keys(s);
    await Promise.all(
      todas.filter((k) => typeof k === "string" && !k.startsWith(PREFIJO)).map((k) => del(k, s)),
    );
  } catch {
    /* nada que limpiar */
  }
}
