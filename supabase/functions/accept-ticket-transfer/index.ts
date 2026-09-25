// Pasify · accept-ticket-transfer
//
// Página /#/transferencia?token=… (B1-11). El token del email es la
// credencial del enlace.
//
//   GET ?token=  (sin sesión)
//     → { event: { title, date_start, venue_name, timezone }, tier_name,
//         from_name, to_email_masked, status }
//     Nada más de nadie: de quien envía, nombre e inicial del apellido; del
//     destinatario, el email enmascarado (para saber con qué cuenta entrar).
//     status: pending | accepted | declined | expired | cancelled (una
//     pendiente ya caducada sale como expired). 404 transfer_not_found.
//   POST { token } con el JWT de quien la recibe
//     → { ticket_id }. La transferencia la hace accept_ticket_transfer como
//     ese usuario: QR y enlace público nuevos y la entrada pasa a su cuenta.
//     Errores: 401 sin sesión, 404 transfer_not_found, 403 email_mismatch,
//     409 transfer_not_pending, 410 transfer_expired, 409
//     ticket_not_transferable (la transferencia queda anulada).
//     Repetir el POST después de aceptarla devuelve la misma entrada.
//
// verify_jwt = false (config.toml). Límite por IP (GET) y por usuario (POST).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, userClientFrom } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit, clientIp } from "../_shared/rate-limit.ts";
import { DEFAULT_TIMEZONE } from "../_shared/email-templates.ts";
import { enqueueNotification } from "../_shared/notify.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

const fail = (code: string, status: number) => errorResponse(code, status, code);

interface TransferRow {
  id: string;
  ticket_id: string;
  from_user_id: string | null;
  to_email: string;
  to_user_id: string | null;
  status: string;
  expires_at: string;
}

/** "fr***@gmail.com": lo justo para reconocer la dirección. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, local.length <= 3 ? 1 : 2)}***@${domain}`;
}

/** "Clara E.": nombre e inicial del apellido de quien envía. */
function shortName(first: string | null | undefined, last: string | null | undefined): string | null {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f) return null;
  return l ? `${f} ${l.charAt(0).toUpperCase()}.` : f;
}

/** Estado para la página: una pendiente caducada ya es 'expired'. */
const publicStatus = (tr: TransferRow): string =>
  tr.status === "pending" && Date.parse(tr.expires_at) <= Date.now() ? "expired" : tr.status;

async function loadTransfer(token: string): Promise<TransferRow | null> {
  const { data, error } = await supabaseAdmin
    .from("ticket_transfers")
    .select("id, ticket_id, from_user_id, to_email, to_user_id, status, expires_at")
    .eq("invitation_token", token)
    .maybeSingle();
  if (error) throw new Error(`transfer_lookup_failed: ${error.message}`);
  return (data as TransferRow | null) ?? null;
}

async function handleGet(req: Request, token: string): Promise<Response> {
  await enforceRateLimit({ key: `accept_transfer_get:${clientIp(req)}`, max: 120, windowSec: 600 });
  const tr = await loadTransfer(token);
  if (!tr) return fail("transfer_not_found", 404);

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
    tr.from_user_id
      ? supabaseAdmin.from("profiles").select("first_name, last_name").eq("id", tr.from_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const event = eventRes.data as { title: string; date_start: string; venue_name: string | null; venue_id: string | null } | null;
  let venue: { name: string | null; timezone: string | null } | null = null;
  if (event?.venue_id) {
    const { data } = await supabaseAdmin.from("venues").select("name, timezone").eq("id", event.venue_id).maybeSingle();
    venue = data ?? null;
  }
  const from = fromRes.data as { first_name: string | null; last_name: string | null } | null;

  return jsonResponse(
    {
      event: {
        title: event?.title ?? null,
        date_start: event?.date_start ?? null,
        venue_name: event?.venue_name ?? venue?.name ?? null,
        timezone: venue?.timezone || DEFAULT_TIMEZONE,
      },
      tier_name: (tierRes.data as { name?: string } | null)?.name ?? null,
      from_name: shortName(from?.first_name, from?.last_name),
      to_email_masked: maskEmail(tr.to_email),
      status: publicStatus(tr),
    },
    { headers: NO_STORE },
  );
}

async function handlePost(req: Request, token: string, log: ReturnType<typeof logger.child>): Promise<Response> {
  const user = await requireUser(req);
  await enforceRateLimit({ key: `accept_transfer:${user.id}`, max: 30, windowSec: 3600 });
  const tr = await loadTransfer(token);
  if (!tr) return fail("transfer_not_found", 404);
  // Doble toque en "Aceptar": ya es suya.
  if (tr.status === "accepted" && tr.to_user_id === user.id) return jsonResponse({ ticket_id: tr.ticket_id });
  if (tr.status !== "pending") return fail("transfer_not_pending", 409);
  if (Date.parse(tr.expires_at) <= Date.now()) return fail("transfer_expired", 410);
  if ((user.email ?? "").toLowerCase() !== tr.to_email.toLowerCase()) return fail("email_mismatch", 403);

  // La hace la RPC como el usuario (auth.uid()): vuelve a comprobarlo todo.
  const { data: ticketId, error: rpcErr } = await userClientFrom(req).rpc("accept_ticket_transfer", { _token: token });
  if (rpcErr) {
    const msg = rpcErr.message ?? "";
    log.warn("accept_ticket_transfer_rpc_failed", { transfer_id: tr.id, error: msg });
    if (msg.includes("ticket_not_transferable")) {
      // La RPC lo deshace todo al fallar: se anula aquí para que la página y
      // quien la envió lo vean (y pueda volver a usar su entrada).
      await supabaseAdmin
        .from("ticket_transfers")
        .update({ status: "cancelled", responded_at: new Date().toISOString() })
        .eq("id", tr.id)
        .eq("status", "pending");
      return fail("ticket_not_transferable", 409);
    }
    if (msg.includes("transfer_invalid_or_expired")) return fail("transfer_not_pending", 409);
    return fail("transfer_failed", 500);
  }

  // Aviso a quien la envió: la entrada ya no está en su cuenta.
  if (tr.from_user_id) {
    const { data: ev } = await supabaseAdmin
      .from("tickets")
      .select("events(title)")
      .eq("id", tr.ticket_id)
      .maybeSingle();
    const title = (ev as { events?: { title?: string } | null } | null)?.events?.title ?? "tu evento";
    await enqueueNotification({
      user_id: tr.from_user_id,
      category: "tickets",
      kind: "ticket_transfer_accepted",
      title: "Entrada enviada",
      body: `${tr.to_email} ya tiene tu entrada para ${title}.`,
      link: "/#/client-dashboard",
      payload: { transfer_id: tr.id, ticket_id: tr.ticket_id },
    }).catch((e) => log.warn("transfer_accepted_notify_failed", { transfer_id: tr.id, error: String(e) }));
  }

  log.info("transfer_accepted", { transfer_id: tr.id, user_id: user.id });
  return jsonResponse({ ticket_id: (ticketId as string | null) ?? tr.ticket_id });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "accept-ticket-transfer" });
  try {
    let token: string | null = null;
    if (req.method === "GET") token = new URL(req.url).searchParams.get("token");
    else if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { token?: unknown };
      token = typeof body.token === "string" ? body.token : null;
    } else return fail("method_not_allowed", 405);
    token = (token ?? "").trim();
    if (!token) return fail("token_required", 400);
    if (!UUID_RE.test(token)) return fail("invalid_token", 400);

    return req.method === "GET" ? await handleGet(req, token) : await handlePost(req, token, log);
  } catch (err) {
    log.error("accept-ticket-transfer failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
