// Pasify · verify-captcha (public endpoint, verify_jwt = false)
// Valida token Cloudflare Turnstile contra su API.
// Llamado desde Login, RegisterClient, RegisterPartner, ResetPassword.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { clientIp } from "../_shared/rate-limit.ts";

const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    if (!TURNSTILE_SECRET) {
      // Dev: si no hay secret configurado, pasar permitir (modo desarrollo)
      return jsonResponse({ success: true, dev_mode: true });
    }

    const { token } = await req.json();
    if (!token) return errorResponse("token_required", 400);

    const params = new URLSearchParams();
    params.set("secret", TURNSTILE_SECRET);
    params.set("response", token);
    params.set("remoteip", clientIp(req));

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: params,
    });
    const data = await res.json();

    if (!data.success) {
      return jsonResponse({ success: false, errors: data["error-codes"] ?? [] }, { status: 400 });
    }
    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
