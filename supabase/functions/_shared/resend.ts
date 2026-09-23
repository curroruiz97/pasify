// Pasify · Email transaccional vía Resend
// Reemplaza completamente _shared/gmail.ts (Pasify legacy).
// Sin RESEND_API_KEY no se envía nada: se registra un warn y se devuelve un
// id simulado, para que los flujos que mandan correo no revienten.

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

/** Tiempo máximo por intento: un Resend colgado no debe bloquear un webhook. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Esperas entre reintentos (solo con idempotencyKey, ver sendEmail). */
const RETRY_DELAYS_MS = [500, 1500];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía un email transaccional vía Resend. Retorna `id` (mensaje_id).
 *
 * - Sin `RESEND_API_KEY`: registra un warn, no envía nada y devuelve un id
 *   simulado (provider "fallback"). No lanza.
 * - Con `idempotencyKey`: reintenta errores transitorios (red, timeout, 429,
 *   5xx) hasta 2 veces. Es seguro porque Resend deduplica por esa clave.
 * - Lanza si Resend rechaza el envío o se agotan los reintentos.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    logger.warn("resend_api_key_missing — email no enviado (solo log)", {
      to_count: Array.isArray(opts.to) ? opts.to.length : 1,
      subject: opts.subject,
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

  const maxAttempts = opts.idempotencyKey ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAYS_MS[attempt - 2]);

    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Red caída o timeout: transitorio.
      lastError = new Error(`Resend request failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.warn("resend_request_failed", { attempt, error: lastError.message });
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      return { id: json.id as string, provider: "resend" };
    }

    const errText = await res.text();
    lastError = new Error(`Resend send failed: ${res.status} ${errText.slice(0, 200)}`);
    const transient = res.status === 429 || res.status >= 500;
    if (!transient || attempt === maxAttempts) {
      logger.error("resend_send_failed", { status: res.status, attempt, body: errText.slice(0, 500) });
      throw lastError;
    }
    logger.warn("resend_send_retry", { status: res.status, attempt });
  }

  logger.error("resend_send_failed", { error: lastError?.message });
  throw lastError ?? new Error("Resend send failed");
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
