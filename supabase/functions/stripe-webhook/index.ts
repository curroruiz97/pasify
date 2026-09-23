// Pasify · stripe-webhook
// Procesa eventos Stripe de DOS endpoints configurados en Stripe con el mismo
// URL: el de plataforma (STRIPE_WEBHOOK_SECRET) y el de Connect
// (STRIPE_CONNECT_WEBHOOK_SECRET, eventos de las cuentas de los locales).
// La firma se valida probando ambos secretos.
//
// Eventos:
//   checkout.session.completed / async_payment_succeeded
//                                  → handleOrderPaid (mark_order_paid_v2 + email con QR,
//                                    puntos y notificaciones, solo la primera vez)
//   checkout.session.expired / async_payment_failed
//                                  → expire_ticket_order (libera el stock)
//   charge.refunded                → mark_refund_processed por cada reembolso completado
//   customer.subscription.*        → upsert partner_subscriptions (estado mapeado)
//   invoice.paid                   → último cobro de la suscripción
//   invoice.payment_failed         → past_due + aviso al owner
//   account.updated     (Connect)  → estado de Stripe Connect de la org
//   payout.paid/failed  (Connect)  → stripe_payouts + aviso al owner
//
// El ledger de comisiones lo escribe mark_order_paid_v2 (SQL), no este fichero.
//
// Idempotencia: stripe_webhook_events.event_id UNIQUE. Un evento ya
// 'processed'/'ignored' se contesta 200 sin repetir nada; uno 'received' o
// 'failed' (intento anterior caído) se reprocesa sumando attempt_count. Los
// handlers son idempotentes: dos entregas simultáneas no duplican efectos.
// Un error devuelve 500 para que Stripe reintente (hasta 3 días).
//
// verify_jwt = false (config.toml) — autenticamos por la firma de Stripe.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type Stripe from "npm:stripe@14";
import { supabaseAdmin } from "../_shared/supabase.ts";
import {
  requireStripe,
  stripeWebhookSecrets,
  stripeKeyIsLive,
  stripeCryptoProvider,
  stripeId,
  isCheckoutSessionPaid,
  mapStripeSubscriptionStatus,
  isTerminalSubscriptionStatus,
  mapStripePayoutStatus,
} from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";
import { enqueueNotification, type EnqueueNotificationOpts } from "../_shared/notify.ts";
import { sendEmail } from "../_shared/resend.ts";
import { payoutArrivedEmail } from "../_shared/email-templates.ts";
import { handleOrderPaid } from "../_shared/order-paid.ts";

const log = logger.child({ function: "stripe-webhook" });

/** processed = hecho; ignored = evento que no nos concierne (queda registrado). */
type Outcome = "processed" | "ignored";

const toIso = (sec: number | null | undefined): string | null =>
  typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null;

/** Las notificaciones nunca tumban el webhook (el trabajo principal ya está hecho). */
async function notifySafe(opts: EnqueueNotificationOpts): Promise<void> {
  try {
    await enqueueNotification(opts);
  } catch (err) {
    log.warn("notification_failed", { kind: opts.kind, user_id: opts.user_id, error: String(err) });
  }
}

/* ===========================================================================
   Checkout (compra de entradas)
   =========================================================================== */

/** Solo las sesiones de compra de entradas llevan order_id (las de suscripción no). */
function isTicketCheckout(session: Stripe.Checkout.Session): boolean {
  return session.mode === "payment" && !!session.metadata?.order_id;
}

async function handleCheckoutPaid(stripe: Stripe, event: Stripe.Event, session: Stripe.Checkout.Session): Promise<Outcome> {
  if (!isTicketCheckout(session)) {
    log.info("checkout_session_not_ticket_order", { session_id: session.id, mode: session.mode });
    return "ignored";
  }
  if (!isCheckoutSessionPaid(session)) {
    // Pago asíncrono aún en curso: llegará async_payment_succeeded/failed.
    log.info("checkout_session_not_paid_yet", { session_id: session.id, payment_status: session.payment_status });
    return "processed";
  }

  // En el evento `payment_intent` llega como id (no expandido): hay que pedir
  // el PaymentIntent para conocer la comisión real. Con destination charges
  // el PI vive en la plataforma; solo si el evento viene de una cuenta
  // conectada (event.account) hay que leerlo en esa cuenta.
  const paymentIntentId = stripeId(session.payment_intent);
  let applicationFee = 0;
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {},
      event.account ? { stripeAccount: event.account } : undefined,
    );
    applicationFee = pi.application_fee_amount ?? 0;
  }

  const res = await handleOrderPaid({
    sessionId: session.id,
    paymentIntentId,
    amountTotal: session.amount_total ?? 0,
    applicationFee,
    source: `webhook:${event.type}`,
  });
  log.info("checkout_order_paid", { session_id: session.id, order_id: res.orderId, newly_paid: res.newlyPaid });
  return "processed";
}

