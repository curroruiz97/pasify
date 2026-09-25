// Pasify · notify-admin-message
//
// Email al equipo de Pasify cuando un usuario (cliente o local) escribe a
// Soporte y el admin no tenía nada sin leer en esa conversación. Lo llama el
// trigger trg_support_notify_admin (migración 20260928160000) por pg_net con
// la cabecera x-pasify-internal: solo servidor → servidor (requireServiceRole).
// Antes nadie la llamaba y el admin solo se enteraba mirando el panel.
//
// Destinatarios: el email de cada admin de plataforma y ADMIN_EMAIL si está
// configurado (adminEmailRecipients). Si cuando llega la llamada el admin ya
// ha leído la conversación, no se manda nada. El texto sale de la base de
// datos, no del body: el body solo trae el id del mensaje.
//
// Body: { message_id } · 200: { sent, reason? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { emailDelivered, esc, sendEmail } from "../_shared/resend.ts";
import { APP_URL, renderBaseEmail } from "../_shared/email-templates.ts";
import { adminEmailRecipients } from "../_shared/notify.ts";
import { knownError, requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caracteres del mensaje que se copian en el email. */
const PREVIEW_CHARS = 600;
/** Bandeja de soporte del admin (el panel no enlaza secciones por URL). */
const INBOX_URL = `${APP_URL}/#/admin`;

const oneLine = (s: string | null | undefined): string => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

function supportMessageEmail(opts: {
  who: string;
  isPartner: boolean;
  email: string | null;
  orgName: string | null;
  preview: string;
  truncated: boolean;
}): { subject: string; html: string; text: string } {
  const who = oneLine(opts.who).slice(0, 120) || "Un usuario";
  const kindLabel = opts.isPartner ? "Local" : "Cliente";
  const details = [
    `Tipo: ${kindLabel}`,
    opts.orgName ? `Local: ${oneLine(opts.orgName)}` : null,
    opts.email ? `Email: ${oneLine(opts.email)}` : null,
  ].filter((d): d is string => !!d);
  const preview = opts.preview + (opts.truncated ? "…" : "");

  const html = renderBaseEmail({
    title: "Tienes un mensaje en Soporte.",
    preheader: `${who}: ${oneLine(opts.preview).slice(0, 120)}`,
    body: `
      <p><strong>${esc(who)}</strong> ha escrito a Soporte${opts.isPartner ? " desde el panel de su local" : ""}:</p>
      <div class="panel" style="margin:16px 0;padding:16px;background:#FBF8F3;border:1px solid #E8E1D4;border-radius:14px;color:#1A1612;">
        ${esc(preview).replace(/\r?\n/g, "<br />")}
      </div>
      <p class="muted" style="margin:0 0 12px 0;font-size:13px;color:#5C544A;">${details.map((d) => esc(d)).join(" · ")}</p>
      <p>Contesta desde la bandeja de Soporte del panel de admin: la respuesta le llega en la app y por email.</p>
    `,
    ctaLabel: "Abrir la bandeja de Soporte",
    ctaUrl: esc(INBOX_URL),
    footer: "Solo avisamos del primer mensaje sin leer de cada conversación; los siguientes esperan en la bandeja.",
  });

  const text = [
    `${who} ha escrito a Soporte${opts.isPartner ? " desde el panel de su local" : ""}:`,
    "",
    preview,
    "",
    details.join(" · "),
    "",
    `Contesta desde la bandeja de Soporte: ${INBOX_URL}`,
  ].join("\n");

  return { subject: `Nuevo mensaje en Soporte de ${who}`.slice(0, 150), html, text };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "notify-admin-message" });
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);

    const body = (await req.json().catch(() => ({}))) as { message_id?: unknown } | null;
    const messageId = body?.message_id;
    if (typeof messageId !== "string" || !UUID_RE.test(messageId)) return errorResponse("invalid_payload", 400);

    const { data: msg, error: msgError } = await supabaseAdmin
      .from("support_messages")
      .select("id, conversation_id, sender_id, sender_kind, body")
      .eq("id", messageId)
      .maybeSingle();
    if (msgError) throw new Error(`support_message_load_failed: ${msgError.message}`);
    if (!msg) return jsonResponse({ sent: false, reason: "message_not_found" });
    if (msg.sender_kind !== "client") return jsonResponse({ sent: false, reason: "not_from_user" });

    const { data: conv, error: convError } = await supabaseAdmin
      .from("support_conversations")
      .select("id, kind, org_id, unread_for_admin")
      .eq("id", msg.conversation_id)
      .maybeSingle();
    if (convError) throw new Error(`support_conversation_load_failed: ${convError.message}`);
    if (!conv || (conv.kind !== "client_admin" && conv.kind !== "partner_admin")) {
      return jsonResponse({ sent: false, reason: "not_admin_conversation" });
    }
    // El admin ya la ha abierto (pg_net llama unos segundos después).
    if ((conv.unread_for_admin ?? 0) <= 0) return jsonResponse({ sent: false, reason: "already_read" });

    const [senderRes, orgRes] = await Promise.all([
      msg.sender_id
        ? supabaseAdmin.from("profiles").select("first_name, last_name, email, business_name").eq("id", msg.sender_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      conv.org_id
        ? supabaseAdmin.from("organizations").select("name").eq("id", conv.org_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const sender = senderRes.data as { first_name: string | null; last_name: string | null; email: string | null; business_name: string | null } | null;
    const orgName = (orgRes.data as { name: string | null } | null)?.name ?? null;
    const isPartner = conv.kind === "partner_admin";
    const person = [sender?.first_name, sender?.last_name].map((s) => oneLine(s)).filter(Boolean).join(" ");
    const who = (isPartner ? oneLine(orgName) || oneLine(sender?.business_name) || person : person) || sender?.email || "Un usuario";

    const recipients = await adminEmailRecipients();
    if (recipients.length === 0) {
      log.warn("no_admin_recipients", { message_id: messageId });
      return jsonResponse({ sent: false, reason: "no_recipients" });
    }

    const text = String(msg.body ?? "").trim();
    const res = await sendEmail({
      to: recipients,
      ...supportMessageEmail({
        who,
        isPartner,
        email: sender?.email ?? null,
        orgName: isPartner ? orgName : null,
        preview: text.slice(0, PREVIEW_CHARS),
        truncated: text.length > PREVIEW_CHARS,
      }),
      idempotencyKey: `support-admin-${messageId}`,
      tags: [{ name: "kind", value: "support_message" }],
    });
    const sent = emailDelivered(res);
    if (!sent) log.warn("email_not_configured", { message_id: messageId });
    return jsonResponse({ sent });
  } catch (err) {
    const known = knownError(err);
    if (known) log.warn("notify-admin-message rejected", { code: known.code });
    else log.error("notify-admin-message failed", { error: err instanceof Error ? err.message : String(err) });
    return safeErrorResponse(err);
  }
});
