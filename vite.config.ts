import { defineConfig } from "vite";
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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    // Inyectado en build time; sentry.ts lo lee como `__PASIFY_RELEASE__`.
    __PASIFY_RELEASE__: JSON.stringify(`pasify@${GIT_SHA}`),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
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