async function handleCheckoutExpired(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<Outcome> {
  if (!isTicketCheckout(session)) return "ignored";
  const { data: orderId, error } = await supabaseAdmin.rpc("expire_ticket_order", { _session_id: session.id });
  if (error) throw new Error(`expire_ticket_order_failed: ${error.message}`);
  log.info("ticket_order_expired", { session_id: session.id, order_id: orderId, reason: event.type });
  return "processed";
}

/* ===========================================================================
   Reembolsos
   =========================================================================== */

async function handleChargeRefunded(stripe: Stripe, charge: Stripe.Charge): Promise<Outcome> {
  // Desde la API 2022-11-15 `charge.refunds` ya no viene en el evento: se
  // listan aparte. Sin esto los reembolsos se quedaban en 'processing'.
  const refunds = charge.refunds?.data?.length
    ? charge.refunds.data
    : (await stripe.refunds.list({ charge: charge.id, limit: 100 })).data;
  const paymentIntentId = stripeId(charge.payment_intent) ?? "";

  for (const r of refunds) {
    if (r.status !== "succeeded") continue;
    const { error } = await supabaseAdmin.rpc("mark_refund_processed", {
      _stripe_refund_id: r.id,
      _amount_refunded_cents: r.amount,
      _payment_intent_id: paymentIntentId,
    });
    if (error) throw new Error(`mark_refund_processed_failed: ${error.message}`);
  }
  return "processed";
}

/* ===========================================================================
   Stripe Connect (eventos de las cuentas de los locales)
   =========================================================================== */

async function handleAccountUpdated(account: Stripe.Account): Promise<Outcome> {
  const { data: org, error: selErr } = await supabaseAdmin
    .from("organizations")
    .select("id, owner_id, stripe_connect_onboarded")
    .eq("stripe_connect_account_id", account.id)
    .maybeSingle();
  if (selErr) throw new Error(`org_lookup_failed: ${selErr.message}`);
  if (!org) {
    log.warn("connect_account_without_org", { account_id: account.id });
    return "ignored";
  }

  const charges = account.charges_enabled ?? false;
  const payouts = account.payouts_enabled ?? false;
  const ready = (account.details_submitted ?? false) && charges;

  const { error: updErr } = await supabaseAdmin
    .from("organizations")
    .update({
      stripe_connect_charges_enabled: charges,
      stripe_connect_payouts_enabled: payouts,
      stripe_connect_onboarded: ready,
    })
    .eq("id", org.id);
  if (updErr) throw new Error(`org_connect_update_failed: ${updErr.message}`);

  // Stripe manda account.updated muchas veces: avisamos solo en la transición.
  if (ready && !org.stripe_connect_onboarded && org.owner_id) {
    await notifySafe({
      user_id: org.owner_id,
      category: "system",
      kind: "stripe_connect_ready",
      title: "Stripe Connect listo",
      body: "Tu cuenta puede recibir pagos ya mismo.",
      link: "/#/partner-dashboard",
    });
  }
  return "processed";
}

async function handlePayout(payout: Stripe.Payout, account: string | null): Promise<Outcome> {
  if (!account) return "ignored"; // payouts de la propia plataforma
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("id, owner_id, name")
    .eq("stripe_connect_account_id", account)
    .maybeSingle();
  if (orgErr) throw new Error(`org_lookup_failed: ${orgErr.message}`);
  if (!org) {
    log.warn("payout_account_without_org", { account_id: account, payout_id: payout.id });
    return "ignored";
  }

  const { data: prev, error: prevErr } = await supabaseAdmin
    .from("stripe_payouts")
    .select("status, paid_at")
    .eq("stripe_payout_id", payout.id)
    .maybeSingle();
  if (prevErr) throw new Error(`payout_lookup_failed: ${prevErr.message}`);

  const status = mapStripePayoutStatus(payout.status);
  const currency = (payout.currency ?? "eur").toUpperCase();
  const { error: upErr } = await supabaseAdmin.from("stripe_payouts").upsert({
    stripe_payout_id: payout.id,
    stripe_account_id: account,
    org_id: org.id,
    amount_cents: payout.amount,
    currency,
    status,
    failure_code: payout.failure_code ?? null,
    failure_message: payout.failure_message ?? null,
    arrival_date: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null,
    method: payout.method ?? null,
    paid_at: status === "paid" ? prev?.paid_at ?? new Date().toISOString() : null,
  }, { onConflict: "stripe_payout_id" });
  if (upErr) throw new Error(`payout_upsert_failed: ${upErr.message}`);

  // Solo al pasar a 'paid' (un reintento de Stripe no repite el aviso).
  if (status === "paid" && prev?.status !== "paid" && org.owner_id) {
    await notifySafe({
      user_id: org.owner_id,
      category: "system",
      kind: "payout_arrived",
      title: "Payout en camino",
      body: `${(payout.amount / 100).toFixed(2)} ${currency}`,
      link: "/#/partner-dashboard",
    });

    const { data: ownerProfile } = await supabaseAdmin.from("profiles").select("email").eq("id", org.owner_id).maybeSingle();
    if (ownerProfile?.email) {
      await sendEmail({
        to: ownerProfile.email,
        ...payoutArrivedEmail({
          businessName: org.name,
          amountCents: payout.amount,
          currency,
          arrivalDate: payout.arrival_date
            ? new Date(payout.arrival_date * 1000).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })
            : "próximamente",
        }),
        idempotencyKey: `payout-${payout.id}`,
      }).catch((e) => log.warn("payout_email_failed", { payout_id: payout.id, error: String(e) }));
    }
  }
  return "processed";
}

