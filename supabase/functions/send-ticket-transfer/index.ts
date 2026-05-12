// Pasify · send-ticket-transfer
// Envía email magic link al destinatario de una ticket_transfers row recién creada.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/resend.ts";
import { ticketTransferEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://pasify.es";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { transfer_id } = await req.json();

    const { data: tr } = await supabaseAdmin
      .from("ticket_transfers")
      .select("id, to_email, message, invitation_token, from_user_id, tickets(event_id, events(title, date_start))")
      .eq("id", transfer_id)
      .maybeSingle();
    if (!tr) return errorResponse("transfer_not_found", 404);
    if (tr.from_user_id !== user.id) return errorResponse("forbidden", 403);

    const { data: from } = await supabaseAdmin.from("profiles").select("first_name, last_name").eq("id", tr.from_user_id).maybeSingle();
    const fromName = from ? `${from.first_name ?? ""} ${from.last_name ?? ""}`.trim() : null;

    const event = (tr.tickets as any)?.events;
    const acceptUrl = `${APP_BASE_URL}/#/accept-transfer?token=${tr.invitation_token}`;

    const email = ticketTransferEmail({
      fromName,
      eventTitle: event?.title ?? "el evento",
      eventDate: event ? new Date(event.date_start).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : "",
      acceptUrl,
      message: tr.message,
    });

    await sendEmail({
      to: tr.to_email,
      ...email,
      idempotencyKey: `transfer-${tr.id}`,
      tags: [{ name: "kind", value: "ticket_transfer" }],
    });

    logger.info("ticket_transfer_email_sent", { transfer_id: tr.id });
    return jsonResponse({ ok: true });
  } catch (err) {
    logger.error("send-ticket-transfer failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
