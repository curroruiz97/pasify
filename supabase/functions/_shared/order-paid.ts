// Pasify · "pedido pagado": punto único que usan stripe-webhook y
// confirm-checkout-session cuando Stripe confirma el cobro de un pedido.
//
//   1) `mark_order_paid_v2` (SQL, atómica e idempotente) marca el pedido y
//      sus entradas como pagados y escribe el ledger de comisiones. Devuelve
//      `newly_paid = true` SOLO a quien lo marca por primera vez.
//   2) Si `newly_paid`, se lanzan los efectos: email con las entradas y sus
//      QR, puntos de fidelidad y notificaciones in-app (comprador + equipo
//      del local). Así webhook y confirmación manual pueden llegar a la vez,
//      o repetirse, sin duplicar correos ni puntos.
//
// Los efectos nunca lanzan: si falla el correo o una notificación se
// registra en el log y la compra sigue confirmada.
//
// Si el evento ya está cancelado (el pago de una sesión que seguía abierta
// llega después de cancelar), no se mandan entradas: se crean sus solicitudes
// de reembolso por cancelación y se devuelve el dinero en el momento.

import { supabaseAdmin, SUPABASE_URL } from "./supabase.ts";
import { logger } from "./logger.ts";
import { sendEmail } from "./resend.ts";
import { DEFAULT_TIMEZONE, formatMoney, ticketDoorCode, ticketPurchasedEmail } from "./email-templates.ts";
import { enqueueNotification } from "./notify.ts";
import {
  executeRefund,
  isStaleProcessing,
  loadRefundContext,
  notifyRefundsGrouped,
  resumeStaleRefund,
  type RefundContext,
} from "./refund.ts";

export interface HandleOrderPaidInput {
  sessionId: string;
  paymentIntentId: string | null;
  /** `session.amount_total` en céntimos. */
  amountTotal: number;
  /** `payment_intent.application_fee_amount` en céntimos (0 sin Connect). */
  applicationFee: number;
  /**
   * `session.livemode` de Stripe: se guarda en ticket_orders.livemode. Con
   * false (pago de prueba) el escáner rechaza las entradas y el pedido no suma
   * en el saldo del local mientras require_live_payments esté activo.
   */
  livemode: boolean | null;
  /** Quién confirma, para los logs ("webhook:checkout.session.completed", "confirm-checkout-session"...). */
  source: string;
}

export interface HandleOrderPaidResult {
  orderId: string;
  newlyPaid: boolean;
}

interface MarkOrderPaidRow {
  order_id: string;
  newly_paid: boolean;
  buyer_user_id: string | null;
  buyer_email: string | null;
  org_id: string | null;
  event_id: string | null;
}

type Log = ReturnType<typeof logger.child>;

