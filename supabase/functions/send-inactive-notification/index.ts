import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Translations for inactive user notifications
const translations: Record<string, { week1: { title: string; body: string }; week2: { title: string; body: string } }> = {
  es: {
    week1: {
      title: '👋 ¡Te echamos de menos!',
      body: '¡Hay muchos descuentos nuevos que te esperan! Vuelve a descubrir las ofertas.',
    },
    week2: {
      title: '🎁 ¡No te pierdas las ofertas!',
      body: 'Han pasado 2 semanas... ¡Tenemos descuentos increíbles esperándote!',
    },
  },
  it: {
    week1: {
      title: '👋 Ci manchi!',
      body: 'Ci sono tanti nuovi sconti che ti aspettano! Torna a scoprire le offerte.',
    },
    week2: {
      title: '🎁 Non perderti le offerte!',
      body: 'Sono passate 2 settimane... Abbiamo sconti incredibili che ti aspettano!',
    },
  },
  en: {
    week1: {
      title: '👋 We miss you!',
      body: 'There are many new discounts waiting for you! Come back and discover the offers.',
    },
    week2: {
      title: '🎁 Don\'t miss the deals!',
      body: 'It\'s been 2 weeks... We have amazing discounts waiting for you!',
    },
  },
  fr: {
    week1: {
      title: '👋 Tu nous manques!',
      body: 'Il y a plein de nouvelles réductions qui t\'attendent! Reviens découvrir les offres.',
    },
    week2: {
      title: '🎁 Ne rate pas les offres!',
      body: 'Ça fait 2 semaines... Nous avons des réductions incroyables qui t\'attendent!',
    },
  },
  de: {
    week1: {
      title: '👋 Wir vermissen dich!',
      body: 'Es warten viele neue Rabatte auf dich! Komm zurück und entdecke die Angebote.',
    },
    week2: {
      title: '🎁 Verpasse nicht die Angebote!',
      body: 'Es sind 2 Wochen vergangen... Wir haben tolle Rabatte, die auf dich warten!',
    },
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
    console.log('🔔 send-inactive-notification function called');

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

    // Calculate dates
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const oneWeekAgoStart = new Date(oneWeekAgo.getTime() - 24 * 60 * 60 * 1000); // 1 day window
    const twoWeeksAgoStart = new Date(twoWeeksAgo.getTime() - 24 * 60 * 60 * 1000); // 1 day window

    console.log('📅 Checking for inactive users...');
    console.log(`   1 week window: ${oneWeekAgoStart.toISOString()} to ${oneWeekAgo.toISOString()}`);
    console.log(`   2 weeks window: ${twoWeeksAgoStart.toISOString()} to ${twoWeeksAgo.toISOString()}`);

    // Get users with FCM tokens and their last activity
    const { data: usersWithTokens, error: fetchError } = await supabase
      .from('user_fcm_tokens')
      .select(`
        fcm_token,
        platform,
        user_id,
        profiles!inner(id, last_active_at, preferred_language, user_type)
      `);

    if (fetchError) {
      console.error('❌ Error fetching users:', fetchError.message);
      return new Response(
        JSON.stringify({ error: 'Error fetching users', details: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter users by inactivity period
    const oneWeekInactiveUsers = usersWithTokens?.filter((u: any) => {
      const lastActive = u.profiles?.last_active_at ? new Date(u.profiles.last_active_at) : null;
      if (!lastActive) return false;
      // User was active between 7-8 days ago (1 week notification window)
      return lastActive >= oneWeekAgoStart && lastActive < oneWeekAgo;
    }) || [];

    const twoWeeksInactiveUsers = usersWithTokens?.filter((u: any) => {
      const lastActive = u.profiles?.last_active_at ? new Date(u.profiles.last_active_at) : null;
      if (!lastActive) return false;
      // User was active between 14-15 days ago (2 weeks notification window)
      return lastActive >= twoWeeksAgoStart && lastActive < twoWeeksAgo;
    }) || [];

    console.log(`📊 Found ${oneWeekInactiveUsers.length} users inactive for 1 week`);
    console.log(`📊 Found ${twoWeeksInactiveUsers.length} users inactive for 2 weeks`);

    // Get OAuth2 access token
    console.log('🔑 Getting OAuth2 access token...');
    const accessToken = await getAccessToken(firebaseConfig);

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    let successCount = 0;
    let errorCount = 0;

    // Send 1-week notifications
    for (const userToken of oneWeekInactiveUsers) {
      try {
        const lang = userToken.profiles?.preferred_language || 'es';
        const template = translations[lang]?.week1 || translations['es'].week1;

        const fcmMessage = {
          message: {
            token: userToken.fcm_token,
            notification: {
              title: template.title,
              body: template.body,
            },
            data: {
              type: 'inactive_reminder',
              period: '1_week',
            },
            android: {
              priority: 'high' as const,
              notification: {
                channelId: 'inactive_notifications',
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
          console.log(`✅ Sent 1-week notification to user ${userToken.user_id}`);
        } else {
          errorCount++;
          const errorText = await fcmResponse.text();
          console.warn(`Failed to send to user ${userToken.user_id}:`, errorText);
        }
      } catch (error) {
        errorCount++;
        console.warn(`Error sending to user ${userToken.user_id}:`, error);
      }
    }

    // Send 2-weeks notifications
    for (const userToken of twoWeeksInactiveUsers) {
      try {
        const lang = userToken.profiles?.preferred_language || 'es';
        const template = translations[lang]?.week2 || translations['es'].week2;

        const fcmMessage = {
          message: {
            token: userToken.fcm_token,
            notification: {
              title: template.title,
              body: template.body,
            },
            data: {
              type: 'inactive_reminder',
              period: '2_weeks',
            },
            android: {
              priority: 'high' as const,
              notification: {
                channelId: 'inactive_notifications',
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
          console.log(`✅ Sent 2-weeks notification to user ${userToken.user_id}`);
        } else {
          errorCount++;
          const errorText = await fcmResponse.text();
          console.warn(`Failed to send to user ${userToken.user_id}:`, errorText);
        }
      } catch (error) {
        errorCount++;
        console.warn(`Error sending to user ${userToken.user_id}:`, error);
      }
    }

    console.log(`✅ Inactive notifications sent: ${successCount} success, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Notifications sent successfully`,
        successCount,
        errorCount,
        oneWeekUsers: oneWeekInactiveUsers.length,
        twoWeeksUsers: twoWeeksInactiveUsers.length,
      }),
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
