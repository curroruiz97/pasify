// Pasify · send-sms
// Wrapper Twilio para SMS transaccional (2FA, alertas críticas, recordatorios).
// Solo servidor→servidor: ningún cliente la llama (dispatch-notification usa
// _shared/twilio.ts directamente). Abierta, era un relay de SMS gratis.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendSms } from "../_shared/twilio.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";
import { requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);
    const { to, body, status_callback } = await req.json();
    if (!to || !body) return errorResponse("invalid_payload", 400);

    // Rate limit por teléfono (5 SMS/hora)
    await enforceRateLimit({ key: `sms:${to}`, max: 5, windowSec: 3600 });

    const result = await sendSms({ to, body, statusCallback: status_callback });
    logger.info("sms_sent", { to_last4: to.slice(-4), provider: result.provider });
    return jsonResponse({ sid: result.sid, provider: result.provider });
  } catch (err) {
    logger.error("send-sms failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
