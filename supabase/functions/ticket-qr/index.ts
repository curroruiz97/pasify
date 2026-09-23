// Pasify · ticket-qr (pública)
//
// PNG con el QR de una entrada, para los correos de compra y la página
// pública de la entrada. Lo cargan los clientes de correo (o sus proxies de
// imágenes) sin cabeceras ni sesión, por eso la credencial va en la URL:
//
//   GET ?id=<ticket_id>&k=<access_url_token>
//
// Solo responde si el token casa con la entrada y está pagada o usada. El QR
// codifica `tickets.qr_token`, que es lo que valida `mark_ticket_used` en la
// puerta. Al aceptar una transferencia se regeneran qr_token y
// access_url_token, así que los enlaces del titular anterior dejan de servir.
//
// verify_jwt = false (config.toml). Sin rate limit por IP a propósito: los
// proxies de imágenes (Gmail, Apple) comparten IP entre millones de usuarios.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import QRCode from "npm:qrcode@1.5.4";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QR_VISIBLE_STATUSES = new Set(["paid", "used"]);

const log = logger.child({ function: "ticket-qr" });

/** `qrcode` no trae tipos: esto es lo único que usamos. */
const qr = QRCode as unknown as {
  toBuffer(
    text: string,
    opts: { type: "png"; errorCorrectionLevel: "L" | "M" | "Q" | "H"; margin: number; width: number },
  ): Promise<Uint8Array>;
};

const textResponse = (status: number, body: string) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const k = url.searchParams.get("k") ?? "";
  if (!UUID_RE.test(id) || !UUID_RE.test(k)) return textResponse(404, "Not found");

  try {
    const { data: ticket, error } = await supabaseAdmin
      .from("tickets")
      .select("qr_token, status")
      .eq("id", id)
      .eq("access_url_token", k)
      .maybeSingle();
    if (error) {
      log.error("ticket_query_failed", { error: error.message });
      return textResponse(500, "Error");
    }
    if (!ticket?.qr_token || !QR_VISIBLE_STATUSES.has(ticket.status)) return textResponse(404, "Not found");

    const headers = {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    };
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });

    const png = await qr.toBuffer(String(ticket.qr_token), {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
    });
    return new Response(png, { status: 200, headers });
  } catch (err) {
    log.error("ticket_qr_failed", { error: err instanceof Error ? err.message : String(err) });
    return textResponse(500, "Error");
  }
});
