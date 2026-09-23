// Pasify · ejecución de un reembolso aprobado en Stripe.
//
// Compartido por process-refund (solicitud de un comprador), partner-cancel-event
// (cancelación de un evento) y el pago que llega tarde a un evento ya cancelado
// (_shared/order-paid.ts). La AUTORIZACIÓN la hace cada llamador; aquí solo se
// valida que el reembolso tenga sentido y se ejecuta una sola vez.
//
// El importe, el pedido y la organización salen de la entrada (ticket → pedido
// → evento), nunca de columnas de la solicitud. El webhook charge.refunded
// cierra la solicitud con mark_refund_processed usando pasify_refund_request_id
// de los metadatos del reembolso.
//
// Nunca dos reembolsos para una solicitud:
//   - Se reclama (approved → processing) en una sola sentencia.
//   - Antes de crear, se busca en Stripe un reembolso de ESTA solicitud (por
//     metadatos): si Stripe lo creó pero no lo supimos (timeout, corte), se
//     adopta en vez de crear otro.
//   - Solo un error definitivo de Stripe (tarjeta, petición inválida) marca la
//     solicitud como fallida. Si Stripe no contesta, se queda en 'processing'
//     y resumeStaleRefund la retoma más tarde.

import type Stripe from "npm:stripe@14";
import { supabaseAdmin } from "./supabase.ts";
import { requireStripe } from "./stripe.ts";
import { logger } from "./logger.ts";
import { sendEmail } from "./resend.ts";
import { refundDecidedEmail } from "./email-templates.ts";
import { enqueueNotification } from "./notify.ts";

export interface RefundContext {
  rr: {
    id: string;
    status: string;
    ticket_id: string;
    requester_user_id: string | null;
    requester_email: string;
    currency: string | null;
    decision_note: string | null;
    stripe_refund_id: string | null;
    auto_approved: boolean;
    reason_code: string | null;
    created_at: string;
    updated_at: string;
  };
  ticket: {
    id: string;
    status: string;
    used_at: string | null;
    amount_paid_cents: number | null;
    currency: string | null;
    order_id: string;
    event_id: string;
    buyer_user_id: string | null;
    transferred_to_user_id: string | null;
  };
  order: {
    id: string;
    status: string;
    stripe_payment_intent_id: string | null;
    stripe_destination_account: string | null;
  };
  event: { id: string; title: string; org_id: string | null; partner_id: string | null };
}

export type RefundFailure =
  | "request_not_found"
  | "ticket_not_found"
  | "order_not_found"
  | "invalid_status"
  | "already_refunded"
  | "ticket_not_refundable"
  | "order_not_refundable"
  | "nothing_to_refund"
  | "no_payment_intent"
  | "already_processing"
  | "stripe_refund_failed"
  | "stripe_unavailable"
  | "internal_error";

export type RefundOutcome =
  | { ok: true; stripeRefundId: string; status: string | null; amountCents: number }
  | { ok: false; code: RefundFailure; httpStatus: number; detail?: string };

/** Tiempo tras el que una solicitud en 'processing' sin reembolso se retoma. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

const fail = (code: RefundFailure, httpStatus: number, detail?: string): RefundOutcome => ({
  ok: false,
  code,
  httpStatus,
  detail,
});

/** Carga la solicitud con su entrada, pedido y evento. */
export async function loadRefundContext(
  requestId: string,
): Promise<RefundContext | { missing: RefundFailure }> {
  const { data: rr } = await supabaseAdmin
    .from("refund_requests")
    .select(
      "id, status, ticket_id, requester_user_id, requester_email, currency, decision_note, stripe_refund_id, auto_approved, reason_code, created_at, updated_at",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!rr) return { missing: "request_not_found" };

  const { data: ticket } = await supabaseAdmin
    .from("tickets")
    .select("id, status, used_at, amount_paid_cents, currency, order_id, event_id, buyer_user_id, transferred_to_user_id")
    .eq("id", rr.ticket_id)
    .maybeSingle();
  if (!ticket?.order_id) return { missing: "ticket_not_found" };

  const [{ data: order }, { data: event }] = await Promise.all([
    supabaseAdmin
      .from("ticket_orders")
      .select("id, status, stripe_payment_intent_id, stripe_destination_account")
      .eq("id", ticket.order_id)
      .maybeSingle(),
    supabaseAdmin.from("events").select("id, title, org_id, partner_id").eq("id", ticket.event_id).maybeSingle(),
  ]);
  if (!order || !event) return { missing: "order_not_found" };

  return { rr, ticket, order, event } as RefundContext;
}

