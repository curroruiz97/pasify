/// <reference types="vite-plugin-pwa/vanillajs" />
// File: main.tsx

import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { MotionConfig } from "framer-motion";
import App from "./App.tsx";
import "./index.css";
import "./i18n/config";
import { initSentry, Sentry } from "./lib/sentry";
import { tomarOAuthEnCurso } from "./lib/redirect-url";

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

// --- ENLACES DE AUTH QUE VUELVEN CON ERROR ---
// GoTrue devuelve los enlaces que ya no valen (caducados o usados) con
// `error_code`/`error_description` en la URL (`…/#/update-password#error=…`):
// HashRouter lo tomaba por una ruta y acababa en un 404 en inglés. Un error
// al volver de Google (entrada en curso, redirect-url.ts) va al login; el
// resto son enlaces de email, a pedir uno nuevo. Se hace antes de que auth-js
// lea la URL (arranca en diferido) y sin recargar si solo cambia el hash.
const redirigirErroresDeAuth = (): boolean => {
  const url = `${window.location.search}${window.location.hash}`;
  if (!/[?#&](error_code|error_description)=/.test(url)) return false;
  const destino = tomarOAuthEnCurso() ? '/login?aviso=google' : '/reset-password?enlace=caducado';
  window.location.replace(`${window.location.origin}${window.location.pathname}#${destino}`);
  return true;
};

// --- ENLACE DE RECUPERACIÓN SIN RUTA ---
// Plantilla nueva: `{{ .RedirectTo }}?token_hash=…&type=recovery`, con
// RedirectTo = …/#/update-password. Si esa Redirect URL no está permitida en
// Supabase, GoTrue pone la Site URL y el token llega a la raíz, en la query:
// se lleva a /update-password en vez de perderlo en la landing.
const llevarTokenHashAUpdatePassword = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  if (!tokenHash || params.get('type') !== 'recovery' || window.location.hash.includes('update-password')) return false;
  window.location.replace(
    `${window.location.origin}${window.location.pathname}#/update-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`,
  );
  return true;
};

// --- INTERCETTA TOKEN DI RECOVERY PRIMA DI HASHROUTER ---
// Supabase aggiunge i token come fragment (#access_token=...) ma HashRouter usa anche #
// Quindi dobbiamo intercettarli prima che vengano persi. Enlaces antiguos: los
// nuevos llevan `?token_hash=` y los resuelve UpdatePassword.
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
if (!redirigirErroresDeAuth() && !llevarTokenHashAUpdatePassword()) handleRecoveryTokens();

// Pulisci cache vecchie del Service Worker (post fantasma da DB precedente)
const CACHE_VERSION = "v2";
const cacheVersionKey = "app_cache_version";
try {
  if (localStorage.getItem(cacheVersionKey) !== CACHE_VERSION) {
    localStorage.setItem(cacheVersionKey, CACHE_VERSION);
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          if (name.includes('supabase-api') || name.includes('supabase-storage')) {
            void caches.delete(name);
          }
        });
      }).catch(() => { /* sin Cache Storage */ });
    }
  }
} catch {
  /* sin localStorage (modo privado antiguo) */
}

// --- SERVICE WORKER: solo en la web ---
// En nativo (Capacitor) NO queremos el Service Worker registrado: el bundle
// se sirve desde capacitor://localhost y un SW activo (registrado en una
// build PWA anterior) puede cachear assets con scope incorrecto y dejar la
// APK en un estado raro. Desregistramos cualquier SW que haya quedado vivo
// de una versión web previa instalada en la misma WebView. El registro ya no
// lo inyecta el plugin en index.html (`injectRegister: false`, vite.config.ts):
// el registerSW.js inyectado lo volvía a registrar también en Android.
if (Capacitor.isNativePlatform()) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => void r.unregister());
    }).catch(() => { /* swallow */ });
  }
} else {
  // Web: con `autoUpdate`, cuando un deploy nuevo toma el control la página
  // se recarga sola (registerSW de vite-plugin-pwa). Antes se quedaba con el
  // JS viejo, que pedía trozos que ya no existen: pantalla en blanco.
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch((err) => console.warn('[pwa] registro del service worker omitido:', err));
}

// --- VERSIÓN VIEJA TRAS UN DEPLOY ---
// Un trozo de la versión anterior que ya no existe (deploy nuevo con la
// pestaña o la app abiertas) hace fallar la carga de esa pantalla. Se recarga
// para coger la versión nueva, una sola vez: la marca en sessionStorage evita
// un bucle si el fallo es otro (sin red, un trozo roto). Pasado un minuto, otro
// deploy puede volver a recargar.
const RECARGA_POR_VERSION_KEY = 'pasify.recarga-por-version';
const RECARGA_POR_VERSION_MS = 60_000;
window.addEventListener('vite:preloadError', (event) => {
  let ultima = 0;
  try {
    ultima = Number(sessionStorage.getItem(RECARGA_POR_VERSION_KEY)) || 0;
  } catch {
    return; // sin sessionStorage no hay forma de evitar el bucle: que salga el error
  }
  if (Date.now() - ultima < RECARGA_POR_VERSION_MS) return;
  try {
    sessionStorage.setItem(RECARGA_POR_VERSION_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// --- MULTI-CUENTA RETIRADA ---
// Las versiones anteriores guardaban en Preferences, en claro, el refresh
// token de cada cuenta usada en el dispositivo. Ya no se usa: fuera.
void import('@capacitor/preferences')
  .then(({ Preferences }) =>
    Promise.all([
      Preferences.remove({ key: 'pasify_saved_accounts' }),
      Preferences.remove({ key: 'pasify_active_account' }),
    ]),
  )
  .catch(() => { /* sin plugin o sin storage: nada que borrar */ });

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
    {/* prefers-reduced-motion: framer-motion respeta la preferencia del
        sistema en toda la app, también en la transición entre páginas. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </Sentry.ErrorBoundary>
);
