// Pasify · accept-ticket-transfer
// Endpoint público (verify_jwt = false) que acepta transferencia de ticket via token.
// Sin sesión → devuelve metadata para que el front lleve al login.
// Con sesión y email coincidente → llama a la RPC accept_ticket_transfer con el
// JWT del usuario. Antes la transferencia se hacía aquí a mano con la service
// role y se saltaba las comprobaciones de la RPC (entrada pagada, sin escanear,
// y que siga siendo del remitente).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, userClientFrom } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    let token: string | null = null;
    if (req.method === "GET") token = new URL(req.url).searchParams.get("token");
    else if (req.method === "POST") token = (await req.json()).token;
    else return errorResponse("method_not_allowed", 405);
    if (!token) return errorResponse("token_required", 400);
    if (typeof token !== "string" || !UUID_RE.test(token)) return errorResponse("invalid_token", 400);

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

    // Pre-chequeo para dar un error claro (la RPC vuelve a comprobarlo todo).
    const { data: tr } = await supabaseAdmin
      .from("ticket_transfers")
      .select("id, to_email, ticket_id, status, expires_at")
      .eq("invitation_token", token)
      .maybeSingle();
    if (!tr) return errorResponse("invalid_token", 400);
    if (tr.status !== "pending") return errorResponse("already_used", 400);
    if (new Date(tr.expires_at) < new Date()) return errorResponse("expired", 400);
    if (userData.user.email?.toLowerCase() !== tr.to_email.toLowerCase()) return errorResponse("email_mismatch", 403);

    // La transferencia la hace la RPC, como el usuario: regenera el QR, cambia
    // el titular y cancela otras transferencias pendientes de esa entrada.
    const { data: ticketId, error: rpcErr } = await userClientFrom(req).rpc("accept_ticket_transfer", { _token: token });
    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      logger.warn("accept_ticket_transfer_rpc_failed", { transfer_id: tr.id, error: msg });
      if (msg.includes("ya no se puede transferir")) return errorResponse("ticket_not_transferable", 409);
      if (msg.includes("no válida o caducada")) return errorResponse("invalid_or_expired", 400);
      return errorResponse("transfer_failed", 500);
    }

    logger.info("transfer_accepted", { transfer_id: tr.id, user_id: userData.user.id });
    return jsonResponse({ ok: true, ticket_id: ticketId ?? tr.ticket_id });
  } catch (err) {
    logger.error("accept-ticket-transfer failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
