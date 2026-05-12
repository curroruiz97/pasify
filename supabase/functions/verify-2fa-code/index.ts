// Pasify · verify-2fa-code
// Verifica código TOTP. Si user_2fa.enabled = false → marca como enabled (setup completo).
// Si enabled = true → es un challenge de login.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";

function base32Decode(s: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bits = clean.split("").map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function generateTOTP(secret: string, timeStep = 30, digits = 6, t = Math.floor(Date.now() / 1000)): Promise<string> {
  const counter = Math.floor(t / timeStep);
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter & 0xffffffff);

  const keyBytes = base32Decode(secret);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));

  const offset = signature[signature.length - 1] & 0xf;
  const code =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { code, is_backup_code } = await req.json();
    if (!code) return errorResponse("code_required", 400);

    // Rate limit estricto: 5 intentos / 15 min
    await enforceRateLimit({ key: `2fa:${user.id}`, max: 5, windowSec: 900 });

    const { data: rec } = await supabaseAdmin.from("user_2fa").select("*").eq("user_id", user.id).maybeSingle();
    if (!rec) return errorResponse("2fa_not_setup", 400);

    let valid = false;

    if (is_backup_code) {
      const codeHash = await hashCode(code.replace(/\s/g, "").toLowerCase());
      const idx = (rec.backup_codes_hashed ?? []).indexOf(codeHash);
      if (idx >= 0) {
        valid = true;
        const remaining = [...rec.backup_codes_hashed];
        remaining.splice(idx, 1);
        await supabaseAdmin.from("user_2fa").update({ backup_codes_hashed: remaining }).eq("user_id", user.id);
      }
    } else {
      const secret = new TextDecoder().decode(rec.totp_secret_encrypted);
      // Verifica current + previous + next time step (±30s tolerance)
      const t = Math.floor(Date.now() / 1000);
      for (const offset of [-30, 0, 30]) {
        const expected = await generateTOTP(secret, 30, 6, t + offset);
        if (expected === code) {
          valid = true;
          break;
        }
      }
    }

    if (!valid) {
      logger.warn("2fa_invalid_code", { user_id: user.id, is_backup: !!is_backup_code });
      return errorResponse("invalid_code", 400);
    }

    // Marca enabled si era setup
    if (!rec.enabled) {
      await supabaseAdmin.from("user_2fa").update({
        enabled: true,
        enabled_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      }).eq("user_id", user.id);
    } else {
      await supabaseAdmin.from("user_2fa").update({ last_used_at: new Date().toISOString() }).eq("user_id", user.id);
    }

    logger.info("2fa_verified", { user_id: user.id });
    return jsonResponse({ ok: true });
  } catch (err) {
    logger.error("verify-2fa-code failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
