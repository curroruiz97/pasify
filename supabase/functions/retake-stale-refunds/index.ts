// Pasify · retake-stale-refunds
//
// Retoma los reembolsos atascados sin esperar a que alguien vuelva a pulsar
// en el panel (B6-09). process-refund solo admite llamadas con sesión, así que
// el trabajo interno va aquí. Lo programa pg_cron cada 10 minutos
// (schedule_retake_stale_refunds, migración 20260928160000) con la cabecera
// x-pasify-internal: solo servidor → servidor (requireServiceRole).
//
// En lotes de 10 (refunds_to_retake), uno detrás de otro:
//   processing sin reembolso de Stripe apuntado y 10 minutos sin moverse
//     → resumeStaleRefund: si Stripe llegó a crearlo lo adopta; si no, lo crea;
//   approved que nadie ejecutó (de 10 minutos a 48 horas)
//     → executeRefund, lo mismo que process-refund.
// Nunca dos reembolsos para una solicitud: _shared/refund.ts la reclama en
// una sola sentencia y busca en Stripe antes de crear. Con el reembolso hecho,
// el comprador recibe su email y su aviso como siempre.
//
// Body: {} · 200: { checked, refunded, waiting, skipped, failed, errors, batches }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { knownError, requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";
import { stripe } from "../_shared/stripe.ts";
import {
  executeRefund,
  isStaleProcessing,
  loadRefundContext,
  resumeStaleRefund,
  type RefundOutcome,
} from "../_shared/refund.ts";
import { logger } from "../_shared/logger.ts";

const BATCH_SIZE = 10;
const MAX_BATCHES = 5;
/** No se empieza otra solicitud pasado este tiempo (pg_net espera 55 s). */
const TIME_BUDGET_MS = 40_000;

interface RetakeRow {
  request_id: string;
  status: "processing" | "approved";
}

type Result = "refunded" | "waiting" | "skipped" | "failed";

/** Sin cambio que hacer: otra ejecución la tiene o ya no está atascada. */
const NOTHING_TO_DO = new Set(["already_processing", "already_refunded", "invalid_status"]);

function classify(outcome: RefundOutcome): Result {
  if (outcome.ok) return "refunded";
  // Stripe no contestó: sigue en 'processing' y se retoma en la próxima pasada.
  if (outcome.code === "stripe_unavailable") return "waiting";
  if (NOTHING_TO_DO.has(outcome.code)) return "skipped";
  return "failed";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const log = logger.child({ function: "retake-stale-refunds" });
  const started = Date.now();

  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);

    if (!stripe) {
      log.error("stripe_not_configured");
      return jsonResponse({ error: "stripe_not_configured" }, { status: 503 });
    }

    const counts: Record<Result | "errors", number> = { refunded: 0, waiting: 0, skipped: 0, failed: 0, errors: 0 };
    const seen: string[] = [];
    let batches = 0;
    let outOfTime = false;

    while (!outOfTime && batches < MAX_BATCHES) {
      const { data, error } = await supabaseAdmin.rpc("refunds_to_retake", { _limit: BATCH_SIZE, _exclude: seen });
      if (error) throw new Error(`refunds_to_retake_failed: ${error.message}`);
      const rows = (data ?? []) as RetakeRow[];
      if (rows.length === 0) break;
      batches += 1;

      for (const row of rows) {
        if (Date.now() - started > TIME_BUDGET_MS) {
          outOfTime = true;
          break;
        }
        seen.push(row.request_id);
        try {
          const ctx = await loadRefundContext(row.request_id);
          if ("missing" in ctx) {
            counts.skipped += 1;
            log.warn("retake_missing_context", { request_id: row.request_id, missing: ctx.missing });
            continue;
          }
          let outcome: RefundOutcome | null = null;
          if (ctx.rr.status === "processing" && isStaleProcessing(ctx)) {
            outcome = await resumeStaleRefund(ctx, { stripe });
          } else if (ctx.rr.status === "approved") {
            outcome = await executeRefund(ctx, { stripe });
          }
          if (!outcome) {
            counts.skipped += 1;
            continue;
          }
          const result = classify(outcome);
          counts[result] += 1;
          if (result === "refunded") {
            log.warn("retake_refunded", { request_id: row.request_id, from: row.status, stripe_refund_id: outcome.ok ? outcome.stripeRefundId : null });
          } else if (result !== "skipped") {
            log.warn("retake_not_refunded", {
              request_id: row.request_id,
              from: row.status,
              result,
              code: outcome.ok ? null : outcome.code,
            });
          }
        } catch (e) {
          counts.errors += 1;
          log.error("retake_failed", { request_id: row.request_id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (rows.length < BATCH_SIZE) break;
    }

    const summary = { checked: seen.length, ...counts, batches };
    if (seen.length > 0) log.info("retake_done", { ...summary, duration_ms: Date.now() - started, out_of_time: outOfTime });
    return jsonResponse(summary);
  } catch (err) {
    const known = knownError(err);
    if (known) log.warn("retake-stale-refunds rejected", { code: known.code });
    else log.error("retake-stale-refunds failed", { error: err instanceof Error ? err.message : String(err) });
    return safeErrorResponse(err);
  }
});
