import { test, expect } from "@playwright/test";

/**
 * Smoke test: l'app carica senza errori critici e renderizza
 * la home. Cattura regressioni di build/bootstrap (es. import
 * mancanti, errori a runtime in main.tsx).
 */

test("app boots and shows home or login", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");

  // L'app deve renderizzare qualcosa di visibile entro 5s
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(1500); // attesa per Suspense + animazioni

  // Filtra errori "rumore" (es. immagini 404 da seed test)
  const critical = errors.filter(
    (e) =>
      !/Failed to load resource/.test(e) &&
      !/img.*404/i.test(e) &&
      !/manifest\.json/i.test(e),
  );

  expect(critical, `Errori critici sul boot:\n${critical.join("\n")}`).toEqual([]);
});

test("navigation to /login does not crash", async ({ page }) => {
  await page.goto("/#/login");
  // La pagina deve renderizzare almeno un input (email o password)
  await expect(page.locator("input").first()).toBeVisible({ timeout: 10000 });
});

// La ficha heredada /partner/:id reventaba con un ReferenceError; ahora es
// solo una redirección a la ficha vigente /p/:id.
test("/partner/:id heredada redirige a /p/:id sin romper", async ({ page }) => {
  await page.goto("/#/partner/demo-1");
  await expect(page).toHaveURL(/#\/p\/demo-1$/);
  await expect(page.getByText("Local no encontrado.")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Algo no ha ido bien")).toHaveCount(0);
});
