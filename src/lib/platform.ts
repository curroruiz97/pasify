import { Capacitor } from "@capacitor/core";

/**
 * Plataforma en la que corre la SPA (la misma para web, iOS y Android).
 *
 * Las dos variables globales solo existen para probar en el navegador lo que
 * vera el revisor de Apple o de Google, sin compilar la app:
 *   window.__PASIFY_FORCE_NATIVE_UI__ = true      -> isNativeApp() === true
 *   window.__PASIFY_FORCE_PLATFORM__ = "ios"      -> appPlatform() === "ios"
 * En produccion nadie las define y manda Capacitor.
 */

export type AppPlatform = "ios" | "android" | "web";

declare global {
  interface Window {
    __PASIFY_FORCE_NATIVE_UI__?: boolean;
    __PASIFY_FORCE_PLATFORM__?: AppPlatform;
  }
}

const forcedWindow = (): Window | null => (typeof window === "undefined" ? null : window);

/** true dentro de la app de iOS/Android (o con el override de pruebas). */
export const isNativeApp = (): boolean =>
  Capacitor.isNativePlatform() || forcedWindow()?.__PASIFY_FORCE_NATIVE_UI__ === true;

export const appPlatform = (): AppPlatform => {
  const forced = forcedWindow()?.__PASIFY_FORCE_PLATFORM__;
  if (forced === "ios" || forced === "android" || forced === "web") return forced;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
};

/** Precios de suscripcion, checkouts y enlaces de pago: solo fuera de las apps (App Store 3.1.1). */
export const canShowPurchaseUi = (): boolean => !isNativeApp();
