// Pasify · resend-tickets-email
//
// Reenvía el email con las entradas (y sus QR) de un pedido pagado. Lo pide
// el comprador desde su cartera o un admin de plataforma desde soporte. Va
// siempre al email del pedido, con las entradas vigentes que siguen siendo
// del comprador: ni las transferidas a otra persona ni las de un evento
// cancelado (resendTicketsEmail, _shared/order-paid.ts). Si sale, actualiza
// ticket_orders.tickets_email_sent_at.
//
// POST con JWT (verify_jwt = false en config.toml: la autorización va aquí):
// el comprador del pedido o un admin de plataforma; a cualquier otro, 404.
// Body: { order_id }
// 200: { sent: boolean }  (false: no ha salido: sin proveedor de email, sin
//      entradas que enviar o Resend lo ha rechazado)
// Límite: 3 por hora y pedido (y 20 por hora y usuario).
// Errores: { error: <código>, message: <texto para el usuario> }
//   400 invalid_payload · 401 auth_required · 404 order_not_found
//   409 order_not_paid · 429 rate_limit_exceeded · 500 internal_error

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { enforceRateLimit, RateLimitError } from "../_shared/rate-limit.ts";
import { PAID_ORDER_STATUSES, resendTicketsEmail } from "../_shared/order-paid.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_ORDER_PER_HOUR = 3;
const MAX_PER_USER_PER_HOUR = 20;

function fail(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, { status });
}

const TOO_MANY = "Ya te hemos reenviado este email varias veces. Espera un rato y vuelve a probar.";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  const log = logger.child({ function: "resend-tickets-email" });

  try {
    let user: { id: string };
    try {
      user = await requireUser(req);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        return fail(401, "auth_required", "Inicia sesión para reenviar tus entradas.");
      }
      throw err;
    }

    try {
      await enforceRateLimit({ key: `resend-tickets-email:user:${user.id}`, max: MAX_PER_USER_PER_HOUR, windowSec: 3600 });
    } catch (err) {
      if (err instanceof RateLimitError) return fail(429, "rate_limit_exceeded", TOO_MANY);
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
      .select("id, status, buyer_user_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) {
      log.error("order_query_failed", { error: orderErr.message });
      return fail(500, "internal_error", "No hemos podido consultar tu pedido. Inténtalo de nuevo.");
    }
    const isBuyer = !!order?.buyer_user_id && order.buyer_user_id === user.id;
    const allowed = !!order && (isBuyer || (await isPlatformAdmin(user.id)));
    // Pedido ajeno o inexistente: la misma respuesta (no se confirma que exista).
    if (!allowed) return fail(404, "order_not_found", "No encontramos ese pedido.");
    if (!PAID_ORDER_STATUSES.has(order.status)) {
      return fail(409, "order_not_paid", "Este pedido no está pagado: no tiene entradas que enviar.");
    }

    // Por pedido, después de comprobar quién pide: nadie ajeno gasta el cupo.
    try {
      await enforceRateLimit({ key: `resend-tickets-email:order:${order.id}`, max: MAX_PER_ORDER_PER_HOUR, windowSec: 3600 });
    } catch (err) {
      if (err instanceof RateLimitError) return fail(429, "rate_limit_exceeded", TOO_MANY);
      throw err;
    }

    const sent = await resendTicketsEmail(order.id, isBuyer ? "resend-tickets-email:buyer" : "resend-tickets-email:admin");
    log.info("tickets_email_resend", { order_id: order.id, user_id: user.id, by_admin: !isBuyer, sent });
    return jsonResponse({ sent });
  } catch (err) {
    if (err instanceof HttpError) {
      log.warn("resend_rejected", { code: err.code, status: err.status });
      return fail(err.status, err.code, err.message);
    }
    log.error("resend-tickets-email failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal_error", "Ha ocurrido un error inesperado. Inténtalo de nuevo.");
  }
});
