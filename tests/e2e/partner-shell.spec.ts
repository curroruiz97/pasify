import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  NOMBRE_LOCAL,
  instalarSupabaseFalso,
  simularAppNativa,
  type OpcionesSupabaseFalso,
  type SupabaseFalso,
} from "./support/fake-supabase";

/**
 * Smoke del panel de local (/#/partner-dashboard) sin backend real.
 *
 * Supabase está simulado (support/fake-supabase.ts) y la sesión de un local
 * va sembrada en localStorage. El test entra en el panel, recorre cada sección
 * visible del menú y exige en cada paso que no haya errores JS (`pageerror`,
 * que en dev incluye los errores de render que captura un boundary) ni
 * pantallas de error (boundary global o de sección). Es la red para fallos
 * como el de a70fde8: un ReferenceError al entrar dejaba el panel en blanco.
 *
 * Solo corre con su propia config (arranca Vite con el Supabase falso):
 *   npm run test:e2e:partner
 */

/** Pantallas de error: boundary global (main.tsx) y de sección (SectionBoundary). */
const TEXTO_DE_FALLO = /Algo no ha ido bien|Algo ha ido mal|Esta sección ha fallado/;

/**
 * Secciones maqueta: SECCIONES_SOLO_WEB en src/pages/PartnerDashboard.tsx
 * (etiquetas del menú). Solo existen en la web y para la organización de demo
 * (flag partner_showcase); nunca en la app nativa.
 */
const MAQUETAS = [
  "AutoPilot",
  "Pricing",
  "Door Vision",
  "TPV",
  "Cashless",
  "VIP",
  "CRM",
  "Marketing",
  "Canales",
  "Equipo",
  "Apps",
  "White-label",
  "Benchmarks",
];

/** Secciones que cualquier local ve siempre. */
const SECCIONES_BASICAS = ["Métricas", "En vivo", "Mis eventos", "Soporte"];

/** Precio del plan de suscripción: prohibido dentro de las apps (App Store 3.1.1). */
const PRECIO_SUSCRIPCION = /€\s*\/\s*mes|29[,.]99/i;

interface Panel {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió el panel. */
  errores: string[];
}

/** Menú de secciones del panel: lateral (escritorio) o cajón "Más" (móvil). */
interface Menu {
  /** Etiquetas de las secciones, en el orden del menú. */
  secciones(): Promise<string[]>;
  ir(etiqueta: string): Promise<void>;
}

let panelActual: Panel | null = null;

test.afterEach(async ({ page }, testInfo) => {
  // Respuestas aún en vuelo al cerrar la página: que no fallen en el cierre.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const panel = panelActual;
  panelActual = null;
  if (!panel || panel.supabase.sinMock.size === 0) return;
  // No falla: avisa de lo que el panel pide y el mock no conoce, para ampliarlo.
  const lista = [...panel.supabase.sinMock].sort().join("\n");
  console.log(`[${testInfo.title}] peticiones sin mock (${panel.supabase.sinMock.size}):\n${lista}`);
  await testInfo.attach("peticiones-sin-mock.txt", { body: lista, contentType: "text/plain" });
});

async function abrirPanel(page: Page, opciones: OpcionesSupabaseFalso = {}): Promise<Panel> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, opciones);
  const panel: Panel = { supabase, errores };
  panelActual = panel;

  await page.goto("/#/partner-dashboard");
  const metricas = page.getByRole("heading", { level: 1, name: "Métricas" });
  // Pantallas de error y de "Reintentar" (AuthErrorScreen, carga fallida…).
  const pantallaDeError = page.getByText(new RegExp(`${TEXTO_DE_FALLO.source}|No pudimos|No hemos podido`));
  // Lo primero que salga; la primera carga de Vite en frío (optimización de
  // dependencias) puede tardar, de ahí el margen.
  await expect(metricas.or(pantallaDeError).first()).toBeVisible({ timeout: 90_000 });
  await esperarCalma(page, supabase);
  await comprobarSinFallos(page, panel, "al entrar en el panel");
  // Con el mock completo, el panel carga su cuenta, su configuración y sus eventos.
  await expect(pantallaDeError, "El panel no ha podido cargar sus datos").toHaveCount(0);
  await expect(metricas).toBeVisible();
  return panel;
}

/** Deja que lleguen las respuestas y que React pinte lo que dependa de ellas. */
async function esperarCalma(page: Page, supabase: SupabaseFalso) {
  await page.waitForTimeout(300);
  await expect.poll(() => supabase.enVuelo(), { timeout: 10_000 }).toBe(0);
  await page.waitForTimeout(200);
}

