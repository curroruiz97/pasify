// Pasify · gmail.ts DEPRECATED · shim hacia Resend.
// Mantiene la firma sendEmail() para compatibilidad con edge functions legacy.
// Migrar todos los consumidores a `_shared/resend.ts` directamente.

import { sendEmail as sendViaResend } from "./resend.ts";

/** @deprecated Usa `sendEmail` de `_shared/resend.ts`. */
export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}) {
  // eslint-disable-next-line no-console
  console.warn("[Pasify] _shared/gmail.ts is DEPRECATED — switch to _shared/resend.ts");
  return sendViaResend({
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
  });
}
