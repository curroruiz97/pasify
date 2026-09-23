// Pasify · ejecución de un reembolso aprobado en Stripe.
//
// Compartido por process-refund (solicitud de un comprador), partner-cancel-event
// (cancelación de un evento) y el pago que llega tarde a un evento ya cancelado
// (_shared/order-paid.ts). La AUTORIZACIÓN la hace cada llamador; aquí solo se
// valida que el reembolso tenga sentido y se ejecuta una vez.
//
// El importe, el pedido y la organización salen de la entrada (ticket → pedido
// → evento), nunca de columnas de la solicitud. El webhook charge.refunded
// cierra la solicitud con mark_refund_processed usando pasify_refund_request_id
// de los metadatos del reembolso.

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
    requester_user_id: string;
    requester_email: string;
    currency: string | null;
    decision_note: string | null;
    stripe_refund_id: string | null;
    auto_approved: boolean;
    reason_code: string | null;
    created_at: string;
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
  | "internal_error";

export type RefundOutcome =
  | { ok: true; stripeRefundId: string; status: string | null; amountCents: number }
  | { ok: false; code: RefundFailure; httpStatus: number; detail?: string };

const fail = (code: RefundFailure, httpStatus: number, detail?: string): RefundOutcome => ({
  ok: false,
  code,
  httpStatus,
  detail,
});

/** Carga la solicitud con su entrada, pedido y evento. null si falta algo. */
export async function loadRefundContext(
  requestId: string,
): Promise<RefundContext | { missing: RefundFailure }> {
  const { data: rr } = await supabaseAdmin
    .from("refund_requests")
    .select(
      "id, status, ticket_id, requester_user_id, requester_email, currency, decision_note, stripe_refund_id, auto_approved, reason_code, created_at",
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

/**
 * Ejecuta en Stripe el reembolso de una solicitud aprobada. Idempotente: la
 * reclama (approved → processing) en una sola sentencia y usa una clave de
 * idempotencia por intento.
 */
export async function executeRefund(
  ctx: RefundContext,
  opts: { stripe?: Stripe } = {},
): Promise<RefundOutcome> {
  const { rr, ticket, order, event } = ctx;
  const log = logger.child({ function: "executeRefund", request_id: rr.id });

  if (rr.status !== "approved") return fail("invalid_status", 400, `cannot_refund_${rr.status}`);
  if (rr.stripe_refund_id) return fail("already_refunded", 409);
  // La entrada tiene que seguir pagada, sin usar y en manos de quien pidió el
  // reembolso (no se devuelve una entrada escaneada ni una transferida).
  const holder = ticket.transferred_to_user_id ?? ticket.buyer_user_id;
  if (ticket.status !== "paid" || ticket.used_at || holder !== rr.requester_user_id) {
    return fail("ticket_not_refundable", 409);
  }
  if (!["paid", "partial_refund"].includes(order.status)) return fail("order_not_refundable", 409);
  const amount = ticket.amount_paid_cents ?? 0;
  if (amount <= 0) return fail("nothing_to_refund", 409);
  const pi = order.stripe_payment_intent_id;
  if (!pi) return fail("no_payment_intent", 400);
  // Solo un cargo Connect (destination charge) tiene transfer que revertir y
  // application fee. Con un cargo normal, reverse_transfer hace fallar el refund.
  const isConnectCharge = !!order.stripe_destination_account;

  // Stripe configurado antes de reclamar la solicitud: si no, se quedaría en
  // 'processing' para siempre.
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

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
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
      // Una solicitud reabierta cambia created_at: reintento nuevo.
      { idempotencyKey: `refund-${rr.id}-${Date.parse(rr.created_at)}` },
    );
  } catch (stripeErr) {
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

  // A partir de aquí el dinero ya se ha devuelto: nada de lo que falle debe
  // marcar la solicitud como fallida.
  const { error: saveErr } = await supabaseAdmin
    .from("refund_requests")
    .update({ stripe_refund_id: refund.id, stripe_refund_status: refund.status })
    .eq("id", rr.id);
  if (saveErr) log.error("refund_id_save_failed", { stripe_refund_id: refund.id, error: saveErr.message });

  await notifyRefund(ctx, amount).catch((e) => log.warn("refund_notify_failed", { error: String(e) }));
  log.info("refund_processed", { stripe_refund_id: refund.id, connect: isConnectCharge });
  return { ok: true, stripeRefundId: refund.id, status: refund.status ?? null, amountCents: amount };
}

async function notifyRefund(ctx: RefundContext, amount: number): Promise<void> {
  const { rr, ticket, event } = ctx;
  const cancelled = rr.reason_code === "event_cancelled";
  const currency = ticket.currency ?? rr.currency ?? "EUR";
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("first_name")
    .eq("id", rr.requester_user_id)
    .maybeSingle();

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
    idempotencyKey: `refund-${rr.id}-${Date.parse(rr.created_at)}`,
  }).catch((e) => logger.warn("refund_email_failed", { request_id: rr.id, error: String(e) }));

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
