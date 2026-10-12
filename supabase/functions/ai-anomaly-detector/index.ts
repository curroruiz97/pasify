// Pasify · ai-anomaly-detector (cron diario + «ejecutar ahora» de un admin)
//
// Mira cómo se han portado las capacidades de IA en las últimas 24 h y abre una
// anomalía en ai_anomalies cuando se salen de lo que ellas mismas declaran en
// ai_capabilities. Solo mide lo que la IA deja escrito en ai_audit_log:
//
//   · Errores: % de ejecuciones con result = 'failed' sobre el total.
//       Más de 3 × error_target_pct  → high
//       Más de 10 × error_target_pct → critical
//     Pide muestra (≥ 20 ejecuciones) y al menos 3 fallos: con un objetivo de
//     0,1 % un único fallo entre 20 ejecuciones ya sería un 5 %.
//   · Latencia: mediana de latency_ms de las ejecuciones que no fallaron (las
//     que fallan por timeout contarían dos veces) y que la registran.
//       Más de 2 × latency_target_ms → medium
//       Más de 5 × latency_target_ms → high
//     Pide al menos 10 mediciones.
//
// Cómo se comporta:
//   - No duplica: si ya hay una anomalía abierta (resolved = false) de la misma
//     capacidad y tipo no abre otra; solo la sube de gravedad si ahora es peor.
//   - No las cierra: resolverlas (con su nota) es decisión de un admin.
//   - Salta las capacidades paradas (kill switch, status killed/paused/
//     deprecated). Si se reactivan, solo cuenta lo ocurrido desde entonces.
//   - Avisa a los admins de plataforma solo cuando abre o sube una anomalía
//     (categoría system, prioridad high como mucho: la crítica manda SMS).
//   - No usa ningún modelo ni servicio externo: es SQL sobre el registro.
//
// Autorización: servicio (service role o x-pasify-internal, lo usa el cron) o
// admin de plataforma. POST con cuerpo opcional:
//   { "dry_run": true }      calcula y devuelve, sin escribir ni avisar
//   { "window_hours": 48 }   ventana de 1 a 168 h (por defecto 24)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { HttpError, isServiceRoleRequest, safeErrorResponse } from "../_shared/internal-auth.ts";
import { enqueueNotification, platformAdminIds } from "../_shared/notify.ts";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;

/** Ejecuciones mínimas para hablar de una tasa de errores. */
export const MIN_RUNS = 20;
/** Fallos mínimos: uno o dos sueltos no son una tendencia. */
export const MIN_FAILURES = 3;
/** Mediciones de latencia mínimas para fiarse de la mediana. */
export const MIN_LATENCY_SAMPLES = 10;
/** Un objetivo de errores de 0 % se trata como 0,1 %: con 0 cualquier fallo sería «crítico». */
export const MIN_ERROR_TARGET_PCT = 0.1;
/** Múltiplos del objetivo a partir de los que se abre la anomalía. */
export const ERROR_HIGH_X = 3;
export const ERROR_CRITICAL_X = 10;
export const LATENCY_MEDIUM_X = 2;
export const LATENCY_HIGH_X = 5;
/** Cuántas mediciones de latencia se leen como mucho por capacidad (las más recientes). */
const LATENCY_SAMPLE_LIMIT = 1000;

type Severity = "medium" | "high" | "critical";
type FindingKind = "error_rate" | "latency";

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface CapabilityRow {
  code: string;
  name: string;
  status: string;
  latency_target_ms: number | null;
  error_target_pct: number | null;
}

export interface Finding {
  capability: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
}

interface OpenAnomaly {
  id: string;
  capability_code: string;
  severity: string;
  payload: { kind?: unknown } | null;
}

/** Percentil p (0-1) de una lista YA ordenada de menor a mayor (rango más cercano). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const fmtPct = (n: number) => n.toFixed(1).replace(".", ",");
const fmtInt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** ¿Se sale la tasa de errores? null si no hay muestra suficiente o está dentro del objetivo. */
export function evaluateErrorRate(
  cap: CapabilityRow,
  total: number,
  failed: number,
  windowHours: number,
): Finding | null {
  const target = cap.error_target_pct;
  if (target == null || !Number.isFinite(target) || target < 0) return null;
  if (total < MIN_RUNS || failed < MIN_FAILURES) return null;

  const effectiveTarget = Math.max(target, MIN_ERROR_TARGET_PCT);
  const errorPct = (failed / total) * 100;
  let severity: Severity;
  if (errorPct > effectiveTarget * ERROR_CRITICAL_X) severity = "critical";
  else if (errorPct > effectiveTarget * ERROR_HIGH_X) severity = "high";
  else return null;

  return {
    capability: cap.code,
    kind: "error_rate",
    severity,
    title: `Tasa de errores del ${fmtPct(errorPct)} % en ${cap.name}`,
    detail:
      `${failed} de ${total} ejecuciones fallidas en las últimas ${windowHours} h ` +
      `(objetivo: ${fmtPct(target)} %).`,
    payload: {
      kind: "error_rate",
      window_hours: windowHours,
      total,
      failed,
      error_pct: Number(errorPct.toFixed(3)),
      target_pct: target,
    },
  };
}

