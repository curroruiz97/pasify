import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Prefijo de todo el estado de interfaz guardado: se borra al cerrar sesión. */
export const UI_STATE_PREFIX = "pasify.ui.";

/**
 * useState que sobrevive a desmontar la pantalla y a recargar la pestaña
 * (sessionStorage: solo esta pestaña, se va al cerrarla). Para estado de
 * interfaz —filtros, búsquedas, pestañas internas—, nunca para datos.
 *
 * `key` sin prefijo: se guarda como `pasify.ui.<key>`.
 */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fullKey = `${UI_STATE_PREFIX}${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(fullKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      /* sin storage (modo privado): solo en memoria */
    }
  }, [fullKey, value]);

  return [value, setValue];
}

/** Borra todo el estado de interfaz guardado (al cerrar sesión). */
export function clearSessionUiState() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(UI_STATE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* sin storage */
  }
}
