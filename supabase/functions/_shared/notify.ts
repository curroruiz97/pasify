// Pasify · Helper para enqueue + dispatch de notificaciones desde otras edge functions
// Wrapper que persiste en `notifications` table y dispara dispatch async.

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

  // Disparar dispatch async vía edge → no bloqueamos. La función dispatch-notification
  // se encarga de leer prefs y enviar push/email/sms según corresponda.
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // fire-and-forget
  fetch(`${SUPABASE_URL}/functions/v1/dispatch-notification`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notification_id: data.id }),
  }).catch((err) => logger.warn("dispatch_notification_fire_failed", { error: String(err) }));

  return data.id as string;
}
