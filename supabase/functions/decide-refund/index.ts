// Pasify · decide-refund
//
// El local decide una solicitud de reembolso pendiente (D-3). Pueden decidir
// el owner, admin o manager de la organización del evento y un admin de
// plataforma. La usan la bandeja del local y el panel de admin.
//
//   approve → decide_refund (RPC con el JWT de quien decide: queda como
//             decided_by) y reembolso en Stripe (_shared/refund.ts
//             executeRefund), que avisa al comprador (refundDecidedEmail
//             y aviso en la app).
//   reject  → decide_refund con el motivo (5 caracteres o más) y email
//             refundDecidedEmail({ status: 'rejected' }) con el motivo.
//
// Aprobar otra vez una solicitud ya aprobada cuyo reembolso no llegó a salir
// (Stripe caído o sin configurar) lo reintenta; nunca crea dos reembolsos.
//
// Body: { request_id, decision: 'approve' | 'reject', note }
// Returns: { status } — estado de la solicitud tras decidir: 'rejected',
//   'refunded', 'processing' (Stripe lo confirma luego por el webhook),
//   'approved' (el reembolso no se pudo lanzar: se puede reintentar) o
//   'failed'; con `refund_error` si el reembolso no salió.
// Errores: invalid_payload 400, note_required 400, forbidden 403,
//   request_not_found / ticket_not_found / order_not_found 404,
//   already_decided 409, ticket_not_refundable 409, rate_limit_exceeded 429.
//
// verify_jwt = false (config.toml): la autorización va en el código.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, isPlatformAdmin, callerHasOrgRole, supabaseAdmin, userClientFrom } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import {
  executeRefund,
  isStaleProcessing,
  loadRefundContext,
  notifyRefundRejected,
  resumeStaleRefund,
  type RefundOutcome,
} from "../_shared/refund.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lo mismo que exige decide_refund para denegar. */
const MIN_NOTE_LENGTH = 5;
const MAX_NOTE_LENGTH = 1000;

/** Código estable en message y en code. */
const fail = (code: string, status: number) => errorResponse(code, status, code);

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "decide-refund" });
  try {
    if (req.method !== "POST") return fail("method_not_allowed", 405);
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as { request_id?: unknown; decision?: unknown; note?: unknown };
    const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
    if (!UUID_RE.test(requestId) || !decision) return fail("invalid_payload", 400);
    if (decision === "reject" && note.length < MIN_NOTE_LENGTH) return fail("note_required", 400);
    await enforceRateLimit({ key: `decide_refund:${user.id}`, max: 120, windowSec: 3600 });

    const ctx = await loadRefundContext(requestId);
    if ("missing" in ctx) return fail(ctx.missing, 404);

    // Permisos (los mismos que decide_refund, que los vuelve a mirar con el
    // JWT): admin de plataforma u owner/admin/manager de la organización del
    // evento; en un evento sin organización, quien lo creó.
    const { event } = ctx;
    const allowed =
      (await isPlatformAdmin(user.id)) ||
      (event.org_id
        ? await callerHasOrgRole(req, event.org_id, ["owner", "admin", "manager"])
        : event.partner_id === user.id);
    if (!allowed) return fail("forbidden", 403);

    const { error: rpcErr } = await userClientFrom(req).rpc("decide_refund", {
      _request_id: requestId,
      _decision: decision,
      _note: note || null,
    });
    let retry = false;
    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (/ya decidida/i.test(msg)) {
        // Aprobada antes y sin reembolso hecho: se reintenta el reembolso.
        if (decision === "approve" && (ctx.rr.status === "approved" || isStaleProcessing(ctx))) retry = true;
        else return fail("already_decided", 409);
      } else if (rpcErr.code === "42501" || /sin permisos/i.test(msg)) {
        return fail("forbidden", 403);
      } else if (msg.includes("ticket_not_refundable")) {
        return fail("ticket_not_refundable", 409);
      } else if (/motivo/i.test(msg)) {
        return fail("note_required", 400);
      } else if (/no encontrada/i.test(msg)) {
        return fail("request_not_found", 404);
      } else {
        log.error("decide_refund_rpc_failed", { request_id: requestId, error: msg });
        return fail("internal_error", 500);
      }
    }

    if (decision === "reject") {
      await notifyRefundRejected(ctx, note);
      log.info("refund_rejected", { request_id: requestId, user_id: user.id });
      return jsonResponse({ status: "rejected" });
    }

    // Aprobada: el reembolso en Stripe con la solicitud ya actualizada.
    const fresh = await loadRefundContext(requestId);
    if ("missing" in fresh) return fail(fresh.missing, 404);
    let outcome: RefundOutcome | null = null;
    try {
      outcome = isStaleProcessing(fresh) ? await resumeStaleRefund(fresh) : await executeRefund(fresh);
    } catch (err) {
      // Stripe sin configurar: la solicitud sigue aprobada y se puede reintentar.
      log.error("refund_execute_failed", { request_id: requestId, error: String(err) });
    }
    const { data: after } = await supabaseAdmin.from("refund_requests").select("status").eq("id", requestId).maybeSingle();
    const status = (after?.status as string | undefined) ?? "approved";
    const refundError = outcome ? (outcome.ok ? null : outcome.code) : "stripe_unavailable";
    log.info("refund_approved", { request_id: requestId, user_id: user.id, retry, status, refund_error: refundError });
    return jsonResponse(refundError ? { status, refund_error: refundError } : { status });
  } catch (err) {
    log.error("decide-refund failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
