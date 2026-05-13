import { test, expect } from "@playwright/test";

/**
 * Fase 1 role hardening · regresiones a vigilar.
 *
 * Estos tests validan el **frontend** del modo super-admin/dev y el comportamiento
 * de redirects post-login. Los tests de RLS puros (intento de INSERT sin sesión)
 * se hacen contra el endpoint REST público de Supabase y no requieren browser.
 *
 * **Limitación deliberada**: NO probamos el login real de Francisco aquí porque
 * eso requeriría credenciales en CI (riesgo + flakiness). En su lugar:
 *   1. Confirmamos que el PanelSwitcher NUNCA aparece sin sesión.
 *   2. Confirmamos que LoginRoute redirige a `/login` sin sesión.
 *   3. Confirmamos que ProtectedRoute redirige al login al pedir admin/partner.
 *   4. (RLS) hacemos un POST anónimo a `/rest/v1/user_roles` y verificamos que
 *      Supabase devuelve 401 o 403 — los anónimos no pueden insertar roles.
 *
 * El test de "super-admin ve el switcher" se ejecuta en sesión interactiva
 * con un Playwright codegen separado cuando hagas el QA manual con Francisco
 * (no estable en CI).
 */

test.describe("Role hardening · frontend redirects", () => {
  test("PanelSwitcher NO visible para usuarios anónimos", async ({ page }) => {
    await page.goto("/");
    // El switcher se identifica con data-pasify-switcher (definido en PanelSwitcher.tsx)
    await expect(page.locator("[data-pasify-switcher]")).toHaveCount(0);
  });

  test("/admin sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/#/admin");
    // ProtectedRoute hace navigate('/login') si no hay user
    await page.waitForURL(/\/#\/login/, { timeout: 8000 });
    await expect(page.locator("input").first()).toBeVisible();
  });

  test("/partner-dashboard sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/#/partner-dashboard");
    await page.waitForURL(/\/#\/login/, { timeout: 8000 });
  });

  test("/client-dashboard sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/#/client-dashboard");
    await page.waitForURL(/\/#\/login/, { timeout: 8000 });
  });
});

test.describe("Role hardening · RLS server-side", () => {
  // Suite-level skip si las env vars no están disponibles. En local sí lo están
  // (Vite las inyecta vía import.meta.env y aquí las leemos via process.env del
  // shell donde lanzas `npx playwright test`).
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  test("user_roles INSERT anónimo es rechazado por RLS", async ({ request }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY no definidas en el shell",
    );

    // Anonymous PostgREST request: sin Authorization header, sólo apikey anon.
    // RLS user_roles_self_insert exige auth.uid() match + NO rol previo.
    // Sin sesión, auth.uid() es NULL → la policy WITH CHECK falla.
    const resp = await request.post(`${SUPABASE_URL}/rest/v1/user_roles`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      data: { user_id: "00000000-0000-0000-0000-000000000000", role: "admin" },
    });

    // PostgREST devuelve 401 (no auth), 403 (RLS) o 400 (FK violation)
    // dependiendo del orden de checks. Cualquiera de los tres prueba que
    // NO se insertó la fila (lo único inaceptable es un 201).
    expect(
      [400, 401, 403, 404].includes(resp.status()),
      `Esperaba 4xx, obtuve ${resp.status()}. Body: ${await resp.text()}`,
    ).toBe(true);
  });

  test("user_roles INSERT con role=admin desde anon nunca succeeded", async ({ request }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY no definidas",
    );

    // Aunque pasáramos un user_id válido (no podemos sin auth real), la policy
    // sólo permite role IN ('client','partner') — admin NO se puede reclamar.
    const resp = await request.post(`${SUPABASE_URL}/rest/v1/user_roles`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        "Content-Type": "application/json",
      },
      data: { user_id: "00000000-0000-0000-0000-000000000000", role: "admin" },
    });
    expect(resp.status()).not.toBe(201);
    expect(resp.status()).not.toBe(200);
  });
});
