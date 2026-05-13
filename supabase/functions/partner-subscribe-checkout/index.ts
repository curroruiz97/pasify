// Pasify · partner-subscribe-checkout
//
// Crea una Checkout Session de Stripe en modo `subscription` para activar
// el plan Partner Premium (29,99 €/mes). Es la contraparte premium del
// flujo "Empezar gratis" (RPC `claim_partner_free_plan`).
//
// Diferencias respecto a `stripe-create-checkout`:
//   - Ese flow es para COMPRA DE TICKETS (event_id, tier_id, qty, buyer).
//     Lo llamábamos por error desde /partner/choose-plan con `mode:
//     subscription` y el server devolvía 400 ("invalid_payload") porque
//     no encontraba event_id ni tier_id.
//   - Este flow NO necesita event/tier — sólo el partner autenticado.
//
// Uso de `price_data` (ad-hoc) en lugar de stripe_price_id pre-creado:
//   Hoy `subscription_plans` no tiene `stripe_price_id_monthly` rellenado.
//   `price_data` permite crear el precio en línea, sin tener que
//   configurarlo en el dashboard de Stripe. Si el equipo después
//   pre-crea un Price y lo guarda en BD, podemos refactorizar a usar
//   `line_items: [{ price: 'price_xxx' }]`.
//
// Body: {} (todo se deriva del JWT) o { interval: 'monthly'|'yearly' }
// Returns: { url: string, session_id: string, org_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { enforceRateLimit, clientIp } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";

interface Payload {
  interval?: "monthly" | "yearly";
  /** URL del front al que volver. Si no se pasa, usa el origin de Pasify. */
  return_origin?: string;
}

const PREMIUM_MONTHLY_CENTS = 2999;
const PREMIUM_YEARLY_CENTS = 29900; // ~17% descuento anual
const DEFAULT_ORIGIN = "https://pasifyy.vercel.app";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    const user = await requireUser(req).catch(() => null);
    if (!user) return errorResponse("unauthorized", 401);

    const ip = clientIp(req);
    await enforceRateLimit({ key: `partner-sub-checkout:${user.id ?? ip}`, max: 10, windowSec: 600 });

    const body = ((await req.json().catch(() => ({}))) as Payload) ?? {};
    const interval = body.interval === "yearly" ? "yearly" : "monthly";
    const origin = body.return_origin?.replace(/\/$/, "") || DEFAULT_ORIGIN;

    const stripe = requireStripe();
    const log = logger.child({ function: "partner-subscribe-checkout", user_id: user.id });

    // 1) Resolver/crear la org del partner. Sin org no hay subscription.
    //    Reusamos la misma lógica que claim_partner_free_plan: owner_id directo,
    //    miembro activo, o create_organization.
    let orgId: string | null = null;

    const { data: ownedOrg } = await supabaseAdmin
      .from("organizations")
      .select("id, name, billing_email, contact_email, stripe_customer_id")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (ownedOrg) {
      orgId = ownedOrg.id;
    } else {
      const { data: memberOrg } = await supabaseAdmin
        .from("organization_members")
        .select("org_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (memberOrg?.org_id) orgId = memberOrg.org_id;
    }

    if (!orgId) {
      // Crear org placeholder vía RPC. La llamamos con admin client +
      // metadata.acting_user_id para que dispare el owner_id correcto.
      // create_organization usa auth.uid() internamente — necesitamos
      // delegarla al user-scoped client.
      const userToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!userToken) return errorResponse("missing_authorization", 401);
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${userToken}` } }, auth: { persistSession: false } },
      );
      const slug = (user.email ?? "partner").split("@")[0] || "partner";
      const { data: newOrgId, error: createErr } = await userClient.rpc("create_organization", {
        _name: slug,
        _country: "ES",
        _slug: null,
      });
      if (createErr || !newOrgId) {
        log.error("create_organization_failed", { error: createErr?.message });
        return errorResponse("create_organization_failed", 500, createErr?.message ?? undefined);
      }
      orgId = newOrgId as string;
    }

    // 2) Recargar la org para obtener (o no) stripe_customer_id
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("id, name, billing_email, contact_email, stripe_customer_id, country")
      .eq("id", orgId)
      .maybeSingle();
    if (!org) return errorResponse("org_not_found", 404);

    // 3) Asegurar Stripe Customer
    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.billing_email ?? org.contact_email ?? user.email ?? undefined,
        name: org.name ?? undefined,
        metadata: {
          org_id: org.id,
          purpose: "partner_subscription",
          pasify_user_id: user.id,
        },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id);
    }

    // 4) Crear Checkout Session en modo subscription con price_data ad-hoc.
    const unitAmount = interval === "yearly" ? PREMIUM_YEARLY_CENTS : PREMIUM_MONTHLY_CENTS;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: unitAmount,
            recurring: { interval: interval === "yearly" ? "year" : "month" },
            product_data: {
              name: interval === "yearly" ? "Pasify Partner Premium · Anual" : "Pasify Partner Premium",
              description:
                "Acceso completo a Pasify: eventos ilimitados, tickets, asistentes, QR scanner, reports y Stripe Connect.",
            },
          },
        },
      ],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${origin}/#/partner/success?session_id={CHECKOUT_SESSION_ID}&purpose=subscription`,
      cancel_url: `${origin}/#/partner/choose-plan`,
      metadata: {
        purpose: "partner_subscription",
        pasify_org_id: org.id,
        pasify_user_id: user.id,
        interval,
      },
      subscription_data: {
        metadata: {
          purpose: "partner_subscription",
          pasify_org_id: org.id,
          pasify_user_id: user.id,
        },
      },
    });

    if (!session.url) {
      return errorResponse("session_url_missing", 500);
    }

    // 5) Pre-crear (o actualizar) un row 'incomplete' en partner_subscriptions
    //    para que el partner vea el estado intermedio si vuelve sin pagar.
    await supabaseAdmin
      .from("partner_subscriptions")
      .upsert(
        {
          org_id: org.id,
          plan_code: "premium",
          status: "incomplete",
          stripe_customer_id: customerId,
          metadata: {
            checkout_session_id: session.id,
            interval,
            started_at: new Date().toISOString(),
          },
        },
        { onConflict: "org_id" },
      );

    log.info("checkout_session_created", { session_id: session.id, org_id: org.id });
    return jsonResponse({ url: session.url, session_id: session.id, org_id: org.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[partner-subscribe-checkout] error:", err);
    return errorResponse(msg, 500, "server_error");
  }
});
