// Pasify · ai-pricing-propose (cron + on-demand)
// Para eventos próximos con tickets activos, propone subida o bajada de precio
// según velocidad de venta vs baseline.
// Inserta filas en pricing_proposals (status pending).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    // Auth: service_role (cron) o admin
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(SERVICE_KEY)) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!user) return errorResponse("forbidden", 403);
      const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" })).data;
      if (!isAdmin) return errorResponse("forbidden", 403);
    }

    const { data: killSwitch } = await supabaseAdmin.from("ai_kill_switches").select("killed").eq("capability_code", "pricing").maybeSingle();
    if (killSwitch?.killed) return errorResponse("capability_killed", 503);

    // Eventos próximos (siguientes 14 días)
    const now = new Date();
    const cutoff = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabaseAdmin
      .from("events")
      .select("id, title, date_start, capacity, tickets_sold, org_id, ticket_tiers(id, name, price_cents, sold, capacity, status, transfer_allowed)")
      .eq("status", "published")
      .gt("date_start", now.toISOString())
      .lt("date_start", cutoff)
      .limit(100);

    if (!events) return jsonResponse({ events_processed: 0, proposals_created: 0 });

    let proposals = 0;
    for (const ev of events) {
      // deno-lint-ignore no-explicit-any
      const tiers = (ev.ticket_tiers ?? []) as any as TierRow[];
      for (const tier of tiers) {
        if (tier.status !== "active") continue;
        if (tier.capacity == null) continue;
        const fillRate = tier.sold / tier.capacity;
        const hoursToEvent = (new Date(ev.date_start).getTime() - now.getTime()) / 3600_000;
        const expectedFillRate = Math.max(0, Math.min(1, 1 - hoursToEvent / 336)); // 14d → 0% sold expected
        const velocity = fillRate - expectedFillRate;

        let suggestedPrice = tier.price_cents;
        let rationale: string | null = null;
        let confidence = 0.5;

        // Sube si vende >25% más rápido de lo esperado
        if (velocity > 0.25 && fillRate > 0.3) {
          const uplift = Math.min(0.15, velocity * 0.4); // hasta +15%
          suggestedPrice = Math.round(tier.price_cents * (1 + uplift));
          rationale = `Velocidad de venta ${Math.round(velocity * 100)}% sobre baseline. Subida sugerida para optimizar revenue.`;
          confidence = Math.min(0.92, 0.6 + velocity);
        }
        // Baja si vende >25% más lento
        else if (velocity < -0.25 && hoursToEvent < 168) {
          const cut = Math.min(0.15, Math.abs(velocity) * 0.3);
          suggestedPrice = Math.round(tier.price_cents * (1 - cut));
          rationale = `Venta lenta (${Math.round(velocity * 100)}% bajo baseline). Rebaja sugerida para estimular conversión.`;
          confidence = Math.min(0.85, 0.55 + Math.abs(velocity));
        } else {
          continue; // sin cambio → no proposal
        }

        const deltaPct = ((suggestedPrice - tier.price_cents) / tier.price_cents) * 100;
        const expectedUpliftCents = Math.round((suggestedPrice - tier.price_cents) * (tier.capacity - tier.sold) * 0.7);

        // Mismo motivo que en stripe-webhook: el builder de Postgrest no tiene
        // catch(). Se envuelve en try/catch para que una propuesta que falle no
        // aborte el recorrido de los demas tiers.
        try {
        await supabaseAdmin.from("pricing_proposals").insert({
          event_id: ev.id,
          tier_id: tier.id,
          current_price_cents: tier.price_cents,
          suggested_price_cents: suggestedPrice,
          delta_pct: deltaPct,
          expected_uplift_cents: expectedUpliftCents,
          confidence,
          rationale,
          status: "pending",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }).select("id").single();
        } catch { /* propuesta descartada, seguimos con el siguiente tier */ }

        proposals++;
      }
    }

    await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: "pricing",
      action_summary: `pricing_propose run events=${events.length} proposals=${proposals}`,
      result: "ok",
      model_version: "pasify-pricing-v0.1",
    });

    logger.info("pricing_propose_completed", { events: events.length, proposals });
    return jsonResponse({ events_processed: events.length, proposals_created: proposals });
  } catch (err) {
    logger.error("ai-pricing-propose failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
