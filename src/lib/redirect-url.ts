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

/** Construye una URL absoluta para una ruta de la SPA. */
export const buildAppUrl = (path: string): string => {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}/#${clean}`;
};

/**
 * Redirige el navegador a una ruta de la app con full reload.
 * Equivalente a `window.location.assign(buildAppUrl(path))`.
 * Usar cuando se necesita resetear estado React tras signup/checkout.
 */
export const redirectToApp = (path: string): void => {
  window.location.assign(buildAppUrl(path));
};
