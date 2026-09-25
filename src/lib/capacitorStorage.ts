import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { withTimeout } from './withTimeout';
import { captureError } from './sentry';

/**
 * Adaptador de storage para la sesión de Supabase Auth en nativo.
 *
 * FIX Apple Review — Guideline 2.1(a) (submission 14204a0e-90da-43d1-b420-2a76956de94d):
 * el reviewer reportó que "Editar perfil" no respondía / se quedaba
 * congelado en un iPhone 17 Pro Max con iOS 26.5.1. Causa raíz encontrada:
 * `Preferences.get/set/remove` (el bridge nativo de Capacitor) puede no
 * resolver NI rechazar nunca si se invoca antes de que el WKWebView bridge
 * esté completamente listo (visto en arranques en frío / primeros instantes
 * tras volver de background en iOS 26.x). Como `supabase.auth.getSession()`
 * y `getUser()` leen la sesión a través de este storage en CADA pantalla
 * protegida, un cuelgue aquí bloqueaba `loading` para siempre en
 * `useAuth`/`ProtectedRoute`, congelando toda la UI (incluida la pantalla
 * de perfil) sin ningún error visible — exactamente el síntoma reportado.
 *
 * Por eso cada llamada nativa lleva un límite de tiempo. Si una lectura no
 * responde a tiempo se trata como "sin valor guardado" en vez de dejar la
 * promesa colgada para siempre.
 *
 * Escrituras (nativo): hay una copia en memoria de cada clave con lo último
 * escrito o leído, y se lee primero de ahí. Antes, si `Preferences.set`
 * tardaba más del límite, el error se descartaba: auth-js ya había gastado el
 * refresh token anterior y el renovado no llegaba al disco, así que al
 * reabrir la app la sesión estaba perdida. Ahora la app sigue con el token
 * bueno (memoria) y la escritura se reintenta en segundo plano. Quien escribe
 * solo espera al primer intento: renovar el token o cerrar sesión no se
 * alargan por los reintentos.
 *
 * En la web es localStorage tal cual (síncrono y fiable, y compartido entre
 * pestañas: ahí una copia en memoria se quedaría atrasada).
 */
const NATIVE_STORAGE_TIMEOUT_MS = 4000;
/** Esperas entre reintentos de una escritura que no ha llegado al disco. */
const REINTENTOS_MS = [1_000, 3_000, 10_000];

const esNativo = () => Capacitor.isNativePlatform();

/** Último valor conocido de cada clave (null = borrada). Solo nativo. */
const memoria = new Map<string, string | null>();
/** Versión del valor en memoria y última versión que Preferences confirmó. */
const versionEnMemoria = new Map<string, number>();
const versionEnDisco = new Map<string, number>();
/** Intento de escritura en curso por clave: se escriben en orden. */
const escribiendo = new Map<string, Promise<boolean>>();

/** Lee del disco. `undefined` si Preferences no responde o falla. */
async function leerDelDisco(key: string): Promise<string | null | undefined> {
  try {
    const { value } = await withTimeout(Preferences.get({ key }), NATIVE_STORAGE_TIMEOUT_MS, `Preferences.get(${key})`);
    return value;
  } catch (err) {
    console.error('[capacitorStorage] lectura sin respuesta:', err);
    return undefined;
  }
}

/** Lleva al disco el valor que haya en memoria en ese momento. */
async function escribirEnDisco(key: string): Promise<boolean> {
  const version = versionEnMemoria.get(key) ?? 0;
  const valor = memoria.get(key) ?? null;
  try {
    if (valor === null) {
      await withTimeout(Preferences.remove({ key }), NATIVE_STORAGE_TIMEOUT_MS, `Preferences.remove(${key})`);
    } else {
      await withTimeout(Preferences.set({ key, value: valor }), NATIVE_STORAGE_TIMEOUT_MS, `Preferences.set(${key})`);
    }
    versionEnDisco.set(key, Math.max(versionEnDisco.get(key) ?? 0, version));
    return true;
  } catch (err) {
    console.error('[capacitorStorage] escritura sin respuesta:', err);
    return false;
  }
}

/** Un intento de escritura, detrás del que ya estuviera en curso para la clave. */
function intentarEscritura(key: string): Promise<boolean> {
  const anterior = escribiendo.get(key) ?? Promise.resolve(true);
  const intento = anterior.then(() => escribirEnDisco(key));
  escribiendo.set(key, intento);
  void intento.finally(() => {
    if (escribiendo.get(key) === intento) escribiendo.delete(key);
  });
  return intento;
}

const pendienteDeDisco = (key: string) => (versionEnDisco.get(key) ?? 0) < (versionEnMemoria.get(key) ?? 0);

function programarReintento(key: string, n = 0) {
  if (n >= REINTENTOS_MS.length) {
    captureError(new Error('Preferences no guarda la clave tras varios intentos'), { where: 'capacitorStorage', key });
    return;
  }
  setTimeout(() => {
    if (!pendienteDeDisco(key)) return; // otra escritura ya lo dejó bien
    void intentarEscritura(key).then((ok) => {
      if (!ok && pendienteDeDisco(key)) programarReintento(key, n + 1);
    });
  }, REINTENTOS_MS[n]);
}

async function guardarNativo(key: string, valor: string | null): Promise<void> {
  memoria.set(key, valor);
  versionEnMemoria.set(key, (versionEnMemoria.get(key) ?? 0) + 1);
  const ok = await intentarEscritura(key);
  if (!ok && pendienteDeDisco(key)) programarReintento(key);
}

export const capacitorStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!esNativo()) return localStorage.getItem(key);
    if (memoria.has(key)) return memoria.get(key) ?? null;
    const leido = await leerDelDisco(key);
    // Sin respuesta: "sin valor", pero no se apunta, la próxima vez se vuelve a leer.
    if (leido === undefined) return memoria.get(key) ?? null;
    // Si mientras tanto se ha escrito, manda lo escrito.
    if (!memoria.has(key)) memoria.set(key, leido);
    return memoria.get(key) ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!esNativo()) {
      localStorage.setItem(key, value);
      return;
    }
    await guardarNativo(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (!esNativo()) {
      localStorage.removeItem(key);
      return;
    }
    await guardarNativo(key, null);
  },

  /**
   * Como getItem, pero distingue "no hay nada" (null) de "no se ha podido
   * leer" (undefined). Para decisiones que no se pueden tomar a ciegas, como
   * borrar lo guardado de alguien porque "no hay sesión".
   */
  async consultar(key: string): Promise<string | null | undefined> {
    if (!esNativo()) {
      try {
        return localStorage.getItem(key);
      } catch {
        return undefined;
      }
    }
    if (memoria.has(key)) return memoria.get(key) ?? null;
    const leido = await leerDelDisco(key);
    if (leido === undefined) return memoria.has(key) ? memoria.get(key) ?? null : undefined;
    if (!memoria.has(key)) memoria.set(key, leido);
    return memoria.get(key) ?? null;
  },
};
