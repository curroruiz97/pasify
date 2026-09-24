/**
 * Borradores de formularios largos en el dispositivo (localStorage).
 *
 * Crear un evento en el móvil lleva un rato y es normal salir a otra app a
 * copiar un texto o una foto. Si mientras tanto el navegador descarta la
 * pestaña o iOS cierra la app, al volver el formulario estaba vacío. Con esto
 * se recupera tal como se dejó.
 *
 * localStorage y no sessionStorage: sobrevive a que el sistema mate la app.
 * Caducan a los 7 días y se borran al cerrar sesión (lifecycle.ts).
 */
const PREFIJO = "pasify.draft.";
const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;

interface Envoltorio<T> {
  savedAt: number;
  data: T;
}

export function readDraft<T>(key: string): { savedAt: number; data: T } | null {
  try {
    const raw = localStorage.getItem(PREFIJO + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envoltorio<T>;
    if (typeof env?.savedAt !== "number" || Date.now() - env.savedAt > VIGENCIA_MS) {
      localStorage.removeItem(PREFIJO + key);
      return null;
    }
    return env;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, data: T) {
  try {
    const env: Envoltorio<T> = { savedAt: Date.now(), data };
    localStorage.setItem(PREFIJO + key, JSON.stringify(env));
  } catch {
    /* sin storage o lleno: el formulario sigue funcionando sin borrador */
  }
}

export function removeDraft(key: string) {
  try {
    localStorage.removeItem(PREFIJO + key);
  } catch {
    /* sin storage */
  }
}

/** Borra todos los borradores (al cerrar sesión). */
export function clearDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIJO)) localStorage.removeItem(k);
    }
  } catch {
    /* sin storage */
  }
}