/* ===========================================================================
   Suscripciones de partners
   =========================================================================== */

async function handleSubscriptionEvent(stripe: Stripe, sub: Stripe.Subscription): Promise<Outcome> {
  // Stripe no garantiza el orden de entrega: leemos el estado actual para no
  // pisar un 'active' con un 'past_due' que llega tarde.
  // Tampoco nos fiamos del payload: si no se puede leer de Stripe, error y
  // Stripe reintenta (un evento de una cuenta conectada podía traer metadata
  // con la organización de otro local).
  const current: Stripe.Subscription = await stripe.subscriptions.retrieve(sub.id);

  const orgId = current.metadata?.pasify_org_id;
  if (!orgId) {
    log.warn("subscription_event_no_org_id", { sub_id: sub.id });
    return "ignored";
  }
  const status = mapStripeSubscriptionStatus(current.status);

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("partner_subscriptions")
    .select("stripe_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (exErr) throw new Error(`partner_subscription_lookup_failed: ${exErr.message}`);
  // Evento tardío de una suscripción antigua ya cancelada: no debe pisar la vigente.
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== current.id && isTerminalSubscriptionStatus(status)) {
    log.info("stale_subscription_event_skipped", { sub_id: current.id, current_sub_id: existing.stripe_subscription_id });
    return "ignored";
  }

  // partner-subscribe-checkout no pone pasify_plan_code: su plan es 'premium'.
  const planCode = current.metadata?.pasify_plan_code
    ?? (current.metadata?.purpose === "partner_subscription" ? "premium" : null);
  let planId: string | null = null;
  if (planCode) {
    const { data: plan, error: planErr } = await supabaseAdmin
      .from("subscription_plans")
      .select("id")
      .eq("code", planCode)
      .maybeSingle();
    if (planErr) throw new Error(`plan_lookup_failed: ${planErr.message}`);
    planId = plan?.id ?? null;
  }

  const item = current.items?.data?.[0];
  // En versiones de API nuevas el periodo vive en el item, no en la suscripción.
  const itemPeriod = item as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
  const periodStart = toIso(current.current_period_start ?? itemPeriod?.current_period_start);
  const periodEnd = toIso(current.current_period_end ?? itemPeriod?.current_period_end);
  const row: Record<string, unknown> = {
    org_id: orgId,
    stripe_subscription_id: current.id,
    stripe_customer_id: stripeId(current.customer),
    stripe_price_id: item?.price?.id ?? null,
    status,
    billing_interval: item?.price?.recurring?.interval === "year" ? "yearly" : "monthly",
    cancel_at_period_end: current.cancel_at_period_end ?? false,
    cancelled_at: toIso(current.canceled_at),
    updated_at: new Date().toISOString(),
  };
  if (periodStart) row.current_period_start = periodStart;
  if (periodEnd) row.current_period_end = periodEnd;
  // Sin plan conocido no tocamos plan_code/plan_id (no borrar lo que hay).
  if (planCode) row.plan_code = planCode;
  if (planId) row.plan_id = planId;
  // Las fechas de prueba solo si Stripe las tiene (no borrar la prueba interna).
  if (current.trial_start) row.trial_starts_at = toIso(current.trial_start);
  if (current.trial_end) row.trial_ends_at = toIso(current.trial_end);

  const { error: upErr } = await supabaseAdmin.from("partner_subscriptions").upsert(row, { onConflict: "org_id" });
  if (upErr) throw new Error(`partner_subscription_upsert_failed: ${upErr.message}`);
  log.info("partner_subscription_synced", { org_id: orgId, sub_id: current.id, status });
  return "processed";
}