/** ¿Es una solicitud atascada en 'processing' que hay que retomar? */
export const isStaleProcessing = (ctx: RefundContext, now = Date.now()): boolean =>
  ctx.rr.status === "processing" &&
  !ctx.rr.stripe_refund_id &&
  now - Date.parse(ctx.rr.updated_at) > STALE_PROCESSING_MS;

/** Reembolso de Stripe ya creado para esta solicitud (por metadatos), si lo hay. */
async function findExistingStripeRefund(
  stripe: Stripe,
  paymentIntent: string,
  requestId: string,
): Promise<Stripe.Refund | null> {
  const list = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 });
  return (
    list.data.find(
      (r) => r.metadata?.pasify_refund_request_id === requestId && r.status !== "failed" && r.status !== "canceled",
    ) ?? null
  );
}

/** Errores de Stripe que no se arreglan reintentando (tarjeta, petición inválida). */
function isDefinitiveStripeError(err: unknown): boolean {
  const e = err as { type?: string; statusCode?: number } | null;
  if (!e) return false;
  if (e.type === "StripeCardError" || e.type === "StripeInvalidRequestError" || e.type === "StripeIdempotencyError") {
    return true;
  }
  return typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 429;
}

/** Guarda el reembolso de Stripe en la solicitud y, si ya está hecho, la cierra. */
async function recordRefund(ctx: RefundContext, refund: Stripe.Refund, log: ReturnType<typeof logger.child>) {
  const { error } = await supabaseAdmin
    .from("refund_requests")
    .update({ stripe_refund_id: refund.id, stripe_refund_status: refund.status })
    .eq("id", ctx.rr.id);
  if (error) log.error("refund_id_save_failed", { stripe_refund_id: refund.id, error: error.message });
  if (refund.status === "succeeded") {
    // Lo mismo que hará charge.refunded (idempotente): entrada y pedido al día ya.
    const { error: markErr } = await supabaseAdmin.rpc("mark_refund_processed", {
      _stripe_refund_id: refund.id,
      _amount_refunded_cents: refund.amount,
      _payment_intent_id: ctx.order.stripe_payment_intent_id ?? "",
      _refund_request_id: ctx.rr.id,
    });
    if (markErr) log.warn("refund_mark_processed_failed", { stripe_refund_id: refund.id, error: markErr.message });
  }
}

/**
 * Ejecuta en Stripe el reembolso de una solicitud aprobada.
 * `notify: false` deja los avisos al llamador (notifyRefundsGrouped).
 */
