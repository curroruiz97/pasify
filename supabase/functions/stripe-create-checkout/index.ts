// Pasify · stripe-create-checkout
// Crea una Checkout Session de Stripe para la compra de N tickets de un tier.
// Soporta Stripe Connect (destination charges); Pasify cobra application_fee.
//
// Body: { event_id, tier_id, qty, buyer: { email, first_name?, last_name?, phone? }, success_url, cancel_url }
// Returns: { url, order_id, session_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe, DEFAULT_APPLICATION_FEE_PCT } from "../_shared/stripe.ts";
import { enforceRateLimit, clientIp } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";

interface CheckoutPayload {
  event_id: string;
  tier_id: string;
  qty: number;
  buyer: { email: string; first_name?: string; last_name?: string; phone?: string };
  success_url: string;
  cancel_url: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    const user = await requireUser(req).catch(() => null);
    const ip = clientIp(req);

    await enforceRateLimit({ key: `checkout:${user?.id ?? ip}`, max: 20, windowSec: 3600 });

    const body = (await req.json()) as CheckoutPayload;
    if (!body.event_id || !body.tier_id || !body.qty || body.qty < 1 || body.qty > 10) {
      return errorResponse("invalid_payload", 400);
    }
    if (!body.buyer?.email) return errorResponse("buyer_email_required", 400);

    const stripe = requireStripe();
    const log = logger.child({ function: "stripe-create-checkout", user_id: user?.id, event_id: body.event_id });

    // 1) Cargar event + tier + org
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, title, org_id, partner_id, status, date_start, currency, image_url, city, venue_name")
      .eq("id", body.event_id)
      .maybeSingle();
    if (!event) return errorResponse("event_not_found", 404);
    if (event.status !== "published") return errorResponse("event_not_available", 400, "event_not_published");

    const { data: tier } = await supabaseAdmin
      .from("ticket_tiers")
      .select("id, name, price_cents, currency, capacity, sold, status, per_user_max, sale_starts_at, sale_ends_at")
      .eq("id", body.tier_id)
      .eq("event_id", body.event_id)
      .maybeSingle();
    if (!tier) return errorResponse("tier_not_found", 404);
    if (tier.status !== "active") return errorResponse("tier_not_available", 400);

    const now = Date.now();
    if (tier.sale_starts_at && new Date(tier.sale_starts_at).getTime() > now) return errorResponse("sale_not_started", 400);
    if (tier.sale_ends_at && new Date(tier.sale_ends_at).getTime() < now) return errorResponse("sale_ended", 400);
    if (body.qty > tier.per_user_max) return errorResponse("qty_exceeds_per_user_max", 400);
    if (tier.capacity != null && tier.sold + body.qty > tier.capacity) {
      return errorResponse("tier_sold_out", 400, "tier_sold_out");
    }

    // 2) Stripe Connect account del partner (si onboarded)
    let stripeAccount: string | null = null;
    if (event.org_id) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("stripe_connect_account_id, stripe_connect_charges_enabled")
        .eq("id", event.org_id)
        .maybeSingle();
      if (org?.stripe_connect_account_id && org.stripe_connect_charges_enabled) {
        stripeAccount = org.stripe_connect_account_id;
      }
    }

    // 3) Application fee
    const { data: feePctSetting } = await supabaseAdmin.rpc("get_app_setting_text", { _key: "application_fee_pct" });
    const feePct = Number(String(feePctSetting ?? "").replace(/[^0-9.]/g, "")) || DEFAULT_APPLICATION_FEE_PCT;
    const subtotalCents = tier.price_cents * body.qty;
    const applicationFeeCents = Math.floor((subtotalCents * feePct) / 100);

    // 4) Crear order pending
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("ticket_orders")
      .insert({
        event_id: event.id,
        org_id: event.org_id ?? null,
        buyer_user_id: user?.id ?? null,
        buyer_email: body.buyer.email,
        buyer_first_name: body.buyer.first_name ?? null,
        buyer_last_name: body.buyer.last_name ?? null,
        buyer_phone: body.buyer.phone ?? null,
        subtotal_cents: subtotalCents,
        fees_cents: applicationFeeCents,
        total_cents: subtotalCents,
        currency: tier.currency,
        status: "pending",
        stripe_destination_account: stripeAccount,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      })
      .select("id, request_id")
      .single();
    if (orderErr || !order) {
      log.error("order_create_failed", { error: orderErr?.message });
      return errorResponse("order_create_failed", 500);
    }

    // 5) Crear tickets pending
    const ticketsRows = Array.from({ length: body.qty }, () => ({
      event_id: event.id,
      order_id: order.id,
      tier_id: tier.id,
      buyer_user_id: user?.id ?? null,
      buyer_email: body.buyer.email,
      buyer_first_name: body.buyer.first_name ?? null,
      buyer_last_name: body.buyer.last_name ?? null,
      buyer_phone: body.buyer.phone ?? null,
      holder_first_name: body.buyer.first_name ?? null,
      holder_last_name: body.buyer.last_name ?? null,
      holder_email: body.buyer.email,
      status: "pending",
      amount_paid_cents: tier.price_cents,
      currency: tier.currency,
    }));
    const { error: tixErr } = await supabaseAdmin.from("tickets").insert(ticketsRows);
    if (tixErr) {
      log.error("tickets_create_failed", { error: tixErr.message });
      return errorResponse("tickets_create_failed", 500);
    }

    // 6) Crear Stripe Checkout Session
    const sessionParams: Record<string, unknown> = {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: body.qty,
        price_data: {
          currency: tier.currency.toLowerCase(),
          unit_amount: tier.price_cents,
          product_data: {
            name: `${event.title} · ${tier.name}`,
            description: `${event.venue_name ?? event.city} · ${new Date(event.date_start).toLocaleDateString("es-ES")}`,
            images: event.image_url ? [event.image_url] : undefined,
          },
        },
      }],
      customer_email: body.buyer.email,
      success_url: `${body.success_url}?order_id=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${body.cancel_url}?order_id=${order.id}`,
      metadata: {
        order_id: order.id,
        event_id: event.id,
        tier_id: tier.id,
        qty: String(body.qty),
        request_id: order.request_id,
        buyer_user_id: user?.id ?? "",
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    };

    if (stripeAccount) {
      sessionParams.payment_intent_data = {
        application_fee_amount: applicationFeeCents,
        transfer_data: { destination: stripeAccount },
        on_behalf_of: stripeAccount,
        metadata: {
          order_id: order.id,
          event_id: event.id,
          partner_account: stripeAccount,
        },
      };
    }

    // deno-lint-ignore no-explicit-any
    const session = await stripe.checkout.sessions.create(sessionParams as any);

    await supabaseAdmin.from("ticket_orders").update({ stripe_session_id: session.id }).eq("id", order.id);

    log.info("checkout_session_created", { order_id: order.id, session_id: session.id, amount_total: subtotalCents });

    return jsonResponse({ url: session.url, order_id: order.id, session_id: session.id });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const code = (err as { code?: string }).code ?? "internal_error";
    logger.error("stripe-create-checkout failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", status, code);
  }
});
