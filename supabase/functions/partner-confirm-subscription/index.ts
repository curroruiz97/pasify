// Pasify · partner-confirm-subscription
//
// Fallback robusto cuando el webhook `stripe-webhook` no llega para una
// subscription session creada por `partner-subscribe-checkout`. La página
// `/partner/success` lo llama con el `session_id` que vino en la URL:
//
//   1) Consulta la session de Stripe API directamente.
//   2) Valida que metadata.purpose === 'partner_subscription'.
//   3) Si payment_status === 'paid' y la subscription está active/trialing,
//      UPSERTs `partner_subscriptions` con plan_code='premium' y
//      status='active'. Idempotente.
//
// Body: { session_id: string }
// Returns: { status: 'active'|'incomplete'|'expired', org_id?: string, plan_code?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";

interface Payload {
  session_id: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    const user = await requireUser(req).catch(() => null);
    if (!user) return errorResponse("unauthorized", 401);

    const body = (await req.json()) as Payload;
    if (!body.session_id) return errorResponse("session_id_required", 400);

    const stripe = requireStripe();
    const log = logger.child({
      function: "partner-confirm-subscription",
      user_id: user.id,
      session_id: body.session_id,
    });

    // 1) Consultar la session en Stripe
    const session = await stripe.checkout.sessions.retrieve(body.session_id, {
      expand: ["subscription"],
    });
    if (!session) return errorResponse("session_not_found", 404);

    if (session.metadata?.purpose !== "partner_subscription") {
      return errorResponse(
        "wrong_session_purpose",
        400,
        `expected partner_subscription, got ${session.metadata?.purpose ?? "none"}`,
      );
    }

    const orgId = session.metadata?.pasify_org_id;
    if (!orgId) return errorResponse("missing_org_metadata", 400);

    // 2) Validar pago. Si payment_status no es paid, retornamos estado
    //    intermedio. El front puede reintentar (polling) o mostrar mensaje.
    if (session.payment_status !== "paid" && session.status !== "complete") {
      log.info("session_not_paid_yet", {
        payment_status: session.payment_status,
        session_status: session.status,
      });
      return jsonResponse({
        status: session.status === "expired" ? "expired" : "incomplete",
        org_id: orgId,
      });
    }

    // 3) Extraer subscription details
    const subscription =
      typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

    const stripeSubId = subscription?.id ?? null;
    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const periodEnd = subscription?.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    const periodStart = subscription?.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null;
    const stripeStatus = subscription?.status ?? "active";

    // Mapear status Stripe → enum Pasify
    const subStatus: string = (() => {
      switch (stripeStatus) {
        case "active":
        case "trialing":
          return stripeStatus;
        case "past_due":
        case "unpaid":
        case "paused":
        case "incomplete":
        case "incomplete_expired":
          return stripeStatus;
        case "canceled":
          return "cancelled";
        default:
          return "active";
      }
    })();

    // 4) UPSERT partner_subscriptions
    const { data: upserted, error: upErr } = await supabaseAdmin
      .from("partner_subscriptions")
      .upsert(
        {
          org_id: orgId,
          plan_code: "premium",
          status: subStatus,
          stripe_subscription_id: stripeSubId,
          stripe_customer_id: stripeCustomerId,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          last_payment_at: new Date().toISOString(),
          last_payment_amount_cents: session.amount_total ?? null,
          metadata: {
            confirmed_via: "partner_confirm_subscription",
            confirmed_at: new Date().toISOString(),
            stripe_session_id: session.id,
            interval: session.metadata?.interval ?? "monthly",
          },
        },
        { onConflict: "org_id" },
      )
      .select("id, plan_code, status, org_id")
      .single();

    if (upErr) {
      log.error("upsert_partner_subscription_failed", { error: upErr.message });
      return errorResponse("upsert_failed", 500, upErr.message);
    }

    log.info("partner_subscription_confirmed", { org_id: orgId, plan: "premium", status: subStatus });
    return jsonResponse({
      status: upserted.status,
      org_id: upserted.org_id,
      plan_code: upserted.plan_code,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[partner-confirm-subscription] error:", err);
    return errorResponse(msg, 500, "server_error");
  }
});
