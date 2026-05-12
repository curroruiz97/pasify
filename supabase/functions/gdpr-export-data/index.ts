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
    const { data: rows } = await supabaseAdmin.from(t).select("*").eq(col, userId);
    data[t] = rows ?? [];
  }
  return data;
}

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
    if (uploadErr) return errorResponse(`upload_failed: ${uploadErr.message}`, 500);

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
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
