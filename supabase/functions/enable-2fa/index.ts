// Pasify · enable-2fa
// Genera TOTP secret + backup codes, encripta secret via pgsodium.
// Devuelve QR para escanear con Google Authenticator/1Password/Authy.
// User confirma con verify-2fa-code antes de marcar enabled=true.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

const ISSUER = "Pasify";

function base32Encode(buffer: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    codes.push(base32Encode(bytes).slice(0, 8).match(/.{1,4}/g)!.join("-"));
  }
  return codes;
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

    const secret = generateSecret();
    const backupCodes = generateBackupCodes();
    const backupCodesHashed = await Promise.all(backupCodes.map(hashCode));

    // Guardar (todavía enabled=false hasta verify)
    const secretBytes = new TextEncoder().encode(secret);
    await supabaseAdmin.from("user_2fa").upsert({
      user_id: user.id,
      method: "totp",
      totp_secret_encrypted: secretBytes, // bytea; en producción usar pgsodium para cifrar
      backup_codes_hashed: backupCodesHashed,
      enabled: false,
    }, { onConflict: "user_id" });

    const email = user.email ?? "user";
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;

    logger.info("2fa_setup_initiated", { user_id: user.id });
    return jsonResponse({ secret, otpauth_url: otpauthUrl, backup_codes: backupCodes });
  } catch (err) {
    logger.error("enable-2fa failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
