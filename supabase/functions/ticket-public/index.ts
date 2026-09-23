// Pasify · ticket-public (pública)
//
// Datos de una entrada para la página pública /#/entrada/:id?k=... (enlace
// "Ver entrada" del correo). Sin sesión: la credencial es access_url_token.
//
//   GET  ?id=<ticket_id>&k=<access_url_token>
//   POST { id, k }            (equivalente, cómodo con supabase.functions.invoke)
//
// Returns 200:
//   { ticket: { id, status, tier_name, holder_name, qr_token | null, used_at },
//     event:  { title, date_start, date_end, venue_name, address, city, image_url, timezone } }
// `qr_token` solo viaja con la entrada pagada ('paid'); usada, reembolsada o
// cancelada → null. Nunca devuelve email, teléfono ni datos del comprador.
// 404 { error: 'ticket_not_found', message } si id/k no casan (no distingue).
//
// verify_jwt = false (config.toml). Rate limit por IP.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { enforceRateLimit, clientIp, RateLimitError } from "../_shared/rate-limit.ts";
import { DEFAULT_TIMEZONE } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

const log = logger.child({ function: "ticket-public" });

function fail(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, { status, headers: NO_STORE });
}

const notFound = () => fail(404, "ticket_not_found", "No encontramos esta entrada. Revisa que el enlace esté completo.");

async function readParams(req: Request): Promise<{ id: string; k: string }> {
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { id?: unknown; k?: unknown };
    return {
      id: typeof body.id === "string" ? body.id.trim() : "",
      k: typeof body.k === "string" ? body.k.trim() : "",
    };
  }
  const url = new URL(req.url);
  return { id: (url.searchParams.get("id") ?? "").trim(), k: (url.searchParams.get("k") ?? "").trim() };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET" && req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  try {
    const { id, k } = await readParams(req);
    if (!UUID_RE.test(id) || !UUID_RE.test(k)) return notFound();

    try {
      // Generoso: en la puerta mucha gente abre su entrada desde la misma wifi.
      await enforceRateLimit({ key: `ticket-public:${clientIp(req)}`, max: 600, windowSec: 600 });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return fail(429, "rate_limit_exceeded", "Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo.");
      }
      throw err;
    }

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id, status, event_id, tier_id, holder_first_name, holder_last_name, qr_token, used_at")
      .eq("id", id)
      .eq("access_url_token", k)
      .maybeSingle();
    if (ticketErr) {
      log.error("ticket_query_failed", { error: ticketErr.message });
      return fail(500, "internal_error", "No hemos podido cargar la entrada. Inténtalo de nuevo.");
    }
    if (!ticket) return notFound();

    const [tierRes, eventRes] = await Promise.all([
      ticket.tier_id
        ? supabaseAdmin.from("ticket_tiers").select("name").eq("id", ticket.tier_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin
        .from("events")
        .select("title, date_start, date_end, venue_name, address, city, image_url, venue_id")
        .eq("id", ticket.event_id)
        .maybeSingle(),
    ]);
    if (tierRes.error) log.warn("tier_query_failed", { error: tierRes.error.message });
    if (eventRes.error || !eventRes.data) {
      log.error("event_query_failed", { ticket_id: ticket.id, error: eventRes.error?.message ?? "not_found" });
      return fail(500, "internal_error", "No hemos podido cargar la entrada. Inténtalo de nuevo.");
    }
    const ev = eventRes.data;

    let venue: { name: string | null; address: string | null; city: string | null; timezone: string | null } | null = null;
    if (ev.venue_id) {
      const { data, error } = await supabaseAdmin
        .from("venues")
        .select("name, address, city, timezone")
        .eq("id", ev.venue_id)
        .maybeSingle();
      if (error) log.warn("venue_query_failed", { error: error.message });
      venue = data ?? null;
    }

    const holderName = [ticket.holder_first_name, ticket.holder_last_name]
      .map((s: string | null) => (s ?? "").trim())
      .filter(Boolean)
      .join(" ") || null;

    return jsonResponse({
      ticket: {
        id: ticket.id,
        status: ticket.status,
        tier_name: tierRes.data?.name ?? null,
        holder_name: holderName,
        qr_token: ticket.status === "paid" ? ticket.qr_token : null,
        used_at: ticket.used_at ?? null,
      },
      event: {
        title: ev.title,
        date_start: ev.date_start,
        date_end: ev.date_end ?? null,
        venue_name: ev.venue_name ?? venue?.name ?? null,
        address: ev.address ?? venue?.address ?? null,
        city: ev.city ?? venue?.city ?? null,
        image_url: ev.image_url ?? null,
        timezone: venue?.timezone || DEFAULT_TIMEZONE,
      },
    }, { headers: NO_STORE });
  } catch (err) {
    log.error("ticket_public_failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal_error", "No hemos podido cargar la entrada. Inténtalo de nuevo.");
  }
});
