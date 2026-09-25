// Pasify · health-check
//
// Público (smoke de CI, monitorización externa): solo la base de datos, sin
// detalles de los errores.
//
// Completo, solo servidor → servidor (service role o la cabecera
// x-pasify-internal): lo programa pg_cron cada 15 minutos
// (schedule_health_check, migración 20260928160000). Mira la base de datos,
// Stripe, el email (Resend), push (FCM), Storage y la cola de avisos; guarda la
// pasada (record_service_status) y, si un servicio deja de funcionar o vuelve,
// avisa a cada admin de plataforma con un aviso ops_alert / ops_recovered, que
// dispatch-notification manda también por email. Solo al cambiar de estado,
// no en cada pasada. Antes nadie lo ejecutaba en modo completo y el email
// estuvo semanas caído sin que nadie se enterase.
// verify_jwt = false.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { isServiceRoleRequest } from "../_shared/internal-auth.ts";
import { enqueueNotification, platformAdminIds } from "../_shared/notify.ts";
import { EMAIL_FROM } from "../_shared/resend.ts";
import { logger } from "../_shared/logger.ts";

type Status = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";
interface ServiceCheck { service: string; status: Status; latency_ms?: number; message?: string }

/** Pueden estar sin configurar sin que sea una avería: push sigue retirado en la app. */
const OPTIONAL_SERVICES = new Set(["push"]);
/** Envíos de avisos vencidos hace más de esto: la cola no se está vaciando. */
const QUEUE_STUCK_MS = 15 * 60 * 1000;
/** Un estado guardado hace más de esto no cuenta como "anterior" (el cron pasa cada 15 min). */
const PREVIOUS_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const SERVICE_LABEL: Record<string, string> = {
  database: "Base de datos",
  stripe: "Pagos (Stripe)",
  email: "Email (Resend)",
  push: "Notificaciones push (FCM)",
  storage: "Almacenamiento",
  notifications: "Cola de avisos",
};
const STATUS_LABEL: Record<Status, string> = {
  operational: "funciona",
  degraded: "con fallos",
  partial_outage: "caído en parte",
  major_outage: "caído",
  maintenance: "sin configurar",
};

const isHealthy = (service: string, status: string): boolean =>
  status === "operational" || (status === "maintenance" && OPTIONAL_SERVICES.has(service));

// Endpoint público: el detalle de los errores (Postgres, Storage…) va al log,
// nunca a la respuesta.
function unavailable(service: string, detail: unknown): string {
  console.error(`health-check ${service}:`, detail);
  return "unavailable";
}

async function checkDb(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const { error } = await supabaseAdmin.from("cities").select("id", { count: "exact", head: true });
    if (error) return { service: "database", status: "major_outage", message: unavailable("database", error.message) };
    return { service: "database", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "database", status: "major_outage", message: unavailable("database", e), latency_ms: Date.now() - start };
  }
}