/** ¿Se sale la latencia? null si hay pocas mediciones o está dentro del objetivo. */
export function evaluateLatency(cap: CapabilityRow, latenciesMs: number[], windowHours: number): Finding | null {
  const target = cap.latency_target_ms;
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  if (latenciesMs.length < MIN_LATENCY_SAMPLES) return null;

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  let severity: Severity;
  if (p50 > target * LATENCY_HIGH_X) severity = "high";
  else if (p50 > target * LATENCY_MEDIUM_X) severity = "medium";
  else return null;

  return {
    capability: cap.code,
    kind: "latency",
    severity,
    title: `Latencia mediana de ${fmtInt(p50)} ms en ${cap.name}`,
    detail:
      `Mediana ${fmtInt(p50)} ms y p95 ${fmtInt(p95)} ms sobre ${sorted.length} ejecuciones en las últimas ` +
      `${windowHours} h (objetivo: ${fmtInt(target)} ms).`,
    payload: {
      kind: "latency",
      window_hours: windowHours,
      samples: sorted.length,
      p50_ms: p50,
      p95_ms: p95,
      target_ms: target,
    },
  };
}

interface Options {
  dryRun: boolean;
  windowHours: number;
}

/** Cuerpo opcional del POST: vacío vale (el cron manda `{}`). */
async function readOptions(req: Request): Promise<Options> {
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "invalid_json");
    }
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") throw new HttpError(400, "invalid_dry_run");
  let windowHours = DEFAULT_WINDOW_HOURS;
  if (body.window_hours !== undefined) {
    const w = body.window_hours;
    if (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > MAX_WINDOW_HOURS) {
      throw new HttpError(400, "invalid_window_hours");
    }
    windowHours = w;
  }
  return { dryRun: body.dry_run === true, windowHours };
}

async function countRuns(code: string, sinceIso: string, onlyFailed: boolean): Promise<number> {
  let query = supabaseAdmin
    .from("ai_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("capability_code", code)
    .gte("created_at", sinceIso);
  if (onlyFailed) query = query.eq("result", "failed");
  const { count, error } = await query;
  if (error) throw new Error(`ai_audit_log count (${code}): ${error.message}`);
  return count ?? 0;
}

async function loadLatencies(code: string, sinceIso: string): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_audit_log")
    .select("latency_ms")
    .eq("capability_code", code)
    .neq("result", "failed")
    .gte("created_at", sinceIso)
    .gt("latency_ms", 0)
    .order("created_at", { ascending: false })
    .limit(LATENCY_SAMPLE_LIMIT);
  if (error) throw new Error(`ai_audit_log latency (${code}): ${error.message}`);
  return (data ?? []).map((r) => Number(r.latency_ms)).filter((n) => Number.isFinite(n) && n > 0);
}

