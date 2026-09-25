import { useCallback, useSyncExternalStore } from "react";

/**
 * Modo puerta (/door): bloqueo del dispositivo con PIN.
 *
 * El dueño deja su móvil en la puerta con su propia sesión (D12 del plan: las
 * cuentas de portero llegan con Equipo). Mientras el modo puerta está activo
 * en ESTE dispositivo, cualquier pantalla redirige a /door (DoorLockGuard en
 * App.tsx, también /login y /update-password) y salir exige el PIN.
 *
 * Es un bloqueo local, no un permiso: vive en localStorage, ligado al usuario
 * y con el PIN guardado como hash (SHA-256 de usuario + PIN).
 *
 * Si se olvida el PIN, queda cerrar sesión. El bloqueo se quita SOLO cuando la
 * sesión ya no existe (lo hace la caché al pasar el usuario a null,
 * cache/lifecycle.ts). Antes se borraba primero y, sin red, signOut fallaba:
 * la sesión seguía viva, sin bloqueo, y /login llevaba al panel.
 *
 * Los PIN fallidos y la espera también se guardan aquí: recargar ya no
 * reinicia la cuenta. Hay DOOR_FREE_ATTEMPTS intentos seguidos; a partir de
 * ahí cada fallo obliga a esperar, y la espera se dobla (30 s, 1 min, 2 min…
 * hasta 1 h): probar los 10.000 PIN de 4 cifras deja de caber en una noche.
 */

const ACTIVE_KEY = "pasify.door.active";
const PIN_KEY = "pasify.door.pin";
const FAILS_KEY = "pasify.door.fails";
/** Aviso dentro de esta pestaña (el evento `storage` solo llega a las demás). */
const CHANGE_EVENT = "pasify:door-lock";

/** Fallos seguidos permitidos antes de la primera espera. */
export const DOOR_FREE_ATTEMPTS = 5;
const FIRST_WAIT_MS = 30_000;
const MAX_WAIT_MS = 60 * 60_000;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: el modo puerta simplemente no persiste */
  }
};

const notifyChange = () => {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* sin window: nada que avisar */
  }
};

async function pinHash(userId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`pasify-door:${userId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** PIN válido: 4 a 6 cifras. */
export const isValidDoorPin = (pin: string): boolean => /^\d{4,6}$/.test(pin);

/** ¿Está este dispositivo bloqueado en modo puerta para este usuario? */
export const isDoorLocked = (userId: string | null | undefined): boolean =>
  !!userId && read(ACTIVE_KEY) === userId && !!read(PIN_KEY);

/** Avisa de cualquier cambio del bloqueo, en esta pestaña o en otra. */
export function subscribeDoorLock(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // key null: localStorage.clear() en otra pestaña.
    if (e.key === null || e.key === ACTIVE_KEY || e.key === PIN_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * `isDoorLocked` que se vuelve a pintar cuando cambia el bloqueo: si el dueño
 * activa el modo puerta en una pestaña, las demás (con el panel abierto)
 * pasan también a /door.
 */
export function useDoorLocked(userId: string | null | undefined): boolean {
  const getSnapshot = useCallback(() => isDoorLocked(userId), [userId]);
  return useSyncExternalStore(subscribeDoorLock, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------- intentos

interface Fails {
  /** Fallos seguidos desde el último PIN correcto. */
  count: number;
  /** Hasta cuándo no se puede volver a probar (ms desde epoch; 0 = sin espera). */
  until: number;
}

function readFails(): Fails {
  try {
    const v = JSON.parse(read(FAILS_KEY) ?? "null") as Partial<Fails> | null;
    if (v && typeof v.count === "number" && typeof v.until === "number" && v.count >= 0) {
      return { count: Math.floor(v.count), until: v.until };
    }
  } catch {
    /* valor corrupto: se empieza de cero */
  }
  return { count: 0, until: 0 };
}

/** Espera que impone el fallo número `count` (1, 2…): ninguna en los primeros. */
export function doorWaitAfterFails(count: number): number {
  if (count < DOOR_FREE_ATTEMPTS) return 0;
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (count - DOOR_FREE_ATTEMPTS));
}

/** Milisegundos que faltan para poder volver a probar el PIN (0 = ya se puede). */
export function doorWaitMs(now = Date.now()): number {
  // Con el reloj del móvil atrasado a propósito, la espera nunca pasa del máximo.
  return Math.max(0, Math.min(readFails().until - now, MAX_WAIT_MS));
}

export type DoorUnlockResult =
  | { ok: true }
  | {
      ok: false;
      /** Espera antes del siguiente intento (0 = se puede probar ya). */
      waitMs: number;
      /** Intentos que quedan antes de tener que esperar. */
      attemptsLeft: number;
    };

export async function lockDoor(userId: string, pin: string): Promise<void> {
  if (!isValidDoorPin(pin)) throw new Error("invalid_pin");
  write(PIN_KEY, await pinHash(userId, pin));
  write(ACTIVE_KEY, userId);
  write(FAILS_KEY, null);
  notifyChange();
}

/**
 * Comprueba el PIN y, si es correcto, desbloquea. Mientras dure una espera ni
 * siquiera se comprueba (y ese intento no cuenta).
 */
export async function unlockDoor(userId: string, pin: string): Promise<DoorUnlockResult> {
  const stored = read(PIN_KEY);
  if (!stored || read(ACTIVE_KEY) !== userId) {
    clearDoorLock();
    return { ok: true };
  }
  const waitMs = doorWaitMs();
  if (waitMs > 0) return { ok: false, waitMs, attemptsLeft: 0 };
  if ((await pinHash(userId, pin)) === stored) {
    clearDoorLock();
    return { ok: true };
  }
  const count = readFails().count + 1;
  const wait = doorWaitAfterFails(count);
  const fails: Fails = { count, until: wait ? Date.now() + wait : 0 };
  write(FAILS_KEY, JSON.stringify(fails));
  return { ok: false, waitMs: wait, attemptsLeft: Math.max(0, DOOR_FREE_ATTEMPTS - count) };
}

/**
 * Quita el bloqueo: con el PIN correcto (unlockDoor) o cuando ya no hay
 * sesión (cache/lifecycle.ts). Nunca antes de haber cerrado la sesión.
 */
export function clearDoorLock(): void {
  write(ACTIVE_KEY, null);
  write(PIN_KEY, null);
  write(FAILS_KEY, null);
  notifyChange();
}
