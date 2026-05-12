// File: main.tsx

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n/config";
import { initSentry } from "./lib/sentry";

// No-op se VITE_SENTRY_DSN non è settato.
initSentry();

// --- INTERCETTA TOKEN DI RECOVERY PRIMA DI HASHROUTER ---
// Supabase aggiunge i token come fragment (#access_token=...) ma HashRouter usa anche #
// Quindi dobbiamo intercettarli prima che vengano persi
const handleRecoveryTokens = () => {
  const hash = window.location.hash;
  const search = window.location.search;

  // Check if URL contains recovery tokens (various formats Supabase might use)
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let type: string | null = null;

  // Format 1: ?access_token=xxx (query params)
  if (search.includes('access_token')) {
    const params = new URLSearchParams(search);
    accessToken = params.get('access_token');
    refreshToken = params.get('refresh_token');
    type = params.get('type');
  }

  // Format 2: #access_token=xxx (fragment without route)
  if (!accessToken && hash.startsWith('#access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    accessToken = params.get('access_token');
    refreshToken = params.get('refresh_token');
    type = params.get('type');
  }

  // Format 3: #/route?access_token=xxx (HashRouter with query in hash)
  if (!accessToken && hash.includes('access_token')) {
    const queryPart = hash.split('?')[1];
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      accessToken = params.get('access_token');
      refreshToken = params.get('refresh_token');
      type = params.get('type');
    }
  }

  // If we found recovery tokens, save them and redirect to update-password
  if (accessToken && (type === 'recovery' || type === 'magiclink' || hash.includes('update-password') || hash.includes('password-recovery'))) {
    console.log('🔑 Recovery tokens found, saving to sessionStorage');
    sessionStorage.setItem('recovery_access_token', accessToken);
    if (refreshToken) {
      sessionStorage.setItem('recovery_refresh_token', refreshToken);
    }
    // Clean URL and redirect to update-password route
    window.location.replace(window.location.origin + '/#/update-password');
    return true; // Tokens were handled
  }

  return false; // No tokens found
};

// Run token handler - if tokens were found, the page will reload
handleRecoveryTokens();

// --- LOGICA GLOBALE PER LA GESTIONE DEI LISTENER DI PUSH NOTIFICATIONS ---
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client'; // Importa il client Supabase

// Dichiarazioni globali per tenere traccia del token e dell'ID utente
let globalFcmToken: string | undefined = undefined;
let globalUserId: string | undefined = undefined;

// Funzione helper per tentare di salvare il token nel database
// Verrà chiamata ogni volta che globalFcmToken o globalUserId vengono aggiornati
const trySaveFcmToken = async () => {
  if (globalUserId && globalFcmToken && Capacitor.isNativePlatform()) {
    console.log('Attempting to save FCM token globally:', { userId: globalUserId, token: globalFcmToken.substring(0, 20) + '...', platform: Capacitor.getPlatform() });
    try {
      const platform = Capacitor.getPlatform();

      // Check if token already exists for this user/platform
      const { data: existing } = await supabase
        .from('user_fcm_tokens')
        .select('id')
        .eq('user_id', globalUserId)
        .eq('platform', platform)
        .maybeSingle();

      let error;
      if (existing) {
        // Update existing token
        const result = await supabase
          .from('user_fcm_tokens')
          .update({ fcm_token: globalFcmToken, updated_at: new Date().toISOString() })
          .eq('user_id', globalUserId)
          .eq('platform', platform);
        error = result.error;
      } else {
        // Insert new token
        const result = await supabase
          .from('user_fcm_tokens')
          .insert({ user_id: globalUserId, fcm_token: globalFcmToken, platform: platform });
        error = result.error;
      }

      if (error) {
        console.error('❌ Error saving FCM token globally to DB:', JSON.stringify(error, null, 2));
      } else {
        console.log('✅ FCM token saved globally to DB for user:', globalUserId);
      }
    } catch (error) {
      console.error('❌ Error during global FCM token save to DB:', error);
    }
  } else {
    console.log('ℹ️ Waiting for both userId and fcmToken to be available before saving.');
  }
};


// Pasify: PushNotifications disabilitato finché non aggiungiamo Firebase
// (google-services.json). Senza FCM init il plugin crasha al register().
// Re-abilitare dopo aver configurato Firebase Cloud Messaging.
void PushNotifications;
void trySaveFcmToken;

// Pasify: no-op. profiles.last_active_at non esiste nel nostro schema;
// reintrodurre se servisse tracciare last active.
const updateLastActive = async (_userId: string) => {};

// Assicurati di aggiornare globalUserId quando l'utente si autentica
supabase.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    globalUserId = session.user.id;
    trySaveFcmToken(); // Tenta di salvare quando l'ID utente arriva/cambia
    updateLastActive(session.user.id); // Aggiorna l'ultima attività
  } else {
    globalUserId = undefined;
    globalFcmToken = undefined; // Resetta anche il token al logout
    console.log('ℹ️ User logged out or session ended. Resetting global FCM data.');
  }
});


// Pulisci cache vecchie del Service Worker (post fantasma da DB precedente)
const CACHE_VERSION = "v2";
const cacheVersionKey = "app_cache_version";
if (localStorage.getItem(cacheVersionKey) !== CACHE_VERSION) {
  localStorage.setItem(cacheVersionKey, CACHE_VERSION);
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        if (name.includes('supabase-api') || name.includes('supabase-storage')) {
          caches.delete(name);
          console.log(`🗑️ Cleared stale cache: ${name}`);
        }
      });
    });
  }
}

// Renderizza il componente principale dell'app
import { Sentry } from "./lib/sentry";

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      <div style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        textAlign: "center",
        fontFamily: "system-ui, sans-serif",
      }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Algo no ha ido bien
        </h1>
        <p style={{ color: "#666", fontSize: "0.875rem" }}>
          Hemos enviado el error a nuestro equipo. Por favor, vuelve a intentarlo.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "1.25rem",
            padding: "0.625rem 1.25rem",
            background: "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: "10px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Recargar
        </button>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>
);

