import { test, expect } from "@playwright/test";

/**
 * Onboarding partner: smoke tests del flujo de registro y wizard sin
 * login real. Verifica:
 *  - /register-partner expone los campos obligatorios marcados con *
 *  - Sin sesión, /partner-dashboard redirige a /login (cubre el caso
 *    "wizard auto-abriéndose" — debe ocurrir SOLO en partner-dashboard,
 *    no antes de autenticarse)
 *  - El form de RegisterPartner valida que el password tenga 6+ chars
 *    (cliente-side, sin tocar Supabase)
 *
 * No se prueba el flujo end-to-end con signup real porque CI no tiene
 * credenciales estables y el wizard depende de un usuario auténtico
 * con session viva. Esos casos se cubren con QA manual.
 */

test.describe("Partner onboarding · smoke", () => {
  test("register-partner muestra campos obligatorios", async ({ page }) => {
    await page.goto("/#/register-partner");
    // Email + business name + password + confirm password — son required
    await expect(
      page.locator('input[type="email"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('input[type="password"]').nth(0),
    ).toBeVisible();
    await expect(
      page.locator('input[type="password"]').nth(1),
    ).toBeVisible();
    // El campo "Nombre del negocio" se renderiza como Input estándar.
    // Verificamos al menos 2 inputs de texto (business + others).
    const textInputs = page.locator(
      'input:not([type="email"]):not([type="password"]):not([type="hidden"])',
    );
    await expect(await textInputs.count()).toBeGreaterThanOrEqual(2);
  });

  test("submit con password corto muestra toast de error", async ({
    page,
  }) => {
    await page.goto("/#/register-partner");
    await page.locator('input[type="email"]').first().fill("test@pasify.es");
    await page.locator('input[type="password"]').nth(0).fill("123");
    await page.locator('input[type="password"]').nth(1).fill("123");
    // Submit — el botón principal del form lleva texto Spanish "Crear cuenta..."
    await page
      .getByRole("button", { name: /(crear|sign up|signup)/i })
      .first()
      .click();
    // Sonner toast con error de password corto
    const toast = page.locator(
      '[data-sonner-toast], [role="status"], [role="alert"]',
    );
    await expect(toast.first()).toBeVisible({ timeout: 8000 });
  });

  test("partner-dashboard sin sesión NO abre el wizard, redirige a login", async ({
    page,
  }) => {
    await page.goto("/#/partner-dashboard");
    await page.waitForURL(/\/#\/login/, { timeout: 8000 });
    // Confirmamos que NO se renderizó el modal del wizard (z-[80])
    await expect(
      page.locator(".z-\\[80\\], [data-pasify-onboarding]"),
    ).toHaveCount(0);
  });
});
