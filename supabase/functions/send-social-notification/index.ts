import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NotificationPayload {
  recipientUserId: string;
  actorName: string;
  actorId: string;
  type: 'like' | 'comment' | 'follow' | 'save';
  postId?: string;
  commentContent?: string;
  language?: string; // 'es' | 'it' | 'en' | 'fr' | 'de'
}

// Translations for notifications
const translations: Record<string, Record<string, { title: string; body: string }>> = {
  like: {
    es: { title: 'Nuevo me gusta ❤️', body: 'A {name} le gustó tu publicación' },
    it: { title: 'Nuovo mi piace ❤️', body: 'A {name} è piaciuto il tuo post' },
    en: { title: 'New like ❤️', body: '{name} liked your post' },
    fr: { title: 'Nouveau j\'aime ❤️', body: '{name} a aimé votre publication' },
    de: { title: 'Neues Gefällt mir ❤️', body: '{name} gefällt dein Beitrag' },
  },
  comment: {
    es: { title: 'Nuevo comentario 💬', body: '{name} comentó: {content}' },
    it: { title: 'Nuovo commento 💬', body: '{name} ha commentato: {content}' },
    en: { title: 'New comment 💬', body: '{name} commented: {content}' },
    fr: { title: 'Nouveau commentaire 💬', body: '{name} a commenté: {content}' },
    de: { title: 'Neuer Kommentar 💬', body: '{name} hat kommentiert: {content}' },
  },
  follow: {
    es: { title: 'Nuevo seguidor 👤', body: '{name} comenzó a seguirte' },
    it: { title: 'Nuovo follower 👤', body: '{name} ha iniziato a seguirti' },
    en: { title: 'New follower 👤', body: '{name} started following you' },
    fr: { title: 'Nouveau follower 👤', body: '{name} a commencé à vous suivre' },
    de: { title: 'Neuer Follower 👤', body: '{name} folgt dir jetzt' },
  },
  save: {
    es: { title: 'Post guardado 🔖', body: '{name} guardó tu publicación' },
    it: { title: 'Post salvato 🔖', body: '{name} ha salvato il tuo post' },
    en: { title: 'Post saved 🔖', body: '{name} saved your post' },
    fr: { title: 'Post enregistré 🔖', body: '{name} a enregistré votre publication' },
    de: { title: 'Beitrag gespeichert 🔖', body: '{name} hat deinen Beitrag gespeichert' },
  },
};

// Helper functions for JWT
function base64urlToBase64(base64url: string): string {
  return base64url.replace(/-/g, '+').replace(/_/g, '/');
}

function base64ToBase64url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateJWT(serviceAccount: any): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
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

  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const data = encoder.encode(unsignedToken);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, data);
  const base64Signature = base64ToBase64url(btoa(String.fromCharCode(...new Uint8Array(signature))));

  return `${unsignedToken}.${base64Signature}`;
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const jwt = await generateJWT(serviceAccount);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    console.log('🔔 send-social-notification function called');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const firebaseServiceAccountJson = Deno.env.get('FIREBASE_ADMIN_SERVICE_ACCOUNT');
    if (!firebaseServiceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'Missing Firebase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firebaseConfig = JSON.parse(firebaseServiceAccountJson);
    const projectId = firebaseConfig.project_id;

    const payload: NotificationPayload = await req.json();
    console.log('📨 Social notification payload:', payload);

    const { recipientUserId, actorName, actorId, type, postId, commentContent, language = 'es' } = payload;

    // Don't send notification to yourself
    if (recipientUserId === actorId) {
      console.log('⚠️ Skipping notification - same user');
      return new Response(
        JSON.stringify({ message: 'Skipped - same user' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get recipient's FCM token
    const { data: userDevice, error: fetchError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token, platform')
      .eq('user_id', recipientUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error('❌ Error fetching FCM token:', fetchError.message);
      return new Response(
        JSON.stringify({ error: 'Error fetching FCM token', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!userDevice) {
      console.log('⚠️ No FCM token found for user:', recipientUserId);
      return new Response(
        JSON.stringify({ message: 'No FCM token registered for user' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ FCM token found for platform:', userDevice.platform);

    // Build notification message based on type and language
    const lang = translations[type]?.[language] ? language : 'es';
    const template = translations[type]?.[lang] || translations[type]?.['es'] || { title: 'Notification', body: '{name}' };

    let title = template.title;
    let body = template.body
      .replace('{name}', actorName)
      .replace('{content}', commentContent
        ? (commentContent.length > 40 ? commentContent.substring(0, 40) + '...' : commentContent)
        : '');

    const fcmMessage = {
      message: {
        token: userDevice.fcm_token,
        notification: { title, body },
        data: {
          type: type,
          actorId: actorId,
          postId: postId || '',
        },
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'social_notifications',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: { sound: 'default', badge: 1 },
          },
        },
      },
    };

    console.log('🔑 Getting OAuth2 access token...');
    const accessToken = await getAccessToken(firebaseConfig);

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    console.log('📤 Sending FCM notification...');

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
      console.error('❌ FCM API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to send FCM notification', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fcmResult = await fcmResponse.json();
    console.log('✅ FCM notification sent successfully:', fcmResult);

    return new Response(
      JSON.stringify({ success: true, message: 'Notification sent', fcmMessageId: fcmResult.name }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Edge Function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
