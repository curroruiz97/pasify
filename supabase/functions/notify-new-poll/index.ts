// Notifica push a tutti gli utenti (con FCM token) quando viene creato un nuovo sondaggio.
// Il payload arriva dal client dopo l'insert in DB.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PollNotifyPayload {
  poll_id: string;
  actor_name: string;
  question: string;
  city: string | null;
}

// === FCM helpers (riusa pattern di send-social-notification) ===
function base64ToBase64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateJWT(serviceAccount: any): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encodedHeader = base64ToBase64url(btoa(JSON.stringify(header)));
  const encodedPayload = base64ToBase64url(btoa(JSON.stringify(payload)));
  const unsigned = `${encodedHeader}.${encodedPayload}`;

  const pem = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64ToBase64url(btoa(String.fromCharCode(...new Uint8Array(sig))))}`;
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const jwt = await generateJWT(serviceAccount);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const fbJson = Deno.env.get("FIREBASE_ADMIN_SERVICE_ACCOUNT");
    if (!supabaseUrl || !supabaseKey || !fbJson) {
      return json({ error: "Missing config" }, 500);
    }

    const sb = createClient(supabaseUrl, supabaseKey);
    const fb = JSON.parse(fbJson);

    const body: PollNotifyPayload = await req.json();
    const { poll_id, actor_name, question, city } = body;

    if (!poll_id || !actor_name || !question) {
      return json({ error: "Missing fields" }, 400);
    }

    // Recupera autore per escluderlo dalla notifica
    const { data: poll } = await sb.from("polls").select("user_id").eq("id", poll_id).maybeSingle();
    const authorId = poll?.user_id;

    // Recupera tutti gli FCM token (filtro città se disponibile)
    let q = sb.from("user_fcm_tokens").select("user_id, fcm_token, platform");
    const { data: tokens, error: tokenErr } = await q;
    if (tokenErr) return json({ error: tokenErr.message }, 500);

    const recipients = (tokens || []).filter((t) => t.user_id !== authorId);
    if (recipients.length === 0) {
      return json({ message: "No recipients", sent: 0 }, 200);
    }

    const accessToken = await getAccessToken(fb);
    const projectId = fb.project_id;

    const title = `📊 Nueva encuesta de ${actor_name}`;
    const trimmedQuestion = question.length > 80 ? question.slice(0, 80) + "..." : question;
    const bodyText = trimmedQuestion;

    let sent = 0;
    let failed = 0;

    // Send in parallel batches
    const batchSize = 20;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const promises = batch.map(async (r) => {
        const fcmMessage = {
          message: {
            token: r.fcm_token,
            notification: { title, body: bodyText },
            data: {
              type: "new_poll",
              poll_id,
              actor_name,
              city: city || "",
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            },
          },
        };
        try {
          const resp = await fetch(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(fcmMessage),
            },
          );
          if (resp.ok) sent++;
          else {
            failed++;
            console.warn(`FCM send failed for ${r.user_id}: ${resp.status}`);
          }
        } catch (e) {
          failed++;
          console.warn(`FCM error for ${r.user_id}:`, e);
        }
      });
      await Promise.all(promises);
    }

    return json({ message: "ok", sent, failed, total: recipients.length }, 200);
  } catch (err) {
    console.error("notify-new-poll error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