export async function handleOrderPaid(input: HandleOrderPaidInput): Promise<HandleOrderPaidResult> {
  const log = logger.child({ function: "order-paid", source: input.source, session_id: input.sessionId });

  // _livemode necesita la migración 20260925110100 (mark_order_paid_v2 con 5
  // parámetros): desplegar esta función después de aplicarla.
  const { data, error } = await supabaseAdmin.rpc("mark_order_paid_v2", {
    _session_id: input.sessionId,
    _payment_intent_id: input.paymentIntentId,
    _amount_total_cents: Math.max(0, Math.round(input.amountTotal || 0)),
    _application_fee_cents: Math.max(0, Math.round(input.applicationFee || 0)),
    _livemode: typeof input.livemode === "boolean" ? input.livemode : null,
  });
  if (error) throw new Error(`mark_order_paid_v2_failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as MarkOrderPaidRow | null | undefined;
  if (!row?.order_id) throw new Error(`mark_order_paid_v2_no_order (session ${input.sessionId})`);

  // Evento ya cancelado: ni entradas ni puntos, se devuelve el dinero. Va en
  // las dos ramas: si falla, lanza y la siguiente entrega del webhook (ya con
  // newly_paid = false) lo reintenta; y nunca se reenvían entradas de un
  // evento cancelado.
  if (await refundIfEventCancelled(row.order_id, row.event_id, log)) {
    return { orderId: row.order_id, newlyPaid: !!row.newly_paid };
  }

  if (row.newly_paid) {
    log.info("order_newly_paid", { order_id: row.order_id });
    await runPaidEffects(row.order_id, log);
  } else {
    log.info("order_already_paid", { order_id: row.order_id });
    await retryTicketsEmailIfMissing(row.order_id, log);
  }

  return { orderId: row.order_id, newlyPaid: !!row.newly_paid };
}

/* ===========================================================================
   Pago de un evento ya cancelado
   =========================================================================== */

async function refundIfEventCancelled(orderId: string, eventId: string | null, log: Log): Promise<boolean> {
  if (!eventId) return false;
  const { data: ev, error } = await supabaseAdmin
    .from("events")
    .select("status, metadata")
    .eq("id", eventId)
    .maybeSingle();
  // Sin poder leer el evento no se mandan entradas a ciegas: error y reintento.
  if (error) throw new Error(`event_status_check_failed: ${error.message}`);
  if (ev?.status !== "cancelled") return false;

  log.warn("paid_order_for_cancelled_event", { order_id: orderId, event_id: eventId });
  const note = (ev.metadata as { cancel_reason?: string } | null)?.cancel_reason ?? null;
  const { error: reqErr } = await supabaseAdmin.rpc("create_cancellation_refund_requests", {
    _event_id: eventId,
    _decided_by: null,
    _note: note,
    _order_id: orderId,
  });
  if (reqErr) throw new Error(`late_payment_refund_requests_failed: ${reqErr.message}`);

  // Todas las de este pedido: las recién creadas, las aprobadas de un intento
  // anterior y las que se quedaron en proceso (se buscan antes en Stripe).
  const { data: pending, error: listErr } = await supabaseAdmin
    .from("refund_requests")
    .select("id")
    .eq("order_id", orderId)
    .eq("reason_code", "event_cancelled")
    .in("status", ["approved", "processing"]);
  if (listErr) throw new Error(`late_payment_refunds_list_failed: ${listErr.message}`);

  const done: Array<{ ctx: RefundContext; amountCents: number }> = [];
  let retryable = false;
  for (const { id } of (pending ?? []) as Array<{ id: string }>) {
    const ctx = await loadRefundContext(id);
    if ("missing" in ctx) continue;
    const out =
      ctx.rr.status === "approved"
        ? await executeRefund(ctx, { notify: false })
        : isStaleProcessing(ctx)
        ? await resumeStaleRefund(ctx, { notify: false })
        : null;
    if (!out) continue; // en proceso reciente: lo termina quien lo empezó
    if (out.ok) done.push({ ctx, amountCents: out.amountCents });
    else {
      log.error("late_payment_refund_failed", { order_id: orderId, request_id: id, code: out.code });
      if (out.code === "stripe_unavailable" || out.code === "internal_error") retryable = true;
    }
  }
  await notifyRefundsGrouped(done);
  // Stripe no contestó: que el webhook se reintente más tarde.
  if (retryable) throw new Error("late_payment_refund_retry");
  return true;
}

/* ===========================================================================
   Efectos (nunca lanzan)
   =========================================================================== */

interface OrderContext {
  order: {
    id: string;
    event_id: string;
    org_id: string | null;
    buyer_user_id: string | null;
    buyer_email: string | null;
    buyer_first_name: string | null;
    total_cents: number;
    currency: string | null;
  };
  event: {
    id: string;
    title: string;
    date_start: string;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    partner_id: string | null;
    timezone: string;
  } | null;
  tickets: Array<{
    id: string;
    access_url_token: string | null;
    door_code: string | null;
    tier_name: string;
    holder_name: string | null;
    amount_paid_cents: number;
    status: string;
  }>;
}

async function runPaidEffects(orderId: string, log: Log): Promise<void> {
  try {
    const ctx = await loadOrderContext(orderId);
    const results = await Promise.allSettled([
      sendTicketsEmail(ctx, log),
      grantLoyaltyPoints(ctx, log),
      notifyPurchase(ctx, log),
    ]);
    for (const r of results) {
      if (r.status === "rejected") log.warn("order_paid_effect_failed", { order_id: orderId, error: String(r.reason) });
    }
  } catch (err) {
    log.warn("order_paid_effects_failed", { order_id: orderId, error: String(err) });
  }
}

/**
 * Un pago ya confirmado cuyo email no llegó a salir (Resend caído, sin
 * clave…): la siguiente confirmación del mismo pago lo reintenta. Solo el
 * email; puntos y notificaciones ya se dieron con `newly_paid`.
 */
async function retryTicketsEmailIfMissing(orderId: string, log: Log): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ticket_orders")
      .select("tickets_email_sent_at")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data || data.tickets_email_sent_at) return;
    log.info("tickets_email_retry", { order_id: orderId });
    await sendTicketsEmail(await loadOrderContext(orderId), log);
  } catch (err) {
    log.warn("tickets_email_retry_failed", { order_id: orderId, error: String(err) });
  }
}

const fullName = (first: string | null | undefined, last: string | null | undefined) =>
  [first, last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || null;

async function loadOrderContext(orderId: string): Promise<OrderContext> {
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("ticket_orders")
    .select("id, event_id, org_id, buyer_user_id, buyer_email, buyer_first_name, total_cents, currency")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) throw new Error(`order_load_failed: ${orderErr?.message ?? "not_found"}`);

  const [eventRes, ticketsRes] = await Promise.all([
    supabaseAdmin
      .from("events")
      .select("id, title, date_start, venue_name, address, city, partner_id, venue_id")
      .eq("id", order.event_id)
      .maybeSingle(),
    supabaseAdmin
      .from("tickets")
      .select("id, access_url_token, qr_token, tier_id, holder_first_name, holder_last_name, amount_paid_cents, status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (eventRes.error) throw new Error(`event_load_failed: ${eventRes.error.message}`);
  if (ticketsRes.error) throw new Error(`tickets_load_failed: ${ticketsRes.error.message}`);

  const ev = eventRes.data;
  const rawTickets = ticketsRes.data ?? [];

  // Zona horaria y datos del local (si el evento cuelga de uno).
  let venue: { name: string | null; address: string | null; city: string | null; timezone: string | null } | null = null;
  if (ev?.venue_id) {
    const { data } = await supabaseAdmin
      .from("venues")
      .select("name, address, city, timezone")
      .eq("id", ev.venue_id)
      .maybeSingle();
    venue = data ?? null;
  }

  const tierIds = [...new Set(rawTickets.map((t) => t.tier_id).filter((id): id is string => !!id))];
  const tierNames = new Map<string, string>();
  if (tierIds.length > 0) {
    const { data: tiers } = await supabaseAdmin.from("ticket_tiers").select("id, name").in("id", tierIds);
    for (const t of tiers ?? []) tierNames.set(t.id, t.name);
  }

  return {
    order,
    event: ev
      ? {
          id: ev.id,
          title: ev.title,
          date_start: ev.date_start,
          venue_name: ev.venue_name ?? venue?.name ?? null,
          address: ev.address ?? venue?.address ?? null,
          city: ev.city ?? venue?.city ?? null,
          partner_id: ev.partner_id ?? null,
          timezone: venue?.timezone || DEFAULT_TIMEZONE,
        }
      : null,
    tickets: rawTickets.map((t) => ({
      id: t.id,
      access_url_token: t.access_url_token,
      door_code: ticketDoorCode(t.qr_token),
      tier_name: (t.tier_id && tierNames.get(t.tier_id)) || "Entrada",
      holder_name: fullName(t.holder_first_name, t.holder_last_name),
      amount_paid_cents: t.amount_paid_cents ?? 0,
      status: t.status,
    })),
  };
}

async function sendTicketsEmail(ctx: OrderContext, log: Log): Promise<void> {
  const { order, event } = ctx;
  const tickets = ctx.tickets.filter((t) => t.status === "paid" || t.status === "used");
  if (!order.buyer_email || !event || tickets.length === 0) {
    log.warn("tickets_email_skipped", {
      order_id: order.id,
      has_email: !!order.buyer_email,
      has_event: !!event,
      tickets: tickets.length,
    });
    return;
  }

  const email = ticketPurchasedEmail({
    firstName: order.buyer_first_name,
    event: {
      title: event.title,
      dateStart: event.date_start,
      venueName: event.venue_name,
      address: event.address,
      city: event.city,
      timezone: event.timezone,
    },
    tickets: tickets.map((t) => ({
      id: t.id,
      accessToken: t.access_url_token,
      tierName: t.tier_name,
      holderName: t.holder_name,
      amountCents: t.amount_paid_cents,
      doorCode: t.door_code,
    })),
    totalCents: order.total_cents,
    currency: order.currency ?? "EUR",
    orderId: order.id,
    supabaseUrl: SUPABASE_URL,
  });

  try {
    const res = await sendEmail({
      to: order.buyer_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `order-${order.id}`,
      tags: [
        { name: "category", value: "tickets" },
        { name: "kind", value: "order_paid" },
      ],
    });
    log.info("tickets_email_sent", { order_id: order.id, provider: res.provider, email_id: res.id });
    const { error: markErr } = await supabaseAdmin
      .from("ticket_orders")
      .update({ tickets_email_sent_at: new Date().toISOString() })
      .eq("id", order.id);
    if (markErr) log.warn("tickets_email_mark_failed", { order_id: order.id, error: markErr.message });
  } catch (err) {
    // Nivel error a propósito: es un cliente que ha pagado y no tiene su QR
    // por correo (sí en la app si tiene cuenta). Buscar "tickets_email_failed".
    log.error("tickets_email_failed", { order_id: order.id, error: String(err) });
  }
}

async function grantLoyaltyPoints(ctx: OrderContext, log: Log): Promise<void> {
  const { order, event } = ctx;
  if (!order.buyer_user_id) return;
  const points = Math.floor((order.total_cents ?? 0) / 100); // 1 punto por euro
  if (points <= 0) return;

  const { error } = await supabaseAdmin.rpc("loyalty_grant_points", {
    _user_id: order.buyer_user_id,
    _amount: points,
    _reason: `Compra de entradas · ${event?.title ?? "evento"}`.slice(0, 200),
    _reason_code: "ticket_purchase",
    _event_id: order.event_id,
    _org_id: order.org_id,
  });
  if (error) log.warn("loyalty_grant_failed", { order_id: order.id, error: error.message });
}

async function notifyPurchase(ctx: OrderContext, log: Log): Promise<void> {
  const { order, event } = ctx;
  const paidCount = ctx.tickets.filter((t) => t.status === "paid" || t.status === "used").length || ctx.tickets.length;
  const title = event?.title ?? "tu evento";
  const jobs: Array<Promise<unknown>> = [];

  if (order.buyer_user_id) {
    jobs.push(enqueueNotification({
      user_id: order.buyer_user_id,
      category: "tickets",
      kind: "ticket_paid",
      title: "Compra confirmada",
      body: paidCount === 1
        ? `Tu entrada para ${title} ya está en Mis entradas, con su QR.`
        : `Tus ${paidCount} entradas para ${title} ya están en Mis entradas, con su QR.`,
      link: "/#/client-dashboard",
      payload: { order_id: order.id, event_id: order.event_id },
    }));
  }

  // Equipo del local: owner de la org + owner/admin/manager activos. Eventos
  // sin org (legacy): el partner que lo creó.
  const recipients = new Set<string>();
  if (order.org_id) {
    const [orgRes, membersRes] = await Promise.all([
      supabaseAdmin.from("organizations").select("owner_id").eq("id", order.org_id).maybeSingle(),
      supabaseAdmin
        .from("organization_members")
        .select("user_id")
        .eq("org_id", order.org_id)
        .in("role", ["owner", "admin", "manager"])
        .eq("status", "active"),
    ]);
    if (orgRes.error) log.warn("org_owner_load_failed", { order_id: order.id, error: orgRes.error.message });
    if (membersRes.error) log.warn("org_members_load_failed", { order_id: order.id, error: membersRes.error.message });
    if (orgRes.data?.owner_id) recipients.add(orgRes.data.owner_id);
    for (const m of membersRes.data ?? []) if (m.user_id) recipients.add(m.user_id);
  } else if (event?.partner_id) {
    recipients.add(event.partner_id);
  }

  const amount = formatMoney(order.total_cents, order.currency ?? "EUR");
  for (const userId of recipients) {
    jobs.push(enqueueNotification({
      user_id: userId,
      category: "tickets",
      kind: "ticket_sold",
      title: `Nueva venta · ${title}`,
      body: `${paidCount} ${paidCount === 1 ? "entrada" : "entradas"} · ${amount}`,
      link: "/#/partner-dashboard/eventos",
      payload: { order_id: order.id, event_id: order.event_id },
    }));
  }

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === "rejected") log.warn("purchase_notification_failed", { order_id: order.id, error: String(r.reason) });
  }
}
