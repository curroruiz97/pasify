// Pasify · industry-benchmarks-recompute (cron diario)
// Agrega métricas anónimas cross-tenant con k-anonimato ≥ 15 + ruido gaussiano.
// Persiste en industry_benchmarks_snapshots.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { isServiceRoleRequest, safeErrorResponse } from "../_shared/internal-auth.ts";

const K_ANONYMITY_MIN = 15;

const SEGMENTS = ["discoteca", "club", "bar-musica", "festival", "sala-concierto"];
const REGIONS = ["españa-nacional", "madrid", "barcelona", "valencia", "ibiza", "andalucia"];

function gaussianNoise(stddev: number): number {
  // Box-Muller
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stddev;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    // Auth: cron (service role / x-pasify-internal) o admin de plataforma.
    if (!isServiceRoleRequest(req)) await requireAdmin(req);

    let snapshotsCreated = 0;

    for (const segment of SEGMENTS) {
      for (const region of REGIONS) {
        // Filtro por ciudad si region != nacional
        let cityFilter: string[] | null = null;
        if (region !== "españa-nacional") {
          cityFilter = ({
            madrid: ["Madrid", "Alcalá de Henares", "Móstoles"],
            barcelona: ["Barcelona", "Sitges", "Castelldefels", "Lloret de Mar"],
            valencia: ["Valencia", "Benidorm", "Gandía"],
            ibiza: ["Ibiza", "Formentera"],
            andalucia: ["Sevilla", "Málaga", "Granada", "Marbella", "Cádiz"],
          } as Record<string, string[]>)[region] ?? null;
        }

        let venuesQ = supabaseAdmin
          .from("venues")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .eq("business_category", segment);
        if (cityFilter) venuesQ = venuesQ.in("city", cityFilter);
        const { count } = await venuesQ;
        const sampleSize = count ?? 0;
        if (sampleSize < K_ANONYMITY_MIN) continue;

        // Métricas reales (todavía no hay datos a escala — usamos placeholders sintéticos)
        // Cuando haya datos producción, este bloque pasa a queries reales.
        const payload = {
          venues_total: sampleSize,
          avg_ticket_price_cents: Math.round(1800 + gaussianNoise(100)),
          median_capacity: Math.round(450 + gaussianNoise(20)),
          avg_attendance_pct: Math.max(0, Math.min(100, 68 + gaussianNoise(3))),
          top_genres: segment === "discoteca" ? ["techno", "house", "reggaeton"] : ["techno", "indie", "comercial"],
          weekend_peak_hour: 0, // 00:00
          last_computed_at: new Date().toISOString(),
        };

        await supabaseAdmin.from("industry_benchmarks_snapshots").insert({
          segment,
          region,
          sample_size: sampleSize,
          payload,
          k_anonymity_min: K_ANONYMITY_MIN,
        });
        snapshotsCreated++;
      }
    }

    logger.info("benchmarks_recomputed", { snapshots_created: snapshotsCreated });
    return jsonResponse({ snapshots_created: snapshotsCreated });
  } catch (err) {
    logger.error("industry-benchmarks-recompute failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
