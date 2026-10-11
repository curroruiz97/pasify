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

/**
 * Qué pasó al guardar: "ok"; "sin-sesion" (no hay usuario: no se guarda);
 * "otro-usuario" (la sesión ya no es de quien escribió el formulario);
 * "mas-nuevo" (ya hay un borrador guardado después del cambio, de otra
 * pestaña, y no se pisa); "fallo" (sin almacenamiento, o lleno).
 */
export type ResultadoBorrador = "ok" | "sin-sesion" | "otro-usuario" | "mas-nuevo" | "fallo";

export interface OpcionesBorrador {
  /** De quién es el formulario: si la sesión es de otro usuario, no se guarda nada. */
  usuario?: string;
  /**
   * Cuándo se hizo el cambio que se guarda (Date.now()). Si en el dispositivo ya
   * hay un borrador guardado después de eso, es más nuevo y no se pisa.
   */
  editadoEn?: number;
}

/** Guarda el borrador y dice qué pasó: quien llama avisa si falla, en vez de tragárselo. */
export function writeDraft<T>(formulario: string, data: T, opciones: OpcionesBorrador = {}): ResultadoBorrador {
  const userId = usuarioActual();
  if (!userId) return "sin-sesion";
  if (opciones.usuario && opciones.usuario !== userId) return "otro-usuario";
  try {
    const clave = claveDe(userId, formulario);
    if (opciones.editadoEn !== undefined) {
      let guardado: Envoltorio<T> | null = null;
      try {
        guardado = leerEnvoltorio<T>(clave);
      } catch {
        /* ilegible: se sobrescribe */
      }
      if (guardado && guardado.savedAt > opciones.editadoEn) return "mas-nuevo";
    }
    const env: Envoltorio<T> = { savedAt: Date.now(), data };
    localStorage.setItem(clave, JSON.stringify(env));
    return "ok";
  } catch {
    return "fallo";
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
