import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { withTimeout } from './withTimeout';

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
 * La solución: acotar cada llamada nativa con un timeout. Si no responde a
 * tiempo, degradamos con seguridad (tratamos como "sin valor guardado") en
 * vez de dejar la promesa colgada para siempre. En el peor caso el usuario
 * ve la pantalla de login en vez de quedar con la app congelada.
 */
const NATIVE_STORAGE_TIMEOUT_MS = 4000;

export const capacitorStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        const { value } = await withTimeout(
          Preferences.get({ key }),
          NATIVE_STORAGE_TIMEOUT_MS,
          `Preferences.get(${key})`
        );
        return value;
      } catch (err) {
        console.error('[capacitorStorage] getItem timeout/error — degradando a null:', err);
        return null;
      }
    }
    return localStorage.getItem(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await withTimeout(
          Preferences.set({ key, value }),
          NATIVE_STORAGE_TIMEOUT_MS,
          `Preferences.set(${key})`
        );
      } catch (err) {
        console.error('[capacitorStorage] setItem timeout/error:', err);
      }
    } else {
      localStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await withTimeout(
          Preferences.remove({ key }),
          NATIVE_STORAGE_TIMEOUT_MS,
          `Preferences.remove(${key})`
        );
      } catch (err) {
        console.error('[capacitorStorage] removeItem timeout/error:', err);
      }
    } else {
      localStorage.removeItem(key);
    }
  },
};
