import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";

/**
 * Sesión actual, legible de forma síncrona desde cualquier sitio.
 *
 * Los hooks de datos necesitan saber el usuario en el PRIMER render para
 * leer su caché: con `useAuth` (estado por instancia que arranca en null)
 * cada pantalla pintaba un esqueleto un instante antes de encontrar sus
 * datos. Aquí hay una única suscripción a auth-js para toda la app.
 *
 * `ready` pasa a true con el primer evento de auth-js (INITIAL_SESSION) o con
 * la lectura de respaldo de `getSession()`.
 */
export interface SessionSnapshot {
  ready: boolean;
  userId: string | null;
  session: Session | null;
}

let snapshot: SessionSnapshot = { ready: false, userId: null, session: null };
const listeners = new Set<() => void>();

function publicar(session: Session | null) {
  const userId = session?.user?.id ?? null;
  // Mismas referencias si nada cambia: el SIGNED_IN de volver a la pestaña
  // trae la misma sesión y no debe re-renderizar a nadie.
  if (snapshot.ready && snapshot.userId === userId && snapshot.session?.access_token === session?.access_token) {
    return;
  }
  snapshot = { ready: true, userId, session };
  listeners.forEach((l) => l());
}

let eventoRecibido = false;
supabase.auth.onAuthStateChange((_event, session) => {
  eventoRecibido = true;
  // Solo se guarda estado: llamar a Supabase aquí dentro puede bloquear el
  // lock de auth-js.
  publicar(session);
});

// Respaldo por si INITIAL_SESSION no llegara (storage nativo colgado).
withTimeout(supabase.auth.getSession(), 10_000, "session.getSession")
  .then(({ data }) => {
    if (!eventoRecibido) publicar(data.session);
  })
  .catch(() => {
    if (!eventoRecibido && !snapshot.ready) publicar(null);
  });

/**
 * Las instancias de `useAuth` avisan de cada sesión que aplican: así esta
 * vista nunca va por detrás de lo que ya pinta la app.
 */
export function noteSession(session: Session | null) {
  publicar(session);
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getUserId = () => snapshot.userId;
const getReady = () => snapshot.ready;
const getUser = () => snapshot.session?.user ?? null;

/** Usuario de la sesión (objeto de auth-js) o null. */
export function useCurrentUser() {
  return useSyncExternalStore(subscribe, getUser, getUser);
}

/** Usuario actual (null sin sesión o mientras no se sabe). Re-renderiza solo si cambia. */
export function useCurrentUserId(): string | null {
  return useSyncExternalStore(subscribe, getUserId, getUserId);
}

/** ¿Se sabe ya si hay sesión? */
export function useSessionReady(): boolean {
  return useSyncExternalStore(subscribe, getReady, getReady);
}
