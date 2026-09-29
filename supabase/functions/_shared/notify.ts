// Pasify · Avisos desde las edge functions
//
// enqueueNotification guarda el aviso en `notifications`. El trigger de la
// migración 20260928160000 deja sus envíos pendientes en
// notification_dispatches (email; push si el usuario tiene dispositivos; SMS
// si es crítico) y aquí se pide a dispatch-notification que los mande ya. Si
// esa llamada no llega (corte de red, la función termina antes), los recoge el
// cron de cada minuto (schedule_dispatch_notifications): el aviso sale igual,
// con hasta un minuto de retraso. Lo encolado desde SQL (enqueue_notification)
// sale solo por el cron.

import { supabaseAdmin } from "./supabase.ts";
import { logger } from "./logger.ts";

export interface EnqueueNotificationOpts {
  user_id: string;
  category: "events" | "tickets" | "promos" | "loyalty" | "security" | "support" | "system" | "critical" | "newsletter";
  kind: string;
  title: string;
  body?: string;
  link?: string;
  icon?: string;
  payload?: Record<string, unknown>;
  priority?: "low" | "normal" | "high" | "critical";
}

export async function enqueueNotification(opts: EnqueueNotificationOpts): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: opts.user_id,
      category: opts.category,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      icon: opts.icon ?? null,
      payload: opts.payload ?? {},
      priority: opts.priority ?? "normal",
    })
    .select("id")
    .single();

  if (error) {
    logger.error("enqueue_notification_failed", { error: error.message, user_id: opts.user_id, kind: opts.kind });
    throw new Error(`enqueue_notification_failed: ${error.message}`);
  }

  kickDispatch(data.id as string);
  return data.id as string;
}

/**
 * Mantiene viva la función que llama hasta que termine `task`
 * (EdgeRuntime.waitUntil): sin eso, la petición en segundo plano se corta en
 * cuanto la función responde. Fuera del runtime de Supabase no espera.
 */
function inBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(task);
}

/**
 * Pide a dispatch-notification que mande ya los envíos pendientes de un
 * aviso. Sin esperar y sin lanzar: si falla, el cron lo recoge.
 */
export function kickDispatch(notificationId: string): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return;

  const task = fetch(`${supabaseUrl}/functions/v1/dispatch-notification`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notification_id: notificationId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      // El cuerpo no interesa, pero hay que soltarlo.
      await res.body?.cancel();
      if (!res.ok) logger.warn("dispatch_notification_kick_status", { notification_id: notificationId, status: res.status });
    })
    .catch((err) => logger.warn("dispatch_notification_fire_failed", { notification_id: notificationId, error: String(err) }));

  inBackground(task);
}

/** Ids de los admins de plataforma (user_roles con rol admin). */
export async function platformAdminIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  if (error) {
    logger.warn("platform_admins_load_failed", { error: error.message });
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.user_id as string).filter(Boolean))];
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * A quién escribir los emails para el equipo de Pasify (soporte, alertas):
 * el email de cada admin de plataforma y, además, ADMIN_EMAIL si está
 * configurado (uno o varios, separados por comas). Sin duplicados. Sin
 * ADMIN_EMAIL no se inventa ninguna dirección: un buzón que no existe
 * devolvería cada email.
 */
export async function adminEmailRecipients(): Promise<string[]> {
  const out = new Map<string, string>();
  const add = (raw: string | null | undefined) => {
    const email = (raw ?? "").trim();
    if (EMAIL_RE.test(email)) out.set(email.toLowerCase(), email);
  };

  (Deno.env.get("ADMIN_EMAIL") ?? "").split(",").forEach(add);

  const ids = await platformAdminIds();
  if (ids.length > 0) {
    const { data, error } = await supabaseAdmin.from("profiles").select("email").in("id", ids);
    if (error) logger.warn("admin_emails_load_failed", { error: error.message });
    for (const p of data ?? []) add(p.email as string | null);
  }
  return [...out.values()];
}
