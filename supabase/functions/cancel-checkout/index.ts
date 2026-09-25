// Pasify · cancel-checkout
//
// El comprador abandona un pago (vuelve de Stripe sin pagar): se caduca su
// sesión de Stripe y el pedido se anula en el acto, así sus plazas y su
// máximo por persona quedan libres sin esperar a que caduque (32 + 15 min).
// Si Stripe ya lo había cobrado se confirma (mismas entradas, email y avisos
// que el webhook) y no se anula nada (settlePendingOrder, _shared/order-paid.ts).
//
// POST con el JWT del comprador (verify_jwt = false en config.toml: la
// autorización va aquí). Solo el comprador del pedido; a cualquier otro, 404.
// Body: { order_id }
// 200: { status: 'cancelled' | 'already_paid' | 'not_pending' }
// Errores: { error: <código>, message: <texto para el usuario> }
//   400 invalid_payload · 401 auth_required · 404 order_not_found
//   409 payment_in_progress · 429 rate_limit_exceeded
//   502 payment_provider_error · 503 payments_unavailable · 500 internal_error

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { stripe } from "../_shared/stripe.ts";
import { enforceRateLimit, RateLimitError } from "../_shared/rate-limit.ts";
import { PAID_ORDER_STATUSES, settlePendingOrder } from "../_shared/order-paid.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, { status });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  const log = logger.child({ function: "cancel-checkout" });

  try {
    let user: { id: string };
    try {
      user = await requireUser(req);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        return fail(401, "auth_required", "Inicia sesión para cancelar tu reserva.");
      }
      throw err;
    }

    try {
      await enforceRateLimit({ key: `cancel-checkout:${user.id}`, max: 30, windowSec: 3600 });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return fail(429, "rate_limit_exceeded", "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.");
      }
      throw err;
    }

    let body: { order_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, "invalid_payload", "La petición no es válida.");
    }
    const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
    if (!UUID_RE.test(orderId)) return fail(400, "invalid_payload", "Falta la referencia del pedido.");

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("ticket_orders")
      .select("id, status, buyer_user_id, stripe_session_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) {
      log.error("order_query_failed", { error: orderErr.message });
      return fail(500, "internal_error", "No hemos podido consultar tu pedido. Inténtalo de nuevo.");
    }
    // Pedido ajeno o inexistente: la misma respuesta (no se confirma que exista).
    if (!order || !order.buyer_user_id || order.buyer_user_id !== user.id) {
      return fail(404, "order_not_found", "No encontramos ese pedido.");
    }

    const olog = logger.child({ function: "cancel-checkout", order_id: order.id, user_id: user.id });

    if (PAID_ORDER_STATUSES.has(order.status)) return jsonResponse({ status: "already_paid" });
    if (order.status !== "pending") return jsonResponse({ status: "not_pending" });

    const outcome = await settlePendingOrder(
      { id: order.id, stripe_session_id: order.stripe_session_id ?? null },
      { stripe, source: "cancel-checkout", cancelAs: "failed" },
    );
    olog.info("checkout_cancel", { outcome });

    switch (outcome) {
      case "cancelled":
        return jsonResponse({ status: "cancelled" });
      case "paid":
        return jsonResponse({ status: "already_paid" });
      case "not_pending":
        return jsonResponse({ status: "not_pending" });
      case "processing":
        return fail(
          409,
          "payment_in_progress",
          "Tu pago se está procesando y ya no se puede cancelar. Si no se completa, la reserva se anulará sola.",
        );
      default:
        return fail(
          502,
          "payment_provider_error",
          "No hemos podido cancelar la reserva ahora mismo. Inténtalo de nuevo en unos segundos.",
        );
    }
  } catch (err) {
    // Errores conocidos (Stripe sin responder, pagos no disponibles…).
    if (err instanceof HttpError) {
      log.warn("cancel_checkout_rejected", { code: err.code, status: err.status });
      return fail(err.status, err.code, err.message);
    }
    log.error("cancel-checkout failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal_error", "Ha ocurrido un error inesperado. Inténtalo de nuevo.");
  }
});
