import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — test E2E sui flussi critici della WebApp.
 * Avvia automaticamente `npm run dev` su :8080 e gira i test contro Chromium.
 *
 * Per eseguire:
 *   npx playwright test
 *   npx playwright test --ui    # modalità interattiva
 *   npx playwright codegen http://localhost:8080  # registra nuovi test
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Per testare il chrome mobile (capacitor-like):
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
