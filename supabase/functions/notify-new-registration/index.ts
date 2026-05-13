import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/gmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RegistrationNotification {
  userEmail: string;
  userType: 'client' | 'partner';
  firstName?: string;
  lastName?: string;
  university?: string;
  businessName?: string;
}

const ADMIN_EMAIL = "admin@pasify.es";

// Helper function to convert base64url to base64
function base64urlToBase64(base64url: string): string {
  return base64url.replace(/-/g, '+').replace(/_/g, '/');
}

// Helper function to convert base64 to base64url
function base64ToBase64url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate JWT for Google OAuth2
async function generateJWT(serviceAccount: any): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64ToBase64url(btoa(JSON.stringify(header)));
  const encodedPayload = base64ToBase64url(btoa(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const data = encoder.encode(unsignedToken);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    data
  );

  const base64Signature = base64ToBase64url(
    btoa(String.fromCharCode(...new Uint8Array(signature)))
  );

  return `${unsignedToken}.${base64Signature}`;
}

// Get OAuth2 access token from Google
async function getAccessToken(serviceAccount: any): Promise<string> {
  const jwt = await generateJWT(serviceAccount);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Send FCM push notification to all admin users
async function sendAdminPushNotification(
  supabase: any,
  isPartner: boolean,
  userName: string,
  userEmail: string
): Promise<void> {
  try {
    // Find all admin user IDs
    const { data: adminRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (rolesError || !adminRoles || adminRoles.length === 0) {
      console.log('No admin users found for push notification');
      return;
    }

    const adminUserIds = adminRoles.map((r: any) => r.user_id);
    console.log(`Found ${adminUserIds.length} admin user(s)`);

    // Get FCM tokens for all admins
    const { data: fcmTokens, error: fcmError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token, platform, user_id')
      .in('user_id', adminUserIds);

    if (fcmError || !fcmTokens || fcmTokens.length === 0) {
      console.log('No FCM tokens found for admin users');
      return;
    }

    // Get Firebase service account
    const firebaseServiceAccountJson = Deno.env.get('FIREBASE_ADMIN_SERVICE_ACCOUNT');
    if (!firebaseServiceAccountJson) {
      console.error('FIREBASE_ADMIN_SERVICE_ACCOUNT not configured, skipping push');
      return;
    }

    const firebaseConfig = JSON.parse(firebaseServiceAccountJson);
    const projectId = firebaseConfig.project_id;
    const accessToken = await getAccessToken(firebaseConfig);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    const userTypeLabel = isPartner ? 'Partner' : 'Cliente';
    const title = `Nuevo ${userTypeLabel} registrado`;
    const body = `${userName || userEmail} se ha registrado. Pendiente de aprobación.`;

    // Send push to each admin token
    for (const tokenData of fcmTokens) {
      try {
        const fcmMessage = {
          message: {
            token: tokenData.fcm_token,
            notification: {
              title,
              body,
            },
            data: {
              type: 'new_registration',
              userType: isPartner ? 'partner' : 'client',
              userEmail,
              userName: userName || '',
            },
            android: {
              priority: 'high' as const,
              notification: {
                channelId: 'chat_messages',
                sound: 'default',
                defaultSound: true,
                defaultVibrateTimings: true,
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: 'default',
                  badge: 1,
                },
              },
            },
          },
        };

        let fcmResponse = await fetch(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        });

        // Retry once with fresh token if 401
        if (fcmResponse.status === 401) {
          console.log('Got 401, retrying with fresh access token...');
          const retryToken = await getAccessToken(firebaseConfig);
          fcmResponse = await fetch(fcmUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${retryToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(fcmMessage),
          });
        }

        if (fcmResponse.ok) {
          console.log(`Push sent to admin ${tokenData.user_id} (${tokenData.platform})`);
        } else {
          const errorText = await fcmResponse.text();
          console.error(`Failed to send push to admin ${tokenData.user_id}:`, errorText);
        }
      } catch (pushError) {
        console.error(`Error sending push to admin ${tokenData.user_id}:`, pushError);
      }
    }
  } catch (error) {
    console.error('Error in sendAdminPushNotification:', error);
  }
}

const handler = async (req: Request): Promise<Response> => {
  console.log("notify-new-registration: Request received");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const body: RegistrationNotification = await req.json();
    console.log("notify-new-registration: Processing notification for:", body.userEmail, "Type:", body.userType);

    const isPartner = body.userType === 'partner';
    const userName = isPartner
      ? body.businessName
      : `${body.firstName || ''} ${body.lastName || ''}`.trim();

    // --- PUSH NOTIFICATION to admin ---
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await sendAdminPushNotification(supabase, isPartner, userName, body.userEmail);
    } else {
      console.log("notify-new-registration: Supabase config missing, skipping push notification");
    }

    // --- EMAIL notification to admin ---
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Nuevo Usuario Registrado</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); border-radius: 16px 16px 0 0; padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">🎉 Nuevo ${isPartner ? 'Partner' : 'Cliente'} Registrado</h1>
          </div>
          <div style="background: white; border-radius: 0 0 16px 16px; padding: 32px;">
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
              Un nuevo ${isPartner ? 'partner' : 'cliente'} se ha registrado en Pasify:
            </p>

            <div style="background: #f3f4f6; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px;">
                <strong style="color: #374151;">Nombre:</strong> ${userName || 'No especificado'}
              </p>
              <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px;">
                <strong style="color: #374151;">Email:</strong> ${body.userEmail}
              </p>
              <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px;">
                <strong style="color: #374151;">Tipo:</strong> ${isPartner ? 'Partner' : 'Cliente'}
              </p>
              ${body.university ? `
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                <strong style="color: #374151;">Universidad:</strong> ${body.university}
              </p>
              ` : ''}
            </div>

            <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
              ⚠️ ${isPartner ? 'Este partner' : 'Este usuario'} está pendiente de aprobación. Accede al panel de administración para aprobar o rechazar la solicitud.
            </p>

            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <a href="https://www.pasify.es/#/admin" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                Ir al Panel Admin
              </a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px;">
            Pasify - La comunidad de los estudiantes
          </p>
        </div>
      </body>
      </html>
    `;

    try {
      await sendEmail({
        to: [ADMIN_EMAIL],
        subject: `🆕 Nuevo ${isPartner ? 'Partner' : 'Cliente'}: ${userName || body.userEmail}`,
        html: emailHtml,
      });

      console.log("notify-new-registration: Email sent successfully via Gmail SMTP");
      return new Response(
        JSON.stringify({ success: true, message: "Push and email sent" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (emailError: any) {
      console.error("notify-new-registration: Gmail SMTP error:", emailError);
      return new Response(
        JSON.stringify({ success: true, message: "Push sent, email failed", error: emailError.message }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("notify-new-registration: Error:", errorMessage);
    return new Response(
      JSON.stringify({ success: true, message: "Registration successful, notification error", error: errorMessage }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
