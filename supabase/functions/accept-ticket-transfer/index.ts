// Pasify · accept-ticket-transfer
// Endpoint público que acepta transferencia de ticket via token.
// Si user logueado y email match → llama accept_ticket_transfer RPC.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    let token: string | null = null;
    if (req.method === "GET") token = new URL(req.url).searchParams.get("token");
    else if (req.method === "POST") token = (await req.json()).token;
    else return errorResponse("method_not_allowed", 405);
    if (!token) return errorResponse("token_required", 400);

    const auth = req.headers.get("Authorization");
    if (!auth) {
      // Devolver metadata para que el front lleve al login con next=accept-transfer
      const { data: tr } = await supabaseAdmin
        .from("ticket_transfers")
        .select("to_email, ticket_id, tickets(events(title, date_start))")
        .eq("invitation_token", token)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!tr) return errorResponse("invalid_or_expired", 400);
      return jsonResponse({
        requires_auth: true,
        email: tr.to_email,
        event: (tr.tickets as any)?.events,
      });
    }

    const { data: userData } = await supabaseAdmin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!userData.user) return errorResponse("invalid_token", 401);

    // Verificar email coincide
    const { data: tr } = await supabaseAdmin
      .from("ticket_transfers")
      .select("id, to_email, ticket_id, status, expires_at")
      .eq("invitation_token", token)
      .maybeSingle();
    if (!tr) return errorResponse("invalid_token", 400);
    if (tr.status !== "pending") return errorResponse("already_used", 400);
    if (new Date(tr.expires_at) < new Date()) return errorResponse("expired", 400);
    if (userData.user.email?.toLowerCase() !== tr.to_email.toLowerCase()) return errorResponse("email_mismatch", 403);

    // Realizar transferencia: cambiar holder, regenerar qr_token
    await supabaseAdmin.from("ticket_transfers").update({
      status: "accepted",
      to_user_id: userData.user.id,
      responded_at: new Date().toISOString(),
    }).eq("id", tr.id);

    const newToken = crypto.randomUUID();
    await supabaseAdmin.from("tickets").update({
      transferred_to_user_id: userData.user.id,
      transferred_at: new Date().toISOString(),
      qr_token: newToken,
    }).eq("id", tr.ticket_id);

    logger.info("transfer_accepted", { transfer_id: tr.id, user_id: userData.user.id });
    return jsonResponse({ ok: true, ticket_id: tr.ticket_id });
  } catch (err) {
    logger.error("accept-ticket-transfer failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
