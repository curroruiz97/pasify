// Pasify · confirm-checkout-session
//
// Red de seguridad cuando el webhook `stripe-webhook` no llega (o llega
// tarde): la página de vuelta de Stripe pregunta aquí y esta función consulta
// a Stripe directamente.
//
//   1) Busca el pedido por session_id y comprueba que quien pregunta puede:
//        - sin sesión: el body trae session_id Y order_id y ambos casan con
//          el pedido (es la URL de vuelta de Stripe; así funciona desde
//          /ticket/gracias en Safari, donde la app nativa paga sin sesión);
//        - con sesión: el comprador o un admin.
//   2) Si Stripe dice que está cobrada → `handleOrderPaid` (el mismo camino
//      que el webhook: mark_order_paid_v2 + email con QR, puntos y avisos,
//      solo la primera vez). Si la sesión caducó → `expire_ticket_order`.
//      En producción una sesión de modo prueba (livemode false) no confirma
//      nada: 409 test_payment_not_accepted (salvo PASIFY_ALLOW_TEST_PAYMENTS,
//      ver _shared/stripe.ts).
//
// verify_jwt = false (config.toml): la autorización la hace esta función.
// Rate limit por IP.
//
// Body: { session_id: string, order_id?: string }
// Returns: { status: 'paid'|'pending'|'expired', order_id }  (sin datos personales)
// Errores: { error: <código>, message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type Stripe from "npm:stripe@14";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { requireStripe, stripeId, isCheckoutSessionPaid, isIgnoredTestModeObject } from "../_shared/stripe.ts";
import { enforceRateLimit, clientIp, RateLimitError } from "../_shared/rate-limit.ts";
import { handleOrderPaid } from "../_shared/order-paid.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{10,255}$/;
/** Estados de pedido que ya implican cobro (no hace falta preguntar a Stripe). */
const PAID_ORDER_STATUSES = new Set(["paid", "partial_refund", "refunded"]);

function fail(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, { status });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  const log = logger.child({ function: "confirm-checkout-session" });

  try {
    try {
      // La página de vuelta reintenta ~10 veces por compra; margen para redes
      // compartidas (universidad, CGNAT). Stripe solo se consulta con un par
      // session_id/order_id válido, así que esto protege sobre todo la BD.
      await enforceRateLimit({ key: `confirm-checkout:${clientIp(req)}`, max: 120, windowSec: 600 });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return fail(429, "rate_limit_exceeded", "Demasiadas comprobaciones seguidas. Espera un momento y vuelve a intentarlo.");
      }
      throw err;
    }

    let body: { session_id?: unknown; order_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, "invalid_payload", "La petición no es válida.");
    }
    const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
    const orderIdParam = typeof body?.order_id === "string" ? body.order_id.trim() : "";
    if (!SESSION_ID_RE.test(sessionId)) return fail(400, "session_id_required", "Falta la referencia del pago.");
    if (orderIdParam && !UUID_RE.test(orderIdParam)) return fail(400, "invalid_order_id", "La referencia del pedido no es válida.");

    const user = await requireUser(req).catch(() => null);
    if (!user && !orderIdParam) {
      return fail(401, "auth_required", "Inicia sesión o abre el enlace de vuelta del pago para confirmar tu compra.");
    }

    // 1) Pedido + autorización
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("ticket_orders")
      .select("id, status, buyer_user_id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();
    if (orderErr) {
      log.error("order_query_failed", { error: orderErr.message });
      return fail(500, "order_query_failed", "No hemos podido consultar tu pedido. Inténtalo de nuevo.");
    }
    const notFound = () => fail(404, "order_not_found", "No encontramos ese pedido.");
    if (!order) return notFound();

    const pairMatches = !!orderIdParam && order.id === orderIdParam;
    let allowed = pairMatches || (!!user && !!order.buyer_user_id && order.buyer_user_id === user.id);
    if (!allowed && user) allowed = await isPlatformAdmin(user.id);
    if (!allowed) {
      // Con order_id que no casa respondemos 404 (no confirmamos que exista).
      if (user && !orderIdParam) {
        log.warn("forbidden_not_buyer_or_admin", { user_id: user.id, order_id: order.id });
        return fail(403, "forbidden", "Este pedido no es tuyo.");
      }
      return notFound();
    }

    const olog = logger.child({ function: "confirm-checkout-session", order_id: order.id, session_id: sessionId });

    // 2) Ya pagado: no hace falta molestar a Stripe.
    if (PAID_ORDER_STATUSES.has(order.status)) {
      return jsonResponse({ status: "paid", order_id: order.id });
    }

    // 3) Estado real en Stripe (incluso si el pedido figura como caducado:
    //    si Stripe cobró, mark_order_paid_v2 recupera las entradas).
    const stripe = requireStripe();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    } catch (err) {
      olog.error("stripe_session_retrieve_failed", { error: err instanceof Error ? err.message : String(err) });
      return fail(502, "payment_provider_error", "No hemos podido consultar el pago. Inténtalo de nuevo en unos segundos.");
    }
    if (session.metadata?.order_id && session.metadata.order_id !== order.id) {
      olog.error("session_order_mismatch", { session_order_id: session.metadata.order_id });
      return notFound();
    }

    // Producción: un pago de modo prueba no genera entradas (ni email, ni
    // puntos, ni aviso de venta). El pedido sigue pendiente hasta que caduca.
    if (isIgnoredTestModeObject(session.livemode)) {
      olog.warn("test_mode_session_ignored", { status: session.status, payment_status: session.payment_status });
      return fail(
        409,
        "test_payment_not_accepted",
        "Este pago se hizo en modo de prueba y no genera entradas. No se te ha cobrado nada.",
      );
    }

    if (isCheckoutSessionPaid(session)) {
      const pi = session.payment_intent;
      const res = await handleOrderPaid({
        sessionId,
        paymentIntentId: stripeId(pi),
        amountTotal: session.amount_total ?? 0,
        applicationFee: pi && typeof pi === "object" ? pi.application_fee_amount ?? 0 : 0,
        livemode: session.livemode,
        source: "confirm-checkout-session",
      });
      olog.info("order_confirmed_via_stripe", { newly_paid: res.newlyPaid });
      return jsonResponse({ status: "paid", order_id: res.orderId });
    }

    if (session.status === "expired") {
      const { error: expErr } = await supabaseAdmin.rpc("expire_ticket_order", { _session_id: sessionId });
      if (expErr) olog.warn("expire_ticket_order_failed", { error: expErr.message });
      return jsonResponse({ status: "expired", order_id: order.id });
    }

    return jsonResponse({ status: "pending", order_id: order.id });
  } catch (err) {
    log.error("confirm-checkout-session failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal_error", "Ha ocurrido un error inesperado. Inténtalo de nuevo.");
  }
});
