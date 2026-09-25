// Pasify · gdpr-export-data
// Exportación de los datos de una cuenta (art. 15 y 20 del RGPD) en JSON.
//
//   - Sin body: la pide el propio usuario desde Ajustes («Descargar mis
//     datos»). Se devuelve el JSON en la respuesta ({ ok, file_name, export })
//     y la app lo guarda o lo comparte; no se sube a ningún sitio ni se manda
//     por email. Como mucho 5 al día por usuario (429 rate_limit_exceeded).
//   - Body { dsar_request_id }: un admin atiende una solicitud de
//     compliance_dsar_requests (o el propio solicitante). Se sube al bucket
//     privado gdpr-exports, se envía por email un enlace firmado de 30 días y
//     se cierra la solicitud.
//
// Columnas: lista explícita por tabla. Antes era `select *` y salían
// credenciales: invitation_token de transferencias y de invitaciones de
// equipo (con él se acepta la invitación), qr_token y access_url_token
// (entrar al evento o abrir la entrada), el antes/después de audit_logs (que
// copia esas filas), consolas de bug_reports… Tampoco salen identificadores
// internos de pago (Stripe) ni datos de otras personas que no haya dado el
// propio usuario (quién le mandó una entrada, quién decidió un reembolso…).
// Una columna nueva no sale hasta que se añade aquí.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { esc, sendEmail } from "../_shared/resend.ts";
import { renderBaseEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";

/** El mismo correo de soporte que publica /soporte. */
const SUPPORT_EMAIL = "comunicacion@avenuemedia.io";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filas por página (PostgREST corta en 1000) y máximo por tabla. */
const PAGINA = 1000;
const MAX_FILAS = 20_000;

type Fila = Record<string, unknown>;

/** Lo que se usa del query builder de PostgREST (sin tipos generados en las funciones). */
interface Consulta {
  eq(columna: string, valor: string): Consulta;
  in(columna: string, valores: string[]): Consulta;
  or(filtro: string): Consulta;
  order(columna: string, opciones: { ascending: boolean }): Consulta;
  range(desde: number, hasta: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const COLUMNAS = {
  profiles:
    "id, email, first_name, last_name, phone, city, country, avatar_url, cover_image_url, business_name, business_category, business_description, business_address, business_country, business_city, business_phone, account_status, created_at, updated_at",
  user_roles: "role, created_at",
  tickets:
    "id, event_id, order_id, tier_id, status, amount_paid_cents, currency, buyer_user_id, buyer_email, buyer_first_name, buyer_last_name, buyer_phone, holder_first_name, holder_last_name, holder_email, transferred_to_user_id, transferred_at, paid_at, used_at, created_at",
  ticket_orders:
    "id, event_id, status, subtotal_cents, fees_cents, total_cents, currency, buyer_email, buyer_first_name, buyer_last_name, buyer_phone, created_at, paid_at, refunded_at, expires_at, tickets_email_sent_at, dispute_status, disputed_at",
  ticket_transfers_sent: "id, ticket_id, to_email, status, message, expires_at, created_at, responded_at",
  ticket_transfers_received: "id, ticket_id, to_email, status, message, expires_at, created_at, responded_at",
  refund_requests:
    "id, ticket_id, order_id, event_id, requester_email, amount_cents, currency, reason, reason_code, status, decided_at, decision_note, stripe_refund_status, processed_at, auto_approved, created_at, updated_at",
  refund_request_messages: "id, request_id, sender_kind, body, created_at",
  favorites_v2: "id, event_id, brand_id, venue_id, created_at",
  partner_favorites: "id, partner_id, created_at",
  loyalty_points: "id, change_amount, reason, reason_code, balance_after, event_id, ticket_id, expires_at, created_at",
  referral_codes: "code, created_at",
  referral_claims_as_referee: "id, referral_code, reward_points, status, claimed_at, rewarded_at",
  referral_claims_as_referrer: "id, reward_points, status, referrer_rewarded, claimed_at, rewarded_at",
  support_conversations: "id, kind, subject, status, event_id, org_id, last_message_at, created_at",
  support_messages: "id, conversation_id, sender_kind, body, read_at, created_at",
  notifications: "id, category, kind, title, body, link, priority, read_at, expires_at, created_at",
  user_notification_prefs: "channel, category, enabled, quiet_hours_start, quiet_hours_end, timezone, updated_at",
  // Sin el secreto TOTP ni los códigos de respaldo.
  user_2fa: "method, phone, enabled, enabled_at, disabled_at, last_used_at, created_at, updated_at",
  // Sin el token del dispositivo.
  user_fcm_tokens: "id, platform, created_at, updated_at",
  compliance_consents: "id, consent_kind, granted, version, ip_address, user_agent, granted_at",
  compliance_dsar_requests:
    "id, type, status, requester_email, notes, deadline_at, started_at, completed_at, rejection_reason, created_at",
  // Sin la consola del navegador (puede llevar tokens) ni la ruta de la captura.
  bug_reports: "id, role, page, description, user_agent, url, app_version, status, resolution, created_at",
  // Sin invitation_token.
  organization_members:
    "id, org_id, email, role, status, venue_id, brand_id, invitation_expires_at, invited_at, accepted_at, removed_at, created_at, updated_at",
  // Sin before/after: copian filas enteras (tokens de invitación incluidos).
  audit_logs: "id, action, target_kind, target_id, org_id, actor_role, ip_address, user_agent, created_at",
} as const;

/** Tablas que no se han podido leer: el JSON lo dice en vez de callarlo. */
class Exportacion {
  readonly data: Record<string, unknown> = {};
  readonly conError: string[] = [];

  constructor(private readonly log: ReturnType<typeof logger.child>) {}

  /** Todas las filas (paginando) de `tabla` que cumplen `filtro`. */
  async filas(tabla: string, columnas: string, filtro: (q: Consulta) => Consulta, orden: string): Promise<Fila[]> {
    const out: Fila[] = [];
    for (let desde = 0; desde < MAX_FILAS; desde += PAGINA) {
      const base = supabaseAdmin.from(tabla).select(columnas) as unknown as Consulta;
      const { data, error } = await filtro(base)
        .order(orden, { ascending: true })
        .range(desde, desde + PAGINA - 1);
      if (error) throw new Error(`${tabla}: ${error.message}`);
      const pagina = (data ?? []) as Fila[];
      out.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    return out;
  }

  /** Guarda en `clave` lo que devuelva `leer`; si falla, [] y la anota. */
  async guardar(clave: string, leer: () => Promise<Fila[]>): Promise<Fila[]> {
    try {
      const filas = await leer();
      this.data[clave] = filas;
      return filas;
    } catch (err) {
      this.log.error("gdpr_export_table_failed", { table: clave, error: String((err as Error)?.message ?? err) });
      this.data[clave] = [];
      this.conError.push(clave);
      return [];
    }
  }
}

const trozos = <T,>(lista: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};

async function collectUserData(userId: string, log: ReturnType<typeof logger.child>) {
  const ex = new Exportacion(log);
  const porUsuario = (col: string) => (q: Consulta) => q.eq(col, userId);

  await ex.guardar("profiles", () => ex.filas("profiles", COLUMNAS.profiles, porUsuario("id"), "id"));
  await ex.guardar("user_roles", () => ex.filas("user_roles", COLUMNAS.user_roles, porUsuario("user_id"), "created_at"));

  // Entradas compradas y recibidas. De una recibida no salen los datos de quien
  // la compró; de una comprada y enviada a otra persona, los de quien la tiene
  // ahora; de ninguna, el id de la otra cuenta.
  await ex.guardar("tickets", async () => {
    const filas = await ex.filas(
      "tickets",
      COLUMNAS.tickets,
      (q) => q.or(`buyer_user_id.eq.${userId},transferred_to_user_id.eq.${userId}`),
      "created_at",
    );
    return filas.map((t) => {
      const comprada = t.buyer_user_id === userId;
      const enviada = comprada && t.transferred_to_user_id != null && t.transferred_to_user_id !== userId;
      const { buyer_user_id: _b, transferred_to_user_id: _t, ...resto } = t;
      if (enviada) {
        const { holder_first_name: _hf, holder_last_name: _hl, holder_email: _he, ...sinTitular } = resto;
        return { origen: "comprada_y_enviada", ...sinTitular };
      }
      if (comprada) return { origen: "comprada", ...resto };
      const { buyer_email: _e, buyer_first_name: _f, buyer_last_name: _l, buyer_phone: _p, ...recibida } = resto;
      return { origen: "recibida", ...recibida };
    });
  });
  await ex.guardar("ticket_orders", () => ex.filas("ticket_orders", COLUMNAS.ticket_orders, porUsuario("buyer_user_id"), "created_at"));
  await ex.guardar("ticket_transfers_sent", () =>
    ex.filas("ticket_transfers", COLUMNAS.ticket_transfers_sent, porUsuario("from_user_id"), "created_at"));
  await ex.guardar("ticket_transfers_received", () =>
    ex.filas("ticket_transfers", COLUMNAS.ticket_transfers_received, porUsuario("to_user_id"), "created_at"));

  const reembolsos = await ex.guardar("refund_requests", () =>
    ex.filas("refund_requests", COLUMNAS.refund_requests, porUsuario("requester_user_id"), "created_at"));
  // La conversación de cada solicitud suya, con las respuestas del local.
  await ex.guardar("refund_request_messages", async () => {
    const ids = reembolsos.map((r) => String(r.id));
    const out: Fila[] = [];
    for (const lote of trozos(ids, 100)) {
      out.push(...(await ex.filas("refund_request_messages", COLUMNAS.refund_request_messages, (q) => q.in("request_id", lote), "created_at")));
    }
    return out;
  });

  await ex.guardar("favorites_v2", () => ex.filas("favorites_v2", COLUMNAS.favorites_v2, porUsuario("user_id"), "created_at"));
  await ex.guardar("partner_favorites", () =>
    ex.filas("partner_favorites", COLUMNAS.partner_favorites, porUsuario("user_id"), "created_at"));
  await ex.guardar("loyalty_points", () => ex.filas("loyalty_points", COLUMNAS.loyalty_points, porUsuario("user_id"), "created_at"));
  await ex.guardar("referral_codes", () => ex.filas("referral_codes", COLUMNAS.referral_codes, porUsuario("user_id"), "created_at"));
  await ex.guardar("referral_claims_as_referee", () =>
    ex.filas("referral_claims", COLUMNAS.referral_claims_as_referee, porUsuario("referee_user_id"), "claimed_at"));
  await ex.guardar("referral_claims_as_referrer", () =>
    ex.filas("referral_claims", COLUMNAS.referral_claims_as_referrer, porUsuario("referrer_user_id"), "claimed_at"));

  // Sus conversaciones de soporte (como comprador o como local), con todos sus mensajes.
  const conversaciones = await ex.guardar("support_conversations", () =>
    ex.filas(
      "support_conversations",
      COLUMNAS.support_conversations,
      (q) => q.or(`client_id.eq.${userId},partner_id.eq.${userId}`),
      "created_at",
    ));
  await ex.guardar("support_messages", async () => {
    const ids = conversaciones.map((c) => String(c.id));
    const out: Fila[] = [];
    for (const lote of trozos(ids, 100)) {
      out.push(...(await ex.filas("support_messages", COLUMNAS.support_messages, (q) => q.in("conversation_id", lote), "created_at")));
    }
    return out;
  });

  await ex.guardar("notifications", () => ex.filas("notifications", COLUMNAS.notifications, porUsuario("user_id"), "created_at"));
  await ex.guardar("user_notification_prefs", () =>
    ex.filas("user_notification_prefs", COLUMNAS.user_notification_prefs, porUsuario("user_id"), "id"));
  await ex.guardar("user_2fa", () => ex.filas("user_2fa", COLUMNAS.user_2fa, porUsuario("user_id"), "created_at"));
  await ex.guardar("user_fcm_tokens", () => ex.filas("user_fcm_tokens", COLUMNAS.user_fcm_tokens, porUsuario("user_id"), "created_at"));
  await ex.guardar("compliance_consents", () =>
    ex.filas("compliance_consents", COLUMNAS.compliance_consents, porUsuario("user_id"), "granted_at"));
  await ex.guardar("compliance_dsar_requests", () =>
    ex.filas("compliance_dsar_requests", COLUMNAS.compliance_dsar_requests, porUsuario("requester_user_id"), "created_at"));
  await ex.guardar("bug_reports", () => ex.filas("bug_reports", COLUMNAS.bug_reports, porUsuario("user_id"), "created_at"));
  await ex.guardar("organization_members", () =>
    ex.filas("organization_members", COLUMNAS.organization_members, porUsuario("user_id"), "created_at"));
  await ex.guardar("audit_logs", () => ex.filas("audit_logs", COLUMNAS.audit_logs, porUsuario("actor_user_id"), "created_at"));

  return ex;
}

function construirExport(userId: string, ex: Exportacion) {
  return {
    generated_at: new Date().toISOString(),
    user_id: userId,
    data: ex.data,
    meta: {
      format: "JSON",
      schema_version: "2.0",
      platform: "Pasify",
      contact: SUPPORT_EMAIL,
      nota:
        "Datos de tu cuenta y de tus compras, en claro. No incluye credenciales (QR y enlaces de las entradas, invitaciones, tokens de dispositivo, 2FA), identificadores internos de pago ni datos de otras personas.",
      tablas_con_error: ex.conError,
    },
  };
}

const fechaFichero = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const dsarId = typeof body?.dsar_request_id === "string" ? body.dsar_request_id : null;
    if (body?.dsar_request_id !== undefined && body?.dsar_request_id !== null && !(dsarId && UUID_RE.test(dsarId))) {
      return errorResponse("invalid_dsar_request_id", 400);
    }

    // ------------------------------------------------------------------
    // El propio usuario, desde Ajustes: el JSON va en la respuesta.
    // ------------------------------------------------------------------
    if (!dsarId) {
      await enforceRateLimit({ key: `gdpr_export:user:${user.id}`, max: 5, windowSec: 86_400 });
      const log = logger.child({ function: "gdpr-export-data", target_user_id: user.id, mode: "self" });
      const ex = await collectUserData(user.id, log);
      const payload = construirExport(user.id, ex);
      log.info("gdpr_export_self", { tables_failed: ex.conError });
      return jsonResponse({ ok: true, file_name: `pasify-mis-datos-${fechaFichero()}.json`, export: payload });
    }

    // ------------------------------------------------------------------
    // Solicitud DSAR: la atiende un admin (o la lanza su solicitante).
    // ------------------------------------------------------------------
    const isAdmin = (await supabaseAdmin.rpc("has_role", { _user_id: user.id, _role: "admin" })).data === true;
    const { data: dsar } = await supabaseAdmin.from("compliance_dsar_requests").select("requester_user_id, type").eq("id", dsarId).maybeSingle();
    if (!dsar) return errorResponse("dsar_not_found", 404);
    if (!isAdmin && dsar.requester_user_id !== user.id) return errorResponse("forbidden", 403);
    if (!isAdmin) {
      await enforceRateLimit({ key: `gdpr_export:user:${user.id}`, max: 5, windowSec: 86_400 });
    }
    const targetUserId = dsar.requester_user_id as string;

    const log = logger.child({ function: "gdpr-export-data", target_user_id: targetUserId, mode: "dsar" });

    const ex = await collectUserData(targetUserId, log);
    const payload = construirExport(targetUserId, ex);

    const jsonStr = JSON.stringify(payload, null, 2);
    const fileName = `${targetUserId}/${fechaFichero()}-export.json`;

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

    await supabaseAdmin.from("compliance_dsar_requests").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      completed_by: user.id,
      export_path: fileName,
      export_size_bytes: jsonStr.length,
    }).eq("id", dsarId);

    // Email user con link
    const { data: profile } = await supabaseAdmin.from("profiles").select("email, first_name").eq("id", targetUserId).maybeSingle();
    if (profile?.email && signed?.signedUrl) {
      await sendEmail({
        to: profile.email,
        subject: "Tus datos de Pasify están listos",
        html: renderBaseEmail({
          title: "Tu export GDPR está <span style=\"font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;\">listo</span>.",
          preheader: "Descarga tu archivo en los próximos 30 días.",
          body: `<p>${profile.first_name ? `Hola ${esc(profile.first_name)}, hemos` : "Hemos"} preparado un export completo con todos los datos asociados a tu cuenta de Pasify.</p><p>Incluye perfil, tickets, transacciones, preferencias y todo lo que la ley GDPR cubre. El enlace caduca en 30 días por seguridad.</p>`,
          ctaLabel: "Descargar mi archivo",
          ctaUrl: signed.signedUrl,
          footer: `Si tienes alguna duda sobre tus datos o quieres ejercer otros derechos GDPR (rectificación, supresión...) escríbenos a ${SUPPORT_EMAIL}`,
        }),
        idempotencyKey: `dsar-${dsarId}`,
      });
    }

    log.info("gdpr_export_complete", { size_bytes: jsonStr.length, tables_failed: ex.conError });
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