interface CapabilityReport {
  capability: string;
  skipped?: string;
  runs?: number;
  failed?: number;
  latency_samples?: number;
  findings?: Array<{ kind: FindingKind; severity: Severity; action: "create" | "escalate" | "already_open" | "failed" }>;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405, "method_not_allowed");
    // Cron (service role / x-pasify-internal) o admin de plataforma.
    if (!isServiceRoleRequest(req)) await requireAdmin(req);

    const { dryRun, windowHours } = await readOptions(req);
    const now = Date.now();
    const windowStart = now - windowHours * 3_600_000;

    const { data: capabilities, error: capErr } = await supabaseAdmin
      .from("ai_capabilities")
      .select("code, name, status, latency_target_ms, error_target_pct")
      .order("code");
    if (capErr) throw new Error(`ai_capabilities: ${capErr.message}`);

    // Si no se puede leer el interruptor no se sigue: mejor parar que juzgar a ciegas.
    const { data: switches, error: switchErr } = await supabaseAdmin
      .from("ai_kill_switches")
      .select("capability_code, killed, updated_at");
    if (switchErr) throw new Error(`ai_kill_switches: ${switchErr.message}`);
    const switchByCode = new Map((switches ?? []).map((s) => [s.capability_code as string, s]));

    const { data: openRows, error: openErr } = await supabaseAdmin
      .from("ai_anomalies")
      .select("id, capability_code, severity, payload")
      .eq("resolved", false)
      .limit(1000);
    if (openErr) throw new Error(`ai_anomalies: ${openErr.message}`);
    const openByKey = new Map<string, OpenAnomaly>();
    for (const row of (openRows ?? []) as OpenAnomaly[]) {
      const kind = row.payload?.kind;
      if (typeof kind === "string") openByKey.set(`${row.capability_code}:${kind}`, row);
    }

    const reports: CapabilityReport[] = [];
    const changes: Finding[] = [];
    let created = 0;
    let escalated = 0;
    let alreadyOpen = 0;
    let failedWrites = 0;

    for (const cap of (capabilities ?? []) as CapabilityRow[]) {
      const report: CapabilityReport = { capability: cap.code };
      reports.push(report);

      const sw = switchByCode.get(cap.code);
      if (sw?.killed) {
        report.skipped = "kill_switch";
        continue;
      }
      if (["killed", "paused", "deprecated"].includes(cap.status)) {
        report.skipped = `status_${cap.status}`;
        continue;
      }

      // Si la capacidad se reactivó hace poco, lo anterior no cuenta.
      let since = windowStart;
      if (sw?.updated_at) {
        const switchedAt = Date.parse(sw.updated_at as string);
        if (Number.isFinite(switchedAt) && switchedAt > since) since = switchedAt;
      }
      const sinceIso = new Date(since).toISOString();

      const total = await countRuns(cap.code, sinceIso, false);
      report.runs = total;

      const findings: Finding[] = [];
      if (cap.error_target_pct != null && total >= MIN_RUNS) {
        const failed = await countRuns(cap.code, sinceIso, true);
        report.failed = failed;
        const f = evaluateErrorRate(cap, total, failed, windowHours);
        if (f) findings.push(f);
      }
      if (cap.latency_target_ms != null) {
        const latencies = await loadLatencies(cap.code, sinceIso);
        report.latency_samples = latencies.length;
        const f = evaluateLatency(cap, latencies, windowHours);
        if (f) findings.push(f);
      }

      for (const f of findings) {
        const existing = openByKey.get(`${f.capability}:${f.kind}`);
        let action: "create" | "escalate" | "already_open" | "failed";
        if (!existing) action = "create";
        else if ((SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) action = "escalate";
        else action = "already_open";

        if (action === "already_open") {
          alreadyOpen++;
        } else if (!dryRun) {
          const { error: writeErr } = action === "create"
            ? await supabaseAdmin.from("ai_anomalies").insert({
              capability_code: f.capability,
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              payload: f.payload,
            })
            : await supabaseAdmin.from("ai_anomalies").update({
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              payload: f.payload,
            }).eq("id", existing!.id).eq("resolved", false);
          if (writeErr) {
            failedWrites++;
            action = "failed";
            logger.error("anomaly_write_failed", { capability: f.capability, kind: f.kind, error: writeErr.message, code: writeErr.code });
          } else if (action === "create") {
            created++;
            changes.push(f);
          } else {
            escalated++;
            changes.push(f);
          }
        } else if (action === "create") {
          created++;
        } else {
          escalated++;
        }
        (report.findings ??= []).push({ kind: f.kind, severity: f.severity, action });
      }
    }

    // Avisar a los admins de lo nuevo (no de lo que ya estaba abierto).
    let notified = 0;
    if (!dryRun && changes.length > 0) {
      const adminIds = await platformAdminIds();
      const worst = changes.some((c) => c.severity === "high" || c.severity === "critical");
      const body = changes.slice(0, 3).map((c) => c.title).join(" · ") +
        (changes.length > 3 ? ` · y ${changes.length - 3} más` : "");
      const results = await Promise.allSettled(adminIds.map((userId) =>
        enqueueNotification({
          user_id: userId,
          category: "system",
          kind: "ai_anomaly_detected",
          title: changes.length === 1 ? "Anomalía de IA detectada" : "Anomalías de IA detectadas",
          body,
          link: "/#/admin",
          // Nunca «critical»: esa prioridad manda SMS.
          priority: worst ? "high" : "normal",
          payload: { anomalies: changes.map((c) => ({ capability: c.capability, kind: c.kind, severity: c.severity })) },
        })
      ));
      notified = results.filter((r) => r.status === "fulfilled").length;
      if (notified < adminIds.length) logger.warn("anomaly_notifications_partial", { admins: adminIds.length, notified });
    }

    logger.info("anomaly_detector_run", {
      dry_run: dryRun,
      window_hours: windowHours,
      capabilities: reports.length,
      created,
      escalated,
      already_open: alreadyOpen,
      failed_writes: failedWrites,
      notified,
    });
    return jsonResponse({
      ok: failedWrites === 0,
      dry_run: dryRun,
      window_hours: windowHours,
      anomalies_created: created,
      anomalies_escalated: escalated,
      already_open: alreadyOpen,
      failed_writes: failedWrites,
      admins_notified: notified,
      capabilities: reports,
    }, { status: failedWrites === 0 ? 200 : 500 });
  } catch (err) {
    logger.error("ai-anomaly-detector failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
