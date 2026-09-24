import { defineConfig, devices } from "@playwright/test";
import { FAKE_SUPABASE_KEY, FAKE_SUPABASE_URL } from "./tests/e2e/support/fake-supabase";

/**
 * Panel de local con Supabase simulado: smoke (tests/e2e/partner-shell.spec.ts)
 * y caché de datos (tests/e2e/partner-cache.spec.ts).
 *
 * Config aparte de playwright.config.ts: arranca su propio Vite en :8090 con
 * VITE_SUPABASE_URL apuntando a un puerto local donde no escucha nadie, y el
 * test contesta a esas peticiones con page.route. Las variables de entorno
 * del proceso ganan a .env.local, así que ni con un .env.local de producción
 * puede salir nada hacia el Supabase real. Por lo mismo nunca reutiliza un
 * servidor ya arrancado en el puerto: podría apuntar al Supabase real.
 *
 *   npm run test:e2e:partner
 *   PW_CHANNEL=chrome npm run test:e2e:partner   # con el Chrome del sistema
 *   ($env:PW_CHANNEL="chrome"; npm run test:e2e:partner   en PowerShell)
 *
 * En CI usa el Chromium de Playwright (`npx playwright install chromium`).
 */
const PORT = 8090;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/partner-shell.spec.ts", "**/partner-cache.spec.ts"],
  outputDir: "test-results/partner-shell",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // Un solo Vite en dev: los tests en serie son más estables que en paralelo.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    // Un service worker se saltaría page.route.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_SUPABASE_KEY,
      VITE_SENTRY_DSN: "",
      VITE_ENABLE_SUPER_ADMIN_SWITCHER: "false",
      VITE_DEV_PREVIEW: "false",
    },
  },
});