/**
 * Id de la suscripción de una factura. El payload del evento usa la versión
 * de API del endpoint de Stripe: hasta 2025-03 va en `invoice.subscription`;
 * en versiones nuevas en `invoice.parent.subscription_details.subscription`.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = stripeId(invoice.subscription);
  if (legacy) return legacy;
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  }).parent;
  return stripeId(parent?.subscription_details?.subscription ?? null);
}

async function subscriptionRowForInvoice(invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return null;
  const { data, error } = await supabaseAdmin
    .from("partner_subscriptions")
    .select("id, org_id, status")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  if (error) throw new Error(`partner_subscription_lookup_failed: ${error.message}`);
  return data as { id: string; org_id: string; status: string } | null;
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<Outcome> {
  const row = await subscriptionRowForInvoice(invoice);
  if (!row) return "ignored";
  const { error } = await supabaseAdmin
    .from("partner_subscriptions")
    .update({
      last_payment_at: toIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString(),
      last_payment_amount_cents: invoice.amount_paid,
      last_payment_failure_reason: null,
    })
    .eq("id", row.id);
  if (error) throw new Error(`partner_subscription_payment_update_failed: ${error.message}`);
  return "processed";
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<Outcome> {
  const row = await subscriptionRowForInvoice(invoice);
  if (!row) return "ignored";

  // Solo las renovaciones pasan a past_due. Si falla el primer cobro la
  // suscripción sigue 'incomplete' (el partner lo ve en el propio Checkout).
  const renewal = ["active", "trialing", "past_due"].includes(row.status);
  const update: Record<string, unknown> = {
    last_payment_failure_reason: `Cobro rechazado (intento ${invoice.attempt_count ?? 1})`,
  };
  if (renewal) update.status = "past_due";

  const { error } = await supabaseAdmin.from("partner_subscriptions").update(update).eq("id", row.id);
  if (error) throw new Error(`partner_subscription_past_due_failed: ${error.message}`);

  if (renewal) {
    const { data: org } = await supabaseAdmin.from("organizations").select("owner_id").eq("id", row.org_id).maybeSingle();
    if (org?.owner_id) {
      await notifySafe({
        user_id: org.owner_id,
        category: "system",
        kind: "subscription_payment_failed",
        title: "No hemos podido cobrar tu suscripción",
        body: "Revisa tu método de pago para no perder las funciones de tu plan.",
        link: "/#/partner/manage",
        priority: "high",
        payload: { invoice_id: invoice.id, attempt: invoice.attempt_count ?? 1 },
      });
    }
  }
  return "processed";
}

/* ===========================================================================
   Idempotencia (stripe_webhook_events)
   =========================================================================== */

/** "new"/"retry" = procesar; "duplicate" = ya hecho, contestar 200. */
async function claimEvent(event: Stripe.Event): Promise<"new" | "retry" | "duplicate"> {
  const { error: insErr } = await supabaseAdmin.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
    livemode: event.livemode,
    payload: event as unknown as Record<string, unknown>,
    status: "received",
    attempt_count: 1,
  });
  if (!insErr) return "new";
  if (insErr.code !== "23505") throw new Error(`webhook_event_insert_failed: ${insErr.message}`);

  const { data: existing, error: selErr } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("status, attempt_count")
    .eq("event_id", event.id)
    .maybeSingle();
  if (selErr || !existing) throw new Error(`webhook_event_lookup_failed: ${selErr?.message ?? "not_found"}`);
  if (existing.status === "processed" || existing.status === "ignored") return "duplicate";

  const { error: updErr } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ attempt_count: (existing.attempt_count ?? 1) + 1, status: "received" })
    .eq("event_id", event.id);
  if (updErr) log.warn("webhook_event_attempt_update_failed", { event_id: event.id, error: updErr.message });
  return "retry";
}

