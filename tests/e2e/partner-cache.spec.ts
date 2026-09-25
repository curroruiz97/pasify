import { expect, test, type Page } from "@playwright/test";
import { CLAVE_SESION, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Caché de datos del panel de local (src/lib/cache) con Supabase simulado.
 *
 * Lo que se protege, que antes fallaba:
 *   - Volver a una sección ya vista la pinta al instante y no vuelve a pedir
 *     nada (antes: "Sincronizando…", pantalla vacía y todo otra vez).
 *   - Al recargar (pestaña descartada por el navegador, WebView cerrado por
 *     iOS) lo guardado en el dispositivo sale sin esperar a la red.
 *   - Cerrar sesión borra lo guardado en el dispositivo.
 *   - Un "Nuevo evento" a medio rellenar sobrevive a la recarga.
 *   - Sin red y con el token caducado, la app arranca en segundos con lo
 *     guardado (antes: ~10 s de splash, al login y sin cartera).
 *
 *   npm run test:e2e:partner
 */

const EVENTO = "Concierto E2E";
/** Entrada del usuario en la caché guardada: `v<CACHE_SCHEMA>:<uid>` (persistence.ts), sea cual sea el esquema. */
const CACHE_DEL_USUARIO = expect.stringMatching(new RegExp(`^v\\d+:${IDS.usuario}$`));

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function esperarCalma(page: Page, supabase: SupabaseFalso) {
  await page.waitForTimeout(300);
  await expect.poll(() => supabase.enVuelo(), { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(200);
}

/** Claves de la caché guardada en IndexedDB (pasify-cache/queries). */
const clavesGuardadas = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("pasify-cache");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains("queries")) return [] as string[];
    const claves = await new Promise<IDBValidKey[]>((res) => {
      const r = db.transaction("queries", "readonly").objectStore("queries").getAllKeys();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    return claves.map(String);
  });

/** Fuerza a escribir ya la caché (la app guarda al ocultarse la pestaña). */
const ocultarPestana = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });

