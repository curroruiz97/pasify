// Pasify · ai-anomaly-detector (cron diario)
// Detecta drift en métricas AI por capability y crea ai_anomalies si fuera de tolerancia.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { enqueueNotification } from "../_shared/notify.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(SERVICE_KEY)) {
      const { data: userData } = await supabaseAdmin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (!userData.user) return errorResponse("forbidden", 403);
      const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" })).data;
      if (!isAdmin) return errorResponse("forbidden", 403);
    }

    const { data: capabilities } = await supabaseAdmin
      .from("ai_capabilities")
      .select("code, precision_target, latency_target_ms, error_target_pct");

    let anomaliesCreated = 0;

    for (const cap of capabilities ?? []) {
      // Últimas 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: audits } = await supabaseAdmin
        .from("ai_audit_log")
        .select("result, latency_ms")
        .eq("capability_code", cap.code)
        .gt("created_at", since);

      const total = audits?.length ?? 0;
      if (total < 10) continue;

      const failures = audits?.filter((a) => a.result === "failed").length ?? 0;
      const errorPct = (failures / total) * 100;
      const latencies = (audits ?? []).map((a) => a.latency_ms ?? 0).filter((l) => l > 0);
      const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

      // Detección error rate spike
      if (cap.error_target_pct != null && errorPct > cap.error_target_pct * 3) {
        await supabaseAdmin.from("ai_anomalies").insert({
          capability_code: cap.code,
          severity: errorPct > cap.error_target_pct * 10 ? "critical" : "high",
          title: `Error rate ${errorPct.toFixed(2)}% en ${cap.code}`,
          detail: `Target: ${cap.error_target_pct}% · Actual: ${errorPct.toFixed(2)}% sobre ${total} ejecuciones`,
          payload: { total, failures, error_pct: errorPct, target: cap.error_target_pct },
        });
        anomaliesCreated++;
      }

      // Detección latency spike
      if (cap.latency_target_ms != null && avgLatency > cap.latency_target_ms * 2) {
        await supabaseAdmin.from("ai_anomalies").insert({
          capability_code: cap.code,
          severity: avgLatency > cap.latency_target_ms * 5 ? "high" : "medium",
          title: `Latencia ${Math.round(avgLatency)}ms en ${cap.code}`,
          detail: `Target: ${cap.latency_target_ms}ms · P50 actual: ${Math.round(avgLatency)}ms`,
          payload: { avg_latency_ms: avgLatency, target: cap.latency_target_ms, sample_size: latencies.length },
        });
        anomaliesCreated++;
      }
    }

    // Notificar admins si críticas
    if (anomaliesCreated > 0) {
      const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
      for (const a of admins ?? []) {
        await enqueueNotification({
          user_id: a.user_id,
          category: "system",
          kind: "ai_anomaly_detected",
          title: "Anomalías IA detectadas",
          body: `${anomaliesCreated} nuevas anomalías abiertas en AI Safety Console.`,
          link: "/#/admin",
          priority: "high",
        }).catch(() => null);
      }
    }

    logger.info("anomaly_detector_run", { anomalies_created: anomaliesCreated });
    return jsonResponse({ anomalies_created: anomaliesCreated });
  } catch (err) {
    logger.error("ai-anomaly-detector failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
