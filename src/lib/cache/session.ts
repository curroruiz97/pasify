import { useSyncExternalStore } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase, SUPABASE_AUTH_STORAGE_KEY } from "@/integrations/supabase/client";
import { capacitorStorage } from "@/lib/capacitorStorage";
import { withTimeout } from "@/lib/withTimeout";

/**
 * Sesión actual, legible de forma síncrona desde cualquier sitio.
 *
 * Los hooks de datos necesitan saber el usuario en el PRIMER render para
 * leer su caché: con `useAuth` (estado por instancia que arranca en null)
 * cada pantalla pintaba un esqueleto un instante antes de encontrar sus
 * datos. Aquí hay una única suscripción a auth-js para toda la app.
 *
 * `ready` pasa a true con el primer evento de auth-js (INITIAL_SESSION), con
 * la lectura de `getSession()` o, si auth-js tarda, con la sesión guardada en
 * el dispositivo (ver "Sin red" más abajo).
 *
 * Sin red:
 *
 *  - Al arrancar con el token caducado y sin cobertura, auth-js intenta
 *    renovarlo con reintentos durante ~25 s y después `getSession()` devuelve
 *    null. Antes la app se quedaba ~10 s en el splash, acababa en el login y
 *    la cartera guardada (30 días) no salía: sin usuario no se sabe de quién
 *    es la caché. Ahora, si auth-js no contesta en ~2 s (medio segundo si el
 *    móvil ya dice que no hay red), se lee la sesión guardada y se publica
 *    "sin verificar" (`sinVerificar`): se ve lo guardado del usuario, en solo
 *    lectura, hasta que auth-js la renueve (TOKEN_REFRESHED) o la borre
 *    (SIGNED_OUT). Mientras tanto React Query no pide nada (queryClient.ts):
 *    iría con la clave anónima y pisaría lo guardado.
 *  - auth-js entrega un INITIAL_SESSION null a cada suscriptor nuevo cuando
 *    no puede renovar el token por falta de red, aunque la sesión siga
 *    guardada (solo la borra, con SIGNED_OUT, si el servidor la rechaza).
 *    Tomarlo como "sin sesión" echaba al usuario y borraba su caché, y el
 *    bloqueo del modo puerta, en cuanto se abría una pantalla nueva sin
 *    cobertura. Un null que no es SIGNED_OUT solo cierra la sesión si el
 *    dispositivo confirma que ya no hay ninguna guardada (`resolverSesion`).
 */
export interface SessionSnapshot {
  ready: boolean;
  userId: string | null;
  session: Session | null;
  /**
   * Sesión del dispositivo que auth-js no ha podido renovar (sin red). Sirve
   * para enseñar lo guardado del usuario; el servidor no la acepta hasta que
   * se renueve.
   */
  sinVerificar: boolean;
}

/** Cuánto se espera a auth-js al arrancar antes de mirar la sesión guardada. */
const ESPERA_ARRANQUE_MS = 2_000;
const ESPERA_ARRANQUE_SIN_RED_MS = 500;
/** Margen con el que auth-js da un token por caducado (EXPIRY_MARGIN_MS). */
const MARGEN_CADUCIDAD_MS = 90_000;

/** ¿auth-js tendría que renovarla antes de usarla? */
const caducada = (s: Session) =>
  typeof s.expires_at === "number" && s.expires_at * 1000 - Date.now() < MARGEN_CADUCIDAD_MS;

let snapshot: SessionSnapshot = { ready: false, userId: null, session: null, sinVerificar: false };
const listeners = new Set<() => void>();

function publicar(session: Session | null, sinVerificar = false) {
  const userId = session?.user?.id ?? null;
  const conSesion = sinVerificar && session !== null;
  // Mismas referencias si nada cambia: el SIGNED_IN de volver a la pestaña
  // trae la misma sesión y no debe re-renderizar a nadie.
  if (
    snapshot.ready &&
    snapshot.userId === userId &&
    snapshot.session?.access_token === session?.access_token &&
    snapshot.sinVerificar === conSesion
  ) {
    return;
  }
  snapshot = { ready: true, userId, session, sinVerificar: conSesion };
  listeners.forEach((l) => {
    // Que un suscriptor que falla no deje a los demás sin enterarse.
    try {
      l();
    } catch (err) {
      console.error("[session] suscriptor con error:", err);
    }
  });
}

/**
 * Sesión guardada en el dispositivo (la que auth-js intenta renovar).
 * null: no hay ninguna (o no sirve). undefined: no se ha podido leer.
 */
export async function leerSesionGuardada(): Promise<Session | null | undefined> {
  const raw = await capacitorStorage.consultar(SUPABASE_AUTH_STORAGE_KEY);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  try {
    const s = JSON.parse(raw) as Partial<Session> | null;
    if (
      s &&
      typeof s.access_token === "string" &&
      typeof s.refresh_token === "string" &&
      typeof s.user?.id === "string"
    ) {
      return s as Session;
    }
  } catch {
    /* JSON roto: como si no hubiera nada */
  }
  return null;
}

