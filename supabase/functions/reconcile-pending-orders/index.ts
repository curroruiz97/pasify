// Pasify · reconcile-pending-orders
//
// Red de seguridad para los pedidos que se quedan 'pending' aunque Stripe
// los cobrara: la pestaña se cerró antes de volver de Stripe y el webhook no
// llegó (caído, o dado de alta solo en el otro modo). Antes el cron SQL los
// anulaba a las 2,5 h sin preguntar; ahora solo anula los que no tienen
// sesión o tienen más de 24 h (migración 20260927110000) y esta función
// pregunta a Stripe por el resto.
//
// En lotes de 50 (pending_orders_to_reconcile): pedidos pendientes con sesión
// ya caducados, y los de un local que ya no puede vender aunque su sesión
// siga abierta. Por cada sesión (settlePendingOrder, _shared/order-paid.ts):
//   paid    → handleOrderPaid con su livemode (mismas entradas, email y avisos
//             que el webhook);
//   open    → se caduca en Stripe y se anula el pedido;
//   expired → se anula el pedido (expire_ticket_order).
//
// Solo servidor → servidor: requireServiceRole (service role o la cabecera
// x-pasify-internal con PASIFY_INTERNAL_SECRET). La programa pg_cron + pg_net
// cada 10 minutos si Vault tiene el secreto pasify_internal_secret (ver la
// migración).
// Body: {} · 200: { checked, paid, cancelled, not_pending, processing, open, errors, batches }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";
import { stripe } from "../_shared/stripe.ts";
import { settlePendingOrder, type PendingOrderOutcome } from "../_shared/order-paid.ts";
import { logger } from "../_shared/logger.ts";

const BATCH_SIZE = 50;
const MAX_BATCHES = 10;
/** Pedidos a la vez contra Stripe. */
const CONCURRENCY = 5;
/** Se deja de empezar pedidos nuevos pasado este tiempo (la llamada de pg_net espera 55 s). */
const TIME_BUDGET_MS = 45_000;

interface ReconcileRow {
  order_id: string;
  stripe_session_id: string;
  reason: "expired" | "org_suspended";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const log = logger.child({ function: "reconcile-pending-orders" });
  const started = Date.now();

  try {
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    requireServiceRole(req);

    if (!stripe) {
      log.error("stripe_not_configured");
      return jsonResponse({ error: "stripe_not_configured" }, { status: 503 });
    }

    const counts: Record<PendingOrderOutcome | "errors", number> = {
      cancelled: 0,
      paid: 0,
      not_pending: 0,
      processing: 0,
      open: 0,
      errors: 0,
    };
    const seen: string[] = [];
    let batches = 0;
    let outOfTime = false;

    while (!outOfTime && batches < MAX_BATCHES) {
      const { data, error } = await supabaseAdmin.rpc("pending_orders_to_reconcile", {
        _limit: BATCH_SIZE,
        _exclude: seen,
      });
      if (error) throw new Error(`pending_orders_to_reconcile_failed: ${error.message}`);
      const rows = (data ?? []) as ReconcileRow[];
      if (rows.length === 0) break;
      batches += 1;

      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        if (Date.now() - started > TIME_BUDGET_MS) {
          outOfTime = true;
          break;
        }
        const chunk = rows.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((row) =>
            settlePendingOrder(
              { id: row.order_id, stripe_session_id: row.stripe_session_id },
              { stripe, source: "reconcile-pending-orders", cancelAs: "expired" },
            )
          ),
        );
        results.forEach((r, idx) => {
          const row = chunk[idx];
          seen.push(row.order_id);
          if (r.status === "fulfilled") {
            counts[r.value] += 1;
            if (r.value === "paid") {
              // El webhook no llegó: conviene mirar por qué.
              log.warn("reconcile_recovered_paid_order", { order_id: row.order_id, reason: row.reason });
            }
          } else {
            counts.errors += 1;
            log.error("reconcile_order_failed", {
              order_id: row.order_id,
              reason: row.reason,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        });
      }
      if (rows.length < BATCH_SIZE) break;
    }

    const summary = { checked: seen.length, ...counts, batches };
    log.info("reconcile_done", { ...summary, duration_ms: Date.now() - started, out_of_time: outOfTime });
    return jsonResponse(summary);
  } catch (err) {
    log.error("reconcile-pending-orders failed", { error: err instanceof Error ? err.message : String(err) });
    return safeErrorResponse(err);
  }
});
