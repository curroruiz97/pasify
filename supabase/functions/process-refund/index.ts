// Pasify · process-refund
// Ejecuta el refund Stripe para un refund_requests aprobado.
// Llamado tras decide_refund() o por trigger AFTER UPDATE.
//
// Body: { request_id }
// Returns: { stripe_refund_id, status }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";
import { sendEmail } from "../_shared/resend.ts";
import { refundDecidedEmail } from "../_shared/email-templates.ts";
import { enqueueNotification } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { request_id } = await req.json();
    if (!request_id) return errorResponse("invalid_payload", 400);

    const { data: rr } = await supabaseAdmin
      .from("refund_requests")
      .select("id, status, ticket_id, order_id, amount_cents, currency, requester_user_id, requester_email, event_id, org_id, decision_note, stripe_refund_id, ticket_orders(stripe_payment_intent_id)")
      .eq("id", request_id)
      .maybeSingle();
    if (!rr) return errorResponse("request_not_found", 404);

    // Permisos: admin o owner/admin/manager del org
    const isAdmin = await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    const isOrgManager = rr.org_id
      ? (await supabaseAdmin.rpc("has_org_role", { _org_id: rr.org_id, _roles: ["owner", "admin", "manager"] })).data
      : false;
    if (!isAdmin.data && !isOrgManager) return errorResponse("forbidden", 403);

    if (rr.status !== "approved") return errorResponse("invalid_status", 400, `cannot_refund_${rr.status}`);

    const pi = (rr.ticket_orders as any)?.stripe_payment_intent_id;
    if (!pi) return errorResponse("no_payment_intent", 400);

    // Marcar processing
    await supabaseAdmin.from("refund_requests").update({ status: "processing" }).eq("id", rr.id);

    const stripe = requireStripe();
    try {
      const refund = await stripe.refunds.create({
        payment_intent: pi,
        amount: rr.amount_cents,
        reverse_transfer: true,
        refund_application_fee: false, // Pasify mantiene el fee
        metadata: {
          pasify_refund_request_id: rr.id,
          pasify_ticket_id: rr.ticket_id,
          pasify_order_id: rr.order_id ?? "",
        },
      });

      await supabaseAdmin.from("refund_requests").update({
        stripe_refund_id: refund.id,
        stripe_refund_status: refund.status,
      }).eq("id", rr.id);

      // El handler de charge.refunded del webhook completará mark_refund_processed
      // pero anticipamos email y notificación.

      // Email cliente
      const { data: event } = await supabaseAdmin.from("events").select("title").eq("id", rr.event_id).maybeSingle();
      const { data: profile } = await supabaseAdmin.from("profiles").select("first_name").eq("id", rr.requester_user_id).maybeSingle();

      await sendEmail({
        to: rr.requester_email,
        ...refundDecidedEmail({
          firstName: profile?.first_name ?? null,
          eventTitle: event?.title ?? "tu evento",
          amountCents: rr.amount_cents,
          status: "approved",
          decisionNote: rr.decision_note,
        }),
        idempotencyKey: `refund-${rr.id}`,
      }).catch((e) => logger.warn("refund_email_failed", { error: String(e) }));

      await enqueueNotification({
        user_id: rr.requester_user_id,
        category: "tickets",
        kind: "refund_decided",
        title: "Reembolso aprobado",
        body: `${(rr.amount_cents / 100).toFixed(2)} ${rr.currency} en camino`,
        link: "/#/client-dashboard",
        priority: "high",
      });

      logger.info("refund_processed", { request_id: rr.id, stripe_refund_id: refund.id });

      return jsonResponse({ stripe_refund_id: refund.id, status: refund.status });
    } catch (stripeErr) {
      logger.error("stripe_refund_failed", { request_id: rr.id, error: String(stripeErr) });
      await supabaseAdmin.from("refund_requests").update({
        status: "failed",
        stripe_failure_reason: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
      }).eq("id", rr.id);
      return errorResponse("stripe_refund_failed", 500);
    }
  } catch (err) {
    logger.error("process-refund failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