// Un null ambiguo (sin red) en curso de comprobación contra el dispositivo.
let comprobando: Promise<void> | null = null;

function comprobarSesionGuardada() {
  if (comprobando) return;
  comprobando = (async () => {
    const guardada = await leerSesionGuardada();
    if (snapshot.userId === null) return;
    if (guardada === null) {
      // Ya no hay sesión en el dispositivo: ahora sí, fuera.
      publicar(null);
    } else if (guardada !== undefined && !snapshot.sinVerificar) {
      // Sigue guardada pero auth-js no puede renovarla: se sigue dentro,
      // enseñando lo guardado.
      publicar(snapshot.session, true);
    }
  })().finally(() => {
    comprobando = null;
  });
}

/**
 * Sesión que la app debe aplicar ante un evento de auth-js (o una lectura
 * de `getSession()`, que se pasa como INITIAL_SESSION).
 *
 * Con sesión, esa. SIGNED_OUT, fuera. Otro null con un usuario dentro (el
 * INITIAL_SESSION de un refresco sin red) no echa a nadie: se sigue con la
 * sesión actual y se comprueba en el dispositivo si de verdad ya no hay
 * ninguna guardada.
 */
export function resolverSesion(event: AuthChangeEvent, session: Session | null): Session | null {
  if (session || event === "SIGNED_OUT" || !snapshot.ready || snapshot.userId === null) return session;
  comprobarSesionGuardada();
  return snapshot.session;
}

let eventoRecibido = false;
supabase.auth.onAuthStateChange((event, session) => {
  eventoRecibido = true;
  // Solo se guarda estado: llamar a Supabase aquí dentro puede bloquear el
  // lock de auth-js.
  noteSession(resolverSesion(event, session));
});

// Arranque: la respuesta de auth-js o, si tarda, la sesión del dispositivo.
void (async () => {
  const lectura = supabase.auth.getSession();
  const espera =
    typeof navigator !== "undefined" && navigator.onLine === false ? ESPERA_ARRANQUE_SIN_RED_MS : ESPERA_ARRANQUE_MS;
  try {
    const { data, error } = await withTimeout(lectura, espera, "session.getSession");
    if (eventoRecibido || snapshot.ready) return;
    // Sin error, lo que diga auth-js (con sesión o sin ella). Con error (red),
    // se mira el dispositivo.
    if (data.session || !error) {
      publicar(data.session);
      return;
    }
  } catch {
    // auth-js no contesta: sin red y con el token caducado reintenta ~25 s.
  }
  if (eventoRecibido || snapshot.ready) return;
  const guardada = await leerSesionGuardada();
  if (eventoRecibido || snapshot.ready) return;
  // Un token aún vigente vale tal cual (auth-js lo daría igual). Uno caducado
  // es la sesión "sin verificar". Sin nada legible en el dispositivo, sin
  // sesión: si auth-js la recupera después, su SIGNED_IN la trae.
  publicar(guardada ?? null, !!guardada && caducada(guardada));
})();

/**
 * Las instancias de `useAuth` avisan de cada sesión que aplican: así esta
 * vista nunca va por detrás de lo que ya pinta la app. La sesión que ya se
 * tenía "sin verificar" sigue así; cualquier otra viene de auth-js y vale.
 */
export function noteSession(session: Session | null) {
  const mismaSinVerificar =
    session !== null && snapshot.sinVerificar && snapshot.session?.access_token === session.access_token;
  publicar(session, mismaSinVerificar);
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

/** Avisa de cada cambio de la sesión publicada. Devuelve la baja. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getUserId = () => snapshot.userId;
const getReady = () => snapshot.ready;
const getUser = () => snapshot.session?.user ?? null;
const getSinVerificar = () => snapshot.sinVerificar;

/** Usuario de la sesión (objeto de auth-js) o null. */
export function useCurrentUser() {
  return useSyncExternalStore(subscribeSession, getUser, getUser);
}

/** Usuario actual (null sin sesión o mientras no se sabe). Re-renderiza solo si cambia. */
export function useCurrentUserId(): string | null {
  return useSyncExternalStore(subscribeSession, getUserId, getUserId);
}

/** ¿Se sabe ya si hay sesión? */
export function useSessionReady(): boolean {
  return useSyncExternalStore(subscribeSession, getReady, getReady);
}

/** ¿Se está enseñando lo guardado con una sesión que auth-js no ha podido renovar (sin red)? */
export function useSesionSinVerificar(): boolean {
  return useSyncExternalStore(subscribeSession, getSinVerificar, getSinVerificar);
}
