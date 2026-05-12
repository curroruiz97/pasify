import { test, expect } from "@playwright/test";

/**
 * Login flow: verifica che la pagina di login renderizzi i campi
 * principali e mostri un errore con credenziali sbagliate.
 *
 * Non testa un login reale (richiederebbe credenziali stabili in env).
 */

test.describe("Login page", () => {
  test("renders email/password inputs", async ({ page }) => {
    await page.goto("/#/login");

    // Email input (può avere type=email o type=text con placeholder)
    const email = page.locator('input[type="email"], input[placeholder*="mail" i]').first();
    const password = page.locator('input[type="password"]').first();

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/#/login");

    await page.locator('input[type="email"], input[placeholder*="mail" i]').first().fill("nonexistent@test.invalid");
    await page.locator('input[type="password"]').first().fill("wrong-password-12345");

    // Submit cliccando il button visibile primario
    await page.getByRole("button", { name: /(login|entrar|iniciar|sign in)/i }).first().click();

    // Sonner toast appare con messaggio errore — cerchiamo qualunque toast
    const toast = page.locator('[data-sonner-toast], [role="status"], [role="alert"]');
    await expect(toast.first()).toBeVisible({ timeout: 10000 });
  });
});
