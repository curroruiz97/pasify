// Pasify · send-push
// Helper invocable: envía push FCM a 1 device token o multicast.
// Solo servidor→servidor: ningún cliente la llama (dispatch-notification usa
// _shared/firebase.ts directamente). Abierta, cualquiera mandaba pushes.
//
// Body: { token, title, body, data?, link?, image?, badge?, channel? } | { tokens: [...], ... }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendPush, sendPushMulticast } from "../_shared/firebase.ts";
import { logger } from "../_shared/logger.ts";
import { requireServiceRole, safeErrorResponse } from "../_shared/internal-auth.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    requireServiceRole(req);
    const body = await req.json();
    const log = logger.child({ function: "send-push" });

    if (Array.isArray(body.tokens) && body.tokens.length > 0) {
      const res = await sendPushMulticast(body.tokens, {
        title: body.title,
        body: body.body,
        data: body.data,
        imageUrl: body.image,
        clickAction: body.link,
        badge: body.badge,
        androidChannelId: body.channel ?? "default",
      });
      const success = res.filter((r) => r.success).length;
      log.info("push_multicast_sent", { total: res.length, success });
      return jsonResponse({ total: res.length, success, results: res });
    }

    if (!body.token) return errorResponse("token_or_tokens_required", 400);
    const r = await sendPush({
      token: body.token,
      title: body.title,
      body: body.body,
      data: body.data,
      imageUrl: body.image,
      clickAction: body.link,
      badge: body.badge,
      androidChannelId: body.channel ?? "default",
    });
    return jsonResponse({ id: r.id, provider: r.provider });
  } catch (err) {
    logger.error("send-push failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
