// Pasify · Stripe SDK shared
import Stripe from "npm:stripe@14";

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
export function stripeWebhookSecrets(): string[] {
  return [STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET].map((s) => s.trim()).filter(Boolean);
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
