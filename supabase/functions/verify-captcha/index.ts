// Pasify · verify-captcha (pública, verify_jwt = false)
//
// Comprueba un token de Cloudflare Turnstile contra siteverify. La app web lo
// pide antes de signUp (RegisterClient, RegisterPartner) y de
// resetPasswordForEmail (ResetPassword), solo si existe VITE_TURNSTILE_SITE_KEY.
// En la app nativa no hay widget (Apple y Google lo desaconsejan dentro de
// apps) y no se llama.
//
// Body: { token: string, action?: string }. `action` es la del widget
// ("signup", "reset-password"): si llega, tiene que coincidir con la que
// devuelve Cloudflare, así un token de un formulario no vale para otro.
// Respuesta: 200 { success: true } · 400 { success: false, errors } · 503
// captcha_not_configured si falta el secreto en producción o Cloudflare dice
// que no es válido (invalid-input-secret).
//
// Sin TURNSTILE_SECRET_KEY: fuera de producción se aprueba (desarrollo); en
// producción falla CERRADO (503 captcha_not_configured). Antes aprobaba todo
// también en producción. Opcional: TURNSTILE_ALLOWED_HOSTNAMES (lista separada
// por comas) exige que el token venga de esos dominios.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { clientIp, enforceRateLimit } from "../_shared/rate-limit.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { isProductionEnv } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";

const TURNSTILE_SECRET = (Deno.env.get("TURNSTILE_SECRET_KEY") ?? "").trim();
const ALLOWED_HOSTNAMES = (Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES") ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 8_000;

// Acción del widget: letras, cifras, "_" y "-", hasta 32 (lo que admite Turnstile).
const ACTION_RE = /^[A-Za-z0-9_-]{1,32}$/;

interface SiteverifyResult {
  success?: boolean;
  "error-codes"?: string[];
  action?: string;
  hostname?: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

    // Pública: que nadie la use para gastar invocaciones a nuestra costa.
    await enforceRateLimit({ key: `verify_captcha:ip:${clientIp(req)}`, max: 30, windowSec: 600 });

    if (!TURNSTILE_SECRET) {
      if (isProductionEnv()) {
        logger.error("verify_captcha_not_configured");
        return jsonResponse({ success: false, error: "captcha_not_configured" }, { status: 503 });
      }
      return jsonResponse({ success: true, dev_mode: true });
    }

    const body = (await req.json().catch(() => ({}))) as { token?: unknown; action?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    // Los tokens de Turnstile tienen como mucho 2048 caracteres.
    if (!token || token.length > 2048) {
      return jsonResponse({ success: false, errors: ["token_required"] }, { status: 400 });
    }
    const action = typeof body.action === "string" && ACTION_RE.test(body.action) ? body.action : null;

    const params = new URLSearchParams();
    params.set("secret", TURNSTILE_SECRET);
    params.set("response", token);
    const ip = clientIp(req);
    if (ip !== "unknown") params.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: params,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error("verify_captcha_siteverify_http", { status: res.status });
      return jsonResponse({ success: false, errors: ["siteverify_unavailable"] }, { status: 502 });
    }
    const data = (await res.json()) as SiteverifyResult;

    if (!data.success) {
      const errores = data["error-codes"] ?? [];
      // Secreto mal puesto (p. ej. el de otro servicio): es cosa nuestra, no del usuario.
      if (errores.includes("invalid-input-secret") || errores.includes("missing-input-secret")) {
        logger.error("verify_captcha_bad_secret", { errors: errores });
        return jsonResponse({ success: false, error: "captcha_not_configured" }, { status: 503 });
      }
      return jsonResponse({ success: false, errors: errores }, { status: 400 });
    }
    if (action && data.action !== action) {
      return jsonResponse({ success: false, errors: ["action_mismatch"] }, { status: 400 });
    }
    if (ALLOWED_HOSTNAMES.length > 0 && !ALLOWED_HOSTNAMES.includes((data.hostname ?? "").toLowerCase())) {
      return jsonResponse({ success: false, errors: ["hostname_mismatch"] }, { status: 400 });
    }
    return jsonResponse({ success: true });
  } catch (err) {
    return safeErrorResponse(err);
  }
});
