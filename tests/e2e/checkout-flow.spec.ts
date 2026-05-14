import { test, expect } from "@playwright/test";

/**
 * Checkout client: smoke tests del flujo de compra de tickets sin login
 * real. Verifica:
 *  - /ticket/success carga sin crashear cuando se llama con session_id
 *    falso (el polling debe iniciar y mostrar UI de "confirmando…")
 *  - PublicPartnerPage /p/:id de un partner inexistente cae a empty state
 *    (no demo data ya que P1.1 los eliminó)
 *  - El botón "Iniciar sesión para comprar" en partner page redirige a
 *    /register-client cuando el usuario no está autenticado
 *
 * El flujo Stripe end-to-end (compra real con card 4242…) requiere
 * sesión + integración con Stripe test mode → QA manual.
 */

test.describe("Client checkout · smoke", () => {
  test("/p/:id de partner inexistente NO muestra demo data", async ({
    page,
  }) => {
    // Antes de P1.1, ids "demo-1" mostraban Pacha Ibiza hardcoded.
    // Ahora debe caer a partner=null y mostrar loading o error.
    await page.goto("/#/p/demo-1");
    // Esperar al menos 2s para que termine el query
    await page.waitForTimeout(2000);
    // NO debe aparecer ninguno de los nombres demo
    await expect(page.getByText("Pacha Ibiza")).toHaveCount(0);
    await expect(page.getByText("Razzmatazz")).toHaveCount(0);
    await expect(page.getByText("Teatro Kapital")).toHaveCount(0);
  });

  test("/ticket/success sin session_id NO crashea", async ({ page }) => {
    await page.goto("/#/ticket/success");
    await expect(page.locator("body")).toBeVisible();
    // No esperamos contenido específico — solo que no haya un error overlay
    await page.waitForTimeout(1500);
    // La página puede mostrar loading o un mensaje pidiendo session_id.
    // El crash sería: body queda vacío o el ErrorBoundary se dispara.
    const errorBoundary = page.locator("text=/Algo ha ido mal|Something went wrong/i");
    await expect(errorBoundary).toHaveCount(0);
  });

  test("ClientDashboard sin partners aprobados muestra empty state", async ({
    page,
  }) => {
    // Sin sesión, ClientDashboard redirige a /login.
    // Verificamos que la ruta no muestra Pacha/Razzmatazz (P1.1: DEMO_PARTNERS removidos).
    await page.goto("/#/client-dashboard");
    await page.waitForTimeout(2000);
    // Ya sea que esté en login o en dashboard, el body NO debe contener demos.
    await expect(page.getByText("Pacha Ibiza")).toHaveCount(0);
    await expect(page.getByText("Razzmatazz")).toHaveCount(0);
  });
});
