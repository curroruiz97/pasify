// Pasify · stripe-webhook
// Procesa eventos Stripe (platform + Connect accounts) con idempotencia
// vía stripe_webhook_events.event_id UNIQUE.
//
// Handled events:
//   checkout.session.completed   → mark_order_paid + send-ticket-email + loyalty
//   checkout.session.expired     → marca order como 'expired'
//   payment_intent.succeeded     → confirma
//   charge.refunded              → mark_refund_processed
//   customer.subscription.*      → upsert partner_subscriptions
//   invoice.paid / payment_failed → update subscription state + email
//   account.updated              → sync Connect onboarded state
//   payout.paid / payout.failed  → insert stripe_payouts + email partner
//   application_fee.created      → insert application_fees_ledger
//
// Idempotencia: stripe_webhook_events.event_id UNIQUE. Retries seguros.
// verify_jwt = false (config.toml) — usamos Stripe signature.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { requireStripe, STRIPE_WEBHOOK_SECRET } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";
import { enqueueNotification } from "../_shared/notify.ts";
import { sendEmail } from "../_shared/resend.ts";
import { ticketPurchasedEmail, partnerApprovedEmail, payoutArrivedEmail } from "../_shared/email-templates.ts";

const log = logger.child({ function: "stripe-webhook" });

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    log.warn("checkout_session_completed_no_order_id", { session_id: session.id });
    return;
  }
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const totalCents = session.amount_total ?? 0;
  const feeCents = (session.payment_intent && typeof session.payment_intent !== "string"
    ? session.payment_intent.application_fee_amount
    : 0) ?? 0;

  await supabaseAdmin.rpc("mark_order_paid", {
    _session_id: session.id,
    _payment_intent_id: pi,
    _amount_total_cents: totalCents,
    _application_fee_cents: feeCents,
  });

  // Cargar order + tickets para enviar email
  const { data: order } = await supabaseAdmin
    .from("ticket_orders")
    .select("id, buyer_email, buyer_first_name, buyer_user_id, total_cents, event_id, org_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;

  const { data: event } = await supabaseAdmin
    .from("events")
    .select("title, date_start, venue_name, city")
    .eq("id", order.event_id)
    .maybeSingle();

  const { data: tickets } = await supabaseAdmin
    .from("tickets")
    .select("id, qr_token, amount_paid_cents, tier_id, ticket_tiers(name)")
    .eq("order_id", order.id);

  if (event && tickets && tickets.length > 0) {
    const email = ticketPurchasedEmail({
      firstName: order.buyer_first_name,
      eventTitle: event.title,
      eventDate: new Date(event.date_start).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }),
      venueName: event.venue_name ?? event.city,
      tickets: tickets.map((t: any) => ({
        tierName: t.ticket_tiers?.name ?? "General",
        qrToken: t.qr_token,
        amountCents: t.amount_paid_cents,
      })),
      totalCents: order.total_cents,
      orderId: order.id,
    });
    await sendEmail({ to: order.buyer_email, ...email, idempotencyKey: `order-${order.id}` }).catch((e) =>
      log.warn("ticket_email_send_failed", { error: String(e), order_id: order.id })
    );
  }

  // Loyalty points: 1 punto por euro
  if (order.buyer_user_id) {
    const points = Math.floor(order.total_cents / 100);
    if (points > 0) {
      await supabaseAdmin.rpc("loyalty_grant_points", {
        _user_id: order.buyer_user_id,
        _amount: points,
        _reason: `Compra ticket ${event?.title ?? ""}`,
        _reason_code: "ticket_purchase",
        _event_id: order.event_id,
      });
    }
  }

  // Notif in-app
  if (order.buyer_user_id) {
    await enqueueNotification({
      user_id: order.buyer_user_id,
      category: "tickets",
      kind: "ticket_paid",
      title: "Compra confirmada",
      body: `Tus entradas para ${event?.title ?? "el evento"} están en tu Wallet.`,
      link: "/#/client-dashboard",
      payload: { order_id: order.id },
    }).catch((e) => log.warn("notify_buyer_failed", { error: String(e) }));
  }

  // Notif al partner (org owner/managers)
  if (order.org_id) {
    const { data: members } = await supabaseAdmin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", order.org_id)
      .in("role", ["owner", "admin", "manager"])
      .eq("status", "active");
    if (members) {
      for (const m of members) {
        if (m.user_id) {
          await enqueueNotification({
            user_id: m.user_id,
            category: "tickets",
            kind: "ticket_sold",
            title: `Venta: ${event?.title ?? "evento"}`,
            body: `${tickets?.length ?? 0} × tickets · €${(order.total_cents / 100).toFixed(2)}`,
            link: "/#/partner-dashboard",
            payload: { order_id: order.id, event_id: order.event_id },
          }).catch(() => null);
        }
      }
    }

    // Insertar application_fees_ledger.
    // OJO: el builder de .from().insert() es PromiseLike — tiene then() pero
    // NO catch(). El .catch() que habia aqui lanzaba
    // "TypeError: ....catch is not a function", el handler entero moria, el
    // webhook devolvia 500 y Stripe lo reintentaba. Como el guardia
    // anti-duplicados solo salta con status 'processed' (y el evento quedaba
    // en 'failed'), cada reintento re-ejecutaba la compra completa: puntos de
    // fidelidad duplicados y notificaciones repetidas. Postgrest reporta los
    // errores en { error }, no rechazando, asi que se comprueban; el try/catch
    // cubre fallos de red. Esta linea nunca debe tumbar el webhook: la venta
    // ya esta procesada y el ledger es contabilidad, se puede reconciliar.
    try {
      const { error: ledgerError } = await supabaseAdmin.from("application_fees_ledger").insert({
        org_id: order.org_id,
        ticket_order_id: order.id,
        stripe_payment_intent_id: pi,
        amount_cents: feeCents,
        gross_cents: totalCents,
        net_to_partner_cents: totalCents - feeCents,
        currency: session.currency?.toUpperCase() ?? "EUR",
      });
      if (ledgerError) log.warn("fee_ledger_insert_failed", { error: ledgerError.message, order_id: order.id });
    } catch (e) {
      log.warn("fee_ledger_insert_failed", { error: String(e), order_id: order.id });
    }
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const refundList = charge.refunds?.data ?? [];
  for (const r of refundList) {
    await supabaseAdmin.rpc("mark_refund_processed", {
      _stripe_refund_id: r.id,
      _amount_refunded_cents: r.amount,
      _payment_intent_id: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? "",
    });
  }
}

