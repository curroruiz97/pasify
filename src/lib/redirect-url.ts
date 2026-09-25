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

// ---------------------------------------------------------------- `?next=`

/**
 * `?next=` válido: una ruta de la app que empieza por "/" (nunca "//", que el
 * navegador tomaría por otro dominio, ni con "\" o caracteres de control).
 * Lo que no lo cumple se ignora. Contrato con el CTA de compra
 * (loginPathWithNext en src/lib/eventLinks.ts).
 */
export const sanitizeNextPath = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return null;
    if (decoded.includes("\\") || [...decoded].some((c) => c.charCodeAt(0) < 32)) return null;
    return decoded;
  } catch {
    return null;
  }
};

/** Añade `?next=` a una ruta de la app (si hay destino). */
export const withNext = (path: string, next: string | null | undefined): string => {
  const destino = sanitizeNextPath(next);
  return destino ? `${path}?next=${encodeURIComponent(destino)}` : path;
};

/**
 * Entrar con Google en la web sale de la app (redirección a Google y vuelta a
 * la raíz). Lo que haya que hacer a la vuelta viaja en sessionStorage, que
 * sobrevive a esa ida y vuelta en la misma pestaña: el destino (`next`) y la
 * marca de que el acceso está en curso (main.tsx la usa para no confundir un
 * error de Google con un enlace de email caducado).
 */
const OAUTH_KEY = "pasify.auth.oauth";

interface OAuthEnCurso {
  next: string | null;
  at: number;
}

/** Vale una hora: lo que tarda en volver de Google. */
const OAUTH_VIGENCIA_MS = 60 * 60 * 1000;

export const anotarOAuthEnCurso = (next: string | null | undefined): void => {
  try {
    const valor: OAuthEnCurso = { next: sanitizeNextPath(next), at: Date.now() };
    sessionStorage.setItem(OAUTH_KEY, JSON.stringify(valor));
  } catch {
    /* sin storage: a la vuelta se va a la raíz */
  }
};

/** Lo anotado por anotarOAuthEnCurso (y lo borra). null si no hay nada o caducó. */
export const tomarOAuthEnCurso = (): OAuthEnCurso | null => {
  try {
    const raw = sessionStorage.getItem(OAUTH_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(OAUTH_KEY);
    const v = JSON.parse(raw) as Partial<OAuthEnCurso> | null;
    if (!v || typeof v.at !== "number" || Date.now() - v.at > OAUTH_VIGENCIA_MS) return null;
    return { next: sanitizeNextPath(v.next ?? null), at: v.at };
  } catch {
    return null;
  }
};