async function abrirEventos(page: Page) {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.message));
  const supabase = await instalarSupabaseFalso(page);
  await page.goto("/#/partner-dashboard/eventos");
  await expect(page.getByRole("heading", { level: 1, name: "Mis eventos" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(EVENTO).first()).toBeVisible();
  await esperarCalma(page, supabase);
  return { supabase, errores };
}

test("volver a una sección ya vista la pinta al instante y no vuelve a pedir", async ({ page }) => {
  const { supabase, errores } = await abrirEventos(page);

  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible();
  await esperarCalma(page, supabase);

  const antes = supabase.peticiones.length;
  await page.goto("/#/partner-dashboard/eventos");
  // Sin "Sincronizando tus eventos…": la lista sale ya de la caché.
  await expect(page.getByText(EVENTO).first()).toBeVisible({ timeout: 1_000 });
  await expect(page.getByText("Sincronizando tus eventos…")).toHaveCount(0);
  await esperarCalma(page, supabase);
  // Recién vista (menos de 30 s): nada que refrescar.
  expect(supabase.peticiones.slice(antes).filter((p) => p.includes("/rest/v1/events"))).toEqual([]);
  expect(errores).toEqual([]);
});

test("al recargar, lo guardado en el dispositivo sale sin esperar a la red", async ({ page }) => {
  const { supabase, errores } = await abrirEventos(page);
  await ocultarPestana(page);
  await expect.poll(() => clavesGuardadas(page)).toContainEqual(CACHE_DEL_USUARIO);

  // Red muy lenta: sin caché, el panel se quedaría ~8 s en el loader.
  supabase.retrasoMs = 8_000;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mis eventos" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByText(EVENTO).first()).toBeVisible({ timeout: 1_000 });
  supabase.retrasoMs = 0;
  expect(errores).toEqual([]);
});

test("cerrar sesión borra la caché del dispositivo", async ({ page }) => {
  const { errores } = await abrirEventos(page);
  await ocultarPestana(page);
  await expect.poll(() => clavesGuardadas(page)).toContainEqual(CACHE_DEL_USUARIO);

  await page.locator("aside").getByRole("button", { name: "Cerrar sesión" }).click();
  await expect.poll(() => clavesGuardadas(page)).not.toContainEqual(CACHE_DEL_USUARIO);
  expect(errores).toEqual([]);
});

test("un «Nuevo evento» a medio rellenar sobrevive a la recarga", async ({ page }) => {
  const { errores } = await abrirEventos(page);

  await page.getByRole("button", { name: "Nuevo evento" }).first().click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(page).toHaveURL(/editor=nuevo/);
  await dialogo.locator("input").first().fill("Borrador E2E recuperado");
  await page.waitForTimeout(800); // el borrador se guarda tras una pausa

  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog").locator("input").first()).toHaveValue("Borrador E2E recuperado");
  await expect(page.getByRole("dialog").getByText(/Borrador recuperado/)).toBeVisible();

  await page.getByRole("dialog").getByRole("button", { name: "Empezar de cero" }).click();
  await expect(page.getByRole("dialog").locator("input").first()).toHaveValue("");
  expect(errores).toEqual([]);
});

test("sin red y con el token caducado, arranca en segundos con lo guardado y no lo borra", async ({ page }) => {
  // auth-js tarda ~50 s en rendirse sin red: hay que esperarle.
  test.setTimeout(300_000);
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.message));
  // Renovaciones del token fallidas por falta de red que auth-js escribe en consola.
  let renovacionesFallidas = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("AuthRetryableFetchError")) renovacionesFallidas++;
  });
  // Una sola siembra: la sesión caducada de abajo no se puede pisar al recargar.
  const supabase = await instalarSupabaseFalso(page, { sembrarSesion: "una-vez" });
  await page.goto("/#/partner-dashboard/eventos");
  await expect(page.getByRole("heading", { level: 1, name: "Mis eventos" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(EVENTO).first()).toBeVisible();
  await esperarCalma(page, supabase);
  await ocultarPestana(page);
  await expect.poll(() => clavesGuardadas(page)).toContainEqual(CACHE_DEL_USUARIO);

  // Horas sin abrir la app (token caducado) y sin cobertura (el móvil cree
  // tener red, pero nada llega al servidor): auth-js no puede renovar el
  // token y reintenta ~25 s. Antes: splash ~10 s, al login y sin cartera.
  await page.evaluate((clave) => {
    const sesion = JSON.parse(window.localStorage.getItem(clave) ?? "{}");
    sesion.expires_at = Math.floor(Date.now() / 1000) - 3600;
    window.localStorage.setItem(clave, JSON.stringify(sesion));
  }, CLAVE_SESION);
  supabase.sinRed = true;
  renovacionesFallidas = 0;

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mis eventos" })).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText(EVENTO).first()).toBeVisible();
  await expect(page.getByText("estás viendo lo guardado en este dispositivo")).toBeVisible();

  // Cuando auth-js se rinde (~50 s: la renovación del arranque y la de cada
  // suscriptor, que comparten la segunda) entrega un INITIAL_SESSION null a
  // cada suscriptor: session.ts y cada useAuth. No es un cierre de sesión: ni
  // al login ni fuera lo guardado (antes se borraba la caché, y el bloqueo de
  // la puerta, en cuanto se abría una pantalla nueva sin cobertura).
  await expect.poll(() => renovacionesFallidas, { timeout: 150_000, intervals: [1_000] }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(3_000);
  await expect(page).toHaveURL(/#\/partner-dashboard\/eventos$/);
  await expect(page.getByText(EVENTO).first()).toBeVisible();
  expect(await page.evaluate((clave) => window.localStorage.getItem(clave) !== null, CLAVE_SESION)).toBe(true);
  expect(await clavesGuardadas(page)).toContainEqual(CACHE_DEL_USUARIO);
  // Con la sesión sin verificar los datos no se piden (irían con la clave
  // anónima y la respuesta vacía pisaría lo guardado): solo la renovación del
  // token y la revalidación de los roles, que no escribe si falla.
  const datosPedidos = supabase.intentosSinRed.filter(
    (p) => !p.includes("/auth/v1/") && !/\/rpc\/(get_user_roles|is_super_admin)$/.test(p),
  );
  expect(datosPedidos, "Datos pedidos con la sesión sin verificar").toEqual([]);
  supabase.sinRed = false;
  expect(errores).toEqual([]);
});
