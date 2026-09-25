// Pasify · Stripe SDK shared
import Stripe from "npm:stripe@14";
import { HttpError } from "./internal-auth.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
/** Secreto del endpoint de PLATAFORMA (checkout, cargos, suscripciones). */
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
/**
 * Secreto del endpoint CONNECT (eventos de las cuentas conectadas de los
 * locales: account.updated, payout.*). En Stripe es un endpoint aparte, con su
 * propio secreto, aunque apunte al mismo URL de `stripe-webhook`.
 */
const STRIPE_CONNECT_WEBHOOK_SECRET = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "";
const STRIPE_CONNECT_CLIENT_ID = Deno.env.get("STRIPE_CONNECT_CLIENT_ID") ?? "";

export const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
      httpClient: Stripe.createFetchHttpClient(),
      typescript: true,
    })
  : null;

export function requireStripe(): Stripe {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY not configured");
  return stripe;
}

/** true cuando la clave configurada es de modo prueba (no mueve dinero real). */
export const STRIPE_TEST_MODE = /^(sk|rk)_test_/.test(STRIPE_SECRET_KEY);

/**
 * Verificación de firmas de webhook con WebCrypto. En Deno no hay `crypto`
 * de Node síncrono: hay que usar `constructEventAsync` con este proveedor.
 */
export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();

/** Secretos de firma aceptados por `stripe-webhook`, en el orden en que se prueban. */
/** Secretos de firma del webhook, con el endpoint al que pertenece cada uno. */
export function stripeWebhookSecrets(): Array<{ kind: "platform" | "connect"; secret: string }> {
  const out: Array<{ kind: "platform" | "connect"; secret: string }> = [];
  if (STRIPE_WEBHOOK_SECRET.trim()) out.push({ kind: "platform", secret: STRIPE_WEBHOOK_SECRET.trim() });
  if (STRIPE_CONNECT_WEBHOOK_SECRET.trim()) out.push({ kind: "connect", secret: STRIPE_CONNECT_WEBHOOK_SECRET.trim() });
  return out;
}

/** true si la clave secreta configurada es de producción (sk_live_ / rk_live_). */
export function stripeKeyIsLive(): boolean {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

/* ---------------------------------------------------------------------------
   Pagos de prueba en producción
   ---------------------------------------------------------------------------
   Con una clave de test en producción, la tarjeta 4242 "pagaba" de verdad:
   entradas pagadas, email con QR, puntos, aviso de venta al local, entrada
   válida en puerta e importe en el saldo que Pasify liquida. En producción:
     - no se abre ningún pago si la clave no es live (assertLivePayments);
     - las sesiones y eventos de Stripe con livemode = false se ignoran
       (isIgnoredTestModeObject).
   Fuera de producción todo sigue igual que antes.

   Escape para probar en producción: el secreto PASIFY_ALLOW_TEST_PAYMENTS =
   "true" desactiva los dos controles, y las compras con tarjeta de prueba
   vuelven a confirmarse (entradas, email, puntos, aviso de venta). Solo
   durante la prueba: quitarlo al acabar. En la base de datos esos pedidos
   quedan con livemode = false y, mientras el ajuste require_live_payments de
   app_settings siga a true, el escáner los rechaza ('test_payment') y no
   suman en el saldo del local.
   --------------------------------------------------------------------------- */

/** Ref del proyecto de Supabase de producción (solo si falta PASIFY_ENV). */
const PRODUCTION_PROJECT_REF = "ixkyfwzkknehvsqpopof";

/**
 * true si esta función corre en producción. Manda el secreto PASIFY_ENV
 * ("production" = producción; cualquier otro valor, no). Si no existe, se
 * deduce del SUPABASE_URL del proyecto de producción.
 */
export function isProductionEnv(): boolean {
  const env = (Deno.env.get("PASIFY_ENV") ?? "").trim().toLowerCase();
  if (env) return env === "production";
  return (Deno.env.get("SUPABASE_URL") ?? "").includes(PRODUCTION_PROJECT_REF);
}

/** Escape explícito PASIFY_ALLOW_TEST_PAYMENTS = "true" (ver arriba). */
export function testPaymentsAllowed(): boolean {
  return (Deno.env.get("PASIFY_ALLOW_TEST_PAYMENTS") ?? "").trim().toLowerCase() === "true";
}

/**
 * En producción solo se cobra con clave live. Si no, HttpError 503
 * `payments_unavailable` (salvo el escape). Llamarlo antes de reservar nada.
 */
export function assertLivePayments(): void {
  if (isProductionEnv() && !stripeKeyIsLive() && !testPaymentsAllowed()) {
    throw new HttpError(503, "payments_unavailable", "Los pagos no están disponibles en este momento.");
  }
}

/**
 * true si una sesión o un evento de Stripe de modo prueba (livemode false)
 * debe ignorarse: en producción y sin el escape. Fuera de producción, nunca.
 */
export function isIgnoredTestModeObject(livemode: boolean | null | undefined): boolean {
  return livemode === false && isProductionEnv() && !testPaymentsAllowed();
}

export { STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID };

/** Application fee Pasify por defecto en %. Lee de app_settings o fallback. */
export const DEFAULT_APPLICATION_FEE_PCT = 5.0;

/** Id de un campo expandible de Stripe (`"pi_123"` o `{ id: "pi_123", ... }`). */
export function stripeId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

/**
 * Una Checkout Session está cobrada cuando Stripe dice `paid`. OJO: `status
 * === 'complete'` NO basta: con métodos de pago asíncronos la sesión se
 * completa con `payment_status = 'unpaid'` y el dinero llega (o no) después
 * (`checkout.session.async_payment_succeeded/failed`).
 */
export function isCheckoutSessionPaid(
  session: Pick<Stripe.Checkout.Session, "status" | "payment_status">,
): boolean {
  if (session.payment_status === "paid") return true;
  return session.status === "complete" && session.payment_status === "no_payment_required";
}

/** Valores del enum `partner_subscription_status_t`. */
export type PartnerSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "cancel_at_period_end"
  | "cancelled"
  | "paused"
  | "incomplete"
  | "incomplete_expired";

/**
 * Estado de suscripción de Stripe → enum Pasify. Stripe escribe `canceled`
 * (una L) y el enum `cancelled` (dos): escribir el valor de Stripe tal cual
 * hace fallar el upsert. Mismo criterio que partner-confirm-subscription
 * (desconocido → 'active').
 */
export function mapStripeSubscriptionStatus(status: string | null | undefined): PartnerSubscriptionStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
    case "paused":
    case "incomplete":
    case "incomplete_expired":
      return status;
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

/** Estados finales: una suscripción así ya no va a volver a cobrar. */
export function isTerminalSubscriptionStatus(status: PartnerSubscriptionStatus): boolean {
  return status === "cancelled" || status === "incomplete_expired";
}

/** Valores del enum `stripe_payout_status_t`. */
export type StripePayoutStatus = "pending" | "in_transit" | "paid" | "failed" | "cancelled";

/** Estado de payout de Stripe → enum Pasify (`canceled` → `cancelled`). */
export function mapStripePayoutStatus(status: string | null | undefined): StripePayoutStatus {
  switch (status) {
    case "in_transit":
    case "paid":
    case "failed":
      return status;
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}
