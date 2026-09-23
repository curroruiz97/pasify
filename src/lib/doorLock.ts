/**
 * Modo puerta (/door): bloqueo del dispositivo con PIN.
 *
 * El dueño deja su móvil en la puerta con su propia sesión (D12 del plan: las
 * cuentas de portero llegan con Equipo). Mientras el modo puerta está activo
 * en ESTE dispositivo, el panel redirige a /door y salir exige el PIN.
 *
 * Es un bloqueo local, no un permiso: vive en localStorage, ligado al usuario
 * y con el PIN guardado como hash (SHA-256 de usuario + PIN). Si se olvida el
 * PIN, cerrar sesión lo borra; volver a entrar exige la contraseña del dueño.
 */

const ACTIVE_KEY = "pasify.door.active";
const PIN_KEY = "pasify.door.pin";

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

export async function lockDoor(userId: string, pin: string): Promise<void> {
  if (!isValidDoorPin(pin)) throw new Error("invalid_pin");
  write(PIN_KEY, await pinHash(userId, pin));
  write(ACTIVE_KEY, userId);
}

/** Comprueba el PIN y, si es correcto, desbloquea. */
export async function unlockDoor(userId: string, pin: string): Promise<boolean> {
  const stored = read(PIN_KEY);
  if (!stored || read(ACTIVE_KEY) !== userId) {
    clearDoorLock();
    return true;
  }
  if ((await pinHash(userId, pin)) !== stored) return false;
  clearDoorLock();
  return true;
}

/** Quita el bloqueo sin PIN (al cerrar sesión). */
export function clearDoorLock(): void {
  write(ACTIVE_KEY, null);
  write(PIN_KEY, null);
}