export async function executeRefund(
  ctx: RefundContext,
  opts: { stripe?: Stripe; notify?: boolean } = {},
): Promise<RefundOutcome> {
  const { rr, ticket, order } = ctx;
  const log = logger.child({ function: "executeRefund", request_id: rr.id });

  if (rr.status !== "approved") return fail("invalid_status", 400, `cannot_refund_${rr.status}`);
  if (rr.stripe_refund_id) return fail("already_refunded", 409);
  // La entrada tiene que seguir pagada, sin usar y en manos de quien pidió el
  // reembolso (no se devuelve una entrada escaneada ni una transferida). En
  // una solicitud del sistema para un invitado ambos son null.
  const holder = ticket.transferred_to_user_id ?? ticket.buyer_user_id;
  if (ticket.status !== "paid" || ticket.used_at || holder !== rr.requester_user_id) {
    return fail("ticket_not_refundable", 409);
  }
  if (!["paid", "partial_refund"].includes(order.status)) return fail("order_not_refundable", 409);
  const amount = ticket.amount_paid_cents ?? 0;
  if (amount <= 0) return fail("nothing_to_refund", 409);
  const pi = order.stripe_payment_intent_id;
  if (!pi) return fail("no_payment_intent", 400);

  // Stripe configurado antes de reclamar la solicitud: si no, se quedaría en
  // 'processing' sin motivo.
  const stripe = opts.stripe ?? requireStripe();

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("refund_requests")
    .update({ status: "processing" })
    .eq("id", rr.id)
    .eq("status", "approved")
    .select("id");
  if (claimErr) {
    log.error("refund_claim_failed", { error: claimErr.message });
    return fail("internal_error", 500);
  }
  if (!claimed || claimed.length === 0) return fail("already_processing", 409);

  return await createOrAdoptRefund(ctx, stripe, amount, opts.notify ?? true, log);
}

/**
 * Retoma una solicitud atascada en 'processing' sin reembolso apuntado: si
 * Stripe llegó a crearlo, se adopta; si no, se crea ahora.
 */
export async function resumeStaleRefund(
  ctx: RefundContext,
  opts: { stripe?: Stripe; notify?: boolean } = {},
): Promise<RefundOutcome> {
  const log = logger.child({ function: "resumeStaleRefund", request_id: ctx.rr.id });
  if (!isStaleProcessing(ctx)) return fail("already_processing", 409);
  const amount = ctx.ticket.amount_paid_cents ?? 0;
  const pi = ctx.order.stripe_payment_intent_id;
  if (!pi || amount <= 0) return fail("nothing_to_refund", 409);
  const stripe = opts.stripe ?? requireStripe();
  // Reclamarla de nuevo (tocar updated_at) para que otra ejecución no la retome a la vez.
  const { data: claimed } = await supabaseAdmin
    .from("refund_requests")
    .update({ status: "processing", stripe_failure_reason: null })
    .eq("id", ctx.rr.id)
    .eq("status", "processing")
    .is("stripe_refund_id", null)
    .lt("updated_at", new Date(Date.now() - STALE_PROCESSING_MS).toISOString())
    .select("id");
  if (!claimed || claimed.length === 0) return fail("already_processing", 409);
  return await createOrAdoptRefund(ctx, stripe, amount, opts.notify ?? true, log);
}

async function createOrAdoptRefund(
  ctx: RefundContext,
  stripe: Stripe,
  amount: number,
  notify: boolean,
  log: ReturnType<typeof logger.child>,
): Promise<RefundOutcome> {
  const { rr, ticket, order } = ctx;
  const pi = order.stripe_payment_intent_id as string;
  // Solo un cargo Connect (destination charge) tiene transfer que revertir y
  // application fee. Con un cargo normal, reverse_transfer hace fallar el refund.
  const isConnectCharge = !!order.stripe_destination_account;

  let refund: Stripe.Refund;
  try {
    const existing = await findExistingStripeRefund(stripe, pi, rr.id);
    refund =
      existing ??
      (await stripe.refunds.create(
        {
          payment_intent: pi,
          amount,
          ...(isConnectCharge
            ? { reverse_transfer: true, refund_application_fee: false } // Pasify mantiene el fee
            : {}),
          metadata: {
            pasify_refund_request_id: rr.id,
            pasify_ticket_id: ticket.id,
            pasify_order_id: order.id,
          },
        },
        { idempotencyKey: `refund-${rr.id}-${Date.parse(rr.created_at)}` },
      ));
    if (existing) log.warn("refund_adopted_existing", { stripe_refund_id: existing.id });
  } catch (stripeErr) {
    if (isDefinitiveStripeError(stripeErr)) {
      log.error("stripe_refund_failed", { connect: isConnectCharge, error: String(stripeErr) });
      await supabaseAdmin
        .from("refund_requests")
        .update({
          status: "failed",
          stripe_failure_reason: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
        })
        .eq("id", rr.id);
      return fail("stripe_refund_failed", 502);
    }
    // Sin respuesta clara: puede que Stripe lo haya creado. Se queda en
    // 'processing' y se retoma (resumeStaleRefund), que primero lo busca.
    log.error("stripe_refund_unconfirmed", { connect: isConnectCharge, error: String(stripeErr) });
    await supabaseAdmin
      .from("refund_requests")
      .update({ stripe_failure_reason: `sin confirmar: ${String(stripeErr).slice(0, 200)}` })
      .eq("id", rr.id);
    return fail("stripe_unavailable", 503);
  }

  // A partir de aquí el dinero ya se ha devuelto: nada debe marcarla fallida.
  await recordRefund(ctx, refund, log);
  if (notify) await notifyRefundsGrouped([{ ctx, amountCents: amount }]).catch(() => {});
  log.info("refund_processed", { stripe_refund_id: refund.id, connect: isConnectCharge });
  return { ok: true, stripeRefundId: refund.id, status: refund.status ?? null, amountCents: amount };
}