async function comprobarSinFallos(page: Page, panel: Panel, donde: string) {
  expect(panel.errores, `Errores JS ${donde}`).toEqual([]);
  await expect(page.getByText(TEXTO_DE_FALLO), `Pantalla de error ${donde}`).toHaveCount(0);
  expect(panel.supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
}

/** Despliega todos los grupos plegables (Pasify IA, Operaciones, Plataforma…). */
async function desplegarGrupos(arbol: Locator) {
  for (const grupo of await arbol.locator("button[aria-expanded]").all()) {
    if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
    await expect(grupo).toHaveAttribute("aria-expanded", "true");
  }
}

/** Botones de sección de un NavTree (los de grupo llevan aria-expanded). */
async function etiquetasDe(arbol: Locator): Promise<string[]> {
  const textos = await arbol.locator("button:not([aria-expanded])").allInnerTexts();
  return textos.map((t) => t.trim()).filter(Boolean);
}

function menuLateral(page: Page): Menu {
  const arbol = page.locator("aside nav");
  return {
    async secciones() {
      await desplegarGrupos(arbol);
      return etiquetasDe(arbol);
    },
    async ir(etiqueta) {
      await desplegarGrupos(arbol);
      await arbol.getByRole("button", { name: etiqueta, exact: true }).click();
    },
  };
}

function menuCajon(page: Page): Menu {
  const cajon = page.getByRole("dialog");
  // Dentro del cajón, el NavTree es el primer bloque con botones del <nav>
  // (detrás van Configuración y Ayuda, que no son secciones).
  const arbol = cajon.locator("nav > div:has(button)").first();
  const abrir = async () => {
    await page.getByRole("button", { name: "Más opciones" }).click();
    await expect(cajon).toBeVisible();
    await desplegarGrupos(arbol);
  };
  return {
    async secciones() {
      await abrir();
      const etiquetas = await etiquetasDe(arbol);
      await page.keyboard.press("Escape");
      await expect(cajon).toHaveCount(0);
      return etiquetas;
    },
    async ir(etiqueta) {
      await abrir();
      await arbol.getByRole("button", { name: etiqueta, exact: true }).click();
      await expect(cajon).toHaveCount(0);
    },
  };
}

/**
 * Abre cada sección y comprueba que se pinta (cambia el título) sin errores.
 * `alAbrir` añade las comprobaciones propias de cada pasada.
 */
async function recorrerSecciones(
  page: Page,
  panel: Panel,
  menu: Menu,
  etiquetas: string[],
  alAbrir?: (etiqueta: string) => Promise<void>,
) {
  const titulo = page.locator("main h1").first();
  let tituloAnterior = await titulo.innerText();
  for (const [i, etiqueta] of etiquetas.entries()) {
    await test.step(`Sección «${etiqueta}»`, async () => {
      await menu.ir(etiqueta);
      await esperarCalma(page, panel.supabase);
      // Primero los errores: si la sección revienta, eso es lo que hay que contar.
      await comprobarSinFallos(page, panel, `en «${etiqueta}»`);
      // La primera es la que ya estaba abierta (Métricas).
      if (i > 0) await expect(titulo, `«${etiqueta}» no cambia de sección`).not.toHaveText(tituloAnterior);
      await expect(titulo, `«${etiqueta}» sin título`).toBeVisible();
      tituloAnterior = await titulo.innerText();
      await alAbrir?.(etiqueta);
    });
  }
}

/** Secciones del menú, con las básicas presentes y (salvo `conMaquetas`) sin ninguna maqueta. */
async function seccionesDelMenu(menu: Menu, { conMaquetas }: { conMaquetas: boolean }): Promise<string[]> {
  const etiquetas = await menu.secciones();
  expect(etiquetas, "Faltan secciones básicas en el menú").toEqual(expect.arrayContaining(SECCIONES_BASICAS));
  if (conMaquetas) expect(etiquetas, "Faltan maquetas en el menú de la demo").toEqual(expect.arrayContaining(MAQUETAS));
  else expect(etiquetas.filter((e) => MAQUETAS.includes(e)), "Maquetas en el menú").toEqual([]);
  return etiquetas;
}

test.describe("web", () => {
  test("local real: carga y recorre sus secciones, sin maquetas", async ({ page }) => {
    const panel = await abrirPanel(page);
    await expect(page.locator("aside").getByText(NOMBRE_LOCAL).first()).toBeVisible();

    const menu = menuLateral(page);
    await recorrerSecciones(page, panel, menu, await seccionesDelMenu(menu, { conMaquetas: false }));
  });

  test("organización de demo: también las maquetas, siempre con la franja DEMO", async ({ page }) => {
    const panel = await abrirPanel(page, { showcase: true });
    const franjaDemo = page.getByText("DEMO · datos ficticios");

    const menu = menuLateral(page);
    const secciones = await seccionesDelMenu(menu, { conMaquetas: true });
    await recorrerSecciones(page, panel, menu, secciones, async (etiqueta) => {
      if (MAQUETAS.includes(etiqueta)) await expect(franjaDemo, `«${etiqueta}» sin franja DEMO`).toBeVisible();
      else await expect(franjaDemo, `Franja DEMO en «${etiqueta}», que no es maqueta`).toHaveCount(0);
    });
  });
});

test.describe("app nativa (iOS, override de src/lib/platform.ts)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sin maquetas ni precios de suscripción, aunque sea la organización de demo", async ({ page }) => {
    await simularAppNativa(page, "ios");
    // Con el flag de demo activo: lo único que puede ocultar las maquetas es la app.
    const panel = await abrirPanel(page, { showcase: true });
    const sinPrecio = async (donde: string, zona: Locator = page.locator("body")) =>
      expect(await zona.innerText(), `Precio de suscripción ${donde}`).not.toMatch(PRECIO_SUSCRIPCION);

    const menu = menuCajon(page);
    const secciones = await seccionesDelMenu(menu, { conMaquetas: false });
    await recorrerSecciones(page, panel, menu, secciones, (etiqueta) => sinPrecio(`en «${etiqueta}»`));

    // Configuración y Ayuda (cajón "Más" → Cuenta): ahí es donde vivía el plan.
    for (const [boton, cabecera] of [
      ["Configuración", "Configuración"],
      ["Ayuda y guías", /ayudamos/],
    ] as const) {
      await test.step(`Hoja «${boton}»`, async () => {
        await page.getByRole("button", { name: "Más opciones" }).click();
        await page.getByRole("dialog").getByRole("button", { name: boton }).click();
        const hoja = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: cabecera }) });
        await expect(hoja).toBeVisible();
        await esperarCalma(page, panel.supabase);
        await comprobarSinFallos(page, panel, `en «${boton}»`);
        await sinPrecio(`en «${boton}»`, hoja);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });
    }
  });
});
