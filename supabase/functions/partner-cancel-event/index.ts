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
//   3. Reembolsa en Stripe por tandas (_shared/refund.ts). Si quedan más o
//      alguna falla, el panel vuelve a llamar: solo se procesan las aprobadas.
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
import { executeRefund, loadRefundContext } from "../_shared/refund.ts";

// Unos 0,5 s por reembolso: 120 caben de sobra en el tiempo de una función.
const REFUNDS_PER_CALL = 120;

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
      tickets_without_account: number;
    };

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
        refunds_pending: res.refund_request_ids.length > 0,
        tickets_without_account: res.tickets_without_account,
      });
    }

    for (const sessionId of res.pending_session_ids ?? []) {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (err) {
        // Ya completada o caducada: nada que hacer.
        log.info("session_expire_skipped", { session_id: sessionId, error: String(err) });
      }
    }

    const batch = (res.refund_request_ids ?? []).slice(0, REFUNDS_PER_CALL);
    let refunded = 0;
    let failed = 0;
    for (const id of batch) {
      const ctx = await loadRefundContext(id);
      if ("missing" in ctx) {
        failed += 1;
        continue;
      }
      const out = await executeRefund(ctx, { stripe });
      if (out.ok) refunded += 1;
      else if (out.code !== "already_processing" && out.code !== "already_refunded") {
        failed += 1;
        log.warn("cancel_refund_failed", { event_id, request_id: id, code: out.code });
      }
    }
    const remaining = Math.max(0, (res.refund_request_ids?.length ?? 0) - batch.length);
    log.info("event_cancelled", { event_id, refunded, failed, remaining });

    return jsonResponse({
      event_id,
      already_cancelled: res.already_cancelled,
      refunded,
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
