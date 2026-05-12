// Pasify · ai-forecast-event
// Predicción de asistencia para un evento usando regresión simple sobre histórico
// + factores explicables. Persiste en forecast_predictions.
//
// Body: { event_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

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

    const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" })).data;
    const isMember = ev.org_id ? (await supabaseAdmin.rpc("is_member_of_org", { _org_id: ev.org_id })).data : false;
    if (!isAdmin && !isMember && ev.partner_id !== user.id) return errorResponse("forbidden", 403);

    const log = logger.child({ function: "ai-forecast-event", event_id });

    // Algoritmo simple: media móvil de eventos similares del mismo partner/categoria/ciudad
    // mismo dia de la semana, en últimos 6 meses.
    const eventDay = new Date(ev.date_start).getDay();
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    const { data: similar } = await supabaseAdmin
      .from("events")
      .select("id, tickets_sold, capacity, date_start, category")
      .eq("partner_id", ev.partner_id)
      .eq("city", ev.city)
      .eq("status", "past")
      .gte("date_start", sixMonthsAgo)
      .limit(50);

    let predicted = ev.capacity ? Math.floor(ev.capacity * 0.6) : 200;
    let ciLow = predicted * 0.8;
    let ciHigh = predicted * 1.1;
    let confidence = 0.5;
    const factors: Record<string, unknown> = { method: "default_fallback" };

    if (similar && similar.length >= 3) {
      const sameDow = similar.filter((s) => new Date(s.date_start).getDay() === eventDay);
      const sample = sameDow.length >= 3 ? sameDow : similar;
      const sold = sample.map((s) => s.tickets_sold ?? 0).filter((v) => v > 0);
      if (sold.length >= 3) {
        const avg = sold.reduce((a, b) => a + b, 0) / sold.length;
        const stddev = Math.sqrt(sold.reduce((s, v) => s + (v - avg) ** 2, 0) / sold.length);
        predicted = Math.floor(avg);
        ciLow = Math.max(0, Math.floor(avg - stddev));
        ciHigh = Math.floor(avg + stddev);
        confidence = Math.min(0.95, 0.5 + sold.length / 30);
        factors.method = "historical_mean_same_dow";
        factors.sample_size = sold.length;
        factors.mean = avg;
        factors.stddev = stddev;
        factors.day_of_week = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][eventDay];
      }
    }

    // Insertar prediction
    const { data: prediction } = await supabaseAdmin.from("forecast_predictions").insert({
      event_id: ev.id,
      predicted_attendance: predicted,
      ci_low: Math.floor(ciLow),
      ci_high: Math.floor(ciHigh),
      confidence,
      factors,
      model_version: "pasify-baseline-v0.1",
    }).select("*").single();

    // Audit log
    await supabaseAdmin.from("ai_audit_log").insert({
      capability_code: "forecast",
      org_id: ev.org_id,
      action_summary: `forecast event=${ev.id} pred=${predicted}`,
      result: "ok",
      model_version: "pasify-baseline-v0.1",
    });

    log.info("forecast_generated", { predicted, ciLow, ciHigh, confidence });
    return jsonResponse({ prediction });
  } catch (err) {
    logger.error("ai-forecast-event failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
