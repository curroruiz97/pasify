// Pasify · SMS vía Twilio (2FA, alertas críticas)
import { logger } from "./logger.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";

export interface SendSmsOptions {
  to: string;
  body: string;
  /** Opcional: status callback URL para tracking de entrega. */
  statusCallback?: string;
}

export interface SendSmsResult {
  sid: string;
  provider: "twilio" | "fallback";
}

/** true si Twilio está configurado: sin él no sale ningún SMS. */
export function isSmsConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

/**
 * Teléfono en E.164 («+» y de 7 a 15 cifras, la primera distinta de 0), o null
 * si no lo es. Antes de comprobarlo quita espacios, puntos, guiones y
 * paréntesis, y lee un «00» inicial como «+»: «+34 600 00 00 00»,
 * «0034600000000» y «+34600000000» dan el mismo resultado. Un número sin
 * prefijo de país («600000000») no se adivina: null.
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let phone = raw.replace(/[\s.()-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}

export interface TwilioErrorSummary {
  status: number;
  /** El `code` de Twilio (21211, 20003…): su documentación explica cada uno. */
  code: number | null;
  /** El `message` de Twilio sin cifras; null si el cuerpo no era el JSON de un error. */
  message: string | null;
}

/**
 * Lo que se puede escribir en un log o en un error de una respuesta fallida de
 * Twilio. El cuerpo entero no: lleva el teléfono del destinatario («The 'To'
 * number +34… is not a valid phone number») y acabaría en los logs de las
 * funciones y en notification_dispatches.error_message. Del `message` se
 * quitan todas las cifras, y de un cuerpo que no sea JSON, todo.
 */
export function summarizeTwilioError(status: number, rawBody: string): TwilioErrorSummary {
  let code: number | null = null;
  let message: string | null = null;
  try {
    const body = JSON.parse(rawBody) as { code?: unknown; message?: unknown } | null;
    if (typeof body?.code === "number" && Number.isFinite(body.code)) code = body.code;
    if (typeof body?.message === "string") message = body.message.replace(/\+?\d+/g, "#").slice(0, 200);
  } catch {
    // Una página de error del proxy, por ejemplo: sin cuerpo.
  }
  return { status, code, message };
}

/**
 * Envía un SMS. Si Twilio no está configurado no envía nada: registra un warn
 * y devuelve un sid simulado con provider "fallback", que NO es un envío.
 */
export async function sendSms(opts: SendSmsOptions): Promise<SendSmsResult> {
  if (!isSmsConfigured()) {
    // Sin el cuerpo en el log: puede llevar un código de verificación.
    logger.warn("twilio_not_configured", { to_last4: opts.to.slice(-4) });
    return { sid: `simulated-${crypto.randomUUID()}`, provider: "fallback" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const authHeader = "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const params = new URLSearchParams({
    From: TWILIO_FROM_NUMBER,
    To: opts.to,
    Body: opts.body,
  });
  if (opts.statusCallback) params.set("StatusCallback", opts.statusCallback);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    // Sin el cuerpo de Twilio: puede llevar el teléfono (ver summarizeTwilioError).
    const err = summarizeTwilioError(res.status, await res.text());
    logger.error("twilio_send_failed", { status: err.status, twilio_code: err.code, twilio_message: err.message });
    throw new Error(
      `Twilio send failed: ${err.status}${err.code !== null ? ` (code ${err.code})` : ""}${err.message ? ` ${err.message}` : ""}`,
    );
  }
  const json = await res.json();
  return { sid: json.sid, provider: "twilio" };
}

/** Genera código TOTP de 6 dígitos. Útil para 2FA SMS. */
export function generate2faCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}
