import { getSessionSnapshot } from "@/lib/cache/session";

/**
 * Borradores de formularios largos en el dispositivo (localStorage).
 *
 * Crear un evento en el móvil lleva un rato y es normal salir a otra app a
 * copiar un texto o una foto. Si mientras tanto el navegador descarta la
 * pestaña o iOS cierra la app, al volver el formulario estaba vacío. Con esto
 * se recupera tal como se dejó.
 *
 * Cada borrador es del usuario con sesión: `pasify.draft.<uid>.<formulario>`.
 * Otro usuario en el mismo dispositivo no lo ve, y si la sesión caduca (o la
 * revoca el servidor) sigue ahí cuando su dueño vuelve a entrar. Se borran
 * solo cuando el usuario cierra sesión porque quiere (cache/lifecycle.ts) y
 * caducan a los 7 días. Sin sesión no se guarda ni se lee nada.
 *
 * localStorage y no sessionStorage: sobrevive a que el sistema mate la app.
 */
const PREFIJO = "pasify.draft.";
const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;
/** Clave con usuario: `pasify.draft.<uuid>.…`. Las de antes no lo llevaban. */
const CON_USUARIO = /^pasify\.draft\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i;

interface Envoltorio<T> {
  savedAt: number;
  data: T;
}

const claveDe = (userId: string, formulario: string) => `${PREFIJO}${userId}.${formulario}`;
const usuarioActual = () => getSessionSnapshot().userId;

function leerEnvoltorio<T>(clave: string): Envoltorio<T> | null {
  const raw = localStorage.getItem(clave);
  if (!raw) return null;
  const env = JSON.parse(raw) as Envoltorio<T>;
  if (typeof env?.savedAt !== "number" || Date.now() - env.savedAt > VIGENCIA_MS) {
    localStorage.removeItem(clave);
    return null;
  }
  return env;
}

/** Borrador de `formulario` del usuario con sesión, o null. */
export function readDraft<T>(formulario: string): { savedAt: number; data: T } | null {
  const userId = usuarioActual();
  if (!userId) return null;
  try {
    const env = leerEnvoltorio<T>(claveDe(userId, formulario));
    if (env) return env;
    // Formato anterior (`pasify.draft.<formulario>`), solo si el nombre ya
    // llevaba el usuario (el de "Nuevo evento": `evento.<uid>`): se pasa al nuevo.
    if (!formulario.includes(userId)) return null;
    const antiguo = leerEnvoltorio<T>(PREFIJO + formulario);
    if (!antiguo) return null;
    localStorage.setItem(claveDe(userId, formulario), JSON.stringify(antiguo));
    localStorage.removeItem(PREFIJO + formulario);
    return antiguo;
  } catch {
    return null;
  }
}

export function writeDraft<T>(formulario: string, data: T) {
  const userId = usuarioActual();
  if (!userId) return;
  try {
    const env: Envoltorio<T> = { savedAt: Date.now(), data };
    localStorage.setItem(claveDe(userId, formulario), JSON.stringify(env));
  } catch {
    /* sin storage o lleno: el formulario sigue funcionando sin borrador */
  }
}

export function removeDraft(formulario: string) {
  const userId = usuarioActual();
  try {
    if (userId) localStorage.removeItem(claveDe(userId, formulario));
    localStorage.removeItem(PREFIJO + formulario); // formato anterior
  } catch {
    /* sin storage */
  }
}

/**
 * Borra los borradores de un usuario (al cerrar sesión por voluntad propia) y
 * los del formato anterior, sin usuario.
 */
export function clearDrafts(userId: string) {
  const suyos = `${PREFIJO}${userId}.`;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIJO)) continue;
      if (k.startsWith(suyos) || !CON_USUARIO.test(k)) localStorage.removeItem(k);
    }
  } catch {
    /* sin storage */
  }
}
