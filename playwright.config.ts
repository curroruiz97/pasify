import { defineConfig, devices } from "@playwright/test";
import { FAKE_SUPABASE_KEY, FAKE_SUPABASE_URL } from "./tests/e2e/support/fake-supabase";

/**
 * Playwright config — tests E2E de los flujos críticos de la web.
 *
 * Esta config NUNCA puede apuntar a un Supabase remoto. Antes arrancaba
 * `npm run dev` tal cual: Vite cargaba .env.local, que apunta a producción, y
 * los specs llegaron a hacer peticiones reales. Ahora:
 *
 *   - Por defecto, Supabase simulado (tests/e2e/support/fake-supabase.ts): un
 *     puerto local en el que no escucha nadie. Los specs que llaman a la API
 *     REST por su cuenta (process.env.VITE_SUPABASE_URL) se saltan.
 *   - Con PW_SUPABASE=local, el Supabase local de `supabase start`
 *     (http://127.0.0.1:54321) con su clave anon en PW_LOCAL_SUPABASE_KEY
 *     (la da `supabase status`).
 *
 * Las variables de webServer.env ganan a .env.local (Vite no pisa las que ya
 * existen en el entorno) y la config se niega a cargar si la URL resultante no
 * es local. Arranca siempre su propio Vite en :8091: reutilizar un servidor ya
 * arrancado (el de :8080 suele apuntar a producción) no está permitido.
 *
 *   npx playwright test
 *   PW_SUPABASE=local PW_LOCAL_SUPABASE_KEY=<clave anon> npx playwright test
 *   ($env:PW_SUPABASE="local"; $env:PW_LOCAL_SUPABASE_KEY="<clave anon>"; npx playwright test   en PowerShell)
 *   npx playwright test --ui    # modo interactivo
 *
 * El panel de local tiene su propia config (playwright.partner.config.ts).
 */
const PORT = 8091;
const BASE_URL = `http://localhost:${PORT}`;
const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

interface SupabaseDestino {
  url: string;
  key: string;
  /** true si al otro lado hay un Supabase de verdad (el local). */
  real: boolean;
}

function resolverSupabase(): SupabaseDestino {
  const modo = (process.env.PW_SUPABASE ?? "").trim().toLowerCase();
  if (modo === "local") {
    const key = (process.env.PW_LOCAL_SUPABASE_KEY ?? "").trim();
    if (!key) {
      throw new Error(
        "[playwright] PW_SUPABASE=local necesita la clave anon del Supabase local en PW_LOCAL_SUPABASE_KEY (`supabase status`).",
      );
    }
    return { url: LOCAL_SUPABASE_URL, key, real: true };
  }
  if (modo && modo !== "fake") {
    throw new Error(`[playwright] PW_SUPABASE="${modo}" no es válido: usa "local" o déjalo vacío (Supabase simulado).`);
  }
  return { url: FAKE_SUPABASE_URL, key: FAKE_SUPABASE_KEY, real: false };
}

const SUPABASE = resolverSupabase();

// Última barrera: solo el Supabase simulado o uno en esta máquina.
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (SUPABASE.url !== FAKE_SUPABASE_URL && !HOSTS_LOCALES.has(new URL(SUPABASE.url).hostname)) {
  throw new Error(`[playwright] ${SUPABASE.url} no es local: la config general nunca apunta a un Supabase remoto.`);
}

// Los specs que llaman a la API REST leen process.env (este fichero se evalúa
// también en cada worker): que vean el mismo Supabase que la app, y con el
// simulado nada, para que se salten en vez de salir a la red. Así tampoco
// cuenta lo que haya exportado en la shell.
if (SUPABASE.real) {
  process.env.VITE_SUPABASE_URL = SUPABASE.url;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = SUPABASE.key;
} else {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

export default defineConfig({
  testDir: "./tests/e2e",
  // El panel de local y la puerta van con playwright.partner.config.ts
  // (Supabase simulado con datos): los mismos tres specs de su testMatch.
  // Specs con el Supabase simulado: van con playwright.partner.config.ts.
  testIgnore: [
    "**/partner-shell.spec.ts",
    "**/partner-cache.spec.ts",
    "**/door-pin.spec.ts",
    "**/cuentas.spec.ts",
    "**/client-shell.spec.ts",
    "**/checkout-back.spec.ts",
    "**/transferencia.spec.ts",
  ],
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Chrome móvil (parecido a la app de Capacitor):
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Nunca uno ya arrancado: podría apuntar a producción.
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      VITE_SUPABASE_URL: SUPABASE.url,
      VITE_SUPABASE_PUBLISHABLE_KEY: SUPABASE.key,
      // Sin Sentry: los errores de los tests no van al proyecto real.
      VITE_SENTRY_DSN: "",
      VITE_ENABLE_SUPER_ADMIN_SWITCHER: "false",
      VITE_DEV_PREVIEW: "false",
    },
  },
});