async function checkStripe(): Promise<ServiceCheck> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return { service: "stripe", status: "maintenance", message: "not_configured" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { "Authorization": `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    if (!res.ok) return { service: "stripe", status: "degraded", latency_ms: Date.now() - start, message: `status_${res.status}` };
    return { service: "stripe", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "stripe", status: "major_outage", message: unavailable("stripe", e) };
  }
}

/** Dominio del remitente (EMAIL_FROM: "Pasify <noreply@dominio>"). */
function senderDomain(): string | null {
  const m = /@([^\s>]+)>?\s*$/.exec(EMAIL_FROM.trim());
  return m ? m[1].toLowerCase() : null;
}

async function checkResend(): Promise<ServiceCheck> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { service: "email", status: "maintenance", message: "not_configured" };
  const start = Date.now();
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    const latency = Date.now() - start;
    if (res.ok) {
      // Clave válida, pero Resend rechaza cada envío si el dominio del
      // remitente no está verificado.
      const list = (await res.json().catch(() => null)) as { data?: Array<{ name?: string; status?: string }> } | null;
      const domain = senderDomain();
      const found = domain ? (list?.data ?? []).find((d) => (d.name ?? "").toLowerCase() === domain) : undefined;
      if (domain && Array.isArray(list?.data) && found?.status !== "verified") {
        return { service: "email", status: "degraded", latency_ms: latency, message: `domain_${found?.status ?? "missing"}`.slice(0, 80) };
      }
      return { service: "email", status: "operational", latency_ms: latency };
    }
    const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name : "";
    // Una clave "solo envío" no puede listar dominios, pero manda emails.
    if (name === "restricted_api_key") return { service: "email", status: "operational", latency_ms: latency, message: "restricted_key" };
    return { service: "email", status: "degraded", latency_ms: latency, message: `status_${res.status}${name ? `_${name}` : ""}`.slice(0, 80) };
  } catch (e) {
    return { service: "email", status: "major_outage", message: unavailable("email", e) };
  }
}

function checkFcm(): ServiceCheck {
  const sa = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!sa) return { service: "push", status: "maintenance", message: "not_configured" };
  return { service: "push", status: "operational" };
}

async function checkStorage(): Promise<ServiceCheck> {
  try {
    const start = Date.now();
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    if (error || !data) return { service: "storage", status: "degraded", message: unavailable("storage", error?.message) };
    return { service: "storage", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "storage", status: "major_outage", message: unavailable("storage", e) };
  }
}

/** Avisos vencidos que nadie manda: el cron de dispatch-notification no está funcionando. */
async function checkNotificationQueue(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const { count, error } = await supabaseAdmin
      .from("notification_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("next_retry_at", new Date(Date.now() - QUEUE_STUCK_MS).toISOString());
    if (error) return { service: "notifications", status: "degraded", message: unavailable("notifications", error.message) };
    const stuck = count ?? 0;
    return stuck > 0
      ? { service: "notifications", status: "degraded", latency_ms: Date.now() - start, message: `stuck_${stuck}` }
      : { service: "notifications", status: "operational", latency_ms: Date.now() - start };
  } catch (e) {
    return { service: "notifications", status: "degraded", message: unavailable("notifications", e) };
  }
}

interface PreviousRow { service: string; previous_status: string | null; previous_at: string | null }

/**
 * Guarda la pasada y devuelve qué servicios han dejado de funcionar (down) y
 * cuáles vuelven (up) respecto a la anterior. Sin estado anterior reciente, un
 * servicio que no funciona cuenta como caída nueva.
 */
async function recordAndCompare(checks: ServiceCheck[], log: ReturnType<typeof logger.child>) {
  const rows = checks.map((c) => ({
    service: c.service,
    status: c.status,
    latency_ms: c.latency_ms ?? null,
    message: c.message ?? null,
  }));
  const { data, error } = await supabaseAdmin.rpc("record_service_status", { _checks: rows });
  if (error) {
    // Sin la migración: se guarda como antes y no se avisa (no se sabe el estado anterior).
    log.warn("record_service_status_failed", { error: error.message });
    try {
      await supabaseAdmin.from("service_status_snapshots").insert(rows);
    } catch {
      // best-effort: el snapshot es informativo.
    }
    return { down: [] as ServiceCheck[], up: [] as ServiceCheck[] };
  }

  const previous = new Map(((data ?? []) as PreviousRow[]).map((r) => [r.service, r]));
  const now = Date.now();
  const down: ServiceCheck[] = [];
  const up: ServiceCheck[] = [];
  for (const c of checks) {
    const p = previous.get(c.service);
    const fresh = !!p?.previous_status && !!p.previous_at && now - Date.parse(p.previous_at) <= PREVIOUS_MAX_AGE_MS;
    const wasHealthy = fresh ? isHealthy(c.service, p!.previous_status as string) : null;
    const healthy = isHealthy(c.service, c.status);
    if (!healthy && wasHealthy !== false) down.push(c);
    else if (healthy && wasHealthy === false) up.push(c);
  }
  return { down, up };
}

const describe = (c: ServiceCheck): string =>
  `${SERVICE_LABEL[c.service] ?? c.service}: ${STATUS_LABEL[c.status] ?? c.status}${c.message && c.message !== "unavailable" ? ` (${c.message})` : ""}`;

/** Un aviso a cada admin de plataforma; dispatch-notification lo manda también por email. */
async function alertAdmins(down: ServiceCheck[], up: ServiceCheck[], log: ReturnType<typeof logger.child>): Promise<void> {
  if (down.length === 0 && up.length === 0) return;
  const admins = await platformAdminIds();
  if (admins.length === 0) {
    log.error("ops_alert_without_admins", { down: down.map((c) => c.service), up: up.map((c) => c.service) });
    return;
  }

  const jobs: Array<Promise<unknown>> = [];
  if (down.length > 0) {
    const title = down.length === 1
      ? `Pasify: ${SERVICE_LABEL[down[0].service] ?? down[0].service} no funciona`
      : `Pasify: ${down.length} servicios no funcionan`;
    const body = `${down.map(describe).join(" · ")}. Detectado por el health-check.`.slice(0, 480);
    for (const userId of admins) {
      jobs.push(enqueueNotification({
        user_id: userId,
        category: "system",
        kind: "ops_alert",
        title,
        body,
        link: "/#/admin",
        priority: "critical",
        payload: { services: down.map((c) => ({ service: c.service, status: c.status, message: c.message ?? null })) },
      }));
    }
  }
  if (up.length > 0) {
    const title = up.length === 1
      ? `Pasify: ${SERVICE_LABEL[up[0].service] ?? up[0].service} vuelve a funcionar`
      : `Pasify: ${up.length} servicios vuelven a funcionar`;
    const body = `${up.map((c) => SERVICE_LABEL[c.service] ?? c.service).join(" · ")}: todo en orden otra vez.`;
    for (const userId of admins) {
      jobs.push(enqueueNotification({
        user_id: userId,
        category: "system",
        kind: "ops_recovered",
        title,
        body,
        link: "/#/admin",
        priority: "normal",
        payload: { services: up.map((c) => c.service) },
      }));
    }
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) log.error("ops_alert_enqueue_failed", { failed, total: results.length });
  log.warn("ops_alert", { down: down.map((c) => c.service), up: up.map((c) => c.service), admins: admins.length });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // Público (smoke de CI, monitorización): solo la BD. Las comprobaciones
  // que llaman a Stripe y Resend, guardan la pasada y avisan, solo desde el
  // servidor: cada visita anónima gastaba límite de la API de Stripe y
  // llenaba la tabla.
  if (!isServiceRoleRequest(req)) {
    const db = await checkDb();
    return jsonResponse({
      overall: db.status === "operational" ? "operational" : "major_outage",
      checks: [db],
      timestamp: new Date().toISOString(),
    });
  }

  const log = logger.child({ function: "health-check" });
  const [db, stripe, resend, storage, queue] = await Promise.all([
    checkDb(), checkStripe(), checkResend(), checkStorage(), checkNotificationQueue(),
  ]);
  const checks = [db, stripe, resend, checkFcm(), storage, queue];

  // Guardar y avisar nunca impide responder el estado de salud.
  let alerts = { down: [] as string[], up: [] as string[] };
  try {
    const { down, up } = await recordAndCompare(checks, log);
    await alertAdmins(down, up, log);
    alerts = { down: down.map((c) => c.service), up: up.map((c) => c.service) };
  } catch (e) {
    log.error("health_check_record_failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const overall = checks.every((c) => isHealthy(c.service, c.status))
    ? "operational"
    : checks.some((c) => c.status === "major_outage")
      ? "major_outage"
      : "degraded";

  return jsonResponse({ overall, checks, alerts, timestamp: new Date().toISOString() });
});
