import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Sentry release tag: el git SHA del commit que se está construyendo.
// Resuelto en build time. Vercel inyecta `VERCEL_GIT_COMMIT_SHA`; en local
// caemos en `git rev-parse HEAD`. Si nada de eso resuelve (dev fresh clone
// sin .git), usamos "dev" como sentinel.
const resolveGitSha = (): string => {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 12);
  const fromCI = process.env.GITHUB_SHA;
  if (fromCI) return fromCI.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD").toString().trim();
  } catch {
    return "dev";
  }
};

const GIT_SHA = resolveGitSha();

/**
 * Guardia de build · impide publicar un bundle sin configuración de Supabase.
 *
 * `src/integrations/supabase/client.ts` cae en `https://placeholder.supabase.co`
 * cuando faltan las env vars, para que la app al menos monte en dev. En web eso
 * nunca se notó porque Vercel inyecta las variables desde su dashboard, pero el
 * AAB de Android se compila en local: si ahí no hay `.env.local` ni
 * `.env.production`, el bundle sale apuntando a un host que no existe y TODA
 * petición muere con "Failed to fetch" — incluido el login.
 *
 * Eso fue exactamente lo que rechazó Google Play el 15 ago 2026 (Broken
 * Functionality). Antes de este guardia el build salía con exit 0 y sin un solo
 * aviso, así que el fallo solo era visible con la app ya instalada.
 *
 * Ahora `vite build` en modo producción revienta si la config no es real.
 */
const supabaseEnvGuard = () => ({
  name: "pasify-supabase-env-guard",
  configResolved(config: { command: string; mode: string; env: Record<string, string> }) {
    if (config.command !== "build" || config.mode !== "production") return;

    const isMissing = (v?: string) => !v || /placeholder/i.test(v);
    const faltan = [
      !config.env.VITE_SUPABASE_URL || isMissing(config.env.VITE_SUPABASE_URL)
        ? "VITE_SUPABASE_URL"
        : null,
      isMissing(config.env.VITE_SUPABASE_PUBLISHABLE_KEY)
        ? "VITE_SUPABASE_PUBLISHABLE_KEY"
        : null,
    ].filter(Boolean);

    if (faltan.length > 0) {
      throw new Error(
        [
          "",
          "  ✖ Build de producción abortado: configuración de Supabase ausente o placeholder.",
          "",
          `    Variables sin valor real: ${faltan.join(", ")}`,
          "",
          "    Sin ellas el bundle apunta a https://placeholder.supabase.co, que no",
          "    resuelve, y el login falla con «Failed to fetch» en el dispositivo.",
          "",
          "    Los valores públicos están versionados en .env.production. Si ese",
          "    fichero falta, recupéralo del repo o copia .env.example a .env.local",
          "    y rellena las dos variables (ver DEPLOY_VERCEL.md).",
          "",
        ].join("\n"),
      );
    }
  },
});

/**
 * Source maps a Sentry por release (`pasify@<sha12>`, el mismo que lee
 * sentry.ts). Solo en `vite build` y solo si están SENTRY_AUTH_TOKEN,
 * SENTRY_ORG y SENTRY_PROJECT (en Vercel: Settings → Environment Variables).
 * Sin ellas, o sin el paquete `@sentry/vite-plugin` instalado, se omite con
 * un aviso y el build sigue igual. Los .map se suben y se borran de `dist`:
 * nunca se publican junto al bundle. (Vite acepta plugins asíncronos: esta
 * promesa va tal cual en `plugins`.)
 */
const sentryPlugins = async (command: string): Promise<PluginOption[]> => {
  const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
  if (command !== "build" || !SENTRY_AUTH_TOKEN || !SENTRY_ORG || !SENTRY_PROJECT) return [];
  // Especificador en variable: el paquete es opcional y ni tsc ni el bundler
  // de la config deben exigirlo.
  const paquete = "@sentry/vite-plugin";
  try {
    const { sentryVitePlugin } = (await import(/* @vite-ignore */ paquete)) as {
      sentryVitePlugin: (options: Record<string, unknown>) => PluginOption;
    };
    return [
      // Mapas solo si se suben: "hidden" no los enlaza desde el JS.
      { name: "pasify-sourcemaps-sentry", config: () => ({ build: { sourcemap: "hidden" } }) },
      sentryVitePlugin({
        org: SENTRY_ORG,
        project: SENTRY_PROJECT,
        authToken: SENTRY_AUTH_TOKEN,
        release: { name: `pasify@${GIT_SHA}` },
        sourcemaps: { assets: "./dist/**", filesToDeleteAfterUpload: ["./dist/**/*.map"] },
        telemetry: false,
      }),
    ];
  } catch (err) {
    console.warn(
      `[sentry] Source maps sin subir: instala @sentry/vite-plugin (npm i -D @sentry/vite-plugin). ${String(err)}`,
    );
    return [];
  }
};

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => ({
  define: {
    // Inyectado en build time; sentry.ts lo lee como `__PASIFY_RELEASE__`.
    __PASIFY_RELEASE__: JSON.stringify(`pasify@${GIT_SHA}`),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    supabaseEnvGuard(),
    react(),
    mode === "development" && componentTagger(),
    sentryPlugins(command),
    VitePWA({
      registerType: "autoUpdate",
      // Sin script inyectado en index.html: main.tsx registra el service
      // worker solo en la web. El registerSW.js inyectado lo registraba
      // también en la app Android justo después de que main.tsx lo quitara.
      injectRegister: false,
      workbox: {
        // Force new SW to activate immediately + take control of all clients
        skipWaiting: true,
        clientsClaim: true,
        // Cleanup outdated precaches from previous SW versions
        cleanupOutdatedCaches: true,
        // Precache shell HTML, CSS, JS chunks, logo, manifest
        globPatterns: ["**/*.{js,css,html,ico,svg,webp,woff2}"],
        // Exclude large images from precache (will be runtime-cached instead)
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MB
        // Navigazione SPA
        navigateFallback: "/index.html",
        // Runtime caching strategies
        runtimeCaching: [
          {
            // Supabase Storage images/video — NetworkFirst così risposte stale
            // (vecchi 400, file mancanti) vengono rinnovate al primo successo
            urlPattern: /^https:\/\/.*supabase\.co\/storage\/v1\/(object|render\/image)\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-storage-v2",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 giorni
              },
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            // Supabase API (rest/v1) - NetworkOnly to avoid stale data
            urlPattern: /^https:\/\/.*supabase\.co\/rest\/v1\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 anno
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // CDN assets
            urlPattern: /^https:\/\/cdn\..*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "cdn-assets",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 anno
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: false, // Usa il site.webmanifest esistente
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Limitiamo lo scan delle dipendenze al solo index.html della SPA.
  // Senza questo, Vite scansiona anche gli .html dentro public/ (landing
  // statica, scrape Fourvenues) e fallisce su <script src="runtime.xxx.js">
  // → dep-scan rotto → pagina bianca al boot del dev server.
  optimizeDeps: {
    entries: ["index.html"],
  },
  base: process.env.VITE_BASE_PATH || "/",
  // Niente manualChunks: la separazione di react-i18next in un chunk distinto
  // causava `Cannot read properties of undefined (reading 'createContext')`
  // in prod (load order non garantito). Vite splitta comunque per route via
  // dynamic import, sufficiente per il bundle size.
}));
