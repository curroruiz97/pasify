// File: main.tsx

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n/config";
import { initSentry } from "./lib/sentry";

// No-op se VITE_SENTRY_DSN non è settato.
initSentry();

// --- STATUS BAR NATIVO (Android/iOS) ---
// La APK arranca con la status bar en color blanco/sistema. Aquí la forzamos
// al ink Pasify (#0F0F0F) para que sea continuo con el theme oscuro de la
// app. setOverlaysWebView(false) evita que la WebView dibuje por debajo de
// la barra del sistema (que ya gestionamos con env(safe-area-inset-top) en
// MobileTopBar). Errores se tragan: si el plugin no está disponible (web
// dev en navegador) no debe romper el boot.
(async () => {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setBackgroundColor({ color: '#0F0F0F' });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (err) {
    console.warn('[StatusBar] init skipped', err);
  }
})();

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


// Pasify: PushNotifications REACTIVADOS (Fase production).
// Requiere google-services.json (Android) + GoogleService-Info.plist (iOS)
// configurados en el proyecto Capacitor antes de build.
// El hook useFCMToken (en src/hooks/useFCMToken.ts) hace el registro completo
// dentro de componentes React. Aquí solo enganchamos los listeners globales
// para foreground notifications + deep linking en notification tap.
const initPushNotifications = async () => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // Listener: foreground notification (la app está abierta)
    await PushNotifications.addListener("pushNotificationReceived", (notif) => {
      console.info("[FCM] foreground notification", notif);
      // Mostrar como toast in-app vía CustomEvent que App.tsx escucha.
      // Nombre canónico: `foreground-push` (App.tsx:303 listener). Mantener
      // el nombre coherente — antes despachábamos `pasify:push-received`
      // y NO había listener para él (bug confirmado en plan de hardening).
      window.dispatchEvent(new CustomEvent("foreground-push", { detail: notif }));
    });
    // Listener: notification tapped (open app desde notification)
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      console.info("[FCM] notification tapped", action);
      const link = (action.notification?.data as Record<string, string> | undefined)?.click_action
        || (action.notification?.data as Record<string, string> | undefined)?.link;
      if (link) {
        window.dispatchEvent(new CustomEvent("notification-tap", { detail: { link } }));
      }
    });
  } catch (err) {
    console.warn("[FCM] initPushNotifications failed", err);
  }
};
initPushNotifications();
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

// En nativo (Capacitor) NO queremos el Service Worker registrado: el bundle
// se sirve desde capacitor://localhost y un SW activo (registrado en una
// build PWA anterior) puede cachear assets con scope incorrecto y dejar la
// APK en un estado raro. Desregistramos cualquier SW que haya quedado vivo
// de una versión web previa instalada en la misma WebView.
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister().then(() => console.log('🧹 SW unregistered (native)')));
  }).catch(() => { /* swallow */ });
}

// Renderizza il componente principale dell'app
import { Sentry } from "./lib/sentry";

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      // Fallback con bg + colores Pasify explícitos para que NO se vea
      // un pantallazo negro indistinguible de "la app no carga". Antes el
      // h1 heredaba el foreground del body en dark mode y el botón cyan
      // era inconsistente con el branding terracota.
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        textAlign: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        background: "#0a0a0a",
        color: "#F4EEE2",
      }}>
        <div style={{
          fontSize: "10px",
          fontFamily: "'Geist Mono', ui-monospace, monospace",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "#FF7A4D",
          marginBottom: "0.75rem",
        }}>
          — Pasify · Error temporal —
        </div>
        <h1 style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          marginBottom: "0.75rem",
          color: "#F4EEE2",
          letterSpacing: "-0.01em",
        }}>
          Algo no ha ido bien
        </h1>
        <p style={{
          color: "rgba(244,238,226,0.65)",
          fontSize: "0.9rem",
          maxWidth: "28rem",
          lineHeight: 1.5,
        }}>
          Hemos enviado el error a nuestro equipo. Recarga la página para
          continuar — tu sesión y tus tickets están a salvo.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "1.5rem",
            padding: "0.875rem 1.75rem",
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
            color: "white",
            border: "none",
            borderRadius: "999px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
            fontSize: "0.95rem",
            letterSpacing: "-0.005em",
          }}
        >
          Recargar
        </button>
        <a
          href="/#/"
          style={{
            marginTop: "0.75rem",
            fontSize: "0.8rem",
            color: "rgba(244,238,226,0.55)",
            textDecoration: "none",
          }}
        >
          o volver al inicio →
        </a>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>
);

