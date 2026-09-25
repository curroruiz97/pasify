// Pasify · URLs de vuelta permitidas
//
// Stripe Checkout, el onboarding de Connect y el portal de facturación
// mandan al usuario, al terminar, a la URL que les pasamos. Sin allowlist,
// cualquiera podría crear un pago o un enlace de Stripe de Pasify que acabe en
// una web de phishing. Lo usan stripe-create-checkout,
// partner-onboard-stripe-connect y partner-stripe-create-portal-link.

import { APP_URL } from "./email-templates.ts";
import { STRIPE_TEST_MODE } from "./stripe.ts";

/** Longitud máxima que se acepta en una URL de vuelta. */
const MAX_URL_LENGTH = 2000;

/**
 * Orígenes propios: APP_URL (secreto APP_BASE_URL), el dominio definitivo y la
 * web que hoy está en producción (la app nativa vuelve siempre a ella: ver
 * src/lib/redirect-url.ts), más los del secreto ALLOWED_RETURN_ORIGINS
 * (separados por comas).
 */
export const ALLOWED_RETURN_ORIGINS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  const add = (raw: string) => {
    try {
      const u = new URL(raw.trim());
      if (u.protocol === "https:" || u.protocol === "http:") set.add(u.origin);
    } catch {
      /* entrada mal formada: se ignora */
    }
  };
  [APP_URL, "https://pasify.es", "https://www.pasify.es", "https://pasifyy.vercel.app"].forEach(add);
  (Deno.env.get("ALLOWED_RETURN_ORIGINS") ?? "").split(",").filter((s) => s.trim()).forEach(add);
  return set;
})();

/**
 * true si `raw` es una URL de vuelta de un origen propio, sin credenciales en
 * la URL. En desarrollo contra el Stripe de pruebas (no mueve dinero real)
 * valen también localhost y 127.0.0.1.
 */
export function isAllowedReturnUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (ALLOWED_RETURN_ORIGINS.has(u.origin)) return true;
  return STRIPE_TEST_MODE && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** Origen de una URL para los logs ("invalid" si no se puede leer). */
export function safeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw).origin;
  } catch {
    return "invalid";
  }
}