async function finishEvent(eventId: string, outcome: Outcome): Promise<void> {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ status: outcome, processed_at: new Date().toISOString(), last_error: null })
    .eq("event_id", eventId);
  if (error) log.warn("webhook_event_finish_failed", { event_id: eventId, error: error.message });
}

async function failEvent(eventId: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ status: "failed", last_error: message })
    .eq("event_id", eventId);
  if (error) log.warn("webhook_event_fail_update_failed", { event_id: eventId, error: error.message });
}

/* ===========================================================================
   Router
   =========================================================================== */

function route(stripe: Stripe, event: Stripe.Event): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutPaid(stripe, event, event.data.object as Stripe.Checkout.Session);
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      return handleCheckoutExpired(event, event.data.object as Stripe.Checkout.Session);
    case "charge.refunded":
      return handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
    case "account.updated":
      return handleAccountUpdated(event.data.object as Stripe.Account);
    case "payout.paid":
    case "payout.failed":
      return handlePayout(event.data.object as Stripe.Payout, event.account ?? null);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return handleSubscriptionEvent(stripe, event.data.object as Stripe.Subscription);
    case "invoice.paid":
      return handleInvoicePaid(event.data.object as Stripe.Invoice);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
    default:
      log.info("event_unhandled", { event_id: event.id, type: event.type });
      return Promise.resolve("ignored");
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const secrets = stripeWebhookSecrets();
  let stripe: Stripe;
  try {
    stripe = requireStripe();
  } catch {
    log.error("stripe_secret_key_missing");
    return new Response("Stripe not configured", { status: 500 });
  }
  if (secrets.length === 0) {
    // 500 (no 400) para que Stripe siga reintentando hasta que se configure.
    log.error("webhook_secret_missing");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event | null = null;
  let endpoint: "platform" | "connect" | null = null;
  let lastError = "";
  for (const { kind, secret } of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, secret, undefined, stripeCryptoProvider);
      endpoint = kind;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!event || !endpoint) {
    log.error("signature_verification_failed", { error: lastError, secrets_tried: secrets.length });
    return new Response("Invalid signature", { status: 400 });
  }

  log.info("webhook_received", { event_id: event.id, type: event.type, livemode: event.livemode, account: event.account ?? null, endpoint });

  // Un evento de modo test con clave live (o al revés) no es nuestro: el
  // endpoint de Connect en live también recibe eventos de test de las
  // cuentas conectadas.
  if (event.livemode !== stripeKeyIsLive()) {
    log.warn("webhook_livemode_mismatch", { event_id: event.id, livemode: event.livemode });
    return json({ received: true, ignored: "livemode_mismatch" });
  }
  // Lo que llega de una cuenta conectada solo puede tocar esa cuenta: estado
  // de la cuenta y sus pagos. Pedidos, reembolsos y suscripciones se cobran
  // en la plataforma y llegan por el endpoint de plataforma.
  const CONNECT_EVENT_TYPES = new Set(["account.updated", "payout.paid", "payout.failed"]);
  if ((endpoint === "connect" || event.account) && !CONNECT_EVENT_TYPES.has(event.type)) {
    log.warn("webhook_connect_event_out_of_scope", { event_id: event.id, type: event.type, account: event.account ?? null });
    return json({ received: true, ignored: "connect_scope" });
  }

  let claim: "new" | "retry" | "duplicate";
  try {
    claim = await claimEvent(event);
  } catch (err) {
    log.error("webhook_event_claim_failed", { event_id: event.id, error: String(err) });
    return new Response("Webhook storage failed", { status: 500 });
  }
  if (claim === "duplicate") {
    log.info("duplicate_event_skipped", { event_id: event.id });
    return json({ received: true, duplicate: true });
  }

  try {
    const outcome = await route(stripe, event);
    await finishEvent(event.id, outcome);
    return json({ received: true, outcome });
  } catch (err) {
    log.error("webhook_processing_failed", { event_id: event.id, type: event.type, error: String(err) });
    await failEvent(event.id, err);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
