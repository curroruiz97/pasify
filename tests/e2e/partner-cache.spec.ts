import { expect, test, type Page } from "@playwright/test";
import { IDS, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

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
 *
 *   npm run test:e2e:partner
 */

const EVENTO = "Concierto E2E";

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
  await expect.poll(() => clavesGuardadas(page)).toContain(`v1:${IDS.usuario}`);

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
  await expect.poll(() => clavesGuardadas(page)).toContain(`v1:${IDS.usuario}`);

  await page.locator("aside").getByRole("button", { name: "Cerrar sesión" }).click();
  await expect.poll(() => clavesGuardadas(page)).not.toContain(`v1:${IDS.usuario}`);
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
