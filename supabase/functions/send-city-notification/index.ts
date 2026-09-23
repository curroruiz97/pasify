// Pasify · send-city-notification
// Push a los usuarios de una ciudad cuando se publica un evento/descuento.
// La llama CreateEventDialog (panel admin → CalendarManagement, actuando en
// nombre de un local) y CreateDiscountDialog. Antes era pública: cualquiera
// mandaba un push con texto libre a toda una ciudad (o a toda la base,
// inyectando el filtro). Ahora solo un admin de plataforma: un local
// cualquiera podía mandar texto libre a todos los usuarios de una ciudad.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { knownError } from "../_shared/internal-auth.ts";

// city/country acaban dentro de un filtro .or() de PostgREST: fuera comas,
// paréntesis, comodines (*, %) y dos puntos, o se podía ampliar el filtro.
function cleanFilterValue(value: unknown): string {
  return String(value ?? "").replace(/[^\p{L}\p{M}\p{N} .'-]/gu, "").trim().slice(0, 80);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NotificationPayload {
  city: string;
  country?: string;
  partnerName: string;
  partnerId: string;
  type: 'discount' | 'event';
  title: string;
  discountPercentage?: number;
  language?: string;
}

// Translations
const translations: Record<string, Record<string, { title: string; body: string }>> = {
  discount: {
    es: { title: '🎉 ¡Nuevo descuento en {city}!', body: '{partner} ofrece: {title}' },
    it: { title: '🎉 Nuovo sconto a {city}!', body: '{partner} offre: {title}' },
    en: { title: '🎉 New discount in {city}!', body: '{partner} offers: {title}' },
    fr: { title: '🎉 Nouvelle réduction à {city}!', body: '{partner} propose: {title}' },
    de: { title: '🎉 Neuer Rabatt in {city}!', body: '{partner} bietet: {title}' },
  },
  event: {
    es: { title: '📅 ¡Nuevo evento en {city}!', body: '{partner}: {title}' },
    it: { title: '📅 Nuovo evento a {city}!', body: '{partner}: {title}' },
    en: { title: '📅 New event in {city}!', body: '{partner}: {title}' },
    fr: { title: '📅 Nouvel événement à {city}!', body: '{partner}: {title}' },
    de: { title: '📅 Neues Event in {city}!', body: '{partner}: {title}' },
  },
};

// Helper functions for JWT
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
    console.log('🔔 send-city-notification function called');

    const user = await requireUser(req);
    const payload: NotificationPayload = await req.json();
    const { partnerName, partnerId, type, title, discountPercentage, language = 'es' } = payload;

    // Push masivo a una ciudad: solo admin de plataforma.
    const isAdmin = await isPlatformAdmin(user.id);
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (typeof partnerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(partnerId) || (type !== 'event' && type !== 'discount')) {
      return new Response(
        JSON.stringify({ error: 'invalid_payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Es un push masivo: como mucho 10 por local y hora.
    await enforceRateLimit({ key: `city_notif:${partnerId}`, max: 10, windowSec: 3600 });

    const city = cleanFilterValue(payload.city);
    const country = payload.country ? cleanFilterValue(payload.country) : '';

    const supabase = supabaseAdmin;

    const firebaseServiceAccountJson = Deno.env.get('FIREBASE_ADMIN_SERVICE_ACCOUNT');
    if (!firebaseServiceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'Missing Firebase configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firebaseConfig = JSON.parse(firebaseServiceAccountJson);
    const projectId = firebaseConfig.project_id;

    if (!city) {
      console.log('⚠️ No city provided');
      return new Response(
        JSON.stringify({ message: 'No city provided' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Query profiles matching city/country directly (filter at DB level)
    let profileQuery = supabase
      .from('profiles')
      .select('id')
      .neq('id', partnerId)
      .or(`city.ilike.${city},business_city.ilike.${city}`);

    if (country) {
      profileQuery = profileQuery.or(`country.eq.${country},business_country.eq.${country}`);
    }

    const { data: matchingProfiles, error: profilesError } = await profileQuery;

    if (profilesError) {
      console.error('❌ Error fetching profiles:', profilesError.message);
      return new Response(
        JSON.stringify({ error: 'Error fetching profiles' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!matchingProfiles || matchingProfiles.length === 0) {
      console.log(`📍 No users found in ${city}${country ? `, ${country}` : ''}`);
      return new Response(
        JSON.stringify({ message: 'No users found in this city/country', city, country }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const matchingUserIds = new Set(matchingProfiles.map((p: any) => p.id));
    console.log(`📍 Found ${matchingUserIds.size} profiles in ${city}${country ? `, ${country}` : ''}`);

    // Step 2: Get FCM tokens only for matching users
    const { data: userTokens, error: fetchError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token, platform, user_id')
      .neq('user_id', partnerId);

    if (fetchError) {
      console.error('❌ Error fetching FCM tokens:', fetchError.message);
      return new Response(
        JSON.stringify({ error: 'Error fetching FCM tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter tokens to only users in matching city/country
    const usersInCity = (userTokens || []).filter((t: any) => matchingUserIds.has(t.user_id));
    console.log(`🔔 ${usersInCity.length} FCM tokens to notify`);

    if (usersInCity.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No users found in this city', city }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get translation
    const lang = translations[type]?.[language] ? language : 'es';
    const template = translations[type]?.[lang] || translations[type]?.['es'];

    const notifTitle = template.title
      .replace('{city}', city);

    let notifBody = template.body
      .replace('{partner}', partnerName)
      .replace('{title}', title);

    if (type === 'discount' && discountPercentage) {
      notifBody += ` (-${discountPercentage}%)`;
    }

    // Get OAuth2 access token
    console.log('🔑 Getting OAuth2 access token...');
    let accessToken = await getAccessToken(firebaseConfig);

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    // Send notifications sequentially in small batches with token refresh on auth failure
    let successCount = 0;
    let errorCount = 0;
    let unregisteredCount = 0;
    const staleTokenUserIds: string[] = [];

    for (let i = 0; i < usersInCity.length; i++) {
      const userToken = usersInCity[i];
      try {
        const fcmMessage = {
          message: {
            token: userToken.fcm_token,
            notification: {
              title: notifTitle,
              body: notifBody,
            },
            data: {
              type: type,
              partnerId: partnerId,
              city: city,
            },
            android: {
              priority: 'high' as const,
              notification: {
                channelId: 'city_notifications',
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

        const fcmResponse = await fetch(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        });

        if (fcmResponse.ok) {
          successCount++;
        } else {
          const errorText = await fcmResponse.text();

          // If auth error, refresh token and retry once
          if (fcmResponse.status === 401) {
            console.log('🔄 Token expired, refreshing...');
            accessToken = await getAccessToken(firebaseConfig);
            // Retry this message with new token
            const retryResponse = await fetch(fcmUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(fcmMessage),
            });
            if (retryResponse.ok) {
              successCount++;
            } else {
              errorCount++;
              if (errorCount <= 3) console.warn(`Failed after retry for ${userToken.user_id}`);
            }
          } else if (fcmResponse.status === 404) {
            // UNREGISTERED - stale FCM token, clean up later
            unregisteredCount++;
            staleTokenUserIds.push(userToken.user_id);
          } else {
            errorCount++;
            if (errorCount <= 3) {
              console.warn(`Failed to send to user ${userToken.user_id}:`, errorText);
            }
          }
        }
      } catch (error) {
        errorCount++;
      }

      // Small delay every 10 messages to avoid overwhelming FCM
      if (i > 0 && i % 10 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Clean up stale FCM tokens (UNREGISTERED devices)
    if (staleTokenUserIds.length > 0) {
      console.log(`🧹 Cleaning ${staleTokenUserIds.length} stale FCM tokens`);
      for (const userId of staleTokenUserIds) {
        try {
          await supabase.from('user_fcm_tokens').delete().eq('user_id', userId);
        } catch (_) { /* ignore cleanup errors */ }
      }
    }

    console.log(`✅ City notifications: ${successCount} sent, ${errorCount} errors, ${unregisteredCount} stale tokens cleaned`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Notifications sent to ${successCount} users in ${city}`,
        successCount,
        errorCount,
        totalUsers: usersInCity.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const known = knownError(error);
    if (!known) console.error('❌ Edge Function error:', error);
    return new Response(
      JSON.stringify({ error: known?.code ?? 'internal_error' }),
      { status: known?.status ?? 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
