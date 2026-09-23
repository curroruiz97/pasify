// Pasify · process-refund
// Ejecuta el refund Stripe para un refund_requests aprobado.
// Lo llama hooks/useRefundRequests.ts justo después de decide_refund(), o el
// propio comprador cuando request_refund la aprobó automáticamente.
//
// El importe, el pedido y la organización salen de la entrada (ticket →
// pedido → evento), nunca de columnas de la solicitud.
//
// Body: { request_id }
// Returns: { stripe_refund_id, status }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin, callerHasOrgRole } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";
import { sendEmail } from "../_shared/resend.ts";
import { refundDecidedEmail } from "../_shared/email-templates.ts";
import { enqueueNotification } from "../_shared/notify.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id || typeof request_id !== "string") return errorResponse("invalid_payload", 400);

    const { data: rr } = await supabaseAdmin
      .from("refund_requests")
      .select("id, status, ticket_id, requester_user_id, requester_email, currency, decision_note, stripe_refund_id, auto_approved, created_at")
      .eq("id", request_id)
      .maybeSingle();
    if (!rr) return errorResponse("request_not_found", 404);

    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, status, used_at, amount_paid_cents, currency, order_id, event_id, buyer_user_id, transferred_to_user_id")
      .eq("id", rr.ticket_id)
      .maybeSingle();
    if (!ticket?.order_id) return errorResponse("ticket_not_found", 404);
    const [{ data: order }, { data: event }] = await Promise.all([
      supabaseAdmin
        .from("ticket_orders")
        .select("id, status, stripe_payment_intent_id, stripe_destination_account")
        .eq("id", ticket.order_id)
        .maybeSingle(),
      supabaseAdmin.from("events").select("id, title, org_id, partner_id").eq("id", ticket.event_id).maybeSingle(),
    ]);
    if (!order || !event) return errorResponse("order_not_found", 404);

    // Permisos (los mismos que decide_refund): admin de plataforma, creador
    // del evento u owner/admin/manager de SU organización. has_org_role va
    // con el JWT del usuario. Una solicitud aprobada automáticamente (dentro
    // del plazo del tipo de entrada) la lanza el propio comprador.
    const allowed =
      (await isPlatformAdmin(user.id)) ||
      event.partner_id === user.id ||
      (!!event.org_id && (await callerHasOrgRole(req, event.org_id, ["owner", "admin", "manager"]))) ||
      (rr.requester_user_id === user.id && rr.auto_approved === true);
    if (!allowed) return errorResponse("forbidden", 403);

    if (rr.status !== "approved") return errorResponse("invalid_status", 400, `cannot_refund_${rr.status}`);
    if (rr.stripe_refund_id) return errorResponse("already_refunded", 409);
    // La entrada tiene que seguir pagada, sin usar y en manos de quien pidió
    // el reembolso (no se devuelve una entrada escaneada ni una transferida).
    const holder = ticket.transferred_to_user_id ?? ticket.buyer_user_id;
    if (ticket.status !== "paid" || ticket.used_at || holder !== rr.requester_user_id) {
      return errorResponse("ticket_not_refundable", 409);
    }
    if (!["paid", "partial_refund"].includes(order.status)) return errorResponse("order_not_refundable", 409);
    const amount = ticket.amount_paid_cents ?? 0;
    if (amount <= 0) return errorResponse("nothing_to_refund", 409);

    const pi = order.stripe_payment_intent_id;
    if (!pi) return errorResponse("no_payment_intent", 400);
    // Solo un cargo Connect (destination charge) tiene transfer que revertir y
    // application fee. Con un cargo normal, reverse_transfer hace fallar el refund.
    const isConnectCharge = !!order.stripe_destination_account;

    // Stripe configurado antes de reclamar la solicitud: si no, se quedaba en
    // 'processing' para siempre.
    const stripe = requireStripe();

    // approved → processing en una sola sentencia: si llegan dos llamadas a la
    // vez, solo una lanza el refund.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("refund_requests")
      .update({ status: "processing" })
      .eq("id", rr.id)
      .eq("status", "approved")
      .select("id");
    if (claimErr) {
      logger.error("refund_claim_failed", { request_id: rr.id, error: claimErr.message });
      return errorResponse("internal_error", 500, "internal_error");
    }
    if (!claimed || claimed.length === 0) return errorResponse("invalid_status", 409, "already_processing");

    let refund;
    try {
      refund = await stripe.refunds.create({
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
      }, {
        // Una solicitud reabierta cambia created_at: reintento nuevo.
        idempotencyKey: `refund-${rr.id}-${Date.parse(rr.created_at)}`,
      });
    } catch (stripeErr) {
      logger.error("stripe_refund_failed", { request_id: rr.id, connect: isConnectCharge, error: String(stripeErr) });
      await supabaseAdmin.from("refund_requests").update({
        status: "failed",
        stripe_failure_reason: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      }).eq("id", rr.id);
      return errorResponse("stripe_refund_failed", 500);
    }

    // A partir de aquí el dinero ya se ha devuelto: nada de lo que falle debe
    // marcar la solicitud como fallida ni devolver error al panel.
    const { error: saveErr } = await supabaseAdmin.from("refund_requests").update({
      stripe_refund_id: refund.id,
      stripe_refund_status: refund.status,
    }).eq("id", rr.id);
    if (saveErr) logger.error("refund_id_save_failed", { request_id: rr.id, stripe_refund_id: refund.id, error: saveErr.message });

    // El handler de charge.refunded del webhook completará mark_refund_processed
    // pero anticipamos email y notificación.
    try {
      const { data: profile } = await supabaseAdmin.from("profiles").select("first_name").eq("id", rr.requester_user_id).maybeSingle();

      await sendEmail({
        to: rr.requester_email,
        ...refundDecidedEmail({
          firstName: profile?.first_name ?? null,
          eventTitle: event?.title ?? "tu evento",
          amountCents: amount,
          status: "approved",
          decisionNote: rr.decision_note,
        }),
        idempotencyKey: `refund-${rr.id}-${Date.parse(rr.created_at)}`,
      }).catch((e) => logger.warn("refund_email_failed", { error: String(e) }));

      await enqueueNotification({
        user_id: rr.requester_user_id,
        category: "tickets",
        kind: "refund_decided",
        title: "Reembolso aprobado",
        body: `${(amount / 100).toFixed(2)} ${ticket.currency ?? rr.currency} en camino`,
        link: "/#/client-dashboard",
        priority: "high",
      });
    } catch (notifyErr) {
      logger.warn("refund_notify_failed", { request_id: rr.id, error: String(notifyErr) });
    }

    logger.info("refund_processed", { request_id: rr.id, stripe_refund_id: refund.id, connect: isConnectCharge });

    return jsonResponse({ stripe_refund_id: refund.id, status: refund.status });
  } catch (err) {
    logger.error("process-refund failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
