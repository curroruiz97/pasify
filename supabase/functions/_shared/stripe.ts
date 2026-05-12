// Pasify · Stripe SDK shared
import Stripe from "npm:stripe@14";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
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

export { STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID };

/** Application fee Pasify por defecto en %. Lee de app_settings o fallback. */
export const DEFAULT_APPLICATION_FEE_PCT = 5.0;
