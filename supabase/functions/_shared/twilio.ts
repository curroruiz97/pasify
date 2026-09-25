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
    const errText = await res.text();
    logger.error("twilio_send_failed", { status: res.status, body: errText });
    throw new Error(`Twilio send failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  return { sid: json.sid, provider: "twilio" };
}

/** Genera código TOTP de 6 dígitos. Útil para 2FA SMS. */
export function generate2faCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}
