// Pasify · send-sms
// Wrapper Twilio para SMS transaccional (2FA, alertas críticas, recordatorios).
// Solo servidor→servidor: ningún cliente la llama (dispatch-notification usa
// _shared/twilio.ts directamente). Abierta, era un relay de SMS gratis.
//
// Body: { to, body, status_callback? }. `to` tiene que ser un teléfono E.164
// («+34600000000»); se admiten espacios, guiones, paréntesis y «00» en lugar
// de «+», y se normaliza antes de nada: el límite (5 SMS por hora y número) se
// cuenta sobre el número normalizado, así que escribirlo de otra forma no da un
// cubo nuevo. Un número que no es E.164 es un 400 invalid_phone, sin llegar a
// Twilio.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { normalizeE164, sendSms } from "../_shared/twilio.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";
import { knownError, requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);
    const payload = (await req.json().catch(() => null)) as
      | { to?: unknown; body?: unknown; status_callback?: unknown }
      | null;

    const body = payload?.body;
    if (!payload?.to || typeof body !== "string" || !body.trim()) return errorResponse("invalid_payload", 400);
    const to = normalizeE164(payload.to);
    if (!to) return errorResponse("invalid_phone", 400, "invalid_phone");
    const statusCallback = typeof payload.status_callback === "string" ? payload.status_callback : undefined;

    // Rate limit por teléfono (5 SMS/hora), con el número ya normalizado
    await enforceRateLimit({ key: `sms:${to}`, max: 5, windowSec: 3600 });

    const result = await sendSms({ to, body, statusCallback });
    // Sin Twilio configurado no sale nada: no es un envío.
    const simulated = result.provider !== "twilio";
    logger.info(simulated ? "sms_simulated" : "sms_sent", { to_last4: to.slice(-4), provider: result.provider });
    return jsonResponse({ sid: result.sid, provider: result.provider, simulated });
  } catch (err) {
    // El mensaje de un RateLimitError lleva la clave del cubo (el teléfono):
    // de los errores conocidos solo se registra el código.
    const known = knownError(err);
    if (known) logger.warn("send-sms rejected", { code: known.code });
    else logger.error("send-sms failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
