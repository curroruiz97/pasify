import { expect, test, type Locator, type Page } from "@playwright/test";
import { CLAVE_SESION, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Modo puerta (/door) con Supabase simulado: el PIN no se puede saltar.
 *
 * Lo que se protege, que antes fallaba:
 *   - Sin red, «¿Has olvidado el PIN? Cerrar sesión» quitaba el bloqueo y
 *     luego signOut fallaba: la sesión seguía viva, /login llevaba al panel y,
 *     aunque no, bastaba con recargar. Ahora la sesión sale del dispositivo
 *     aunque no haya red, y el bloqueo solo se quita cuando ya no hay sesión.
 *   - Con la puerta bloqueada, /update-password (cambiar la contraseña del
 *     dueño sin la actual) y /login quedaban fuera del bloqueo.
 *   - Los PIN fallidos se contaban en memoria: recargar reiniciaba la cuenta.
 *
 * La sesión se siembra una sola vez por pestaña (sembrarSesion: "una-vez"):
 * si no, cada recarga la volvería a poner y "tras recargar" no probaría nada.
 *
 *   npm run test:e2e:partner
 */

const PIN = "2468";
const PIN_MALO = "1111";

test.afterEach(async ({ page }) => {
  await page.context().setOffline(false);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

interface Puerta {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió la app. */
  errores: string[];
}

const leer = (page: Page, clave: string) => page.evaluate((k) => window.localStorage.getItem(k), clave);

/** Fallos de PIN guardados en el dispositivo (doorLock.ts). */
const fallosGuardados = async (page: Page) => {
  const valor = await leer(page, "pasify.door.fails");
  return valor ? (JSON.parse(valor) as { count: number }).count : 0;
};

const botonSalirDeCabecera = (page: Page) => page.locator("header").getByRole("button", { name: "Salir" });

/** Entra en /door con la sesión del local y activa el modo puerta con PIN. */
async function bloquearPuerta(page: Page): Promise<Puerta> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });

  await page.goto("/#/door");
  const pin = page.getByPlaceholder("PIN (4 a 6 cifras)");
  // La primera carga de Vite en frío (optimización de dependencias) puede tardar.
  await expect(pin).toBeVisible({ timeout: 90_000 });
  await pin.fill(PIN);
  await page.getByPlaceholder("Repite el PIN").fill(PIN);
  await page.getByRole("button", { name: "Activar" }).click();
  await expect(botonSalirDeCabecera(page)).toBeVisible();
  expect(await leer(page, "pasify.door.active")).toBe(IDS.usuario);
  return { supabase, errores };
}

async function abrirSalida(page: Page): Promise<Locator> {
  await botonSalirDeCabecera(page).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("Salir del modo puerta")).toBeVisible();
  return dialogo;
}

/**
 * Tras «¿Has olvidado el PIN?»: sesión fuera del dispositivo, en /login, y ni
 * recargando ni yendo a mano se vuelve a entrar al panel o a la puerta.
 */
async function comprobarSesionCerrada(page: Page, supabase: SupabaseFalso) {
  await expect(page).toHaveURL(/#\/login$/, { timeout: 15_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
  expect(await leer(page, CLAVE_SESION), "La sesión sigue guardada en el dispositivo").toBeNull();
  // Ya sin sesión el bloqueo sobra: para volver a entrar hace falta la contraseña.
  await expect.poll(() => leer(page, "pasify.door.active")).toBeNull();

  // Vuelve la cobertura y se recarga: sigue fuera.
  await page.context().setOffline(false);
  supabase.sinRed = false;
  await page.reload();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
  for (const ruta of ["/#/partner-dashboard", "/#/door"]) {
    await page.goto(ruta);
    await expect(page, `${ruta} con la sesión cerrada`).toHaveURL(/#\/login$/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toHaveCount(0);
  expect(await leer(page, CLAVE_SESION)).toBeNull();
}

test("en modo avión, «¿Has olvidado el PIN?» cierra la sesión de verdad: ni panel ni tras recargar", async ({
  page,
}) => {
  const { supabase, errores } = await bloquearPuerta(page);

  // Modo avión: navigator.onLine a false y, además, el Supabase falso sin
  // contestar (con setOffline, Playwright sigue sirviendo lo que pasa por
  // page.route, y el signOut de siempre habría funcionado).
  await page.context().setOffline(true);
  supabase.sinRed = true;
  const dialogo = await abrirSalida(page);
  await dialogo.getByRole("button", { name: /¿Has olvidado el PIN\?/ }).click();

  await comprobarSesionCerrada(page, supabase);
  expect(supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
  expect(errores).toEqual([]);
});

test("sin respuesta del servidor (el móvil cree tener red) también cierra la sesión", async ({ page }) => {
  const { supabase, errores } = await bloquearPuerta(page);

  supabase.sinRed = true;
  const dialogo = await abrirSalida(page);
  await dialogo.getByRole("button", { name: /¿Has olvidado el PIN\?/ }).click();

  await comprobarSesionCerrada(page, supabase);
  expect(errores).toEqual([]);
});

test("con la puerta bloqueada, /update-password, /login, / y el panel llevan a /door", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  for (const ruta of ["/#/update-password", "/#/login", "/#/", "/#/partner-dashboard", "/#/partner-dashboard/eventos"]) {
    await page.goto(ruta);
    await expect(page, `${ruta} no lleva a /door`).toHaveURL(/#\/door$/);
    await expect(botonSalirDeCabecera(page)).toBeVisible();
  }
  await expect(page.getByText("Establece tu nueva contraseña")).toHaveCount(0);

  // Y al recargar, igual.
  await page.goto("/#/update-password");
  await page.reload();
  await expect(page).toHaveURL(/#\/door$/, { timeout: 30_000 });
  await expect(botonSalirDeCabecera(page)).toBeVisible();
  expect(errores).toEqual([]);
});

test("los PIN fallidos y la espera no se reinician al recargar", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  const dialogo = await abrirSalida(page);
  const campo = dialogo.getByPlaceholder("PIN", { exact: true });
  for (let intento = 1; intento <= 5; intento++) {
    await campo.fill(PIN_MALO);
    await dialogo.getByRole("button", { name: "Salir", exact: true }).click();
    await expect.poll(() => fallosGuardados(page)).toBe(intento);
  }
  const espera = dialogo.getByText(/Demasiados intentos\. Espera \d+ s\./);
  await expect(espera).toBeVisible();
  await expect(campo).toBeDisabled();

  await page.reload();
  await expect(botonSalirDeCabecera(page)).toBeVisible({ timeout: 30_000 });
  const tras = await abrirSalida(page);
  await expect(tras.getByText(/Demasiados intentos\. Espera \d+ s\./)).toBeVisible();
  await expect(tras.getByPlaceholder("PIN", { exact: true })).toBeDisabled();
  expect(await fallosGuardados(page)).toBe(5);
  expect(await leer(page, "pasify.door.active")).toBe(IDS.usuario);
  expect(errores).toEqual([]);
});

test("con el PIN correcto se sale al panel", async ({ page }) => {
  const { errores } = await bloquearPuerta(page);

  const dialogo = await abrirSalida(page);
  await dialogo.getByPlaceholder("PIN", { exact: true }).fill(PIN);
  await dialogo.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/#\/partner-dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 30_000 });
  expect(await leer(page, "pasify.door.active")).toBeNull();
  expect(errores).toEqual([]);
});
