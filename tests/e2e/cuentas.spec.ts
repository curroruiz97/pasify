import { expect, test } from "@playwright/test";
import { CLAVE_SESION, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Cuentas y acceso con Supabase simulado (support/fake-supabase.ts).
 *
 * Lo que se protege, que antes fallaba:
 *   - Entrar desde "Comprar" (`/login?next=`) llevaba al panel y el comprador
 *     perdía el evento; "Regístrate" tampoco reenviaba `next`.
 *   - Con sesión, las páginas de alta seguían ofreciendo crear otra cuenta.
 *   - Una cuenta sin rol (un local al que se ha retirado el acceso) veía una
 *     pantalla negra sin salida.
 *   - Un enlace de recuperación caducado acababa en un 404 en inglés.
 *   - El enlace nuevo de recuperación (`?token_hash=`) no lo leía nadie.
 *
 *   npm run test:e2e:partner
 */

// La primera carga de Vite en frío puede tardar: también con playwright.config.ts (30 s por test).
test.describe.configure({ timeout: 180_000 });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const errores = (page: import("@playwright/test").Page) => {
  const lista: string[] = [];
  page.on("pageerror", (err) => lista.push(err.stack ?? `${err.name}: ${err.message}`));
  return lista;
};

test("entrar desde /login?next= vuelve a next, y «Regístrate» lo reenvía", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/login?next=%2Fcalendar");

  const email = page.locator('input[type="email"]');
  // La primera carga de Vite en frío (optimización de dependencias) puede tardar.
  await expect(email).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Regístrate como cliente" })).toHaveAttribute(
    "href",
    /register-client\?next=%2Fcalendar$/,
  );

  await email.fill("local@e2e.pasify.test");
  await page.locator('input[type="password"]').fill("contraseña-e2e");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // Ni el panel (LoginRoute al llegar la sesión) ni el login: el evento.
  await expect(page).toHaveURL(/#\/calendar$/, { timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/#\/calendar$/);
  expect(fallos).toEqual([]);
});

test("con sesión, las páginas de alta llevan al panel", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page);
  for (const alta of ["/#/register-client", "/#/register-partner"]) {
    await page.goto(alta);
    await expect(page, `${alta} con sesión`).toHaveURL(/#\/partner-dashboard$/, { timeout: 90_000 });
  }
  expect(fallos).toEqual([]);
});

test("una cuenta sin rol ve con quién hablar y puede cerrar sesión", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { roles: [], sembrarSesion: "una-vez" });
  await page.goto("/#/partner-dashboard");

  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "comunicacion@avenuemedia.io" })).toBeVisible();

  // La raíz tampoco se queda en negro.
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect.poll(() => page.evaluate((clave) => window.localStorage.getItem(clave), CLAVE_SESION)).toBeNull();
  await expect(page.getByRole("heading", { name: "Tu cuenta no tiene acceso" })).toHaveCount(0);
  expect(fallos).toEqual([]);
});

test("un enlace de recuperación caducado lleva a pedir otro, en español", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  // Lo que devuelve GoTrue con un enlace usado o caducado.
  await page.goto(
    "/#/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );

  await expect(page).toHaveURL(/#\/reset-password\?enlace=caducado$/, { timeout: 90_000 });
  await expect(page.getByText("El enlace ha caducado o ya se ha usado. Pide uno nuevo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeVisible();
  expect(fallos).toEqual([]);
});

test("el enlace nuevo de recuperación (token_hash) deja poner la contraseña", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/update-password?token_hash=e2e-token-hash&type=recovery");

  await expect(page.getByText("Establece tu nueva contraseña")).toBeVisible({ timeout: 90_000 });
  // El token sirve una vez: fuera de la barra de direcciones.
  await expect(page).toHaveURL(/#\/update-password$/);

  // Mínimo 8 caracteres, avisado en español.
  await page.locator("#password").fill("corta12");
  await page.locator("#confirmPassword").fill("corta12");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("La contraseña debe tener al menos 8 caracteres.")).toBeVisible();

  await page.locator("#password").fill("nueva-contraseña-e2e");
  await page.locator("#confirmPassword").fill("nueva-contraseña-e2e");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("heading", { name: "Contraseña cambiada" })).toBeVisible({ timeout: 15_000 });
  expect(fallos).toEqual([]);
});

test("una ruta que no existe dice 404 en español y lleva al inicio", async ({ page }) => {
  const fallos = errores(page);
  await instalarSupabaseFalso(page, { sembrarSesion: "nunca" });
  await page.goto("/#/no-existe");

  await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "Volver al inicio" })).toBeVisible();
  expect(fallos).toEqual([]);
});
