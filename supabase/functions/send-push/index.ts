// Pasify · send-push
// Helper invocable: envía push FCM a 1 device token o multicast.
// Solo servidor→servidor: ningún cliente la llama (dispatch-notification usa
// _shared/firebase.ts directamente). Abierta, cualquiera mandaba pushes.
// Sin FCM configurado no sale nada: la respuesta lo dice (simulated) y no
// cuenta como enviado.
//
// Body: { token, title, body, data?, link?, image?, badge?, channel? } | { tokens: [...], ... }
// Se valida entero antes de llamar a FCM (payload.ts): title es una cadena no
// vacía, body una cadena, data un objeto de cadenas, badge un entero >= 0, y
// `tokens` hasta MAX_TOKENS (500) cadenas; con más, 400 too_many_tokens.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendPush, sendPushMulticast } from "../_shared/firebase.ts";
import { logger } from "../_shared/logger.ts";
import { requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";
import { parsePushBody } from "./payload.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);
    const parsed = parsePushBody(await req.json().catch(() => null));
    if (!parsed.ok) return errorResponse(parsed.code, 400, parsed.code);
    const push = parsed.value;
    const log = logger.child({ function: "send-push" });

    const message = {
      title: push.title,
      body: push.body,
      data: push.data,
      imageUrl: push.image,
      clickAction: push.link,
      badge: push.badge,
      androidChannelId: push.channel,
    };

    if (push.multicast) {
      const res = await sendPushMulticast(push.tokens, message);
      const success = res.filter((r) => r.success).length;
      const simulated = res.filter((r) => r.simulated).length;
      log.info("push_multicast_sent", { total: res.length, success, simulated });
      return jsonResponse({ total: res.length, success, simulated, results: res });
    }

    const r = await sendPush({ token: push.tokens[0], ...message });
    return jsonResponse({ id: r.id, provider: r.provider, simulated: r.provider !== "fcm" });
  } catch (err) {
    logger.error("send-push failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
