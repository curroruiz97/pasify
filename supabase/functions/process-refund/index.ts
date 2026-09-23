// Pasify · process-refund
// Ejecuta el refund Stripe para un refund_requests aprobado.
// Lo llama hooks/useRefundRequests.ts justo después de decide_refund(), o el
// propio comprador cuando request_refund la aprobó automáticamente.
//
// El importe, el pedido y la organización salen de la entrada (ticket →
// pedido → evento), nunca de columnas de la solicitud: ver _shared/refund.ts.
//
// Body: { request_id }
// Returns: { stripe_refund_id, status }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, isPlatformAdmin, callerHasOrgRole } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { executeRefund, loadRefundContext } from "../_shared/refund.ts";

const MISSING_STATUS = { request_not_found: 404, ticket_not_found: 404, order_not_found: 404 } as const;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id || typeof request_id !== "string") return errorResponse("invalid_payload", 400);

    const ctx = await loadRefundContext(request_id);
    if ("missing" in ctx) {
      return errorResponse(ctx.missing, MISSING_STATUS[ctx.missing as keyof typeof MISSING_STATUS] ?? 404);
    }

    // Permisos (los mismos que decide_refund): admin de plataforma, creador
    // del evento u owner/admin/manager de SU organización. has_org_role va
    // con el JWT del usuario. Una solicitud aprobada automáticamente (dentro
    // del plazo del tipo de entrada) la lanza el propio comprador.
    const { rr, event } = ctx;
    const allowed =
      (await isPlatformAdmin(user.id)) ||
      event.partner_id === user.id ||
      (!!event.org_id && (await callerHasOrgRole(req, event.org_id, ["owner", "admin", "manager"]))) ||
      (rr.requester_user_id === user.id && rr.auto_approved === true);
    if (!allowed) return errorResponse("forbidden", 403);

    const outcome = await executeRefund(ctx);
    if (!outcome.ok) {
      const status = outcome.code === "stripe_refund_failed" ? 500 : outcome.httpStatus;
      return errorResponse(outcome.code, status, outcome.detail ?? outcome.code);
    }
    return jsonResponse({ stripe_refund_id: outcome.stripeRefundId, status: outcome.status });
  } catch (err) {
    logger.error("process-refund failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
