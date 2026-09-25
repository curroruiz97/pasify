// Pasify · send-ticket-transfer
//
// El titular envía una entrada a otra persona por email (B1-11).
//   1. transfer_ticket con el JWT del titular (auth.uid() = quien envía). La
//      RPC comprueba que es el titular, que la entrada está pagada y sin usar,
//      que su tipo se puede transferir (ticket_tiers.transfer_allowed), que el
//      evento no ha pasado ni está cancelado, y que no hay disputa, reembolso
//      en curso ni otro envío pendiente de esa entrada.
//   2. Email al destinatario con la fecha en la zona horaria del local y el
//      enlace `${WEB_BASE}/#/transferencia?token=<token>` (APP_BASE_URL en el
//      servidor). Si el email no sale, el envío se anula para poder repetirlo.
//
// Body: { ticket_id, to_email, message? }
// Returns: { transfer_id }
// Errores: invalid_payload 400, invalid_email 400, transfer_to_self 400,
//   ticket_not_found 404, not_ticket_holder 403, ticket_not_transferable 409,
//   event_not_transferable 409, transfer_not_allowed 409,
//   refund_in_progress 409, transfer_pending 409, email_failed 502,
//   rate_limit_exceeded 429.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, userClientFrom } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/resend.ts";
import { APP_URL, DEFAULT_TIMEZONE, ticketTransferEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_MESSAGE_LENGTH = 500;

/** Errores de transfer_ticket (el mensaje es el código) → status HTTP. */
const RPC_ERRORS: Record<string, number> = {
  invalid_email: 400,
  transfer_to_self: 400,
  ticket_not_found: 404,
  not_ticket_holder: 403,
  ticket_not_transferable: 409,
  event_not_transferable: 409,
  transfer_not_allowed: 409,
  refund_in_progress: 409,
  transfer_pending: 409,
};

const fail = (code: string, status: number) => errorResponse(code, status, code);

/** Enlace de la página de aceptar (la ruta /transferencia la añade Compra). */
const transferAcceptUrl = (token: string): string =>
  `${APP_URL}/#/transferencia?token=${encodeURIComponent(token)}`;

const fullName = (first: string | null | undefined, last: string | null | undefined) =>
  [first, last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || null;

/** Email al destinatario con los datos de la entrada. Lanza si no sale. */
async function emailTransfer(transferId: string, senderId: string): Promise<void> {
  const { data: tr, error: trErr } = await supabaseAdmin
    .from("ticket_transfers")
    .select("id, to_email, message, invitation_token, expires_at, ticket_id")
    .eq("id", transferId)
    .maybeSingle();
  if (trErr || !tr) throw new Error(`transfer_load_failed: ${trErr?.message ?? "not_found"}`);

  const { data: ticket } = await supabaseAdmin
    .from("tickets")
    .select("event_id, tier_id")
    .eq("id", tr.ticket_id)
    .maybeSingle();
  const [eventRes, tierRes, fromRes] = await Promise.all([
    ticket?.event_id
      ? supabaseAdmin.from("events").select("title, date_start, venue_name, venue_id").eq("id", ticket.event_id).maybeSingle()
      : Promise.resolve({ data: null }),
    ticket?.tier_id
      ? supabaseAdmin.from("ticket_tiers").select("name").eq("id", ticket.tier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("profiles").select("first_name, last_name").eq("id", senderId).maybeSingle(),
  ]);
  const event = eventRes.data as { title: string; date_start: string; venue_name: string | null; venue_id: string | null } | null;
  let venue: { name: string | null; timezone: string | null } | null = null;
  if (event?.venue_id) {
    const { data } = await supabaseAdmin.from("venues").select("name, timezone").eq("id", event.venue_id).maybeSingle();
    venue = data ?? null;
  }
  const from = fromRes.data as { first_name: string | null; last_name: string | null } | null;

  const email = ticketTransferEmail({
    fromName: fullName(from?.first_name, from?.last_name),
    eventTitle: event?.title ?? "el evento",
    eventDateStart: event?.date_start ?? null,
    timezone: venue?.timezone || DEFAULT_TIMEZONE,
    venueName: event?.venue_name ?? venue?.name ?? null,
    tierName: (tierRes.data as { name?: string } | null)?.name ?? null,
    acceptUrl: transferAcceptUrl(tr.invitation_token),
    message: tr.message,
    expiresAt: tr.expires_at,
  });
  await sendEmail({
    to: tr.to_email,
    ...email,
    idempotencyKey: `transfer-${tr.id}`,
    tags: [{ name: "kind", value: "ticket_transfer" }],
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "send-ticket-transfer" });
  try {
    if (req.method !== "POST") return fail("method_not_allowed", 405);
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as { ticket_id?: unknown; to_email?: unknown; message?: unknown };
    const ticketId = typeof body.ticket_id === "string" ? body.ticket_id.trim() : "";
    const toEmail = typeof body.to_email === "string" ? body.to_email.trim().toLowerCase() : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
    if (!UUID_RE.test(ticketId)) return fail("invalid_payload", 400);
    if (toEmail.length > 254 || !EMAIL_RE.test(toEmail)) return fail("invalid_email", 400);
    // Cada envío manda un email a una dirección que elige quien llama.
    await enforceRateLimit({ key: `ticket_transfer:${user.id}`, max: 20, windowSec: 3600 });

    const { data: transferId, error: rpcErr } = await userClientFrom(req).rpc("transfer_ticket", {
      _ticket_id: ticketId,
      _to_email: toEmail,
      _message: message || null,
    });
    if (rpcErr || typeof transferId !== "string") {
      const code = (rpcErr?.message ?? "").trim();
      if (RPC_ERRORS[code]) return fail(code, RPC_ERRORS[code]);
      log.error("transfer_ticket_rpc_failed", { ticket_id: ticketId, error: rpcErr?.message ?? "no_id" });
      return fail("internal_error", 500);
    }

    try {
      await emailTransfer(transferId, user.id);
    } catch (err) {
      // Sin email el destinatario no tiene el enlace: se anula para poder repetirlo.
      log.error("ticket_transfer_email_failed", { transfer_id: transferId, error: String(err) });
      await supabaseAdmin
        .from("ticket_transfers")
        .update({ status: "cancelled", responded_at: new Date().toISOString() })
        .eq("id", transferId)
        .eq("status", "pending");
      return fail("email_failed", 502);
    }

    log.info("ticket_transfer_sent", { transfer_id: transferId, user_id: user.id });
    return jsonResponse({ transfer_id: transferId });
  } catch (err) {
    log.error("send-ticket-transfer failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
