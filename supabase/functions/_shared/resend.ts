// Pasify · Email transaccional vía Resend
// Reemplaza completamente _shared/gmail.ts (Students Life legacy).
// Fallback opcional a Gmail SMTP si RESEND_API_KEY no está configurado.

import { logger } from "./logger.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Pasify <noreply@pasify.es>";
const EMAIL_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hola@pasify.es";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "hola@pasify.es";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Tags para tracking en Resend (segmentación posterior). */
  tags?: Array<{ name: string; value: string }>;
  /** Adjuntos (max 40MB total, base64 encoded). */
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
  /** Header opcional para idempotencia (Resend respeta `Idempotency-Key`). */
  idempotencyKey?: string;
}

export interface SendEmailResult {
  id: string;
  provider: "resend" | "fallback";
}

/**
 * Envía un email transaccional vía Resend. Retorna `id` (mensaje_id).
 * Lanza si la API key no está o la petición falla.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    logger.warn("resend_api_key_missing — falling back to log-only");
    logger.info("email_simulated", {
      to: Array.isArray(opts.to) ? opts.to.join(",") : opts.to,
      subject: opts.subject,
      preview: opts.html.slice(0, 200),
    });
    return { id: `simulated-${crypto.randomUUID()}`, provider: "fallback" };
  }

  const body = {
    from: EMAIL_FROM,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    reply_to: opts.replyTo ?? EMAIL_REPLY_TO,
    cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : undefined,
    bcc: opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]) : undefined,
    tags: opts.tags,
    attachments: opts.attachments,
  };

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${RESEND_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error("resend_send_failed", { status: res.status, body: errText });
    throw new Error(`Resend send failed: ${res.status} ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  return { id: json.id as string, provider: "resend" };
}

/** Util: HTML escape para interpolaciones seguras. */
export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export { EMAIL_FROM, EMAIL_REPLY_TO, SUPPORT_EMAIL };
