// Pasify · confirm-checkout-session
//
// Fallback robusto cuando el webhook `stripe-webhook` no llega (test mode con
// cuentas Stripe desalineadas, Stripe Dashboard en modo distinto, fallos de
// red entre Stripe → Supabase, etc.).
//
// La página `/ticket/success` lo llama tras volver de Stripe Checkout:
//   1) Consulta Stripe API directamente con el session_id que vino en la URL.
//   2) Si la session está en `paid` y aún no hemos marcado la order como
//      `paid` en nuestra BD, invoca la misma RPC `mark_order_paid` que el
//      webhook normal — atomico, idempotente, dispara el mismo trigger
//      `tickets_update_counters` que incrementa events.tickets_sold.
//   3) Devuelve { status, order_id, payment_intent_id } al frontend.
//
// Como `mark_order_paid` tiene early-return `IF v_order.status='paid'`, es
// safe llamarla aunque el webhook ya haya procesado la session. Ambos
// caminos convergen al mismo estado final.
//
// Body: { session_id: string }
// Returns: { status: 'paid'|'pending'|'expired', order_id?: string, payment_intent_id?: string }

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

    // Auth requerida — sólo el comprador o un admin pueden consultar.
    const user = await requireUser(req).catch(() => null);
    if (!user) return errorResponse("unauthorized", 401);

    const body = (await req.json()) as Payload;
    if (!body.session_id) return errorResponse("session_id_required", 400);

    const log = logger.child({
      function: "confirm-checkout-session",
      user_id: user.id,
      session_id: body.session_id,
    });

    // 1) Buscar el order asociado al session_id (RLS bypass con admin client)
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("ticket_orders")
      .select("id, status, buyer_user_id, total_cents, stripe_session_id, stripe_payment_intent_id, paid_at")
      .eq("stripe_session_id", body.session_id)
      .maybeSingle();
    if (orderErr) {
      log.error("order_query_failed", { error: orderErr.message });
      return errorResponse("order_query_failed", 500);
    }
    if (!order) {
      log.warn("order_not_found", { session_id: body.session_id });
      return errorResponse("order_not_found", 404);
    }

    // Autorización: sólo el buyer o un admin pueden forzar la confirmación.
    if (order.buyer_user_id && order.buyer_user_id !== user.id) {
      // Verificar si el usuario es admin
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!isAdmin) {
        log.warn("forbidden_not_buyer_or_admin", { actual_buyer: order.buyer_user_id });
        return errorResponse("forbidden", 403);
      }
    }

    // 2) Si ya está paid, devolvemos directamente — no hace falta consultar Stripe.
    if (order.status === "paid") {
      log.info("already_paid", { order_id: order.id });
      return jsonResponse({
        status: "paid",
        order_id: order.id,
        payment_intent_id: order.stripe_payment_intent_id,
        source: "cache",
      });
    }

    // 3) Consultar a Stripe el estado real de la session
    const stripe = requireStripe();
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(body.session_id, {
        expand: ["payment_intent"],
      });
    } catch (err) {
      log.error("stripe_session_retrieve_failed", { error: (err as Error).message });
      return errorResponse("stripe_session_retrieve_failed", 502);
    }

    const paymentStatus = session.payment_status; // 'paid' | 'unpaid' | 'no_payment_required'
    const sessionStatus = session.status; // 'open' | 'complete' | 'expired'
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const amountTotal = session.amount_total ?? order.total_cents ?? 0;
    const applicationFee =
      typeof session.payment_intent === "object" && session.payment_intent
        ? session.payment_intent.application_fee_amount ?? 0
        : 0;

    log.info("stripe_session_state", {
      payment_status: paymentStatus,
      session_status: sessionStatus,
      payment_intent: paymentIntent,
      amount_total: amountTotal,
    });

    // 4) Si Stripe dice que está pagada → invocamos mark_order_paid (mismo
    //    código path que el webhook). Idempotente por su early-return.
    if (paymentStatus === "paid" || sessionStatus === "complete") {
      if (!paymentIntent) {
        log.error("paid_but_no_payment_intent");
        return errorResponse("paid_but_no_payment_intent", 500);
      }
      const { data: markResult, error: markErr } = await supabaseAdmin.rpc("mark_order_paid", {
        _session_id: body.session_id,
        _payment_intent_id: paymentIntent,
        _amount_total_cents: amountTotal,
        _application_fee_cents: applicationFee,
      });
      if (markErr) {
        log.error("mark_order_paid_failed", { error: markErr.message });
        return errorResponse("mark_order_paid_failed", 500);
      }
      log.info("order_marked_paid_via_polling", { order_id: markResult });
      return jsonResponse({
        status: "paid",
        order_id: markResult,
        payment_intent_id: paymentIntent,
        source: "stripe_polling",
      });
    }

    // 5) Session expirada — marcar order como expired
    if (sessionStatus === "expired") {
      await supabaseAdmin
        .from("ticket_orders")
        .update({ status: "expired" })
        .eq("stripe_session_id", body.session_id);
      return jsonResponse({
        status: "expired",
        order_id: order.id,
        source: "stripe_polling",
      });
    }

    // 6) Aún pendiente
    return jsonResponse({
      status: "pending",
      order_id: order.id,
      payment_intent_id: paymentIntent,
      source: "stripe_polling",
    });
  } catch (err) {
    logger.error("confirm-checkout-session failed", { error: String(err) });
    return errorResponse(
      err instanceof Error ? err.message : "internal_error",
      500
    );
  }
});
