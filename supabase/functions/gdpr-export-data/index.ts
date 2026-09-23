// Pasify · gdpr-export-data
// Genera ZIP con todos los datos asociados al user (perfil, tickets, transacciones,
// support messages, notifications, etc.) y lo sube a bucket `gdpr-exports`.
// Devuelve signed URL con TTL 30 días.
//
// Body: { dsar_request_id? } (si llamado desde compliance_dsar_requests)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/resend.ts";
import { renderBaseEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";

async function collectUserData(userId: string) {
  const tables = [
    "profiles", "user_roles", "tickets", "ticket_orders", "ticket_transfers",
    "refund_requests", "refund_request_messages", "favorites_v2", "partner_favorites",
    "loyalty_points", "support_conversations", "support_messages",
    "notifications", "user_notification_prefs", "user_2fa", "user_fcm_tokens",
    "compliance_consents", "compliance_dsar_requests", "bug_reports",
    "organization_members", "audit_logs",
  ];

  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    const columnsByTable: Record<string, string> = {
      profiles: "id",
      user_roles: "user_id",
      tickets: "buyer_user_id",
      ticket_orders: "buyer_user_id",
      ticket_transfers: "from_user_id",
      refund_requests: "requester_user_id",
      refund_request_messages: "sender_id",
      favorites_v2: "user_id",
      partner_favorites: "user_id",
      loyalty_points: "user_id",
      support_conversations: "client_id",
      support_messages: "sender_id",
      notifications: "user_id",
      user_notification_prefs: "user_id",
      user_2fa: "user_id",
      user_fcm_tokens: "user_id",
      compliance_consents: "user_id",
      compliance_dsar_requests: "requester_user_id",
      bug_reports: "user_id",
      organization_members: "user_id",
      audit_logs: "actor_user_id",
    };
    const col = columnsByTable[t];
    if (!col) continue;
    const special = SPECIAL_EXPORTS[t];
    if (special) {
      data[t] = await special(userId);
      continue;
    }
    const { data: rows } = await supabaseAdmin.from(t).select("*").eq(col, userId);
    data[t] = rows ?? [];
  }
  return data;
}

// Tablas con credenciales: se exportan sin ellas.
//  - tickets: las compradas por el usuario y las que tiene por transferencia,
//    sin qr_token ni access_url_token. Una entrada transferida lleva el QR
//    nuevo del receptor, y con él quien la vendió podía entrar antes.
//  - user_2fa: sin el secreto TOTP ni los códigos de respaldo.
//  - user_fcm_tokens: sin el token del dispositivo.
const TICKET_EXPORT_COLUMNS =
  "id, event_id, order_id, tier_id, status, amount_paid_cents, currency, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone, holder_first_name, holder_last_name, holder_email, transferred_to_user_id, transferred_at, paid_at, used_at, created_at";

const SPECIAL_EXPORTS: Record<string, (userId: string) => Promise<unknown[]>> = {
  tickets: async (userId) => {
    const { data } = await supabaseAdmin
      .from("tickets")
      .select(TICKET_EXPORT_COLUMNS)
      .or(`buyer_user_id.eq.${userId},transferred_to_user_id.eq.${userId}`);
    return data ?? [];
  },
  user_2fa: async (userId) => {
    const { data } = await supabaseAdmin
      .from("user_2fa")
      .select("user_id, method, phone, enabled, enabled_at, disabled_at, last_used_at, created_at, updated_at")
      .eq("user_id", userId);
    return data ?? [];
  },
  user_fcm_tokens: async (userId) => {
    const { data } = await supabaseAdmin
      .from("user_fcm_tokens")
      .select("id, user_id, platform, created_at, updated_at")
      .eq("user_id", userId);
    return data ?? [];
  },
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const dsarId = body.dsar_request_id;

    let targetUserId = user.id;

    // Si dsar_id es admin processing en favor de otro user → permitido
    if (dsarId) {
      const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" })).data;
      const { data: dsar } = await supabaseAdmin.from("compliance_dsar_requests").select("requester_user_id, type").eq("id", dsarId).maybeSingle();
      if (!dsar) return errorResponse("dsar_not_found", 404);
      if (!isAdmin && dsar.requester_user_id !== user.id) return errorResponse("forbidden", 403);
      targetUserId = dsar.requester_user_id;
    }

    const log = logger.child({ function: "gdpr-export-data", target_user_id: targetUserId });

    const data = await collectUserData(targetUserId);
    const payload = {
      generated_at: new Date().toISOString(),
      user_id: targetUserId,
      data,
      meta: {
        format: "JSON",
        schema_version: "1.0",
        platform: "Pasify",
        contact: "hola@pasify.es",
      },
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const fileName = `${targetUserId}/${new Date().toISOString().slice(0, 10)}-export.json`;

    // Upload
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("gdpr-exports")
      .upload(fileName, new Blob([jsonStr], { type: "application/json" }), {
        contentType: "application/json",
        upsert: true,
      });
    if (uploadErr) {
      log.error("gdpr_export_upload_failed", { error: uploadErr.message });
      return errorResponse("upload_failed", 500, "upload_failed");
    }

    // Signed URL TTL 30 días
    const { data: signed } = await supabaseAdmin.storage
      .from("gdpr-exports")
      .createSignedUrl(fileName, 60 * 60 * 24 * 30);

    // Update DSAR
    if (dsarId) {
      await supabaseAdmin.from("compliance_dsar_requests").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: user.id,
        export_path: fileName,
        export_size_bytes: jsonStr.length,
      }).eq("id", dsarId);
    }

    // Email user con link
    const { data: profile } = await supabaseAdmin.from("profiles").select("email, first_name").eq("id", targetUserId).maybeSingle();
    if (profile?.email && signed?.signedUrl) {
      await sendEmail({
        to: profile.email,
        subject: "Tus datos de Pasify están listos",
        html: renderBaseEmail({
          title: "Tu export GDPR está <span style=\"font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;\">listo</span>.",
          preheader: "Descarga tu archivo en los próximos 30 días.",
          body: `<p>${profile.first_name ? `Hola ${profile.first_name}, hemos` : "Hemos"} preparado un export completo con todos los datos asociados a tu cuenta de Pasify.</p><p>Incluye perfil, tickets, transacciones, preferencias y todo lo que la ley GDPR cubre. El enlace caduca en 30 días por seguridad.</p>`,
          ctaLabel: "Descargar mi archivo",
          ctaUrl: signed.signedUrl,
          footer: "Si tienes alguna duda sobre tus datos o quieres ejercer otros derechos GDPR (rectificación, supresión...) escríbenos a hola@pasify.es",
        }),
        idempotencyKey: `dsar-${dsarId ?? targetUserId}`,
      });
    }

    log.info("gdpr_export_complete", { size_bytes: jsonStr.length });
    return jsonResponse({
      ok: true,
      path: fileName,
      size_bytes: jsonStr.length,
      signed_url: signed?.signedUrl,
    });
  } catch (err) {
    logger.error("gdpr-export-data failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
