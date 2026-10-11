// Pasify · ai-pricing-propose (cron + on-demand)
// Para eventos próximos con tickets activos, propone subida o bajada de precio
// según velocidad de venta vs baseline.
// Inserta filas en pricing_proposals (status pending).
//
// Qué no propone (los saltos por ventas o por propuesta pendiente se cuentan en
// el log de la pasada):
//   - Tipos gratis o con un precio que Stripe no cobra (menos de 0,50 €), ni una
//     rebaja que deje un tipo por debajo de ese mínimo; ver suggestion.ts.
//   - Tipos con entradas vendidas (pagadas, usadas o reembolsadas): el editor
//     bloquea su precio y el trigger de ticket_tiers impide cambiarlo, así que
//     apply_pricing_proposal fallaría al aplicarla.
//   - Tipos que ya tienen una propuesta pendiente: el índice único
//     pricing_proposals_one_pending_per_tier admite una por tipo.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { isServiceRoleRequest, safeErrorResponse } from "../_shared/internal-auth.ts";
import { suggestPrice } from "./suggestion.ts";

interface TierRow {
  id: string;
  event_id: string;
  name: string;
  price_cents: number;
  sold: number;
  capacity: number | null;
  status: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    // Auth: cron (service role / x-pasify-internal) o admin de plataforma.
    // Los locales reciben 403: PartnerDynamicPricing ya lo explica en la UI.
    if (!isServiceRoleRequest(req)) await requireAdmin(req);

    const { data: killSwitch, error: killSwitchErr } = await supabaseAdmin.from("ai_kill_switches").select("killed").eq("capability_code", "pricing").maybeSingle();
    // Si no se puede leer el interruptor no se sigue: mejor parar que saltárselo.
    if (killSwitchErr) throw new Error(`ai_kill_switches: ${killSwitchErr.message}`);
    if (killSwitch?.killed) return errorResponse("capability_killed", 503);

    // Eventos próximos (siguientes 14 días)
    const now = new Date();
    const cutoff = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Una propuesta que llega a su caducidad sin que nadie la decida sigue en
    // `pending` (apply_pricing_proposal no puede dejarla en `expired`: el RAISE
    // que sigue deshace el UPDATE) y, con el índice único, impediría proponer
    // otra para ese tipo. Se cierran aquí, antes de proponer.
    const { error: expireErr } = await supabaseAdmin
      .from("pricing_proposals")
      .update({ status: "expired", decided_at: now.toISOString() })
      .eq("status", "pending")
      .lt("expires_at", now.toISOString());
    if (expireErr) logger.error("pricing_expire_stale_failed", { error: expireErr.message, code: expireErr.code });

    const { data: events, error: eventsErr } = await supabaseAdmin
      .from("events")
      .select("id, title, date_start, capacity, tickets_sold, org_id, ticket_tiers(id, name, price_cents, sold, capacity, status, transfer_allowed)")
      .eq("status", "published")
      .gt("date_start", now.toISOString())
      .lt("date_start", cutoff)
      .limit(100);

    // Un fallo de la consulta no es "0 eventos": se responde como error.
    if (eventsErr) throw new Error(`events: ${eventsErr.message}`);
    if (!events) return jsonResponse({ events_processed: 0, proposals_created: 0 });

    // Solo se cuentan las propuestas que se guardaron de verdad.
    let proposals = 0;
    let skippedWithSales = 0;
    let skippedPending = 0;
    let failed = 0;
    for (const ev of events) {
      // deno-lint-ignore no-explicit-any
      const tiers = (ev.ticket_tiers ?? []) as any as TierRow[];
      for (const tier of tiers) {
        if (tier.status !== "active") continue;
        if (tier.capacity == null) continue;
        const hoursToEvent = (new Date(ev.date_start).getTime() - now.getTime()) / 3600_000;
        const suggestion = suggestPrice(tier, hoursToEvent);
        if (!suggestion) continue; // sin cambio, gratis o sin margen → no proposal

        // El builder de Postgrest devuelve el error de la consulta en `error` en
        // vez de lanzarlo (y puede lanzar si falla la red): se miran las dos vías,
        // y una propuesta que falle no aborta el recorrido de los demas tiers.
        try {
          // Con entradas vendidas el precio no se puede cambiar (editor y trigger
          // de ticket_tiers): la propuesta no se podría aplicar. Mismos estados
          // que tier_has_sales().
          const { data: sales, error: salesErr } = await supabaseAdmin
            .from("tickets")
            .select("id")
            .eq("tier_id", tier.id)
            .in("status", ["paid", "used", "refunded"])
            .limit(1);
          if (salesErr) {
            failed++;
            logger.error("pricing_sales_check_failed", { event_id: ev.id, tier_id: tier.id, error: salesErr.message, code: salesErr.code });
            continue;
          }
          if (sales && sales.length > 0) {
            skippedWithSales++;
            continue;
          }

          const { error: insertErr } = await supabaseAdmin.from("pricing_proposals").insert({
            event_id: ev.id,
            tier_id: tier.id,
            current_price_cents: tier.price_cents,
            suggested_price_cents: suggestion.suggestedPrice,
            delta_pct: suggestion.deltaPct,
            expected_uplift_cents: suggestion.expectedUpliftCents,
            confidence: suggestion.confidence,
            rationale: suggestion.rationale,
            status: "pending",
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }).select("id").single();
          if (insertErr) {
            // 23505: el índice único (una pendiente por tipo) → ya hay una vigente.
            if (insertErr.code === "23505") {
              skippedPending++;
              continue;
            }
            failed++;
            logger.error("pricing_proposal_insert_failed", { event_id: ev.id, tier_id: tier.id, error: insertErr.message, code: insertErr.code });
            continue;
          }
        } catch (err) {
          failed++;
          logger.error("pricing_proposal_failed", { event_id: ev.id, tier_id: tier.id, error: String(err) });
          continue;
        }

        proposals++;
      }
    }

    const { error: auditErr } = await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: "pricing",
      action_summary: `pricing_propose run events=${events.length} proposals=${proposals} skipped_with_sales=${skippedWithSales} skipped_pending=${skippedPending} failed=${failed}`,
      result: failed > 0 ? "failed" : "ok",
      error_message: failed > 0 ? `${failed} propuestas no se pudieron guardar` : null,
      model_version: "pasify-pricing-v0.1",
    });
    // Las propuestas ya están guardadas: un fallo del registro no tumba la respuesta.
    if (auditErr) logger.error("pricing_audit_log_failed", { error: auditErr.message, code: auditErr.code });

    logger.info("pricing_propose_completed", {
      events: events.length,
      proposals,
      skipped_with_sales: skippedWithSales,
      skipped_pending: skippedPending,
      failed,
    });
    return jsonResponse({ events_processed: events.length, proposals_created: proposals });
  } catch (err) {
    logger.error("ai-pricing-propose failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
