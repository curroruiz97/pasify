// Pasify · revocar Sign in with Apple al borrar la cuenta (guía 5.1.1(v) de
// Apple: https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens).
//
// Para revocar, Apple pide un refresh token o un access token de ESTE usuario
// para esta app. Supabase no guarda ninguno:
//   - La app entra con Apple en iOS con signInWithIdToken (AppleAuthButton): a
//     Supabase solo le llega el identityToken, que no sirve para revocar, y no
//     habla con /auth/token de Apple.
//   - auth.identities.identity_data solo guarda los datos del id_token (sub,
//     email…). provider_token / provider_refresh_token solo existen en la
//     sesión que devuelve un login OAuth por redirección, una vez, y Supabase
//     no los persiste. La app no usa ese flujo con Apple.
// Así que la app, en iOS, pide a Apple un authorization code nuevo justo antes
// de borrar (SignInWithApple.authorize en Ajustes) y lo manda aquí; con él se
// piden los tokens a /auth/token y se revoca el refresh token en /auth/revoke.
// El code caduca a los 5 minutos y vale una vez.
//
// Secretos: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (el .p8 de una
// clave con "Sign in with Apple", PEM PKCS#8; vale con los saltos de línea
// escritos como \n) y APPLE_CLIENT_ID (el bundle id que usa la app para
// entrar con Apple: es.pasify.app). El client_secret es un JWT ES256 firmado
// con esa clave (WebCrypto de Deno, sin librerías).
//
// Nunca bloquea el borrado: devuelve qué ha pasado para dejarlo en el log.

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_TIMEOUT_MS = 8_000;

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "skipped"; reason: "missing_secrets" | "no_authorization_code" | "invalid_private_key" }
  | { status: "failed"; step: "token" | "revoke"; http_status?: number; error?: string }
  | { status: "sub_mismatch" };

interface AppleConfig {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string;
}

export function appleConfig(): AppleConfig | null {
  const teamId = (Deno.env.get("APPLE_TEAM_ID") ?? "").trim();
  const keyId = (Deno.env.get("APPLE_KEY_ID") ?? "").trim();
  const clientId = (Deno.env.get("APPLE_CLIENT_ID") ?? "").trim();
  const privateKey = (Deno.env.get("APPLE_PRIVATE_KEY") ?? "").trim();
  if (!teamId || !keyId || !clientId || !privateKey) return null;
  return { teamId, keyId, clientId, privateKey };
}

const base64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64urlJson = (value: unknown): string => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** .p8 (PEM PKCS#8) → bytes DER. Admite los saltos de línea escritos como "\n". */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new ArrayBuffer(bin.length);
  const view = new Uint8Array(der);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return der;
}

/**
 * client_secret de Apple: JWT ES256 {iss: team, sub: client_id, aud: Apple}.
 * WebCrypto firma ECDSA en formato IEEE P1363 (r‖s, 64 bytes), que es justo
 * lo que pide JWS: no hay que convertir desde DER.
 */
export async function appleClientSecret(cfg: AppleConfig, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(cfg.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64urlJson({ alg: "ES256", kid: cfg.keyId, typ: "JWT" });
  const payload = base64urlJson({
    iss: cfg.teamId,
    iat: nowSec,
    exp: nowSec + 300,
    aud: APPLE_AUDIENCE,
    sub: cfg.clientId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64url(signature)}`;
}

/** `sub` del id_token que devuelve /auth/token (viene de Apple por TLS: no hace falta verificar la firma). */
function subDelIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  const parte = idToken.split(".")[1];
  if (!parte) return null;
  try {
    const json = atob(parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

const errorDe = async (res: Response): Promise<string | undefined> => {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Revoca el acceso de la app al Apple ID de `appleSub` con un authorization
 * code recién pedido. Si el code es de otro Apple ID no revoca nada.
 */
export async function revokeAppleWithCode(
  authorizationCode: string | null,
  appleSub: string | null,
): Promise<AppleRevokeResult> {
  const cfg = appleConfig();
  if (!cfg) return { status: "skipped", reason: "missing_secrets" };
  if (!authorizationCode) return { status: "skipped", reason: "no_authorization_code" };

  let clientSecret: string;
  try {
    clientSecret = await appleClientSecret(cfg);
  } catch {
    return { status: "skipped", reason: "invalid_private_key" };
  }

  let step: "token" | "revoke" = "token";
  try {
    const tokenRes = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    if (!tokenRes.ok) {
      return { status: "failed", step, http_status: tokenRes.status, error: await errorDe(tokenRes) };
    }
    const tokens = (await tokenRes.json()) as { refresh_token?: unknown; access_token?: unknown; id_token?: unknown };

    const sub = subDelIdToken(tokens.id_token);
    if (appleSub && sub && sub !== appleSub) return { status: "sub_mismatch" };

    const refresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : null;
    const access = typeof tokens.access_token === "string" ? tokens.access_token : null;
    const token = refresh ?? access;
    if (!token) return { status: "failed", step, error: "no_token_in_response" };

    step = "revoke";
    const revokeRes = await fetch(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: refresh ? "refresh_token" : "access_token",
      }),
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    if (!revokeRes.ok) {
      return { status: "failed", step, http_status: revokeRes.status, error: await errorDe(revokeRes) };
    }
    return { status: "revoked" };
  } catch (err) {
    // Red o tiempo agotado: se borra la cuenta igual.
    return { status: "failed", step, error: err instanceof Error ? err.name : "network" };
  }
}
