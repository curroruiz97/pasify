// Pasify · Firebase Cloud Messaging (HTTP v1 API + OAuth service account)
// Implementación nativa Deno sin SDK (no necesitamos firebase-admin completo).

import { logger } from "./logger.ts";

const FIREBASE_SERVICE_ACCOUNT_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") ?? "";
const FCM_LEGACY_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY") ?? "";

let cachedToken: { token: string; expires_at: number } | null = null;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function parseServiceAccount(): ServiceAccount | null {
  if (!FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  try {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    logger.error("firebase_service_account_invalid", { error: String(e) });
    return null;
  }
}

/** PEM → CryptoKey (RS256). */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Genera un access_token OAuth2 con scope FCM. Cache hasta 5min antes de expirar. */
async function getAccessToken(): Promise<string | null> {
  const sa = parseServiceAccount();
  if (!sa) return null;

  if (cachedToken && cachedToken.expires_at - 300 > Math.floor(Date.now() / 1000)) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claim));
  const unsigned = `${header}.${payload}`;

  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    logger.error("fcm_oauth_failed", { status: res.status, body: await res.text() });
    return null;
  }
  const json = await res.json();
  cachedToken = { token: json.access_token, expires_at: now + json.expires_in };
  return json.access_token;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  /** Channel id Android. Por defecto "default". */
  androidChannelId?: string;
  /** Sound iOS. Por defecto "default". */
  iosSound?: string;
  /** Badge count iOS (Mis tickets). */
  badge?: number;
  /** Click action (deep link). Ej "/#/refund/abc-123". */
  clickAction?: string;
}

/**
 * Envía push a un device token vía FCM HTTP v1.
 * Si no hay service account, fallback simulated (log only) para dev.
 */
export async function sendPush(msg: FcmMessage): Promise<{ id: string; provider: "fcm" | "fallback" }> {
  const sa = parseServiceAccount();
  if (!sa) {
    logger.warn("fcm_not_configured", { token_prefix: msg.token.slice(0, 12), title: msg.title });
    return { id: `simulated-${crypto.randomUUID()}`, provider: "fallback" };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error("Failed to obtain FCM access token");

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const body = {
    message: {
      token: msg.token,
      notification: {
        title: msg.title,
        body: msg.body,
        image: msg.imageUrl,
      },
      data: {
        ...msg.data,
        click_action: msg.clickAction ?? "",
      },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: msg.androidChannelId ?? "default",
          icon: "ic_notification",
          color: "#E8542A",
          click_action: msg.clickAction ?? "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: msg.iosSound ?? "default",
            badge: msg.badge,
            "mutable-content": 1,
          },
        },
        fcm_options: { image: msg.imageUrl },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error("fcm_send_failed", { status: res.status, body: errText });
    throw new Error(`FCM send failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  return { id: json.name as string, provider: "fcm" };
}

/** Multicast: envía mismo mensaje a varios tokens. Devuelve resultados por token. */
export async function sendPushMulticast(
  tokens: string[],
  payload: Omit<FcmMessage, "token">
): Promise<Array<{ token: string; success: boolean; id?: string; error?: string }>> {
  const results = await Promise.allSettled(
    tokens.map((token) => sendPush({ ...payload, token }))
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") {
      return { token: tokens[i], success: true, id: r.value.id };
    }
    return { token: tokens[i], success: false, error: String(r.reason) };
  });
}