/**
 * Avisa a cada comprador UNA vez por lote (un pedido de 10 entradas: un email
 * y un aviso, no diez), con el total devuelto. Nunca lanza.
 */
export async function notifyRefundsGrouped(items: Array<{ ctx: RefundContext; amountCents: number }>): Promise<void> {
  const groups = new Map<string, { ctx: RefundContext; total: number; ids: string[] }>();
  for (const it of items) {
    const key = it.ctx.rr.requester_user_id ?? `email:${it.ctx.rr.requester_email.toLowerCase()}`;
    const g = groups.get(key) ?? { ctx: it.ctx, total: 0, ids: [] };
    g.total += it.amountCents;
    g.ids.push(it.ctx.rr.id);
    groups.set(key, g);
  }
  for (const { ctx, total, ids } of groups.values()) {
    try {
      await notifyOne(ctx, total, ids);
    } catch (e) {
      logger.warn("refund_notify_failed", { request_ids: ids, error: String(e) });
    }
  }
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function notifyOne(ctx: RefundContext, amount: number, requestIds: string[]): Promise<void> {
  const { rr, ticket, event } = ctx;
  const cancelled = rr.reason_code === "event_cancelled";
  const currency = ticket.currency ?? rr.currency ?? "EUR";
  const { data: profile } = rr.requester_user_id
    ? await supabaseAdmin.from("profiles").select("first_name").eq("id", rr.requester_user_id).maybeSingle()
    : { data: null };

  if (rr.requester_email) {
    const email = refundDecidedEmail({
      firstName: profile?.first_name ?? null,
      eventTitle: event.title ?? "tu evento",
      amountCents: amount,
      status: "approved",
      decisionNote: cancelled
        ? `El local ha cancelado el evento${rr.decision_note ? `: ${rr.decision_note}` : ""}. Te devolvemos el importe completo.`
        : rr.decision_note,
    });
    await sendEmail({
      to: rr.requester_email,
      ...(cancelled ? { ...email, subject: `Evento cancelado · ${event.title}` } : email),
      idempotencyKey: `refund-${await shortHash([...requestIds].sort().join(","))}`,
    }).catch((e) => logger.warn("refund_email_failed", { request_ids: requestIds, error: String(e) }));
  }

  if (rr.requester_user_id) {
    await enqueueNotification({
      user_id: rr.requester_user_id,
      category: "tickets",
      kind: cancelled ? "event_cancelled_refund" : "refund_decided",
      title: cancelled ? `Evento cancelado: ${event.title}` : "Reembolso aprobado",
      body: `${(amount / 100).toFixed(2)} ${currency} en camino`,
      link: "/#/client-dashboard",
      priority: "high",
    });
  }
}
