/**
 * Pasify · helpers de construcción de URL para redirects.
 *
 * Centraliza el conocimiento "esta app usa HashRouter" en un único
 * sitio. Cuando se migre a BrowserRouter (P2 del plan de hardening,
 * pendiente), solo cambia este fichero. Antes este patrón estaba
 * duplicado en 10 sitios entre RegisterPartner, RegisterClient,
 * PartnerSubscribe, PartnerManage, ResetPassword y useTicketCheckout.
 *
 * Reglas:
 *   - Siempre prefijar con `/#` para coincidir con HashRouter.
 *   - Aceptar path con o sin slash inicial: el helper lo normaliza.
 *   - Nunca acoplar a `window` directamente fuera del navegador (los
 *     consumers son client-only, por eso lee `window.location.origin`).
 */

import { Capacitor } from "@capacitor/core";

/**
 * URL publica del sitio. Hardcode obligatorio: en la app nativa
 * `window.location.origin` no es una direccion web sino el origen interno
 * de la WebView (`capacitor://localhost` en iOS, `https://localhost` en
 * Android).
 */
export const WEB_BASE =
  import.meta.env.VITE_PUBLIC_WEB_URL ||
  import.meta.env.VITE_APP_BASE_URL ||
  "https://pasifyy.vercel.app";

/** Construye una URL absoluta para una ruta de la SPA. */
export const buildAppUrl = (path: string): string => {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}/#${clean}`;
};

/**
 * URL de retorno para servicios EXTERNOS (Stripe Checkout, portal de
 * facturacion, enlaces de recuperacion de contrasena de Supabase).
 *
 * OJO: no vale buildAppUrl aqui. En la app nativa devuelve
 * `capacitor://localhost/#/...`, y eso se lo tragaba Stripe sin rechistar
 * al crear la sesion — el error aparecia despues, al terminar el pago:
 * Safari recibe ese destino, no sabe abrirlo y suelta "Safari no puede
 * abrir la pagina porque la direccion no es valida". El cobro se habia
 * hecho y el usuario se quedaba plantado fuera de la app.
 *
 * En nativo devolvemos siempre la web publica, que si es una https real.
 * En web se comporta exactamente igual que buildAppUrl.
 */
export const buildExternalReturnUrl = (path: string): string => {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const base = Capacitor.isNativePlatform() ? WEB_BASE : window.location.origin;
  return `${base}/#${clean}`;
};

/**
 * Redirige el navegador a una ruta de la app con full reload.
 * Equivalente a `window.location.assign(buildAppUrl(path))`.
 * Usar cuando se necesita resetear estado React tras signup/checkout.
 */
export const redirectToApp = (path: string): void => {
  window.location.assign(buildAppUrl(path));
};
