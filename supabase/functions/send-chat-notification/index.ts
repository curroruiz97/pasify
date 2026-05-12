import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NotificationPayload {
recipientUserId: string;
senderName: string;
messageContent: string;
conversationId: string;
senderId: string;
language?: string;
}

// Chat notification translations
const chatTranslations: Record<string, string> = {
  es: 'Nuevo mensaje de',
  it: 'Nuovo messaggio da',
  en: 'New message from',
  fr: 'Nouveau message de',
  de: 'Neue Nachricht von',
};

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

  // Import private key
  const privateKeyPem = serviceAccount.private_key;
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

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

  // Sign the token
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    console.log('🔔 send-chat-notification function called');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Firebase service account
    const firebaseServiceAccountJson = Deno.env.get('FIREBASE_ADMIN_SERVICE_ACCOUNT');
    if (!firebaseServiceAccountJson) {
      console.error('❌ FIREBASE_ADMIN_SERVICE_ACCOUNT secret not found');
      return new Response(
        JSON.stringify({ error: 'Missing Firebase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firebaseConfig = JSON.parse(firebaseServiceAccountJson);
    const projectId = firebaseConfig.project_id;
    console.log('📱 Firebase project ID:', projectId);

    // Parse request body
    const payload: NotificationPayload = await req.json();
    console.log('📨 Notification payload:', { ...payload, messageContent: payload.messageContent.substring(0, 50) });

    const { recipientUserId, senderName, messageContent, conversationId, language = 'es' } = payload;

    if (!recipientUserId) {
      console.error('❌ Recipient user ID not provided');
      return new Response(
        JSON.stringify({ error: 'Recipient user ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all recipient's FCM tokens (user may have multiple devices)
    const { data: userDevices, error: fetchError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token, platform')
      .eq('user_id', recipientUserId);

    if (fetchError) {
      console.error('❌ Error fetching FCM tokens:', fetchError.message);
      return new Response(
        JSON.stringify({ error: 'Error fetching FCM tokens', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userDevices || userDevices.length === 0) {
      console.log('⚠️ No FCM tokens found for user:', recipientUserId);
      return new Response(
        JSON.stringify({ message: 'No FCM token registered for user' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Found ${userDevices.length} device(s) for user ${recipientUserId}`);

    // Prepare message content
    const truncatedMessage = messageContent.length > 100
      ? messageContent.substring(0, 97) + '...'
      : messageContent;

    const titlePrefix = chatTranslations[language] || chatTranslations['es'];

    // Get OAuth2 access token
    console.log('🔑 Getting OAuth2 access token...');
    const accessToken = await getAccessToken(firebaseConfig);
    console.log('✅ Access token obtained');

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    // Send notification to all devices
    const results = [];
    for (const device of userDevices) {
      console.log(`📤 Sending FCM notification to ${device.platform} device...`);

      const fcmMessage = {
        message: {
          token: device.fcm_token,
          notification: {
            title: `${titlePrefix} ${senderName}`,
            body: truncatedMessage,
          },
          data: {
            conversationId: conversationId,
            senderId: payload.senderId,
            type: 'chat_message',
            // targetUserId permette al deep-link handler client di
            // capire a quale account è destinata la notifica (utile
            // su device multi-account).
            targetUserId: recipientUserId,
          },
          android: {
            priority: 'high' as const,
            notification: {
              channelId: 'chat_messages',
              sound: 'default',
              defaultSound: true,
              defaultVibrateTimings: true,
              defaultLightSettings: true,
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

      try {
        const fcmResponse = await fetch(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        });

        if (!fcmResponse.ok) {
          const errorText = await fcmResponse.text();
          console.error(`❌ FCM API error for ${device.platform}:`, errorText);
          results.push({ platform: device.platform, success: false, error: errorText });
        } else {
          const fcmResult = await fcmResponse.json();
          console.log(`✅ FCM notification sent to ${device.platform}:`, fcmResult.name);
          results.push({ platform: device.platform, success: true, messageId: fcmResult.name });
        }
      } catch (err) {
        console.error(`❌ Error sending to ${device.platform}:`, err);
        results.push({ platform: device.platform, success: false, error: String(err) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Notifications sent: ${successCount}/${userDevices.length} successful`);

    return new Response(
      JSON.stringify({
        success: successCount > 0,
        message: `Notification sent to ${successCount}/${userDevices.length} devices`,
        results,
        recipientUserId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Edge Function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return new Response(
      JSON.stringify({ error: errorMessage, stack: errorStack }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
