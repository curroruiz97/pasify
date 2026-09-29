// Pasify · ai-forecast-event
// Previsión de venta de un evento a partir del histórico del propio local
// (media de eventos comparables). No es un modelo de IA: es estadística
// sencilla y así se presenta en el panel ("Previsión"). Persiste en
// forecast_predictions.
//
//   * Muestra: eventos pasados con ventas del mismo local (organización, o
//     el mismo creador si el evento no tiene organización) y ciudad, de los
//     últimos 6 meses; si hay 3 o más del mismo día de la semana, solo esos.
//   * Previsión = media de lo vendido, recortada al aforo del evento y nunca
//     por debajo de lo ya vendido.
//   * Rango = intervalo de predicción del 80 % para un evento nuevo
//     (media ± t · s · √(1 + 1/n), con la t de Student), no ±1σ.
//   * Confianza = 1 − coeficiente de variación (s / media) de la muestra:
//     cuanto más se parecen entre sí los eventos comparables, más fiable.
//   * Con menos de 3 eventos comparables no se inventa ninguna cifra: se
//     guarda una fila `insufficient_history` sin previsión (las versiones
//     anteriores del panel la enseñan como "aún no hay histórico").
//
// Body: { event_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin, callerIsOrgMember } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";

const MODEL_VERSION = "pasify-historico-v0.2";
const MIN_SAMPLE = 3;
const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** t de Student de dos colas al 80 % (cuantil 0,90), por grados de libertad. */
const T_80: Array<[number, number]> = [
  [1, 3.078], [2, 1.886], [3, 1.638], [4, 1.533], [5, 1.476], [6, 1.44], [7, 1.415], [8, 1.397],
  [9, 1.383], [10, 1.372], [12, 1.356], [15, 1.341], [20, 1.325], [25, 1.316], [30, 1.31],
  [40, 1.303], [60, 1.296],
];

/** Entre dos filas de la tabla se toma la de menos grados (rango más ancho). */
const tQuantile80 = (df: number): number => {
  if (df > 60) return 1.2816;
  let t = T_80[0][1];
  for (const [k, v] of T_80) if (k <= df) t = v;
  return t;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { event_id } = await req.json();
    if (!event_id) return errorResponse("invalid_payload", 400);

    const { data: killSwitch } = await supabaseAdmin.from("ai_kill_switches").select("killed").eq("capability_code", "forecast").maybeSingle();
    if (killSwitch?.killed) return errorResponse("capability_killed", 503);

    // Permisos: member del org del evento o admin
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("id, title, partner_id, org_id, date_start, capacity, tickets_sold, city, category")
      .eq("id", event_id)
      .maybeSingle();
    if (!ev) return errorResponse("event_not_found", 404);

    // is_member_of_org usa auth.uid(): con el cliente admin daba siempre false
    // y solo pasaban el dueño del evento y los admins. Va con el JWT del usuario.
    const allowed =
      ev.partner_id === user.id ||
      (await isPlatformAdmin(user.id)) ||
      (!!ev.org_id && (await callerIsOrgMember(req, ev.org_id)));
    if (!allowed) return errorResponse("forbidden", 403);

    const log = logger.child({ function: "ai-forecast-event", event_id });

    const eventDay = new Date(ev.date_start).getDay();
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    // Eventos comparables del mismo local: por organización (así cuentan los
    // que creó cualquier miembro del equipo) o, sin organización, del mismo
    // creador. Sin ninguno de los dos no hay histórico.
    const base = supabaseAdmin
      .from("events")
      .select("id, tickets_sold, capacity, date_start, category")
      .eq("city", ev.city)
      .eq("status", "past")
      .neq("id", ev.id)
      .gte("date_start", sixMonthsAgo);
    const scoped = ev.org_id
      ? base.eq("org_id", ev.org_id)
      : ev.partner_id
        ? base.eq("partner_id", ev.partner_id)
        : null;
    const { data: similar, error: similarErr } = scoped
      ? await scoped.order("date_start", { ascending: false }).limit(50)
      : { data: [], error: null };
    if (similarErr) throw similarErr;

    const withSales = (similar ?? []).filter((s) => (s.tickets_sold ?? 0) > 0);
    const sameDow = withSales.filter((s) => new Date(s.date_start).getDay() === eventDay);
    const useSameDow = sameDow.length >= MIN_SAMPLE;
    const sample = (useSameDow ? sameDow : withSales).map((s) => s.tickets_sold as number);

    const capacity = typeof ev.capacity === "number" && ev.capacity > 0 ? ev.capacity : null;
    const soldNow = Math.max(0, ev.tickets_sold ?? 0);

    let row: Record<string, unknown>;
    if (sample.length < MIN_SAMPLE) {
      // Sin histórico suficiente: ninguna cifra inventada.
      row = {
        event_id: ev.id,
        predicted_attendance: 0,
        ci_low: null,
        ci_high: null,
        confidence: null,
        factors: {
          method: "insufficient_history",
          comparable_events: sample.length,
          required: MIN_SAMPLE,
        },
        model_version: MODEL_VERSION,
      };
    } else {
      const n = sample.length;
      const mean = sample.reduce((a, b) => a + b, 0) / n;
      // Desviación típica muestral (n − 1).
      const stddev = Math.sqrt(sample.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
      const cv = mean > 0 ? stddev / mean : 1;
      const halfWidth = tQuantile80(n - 1) * stddev * Math.sqrt(1 + 1 / n);

      // Recorte: nunca por encima del aforo ni por debajo de lo ya vendido.
      const upper = capacity ?? Number.POSITIVE_INFINITY;
      const bounded = (v: number) => Math.round(clamp(v, Math.min(soldNow, upper), upper));
      const predicted = bounded(mean);
      const ciLow = bounded(mean - halfWidth);
      const ciHigh = bounded(mean + halfWidth);
      const confidence = Number(clamp(1 - cv, 0.05, 0.95).toFixed(3));

      row = {
        event_id: ev.id,
        predicted_attendance: predicted,
        ci_low: ciLow,
        ci_high: ciHigh,
        confidence,
        factors: {
          method: "historical_mean_same_dow",
          sample_size: n,
          same_day_of_week: useSameDow,
          mean,
          stddev,
          coefficient_of_variation: cv,
          interval: "prediccion_80",
          capped_at_capacity: capacity !== null && mean > capacity,
          sold_at_prediction: soldNow,
          ...(useSameDow ? { day_of_week: DAY_NAMES[eventDay] } : {}),
        },
        model_version: MODEL_VERSION,
      };
    }

    const { data: prediction, error: insertErr } = await supabaseAdmin
      .from("forecast_predictions")
      .insert(row)
      .select("*")
      .single();
    if (insertErr) throw insertErr;

    await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: "forecast",
      org_id: ev.org_id,
      action_summary:
        sample.length < MIN_SAMPLE
          ? `forecast event=${ev.id} sin histórico (${sample.length} comparables)`
          : `forecast event=${ev.id} pred=${row.predicted_attendance}`,
      result: "ok",
      model_version: MODEL_VERSION,
    });

    log.info("forecast_generated", {
      method: (row.factors as { method: string }).method,
      predicted: row.predicted_attendance,
      ciLow: row.ci_low,
      ciHigh: row.ci_high,
      confidence: row.confidence,
    });
    return jsonResponse({ prediction });
  } catch (err) {
    logger.error("ai-forecast-event failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
