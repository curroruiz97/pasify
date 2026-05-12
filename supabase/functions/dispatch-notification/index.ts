// Pasify · dispatch-notification
// Central fanout: lee `notifications` + `user_notification_prefs` + `user_fcm_tokens`
// y envía push/email/sms según preferencias del user.
// Llamado fire-and-forget desde enqueue_notification (otras edge functions).
//
// Body: { notification_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, SUPABASE_URL } from "../_shared/supabase.ts";
import { sendPushMulticast } from "../_shared/firebase.ts";
import { sendEmail } from "../_shared/resend.ts";
import { sendSms } from "../_shared/twilio.ts";
import { logger } from "../_shared/logger.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface NotifRow {
  id: string;
  user_id: string;
  category: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown>;
  priority: string;
}

function isInQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const h = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s < e ? h >= s && h < e : h >= s || h < e; // cruce de medianoche
}

async function trackDispatch(notificationId: string, channel: string, status: string, providerId?: string, error?: string) {
  await supabaseAdmin.from("notification_dispatches").insert({
    notification_id: notificationId,
    channel,
    status,
    provider_message_id: providerId,
    error_message: error,
    dispatched_at: status === "sent" ? new Date().toISOString() : null,
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    // Auth: solo service_role (este endpoint NO se llama directamente desde cliente)
    const auth = req.headers.get("Authorization");
    if (!auth || !auth.includes(SERVICE_KEY)) return errorResponse("forbidden", 403);

    const { notification_id } = await req.json();
    if (!notification_id) return errorResponse("invalid_payload", 400);

    const log = logger.child({ function: "dispatch-notification", notification_id });

    const { data: notif } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("id", notification_id)
      .maybeSingle();
    if (!notif) return errorResponse("notification_not_found", 404);
    const n = notif as NotifRow;

    // Cargar prefs del user para esta category
    const { data: prefs } = await supabaseAdmin
      .from("user_notification_prefs")
      .select("channel, enabled, quiet_hours_start, quiet_hours_end")
      .eq("user_id", n.user_id)
      .in("category", [n.category, "system"]);

    const prefByChannel = new Map<string, { enabled: boolean; quietStart: string | null; quietEnd: string | null }>();
    for (const p of prefs ?? []) {
      prefByChannel.set(p.channel, { enabled: p.enabled, quietStart: p.quiet_hours_start, quietEnd: p.quiet_hours_end });
    }
    const isCritical = n.priority === "critical" || n.category === "critical" || n.category === "security";

    // === PUSH ===
    const pushPref = prefByChannel.get("push");
    if ((pushPref?.enabled ?? true) && !(isInQuietHours(pushPref?.quietStart ?? null, pushPref?.quietEnd ?? null) && !isCritical)) {
      const { data: tokens } = await supabaseAdmin
        .from("user_fcm_tokens")
        .select("fcm_token, platform")
        .eq("user_id", n.user_id);
      if (tokens && tokens.length > 0) {
        const tokensList = tokens.map((t) => t.fcm_token);
        const res = await sendPushMulticast(tokensList, {
          title: n.title,
          body: n.body ?? "",
          data: { kind: n.kind, ...(n.link ? { link: n.link } : {}) },
          clickAction: n.link ?? undefined,
        }).catch(() => []);
        for (const r of res) {
          await trackDispatch(n.id, "push", r.success ? "sent" : "failed", r.id, r.error);
        }
        log.info("push_dispatched", { tokens: tokensList.length });
      } else {
        await trackDispatch(n.id, "push", "skipped", undefined, "no_tokens");
      }
    } else {
      await trackDispatch(n.id, "push", "skipped", undefined, pushPref?.enabled === false ? "user_disabled" : "quiet_hours");
    }

    // === EMAIL ===
    const emailPref = prefByChannel.get("email");
    if (emailPref?.enabled ?? true) {
      const { data: profile } = await supabaseAdmin.from("profiles").select("email, first_name").eq("id", n.user_id).maybeSingle();
      if (profile?.email) {
        try {
          const linkAbs = n.link?.startsWith("http") ? n.link : `${Deno.env.get("APP_BASE_URL") ?? "https://pasify.es"}${n.link ?? "/"}`;
          const r = await sendEmail({
            to: profile.email,
            subject: n.title,
            html: `<h2>${n.title}</h2>${n.body ? `<p>${n.body}</p>` : ""}${n.link ? `<p><a href="${linkAbs}" style="color:#E8542A">Ver detalles →</a></p>` : ""}`,
            idempotencyKey: `notif-${n.id}-email`,
            tags: [{ name: "category", value: n.category }, { name: "kind", value: n.kind }],
          });
          await trackDispatch(n.id, "email", "sent", r.id);
        } catch (e) {
          await trackDispatch(n.id, "email", "failed", undefined, String(e));
        }
      } else {
        await trackDispatch(n.id, "email", "skipped", undefined, "no_email");
      }
    } else {
      await trackDispatch(n.id, "email", "skipped", undefined, "user_disabled");
    }

    // === SMS === (solo security/critical)
    if (isCritical && (prefByChannel.get("sms")?.enabled ?? false)) {
      const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", n.user_id).maybeSingle();
      if (profile?.phone) {
        try {
          const r = await sendSms({ to: profile.phone, body: `${n.title}\n${n.body ?? ""}` });
          await trackDispatch(n.id, "sms", "sent", r.sid);
        } catch (e) {
          await trackDispatch(n.id, "sms", "failed", undefined, String(e));
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    logger.error("dispatch-notification failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
