// Pasify · partner-cancel-event
//
// El local cancela un evento (WP2.3). Todo el que pagó recupera el importe
// completo; la comisión de Pasify la asume el local (D7).
//
//   1. RPC partner_cancel_event con el JWT del local (auth.uid() = quien
//      cancela; la RPC comprueba permisos): estado final 'cancelled', fuera
//      las reservas sin pagar, una solicitud aprobada por entrada pagada y
//      aviso in-app a los titulares. Repetirla es seguro.
//   2. Caduca en Stripe las sesiones de pago que seguían abiertas. Si aun así
//      entra un pago, _shared/order-paid.ts lo devuelve solo.
//   3. Reembolsa en Stripe (_shared/refund.ts) durante unos 60 s como mucho y
//      retoma las que se quedaron en proceso. Si quedan, el panel vuelve a
//      llamar. Los compradores reciben UN aviso por lote con su total.
//
// Body: { event_id, reason }
// Returns: { event_id, already_cancelled, refunded, failed, remaining, refunds_pending, tickets_without_account }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, supabaseAsUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  executeRefund,
  loadRefundContext,
  notifyRefundsGrouped,
  resumeStaleRefund,
  type RefundContext,
} from "../_shared/refund.ts";

// Muy por debajo del límite de una edge function: se deja de empezar
// reembolsos nuevos pasado este tiempo y el panel vuelve a llamar.
const TIME_BUDGET_MS = 60_000;

const FRIENDLY: Record<string, [number, string]> = {
  cancel_reason_required: [400, "cancel_reason_required"],
  event_not_cancellable: [409, "event_not_cancellable"],
  "Event not found": [404, "event_not_found"],
  Forbidden: [403, "forbidden"],
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "partner-cancel-event" });
  const started = Date.now();
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { event_id, reason } = await req.json().catch(() => ({}));
    if (typeof event_id !== "string" || !/^[0-9a-f-]{36}$/i.test(event_id)) {
      return errorResponse("invalid_payload", 400);
    }
    await enforceRateLimit({ key: `cancel_event:${user.id}`, max: 30, windowSec: 3600 });

    const userClient = supabaseAsUser(req.headers.get("Authorization"));
    const { data, error } = await userClient.rpc("partner_cancel_event", {
      _event_id: event_id,
      _reason: typeof reason === "string" ? reason.slice(0, 500) : "",
    });
    if (error) {
      const match = Object.entries(FRIENDLY).find(([k]) => error.message.includes(k));
      if (match) return errorResponse(match[1][1], match[1][0]);
      log.error("partner_cancel_event_failed", { event_id, error: error.message });
      return errorResponse("internal_error", 500);
    }
    const res = data as {
      already_cancelled: boolean;
      pending_session_ids: string[];
      refund_request_ids: string[];
      stale_refund_request_ids: string[];
      tickets_without_account: number;
    };
    const approvedIds = res.refund_request_ids ?? [];
    const staleIds = res.stale_refund_request_ids ?? [];

    let stripe;
    try {
      stripe = requireStripe();
    } catch {
      // Evento cancelado y solicitudes creadas; los reembolsos quedan
      // aprobados hasta que Stripe esté configurado y se reintente.
      log.error("stripe_not_configured", { event_id });
      return jsonResponse({
        event_id,
        already_cancelled: res.already_cancelled,
        refunded: 0,
        failed: 0,
        // Nada más que hacer en esta llamada: el panel ofrece reintentar.
        remaining: 0,
        refunds_pending: approvedIds.length + staleIds.length > 0,
        tickets_without_account: res.tickets_without_account,
      });
    }

    for (const sessionId of res.pending_session_ids ?? []) {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (err) {
        // Ya completada o caducada es lo normal; cualquier otra cosa se ve en el log.
        const msg = String(err);
        if (/expired|complete|not open|status/i.test(msg)) log.info("session_expire_skipped", { session_id: sessionId });
        else log.warn("session_expire_failed", { session_id: sessionId, error: msg });
      }
    }

    const done: Array<{ ctx: RefundContext; amountCents: number }> = [];
    let failed = 0;
    let processed = 0;
    const queue: Array<{ id: string; stale: boolean }> = [
      ...staleIds.map((id) => ({ id, stale: true })),
      ...approvedIds.map((id) => ({ id, stale: false })),
    ];
    for (const item of queue) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      processed += 1;
      const ctx = await loadRefundContext(item.id);
      if ("missing" in ctx) {
        failed += 1;
        continue;
      }
      const out = item.stale
        ? await resumeStaleRefund(ctx, { stripe, notify: false })
        : await executeRefund(ctx, { stripe, notify: false });
      if (out.ok) done.push({ ctx, amountCents: out.amountCents });
      else if (out.code !== "already_processing" && out.code !== "already_refunded") {
        failed += 1;
        log.warn("cancel_refund_failed", { event_id, request_id: item.id, code: out.code });
      }
    }
    await notifyRefundsGrouped(done);

    const remaining = Math.max(0, queue.length - processed);
    log.info("event_cancelled", { event_id, refunded: done.length, failed, remaining });
    return jsonResponse({
      event_id,
      already_cancelled: res.already_cancelled,
      refunded: done.length,
      failed,
      remaining,
      refunds_pending: failed > 0 || remaining > 0,
      tickets_without_account: res.tickets_without_account,
    });
  } catch (err) {
    log.error("partner-cancel-event failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