async function handleAccountUpdated(account: Stripe.Account) {
  const orgId = account.metadata?.pasify_org_id;
  const charges = account.charges_enabled ?? false;
  const payouts = account.payouts_enabled ?? false;
  const details = account.details_submitted ?? false;

  // Update por stripe_connect_account_id (preferred)
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .update({
      stripe_connect_charges_enabled: charges,
      stripe_connect_payouts_enabled: payouts,
      stripe_connect_onboarded: details && charges,
    })
    .eq("stripe_connect_account_id", account.id)
    .select("id, owner_id, name")
    .maybeSingle();

  if (org && details && charges) {
    await sendEmail({
      to: account.email ?? "",
      ...partnerApprovedEmail({ businessName: org.name }),
    }).catch(() => null);

    if (org.owner_id) {
      await enqueueNotification({
        user_id: org.owner_id,
        category: "system",
        kind: "stripe_connect_ready",
        title: "Stripe Connect listo",
        body: "Tu cuenta puede recibir pagos ya mismo.",
        link: "/#/partner-dashboard",
      });
    }
  }
}

async function handlePayoutPaid(payout: Stripe.Payout, account: string | null) {
  if (!account) return;
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, owner_id, name")
    .eq("stripe_connect_account_id", account)
    .maybeSingle();
  if (!org) return;

  await supabaseAdmin.from("stripe_payouts").upsert({
    stripe_payout_id: payout.id,
    stripe_account_id: account,
    org_id: org.id,
    amount_cents: payout.amount,
    currency: (payout.currency ?? "eur").toUpperCase(),
    status: payout.status as any,
    arrival_date: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null,
    method: payout.method ?? null,
    paid_at: payout.status === "paid" ? new Date().toISOString() : null,
  }, { onConflict: "stripe_payout_id" });

  if (org.owner_id && payout.status === "paid") {
    await enqueueNotification({
      user_id: org.owner_id,
      category: "system",
      kind: "payout_arrived",
      title: "Payout en camino",
      body: `${(payout.amount / 100).toFixed(2)} ${(payout.currency ?? "eur").toUpperCase()}`,
      link: "/#/partner-dashboard",
    });

    // Email owner
    const { data: ownerProfile } = await supabaseAdmin.from("profiles").select("email").eq("id", org.owner_id).maybeSingle();
    if (ownerProfile?.email) {
      await sendEmail({
        to: ownerProfile.email,
        ...payoutArrivedEmail({
          businessName: org.name,
          amountCents: payout.amount,
          currency: (payout.currency ?? "eur").toUpperCase(),
          arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000).toLocaleDateString("es-ES") : "próximamente",
        }),
      }).catch(() => null);
    }
  }
}

async function handleSubscriptionEvent(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.pasify_org_id;
  const planCode = sub.metadata?.pasify_plan_code ?? null;
  if (!orgId) {
    log.warn("subscription_event_no_org_id", { sub_id: sub.id });
    return;
  }

  const { data: plan } = planCode
    ? await supabaseAdmin.from("subscription_plans").select("id").eq("code", planCode).maybeSingle()
    : { data: null };

  await supabaseAdmin.from("partner_subscriptions").upsert({
    org_id: orgId,
    plan_id: plan?.id ?? null,
    plan_code: planCode,
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_price_id: sub.items.data[0]?.price.id ?? null,
    status: sub.status as any,
    billing_interval: sub.items.data[0]?.price.recurring?.interval === "year" ? "yearly" : "monthly",
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    trial_starts_at: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const rawBody = await req.text();
  const stripe = requireStripe();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log.error("signature_verification_failed", { error: (err as Error).message });
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 });
  }

  log.info("webhook_received", { event_id: event.id, type: event.type, livemode: event.livemode });

  // Idempotency upsert
  await supabaseAdmin.from("stripe_webhook_events").upsert({
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    payload: event as unknown as Record<string, unknown>,
    status: "received",
    received_at: new Date().toISOString(),
  }, { onConflict: "event_id", ignoreDuplicates: false });

  // Check if already processed
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("status")
    .eq("event_id", event.id)
    .maybeSingle();
  if (existing?.status === "processed") {
    log.info("duplicate_event_skipped", { event_id: event.id });
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await supabaseAdmin
          .from("ticket_orders")
          .update({ status: "expired" })
          .eq("stripe_session_id", (event.data.object as Stripe.Checkout.Session).id);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case "account.updated":
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case "payout.paid":
      case "payout.failed":
        await handlePayoutPaid(event.data.object as Stripe.Payout, event.account ?? null);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
        break;
      default:
        log.info("event_unhandled", { event_id: event.id, type: event.type });
    }

    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("event_id", event.id);

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log.error("webhook_processing_failed", { event_id: event.id, error: String(err) });
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "failed",
        last_error: err instanceof Error ? err.message : String(err),
        attempt_count: (existing as any)?.attempt_count ? (existing as any).attempt_count + 1 : 1,
      })
      .eq("event_id", event.id);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
