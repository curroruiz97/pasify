// Crea una Stripe Checkout Session per la subscription Partner.
// Richiede l'utente autenticato (header Authorization Bearer JWT).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PRICE_ID = Deno.env.get("STRIPE_PRICE_PARTNER")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://studentslife.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // Identifica utente dal JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Authorization required" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const locale = ["es", "en", "it"].includes(body.locale) ? body.locale : "es";
    const successUrl = body.successUrl || `${SITE_URL}/#/partner/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = body.cancelUrl || `${SITE_URL}/#/partner/cancel`;

    // Cerca subscription esistente
    const { data: existingSub } = await supabaseAdmin
      .from("partner_subscriptions")
      .select("stripe_customer_id, status, trial_ends_at, granted_by_admin, admin_granted_until")
      .eq("partner_id", user.id)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;

    // Blocca duplicato solo se l'accesso è *effettivamente* ancora attivo:
    //   - status=active → sub Stripe già in corso
    //   - status=trialing E trial_ends_at ancora futuro → trial valido
    //   - granted_by_admin attivo → accesso gratuito concesso dall'admin
    const now = Date.now();
    const trialStillValid =
      existingSub?.status === "trialing" &&
      existingSub?.trial_ends_at &&
      new Date(existingSub.trial_ends_at).getTime() > now;
    const adminGrantActive =
      existingSub?.granted_by_admin &&
      (!existingSub.admin_granted_until ||
        new Date(existingSub.admin_granted_until).getTime() > now);

    if (existingSub?.status === "active" || trialStillValid || adminGrantActive) {
      return json({ error: "Ya tienes una suscripción activa. Gestiónala desde el portal." }, 400);
    }

    // Crea customer Stripe se non esiste
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { partner_id: user.id, source: "studentslife" },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      locale: locale as Stripe.Checkout.SessionCreateParams.Locale,
      customer: customerId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { partner_id: user.id, source: "studentslife" },
      subscription_data: {
        metadata: { partner_id: user.id },
      },
    });

    return json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("create-checkout error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
