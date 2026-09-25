import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_SUPABASE_URL, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Accesibilidad básica de los tres paneles (Ola 3 · A1-13, B2-16) sin backend
 * real: el mismo Supabase simulado que el resto (support/fake-supabase.ts),
 * con la sesión sembrada y el rol de cada panel (get_user_roles).
 *
 * En cada panel (cliente, local y admin):
 *   - El menú marca la sección activa con aria-current="page" (barra lateral
 *     en escritorio; barra inferior y cajón «Más» en móvil) y lo mueve al
 *     cambiar de sección.
 *   - Cada vista tiene un solo h1 y, al cambiar de sección (desde la barra
 *     lateral o desde el cajón), el foco va a ese h1.
 *   - El título de la pestaña es «<sección> · Pasify».
 *   - Ningún botón de solo icono (sin texto) se queda sin nombre accesible.
 *   - «Saltar al contenido» es lo primero con el Tab y lleva el foco al <main>.
 * Y, con «reducir movimiento» del sistema, las transiciones CSS son instantáneas.
 *
 * Sin @axe-core/playwright (no es una dependencia del proyecto): consultas de
 * Playwright (getByRole) y un evaluate sobre el DOM para los botones.
 *
 * Corre con la config del panel (arranca Vite con el Supabase falso, un
 * worker, hora de Madrid y sin service worker): va en su `testMatch` y en el
 * `testIgnore` de playwright.config.ts.
 *   npx playwright test -c playwright.partner.config.ts a11y
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

/** Pantallas de error: boundary global (main.tsx) y de sección. */
const TEXTO_DE_FALLO = /Algo no ha ido bien|Algo ha ido mal|Esta sección ha fallado|Wallet temporalmente no disponible/;

interface Seccion {
  /** Etiqueta del botón en el menú. */
  menu: string;
  /** Texto del h1 de la vista. */
  h1: string;
  /** document.title esperado. */
  titulo: string;
}

interface Panel {
  nombre: string;
  ruta: string;
  roles: string[];
  /** La sección va en la URL (atrás vuelve a la anterior). El admin la guarda en memoria. */
  seccionEnUrl: boolean;
  /** Lo que indica que el panel ya está pintado. */
  listo: (page: Page) => Locator;
  /** Rutas propias por encima del Supabase falso (la última registrada va primero). */
  preparar?: (page: Page) => Promise<void>;
  /** Sección con la que abre. */
  inicio: Seccion;
  /** Sección a la que se va desde el menú (lateral en escritorio, cajón «Más» en móvil). */
  otra: Seccion;
}

/** Lecturas de PostgREST contestadas con una lista vacía. */
async function vacias(page: Page, tablas: string[]) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && tablas.some((t) => url.pathname === `/rest/v1/${t}`),
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          "content-type": "application/json; charset=utf-8",
          "content-range": "*/0",
        },
        body: "[]",
      });
    },
  );
}

const PANELES: Panel[] = [
  {
    nombre: "cliente",
    ruta: "/#/client-dashboard",
    roles: ["client"],
    seccionEnUrl: true,
    listo: (page) => page.getByRole("textbox", { name: "Buscar locales" }),
    // Las entradas del mock son las del local (otro comprador): la cartera, vacía.
    preparar: (page) => vacias(page, ["tickets"]),
    inicio: { menu: "Inicio", h1: "Inicio", titulo: "Inicio · Pasify" },
    otra: { menu: "Favoritos", h1: "Favoritos", titulo: "Favoritos · Pasify" },
  },
  {
    nombre: "local",
    ruta: "/#/partner-dashboard",
    roles: ["partner"],
    seccionEnUrl: true,
    listo: (page) => page.getByRole("heading", { level: 1, name: "Métricas" }),
    inicio: { menu: "Métricas", h1: "Métricas", titulo: "Métricas · Pasify" },
    otra: { menu: "Mis eventos", h1: "Mis eventos", titulo: "Mis eventos · Pasify" },
  },
  {
    nombre: "admin",
    ruta: "/#/admin",
    roles: ["admin"],
    seccionEnUrl: false,
    listo: (page) => page.getByRole("heading", { level: 1, name: "Métricas" }),
    inicio: { menu: "Métricas", h1: "Métricas", titulo: "Métricas · Pasify" },
    otra: { menu: "Eventos", h1: "Eventos", titulo: "Eventos · Pasify" },
  },
];

// ---------------------------------------------------------------------------
// Apertura y esperas (como partner-shell y client-shell)
// ---------------------------------------------------------------------------

interface Abierto {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió el panel. */
  errores: string[];
}

let abiertoActual: Abierto | null = null;

test.afterEach(async ({ page }, testInfo) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const abierto = abiertoActual;
  abiertoActual = null;
  if (!abierto || abierto.supabase.sinMock.size === 0) return;
  // No falla: avisa de lo que el panel pide y el mock no conoce.
  const lista = [...abierto.supabase.sinMock].sort().join("\n");
  await testInfo.attach("peticiones-sin-mock.txt", { body: lista, contentType: "text/plain" });
});

async function abrir(page: Page, panel: Panel): Promise<Abierto> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { roles: panel.roles });
  await panel.preparar?.(page);
  const abierto: Abierto = { supabase, errores };
  abiertoActual = abierto;

  await page.goto(panel.ruta);
  const pantallaDeError = page.getByText(TEXTO_DE_FALLO);
  // La primera carga de Vite en frío puede tardar, de ahí el margen.
  await expect(panel.listo(page).or(pantallaDeError).first()).toBeVisible({ timeout: 90_000 });
  await esperarCalma(page, supabase);
  await comprobarSinFallos(page, abierto, "al entrar");
  await expect(panel.listo(page)).toBeVisible();
  return abierto;
}

async function esperarCalma(page: Page, supabase: SupabaseFalso) {
  await page.waitForTimeout(300);
  await expect.poll(() => supabase.enVuelo(), { timeout: 10_000 }).toBe(0);
  await page.waitForTimeout(200);
}

async function comprobarSinFallos(page: Page, abierto: Abierto, donde: string) {
  expect(abierto.errores, `Errores JS ${donde}`).toEqual([]);
  await expect(page.getByText(TEXTO_DE_FALLO), `Pantalla de error ${donde}`).toHaveCount(0);
  expect(abierto.supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------

/** Un solo h1 en la vista, con su texto. */
async function unSoloH1(page: Page, seccion: Seccion, donde: string) {
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1, `Número de h1 ${donde}`).toHaveCount(1);
  await expect(h1, `Texto del h1 ${donde}`).toHaveText(seccion.h1);
}

/** Exactamente un elemento del menú con aria-current="page": el de la sección. */
async function marcaActual(menu: Locator, seccion: Seccion, donde: string) {
  const actual = menu.locator('[aria-current="page"]');
  await expect(actual, `aria-current en el menú ${donde}`).toHaveCount(1);
  await expect(actual, `Sección marcada ${donde}`).toContainText(seccion.menu);
}

/**
 * Botones de solo icono (sin texto) que se ven ahora mismo sin nombre
 * accesible. Un solo evaluate sobre el DOM: la lista es de un mismo instante.
 * Nombre: aria-labelledby, aria-label, el contenido (sin lo aria-hidden, con el
 * alt de las imágenes y el <title> de los SVG) o title.
 */
async function botonesDeIconoSinNombre(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const oculto = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.getAttribute("aria-hidden") === "true" || n.hasAttribute("inert")) return true;
        const estilo = getComputedStyle(n);
        if (estilo.display === "none" || estilo.visibility === "hidden") return true;
      }
      return false;
    };
    const contenido = (nodo: Node, raiz: Element): string => {
      if (nodo.nodeType === Node.TEXT_NODE) return nodo.textContent ?? "";
      if (!(nodo instanceof Element) || nodo.getAttribute("aria-hidden") === "true") return "";
      const etiqueta = nodo !== raiz ? nodo.getAttribute("aria-label")?.trim() : "";
      if (etiqueta) return etiqueta;
      if (nodo instanceof HTMLImageElement) return nodo.alt;
      if (nodo.tagName.toLowerCase() === "svg") return nodo.querySelector("title")?.textContent ?? "";
      return Array.from(nodo.childNodes, (hijo) => contenido(hijo, raiz)).join(" ");
    };
    const nombre = (el: Element): string => {
      const ids = el.getAttribute("aria-labelledby");
      if (ids) {
        const texto = ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (texto) return texto;
      }
      return (el.getAttribute("aria-label") ?? "").trim() || contenido(el, el).trim() || (el.getAttribute("title") ?? "").trim();
    };
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((el) => !oculto(el))
      .filter((el) => (el as HTMLElement).innerText.trim() === "")
      .filter((el) => !nombre(el))
      .map((el) => el.outerHTML.slice(0, 240));
  });
}

async function botonesDeIconoConNombre(page: Page, donde: string) {
  expect(await botonesDeIconoSinNombre(page), `Botones de solo icono sin nombre accesible ${donde}`).toEqual([]);
}

/** El h1 de la vista tiene el foco (lo pone useFocoAlTitulo al cambiar de sección). */
async function focoEnElTitulo(page: Page, donde: string) {
  await expect(page.getByRole("heading", { level: 1 }), `Foco en el título ${donde}`).toBeFocused();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const panel of PANELES) {
  test.describe(`panel de ${panel.nombre}`, () => {
    test("escritorio: saltar al contenido, menú, h1, título y botones de icono", async ({ page }) => {
      const abierto = await abrir(page, panel);
      const menu = page.locator("aside nav");

      await test.step("Al entrar", async () => {
        await expect(page).toHaveTitle(panel.inicio.titulo);
        await unSoloH1(page, panel.inicio, "al entrar");
        await marcaActual(menu, panel.inicio, "al entrar");
        await botonesDeIconoConNombre(page, "al entrar");
      });

      await test.step("«Saltar al contenido»: lo primero con el Tab, y lleva al <main>", async () => {
        await page.keyboard.press("Tab");
        const saltar = page.getByRole("link", { name: "Saltar al contenido" });
        await expect(saltar).toBeFocused();
        await expect(saltar).toBeInViewport();
        await page.keyboard.press("Enter");
        await expect(page.locator("main#contenido")).toBeFocused();
        // Con HashRouter, un ancla de verdad cambiaría de ruta.
        expect(page.url()).not.toContain("contenido");
      });

      await test.step(`Menú lateral → «${panel.otra.menu}»`, async () => {
        await menu.getByRole("button", { name: panel.otra.menu, exact: true }).click();
        await esperarCalma(page, abierto.supabase);
        await comprobarSinFallos(page, abierto, `en «${panel.otra.menu}»`);
        await focoEnElTitulo(page, `al ir a «${panel.otra.menu}»`);
        await expect(page).toHaveTitle(panel.otra.titulo);
        await unSoloH1(page, panel.otra, `en «${panel.otra.menu}»`);
        await marcaActual(menu, panel.otra, `en «${panel.otra.menu}»`);
        await botonesDeIconoConNombre(page, `en «${panel.otra.menu}»`);
      });

      if (panel.seccionEnUrl) {
        await test.step("Atrás: vuelve la sección de antes, con su título", async () => {
          await page.goBack();
          await esperarCalma(page, abierto.supabase);
          await expect(page).toHaveTitle(panel.inicio.titulo);
          await marcaActual(menu, panel.inicio, "tras volver atrás");
          await unSoloH1(page, panel.inicio, "tras volver atrás");
        });
      }
    });

    test.describe("móvil", () => {
      test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

      test("barra inferior, cajón «Más» y botones de icono", async ({ page }) => {
        const abierto = await abrir(page, panel);
        const barraInferior = page.getByRole("navigation", { name: "Secciones" });

        await test.step("Al entrar", async () => {
          await expect(page).toHaveTitle(panel.inicio.titulo);
          await unSoloH1(page, panel.inicio, "al entrar (móvil)");
          await marcaActual(barraInferior, panel.inicio, "en la barra inferior");
          await botonesDeIconoConNombre(page, "al entrar (móvil)");
        });

        const cajon = page.getByRole("dialog");
        await test.step("Cajón «Más»: con nombre y la sección marcada", async () => {
          await page.getByRole("button", { name: /^Más opciones/ }).click();
          await expect(cajon).toBeVisible();
          await expect(cajon, "El cajón necesita un nombre (su título)").toHaveAccessibleName(/\S/);
          await marcaActual(cajon, panel.inicio, "en el cajón");
          await botonesDeIconoConNombre(page, "con el cajón abierto");
        });

        await test.step(`Cajón → «${panel.otra.menu}»: se cierra y el foco va al título`, async () => {
          await cajon.getByRole("button", { name: panel.otra.menu, exact: true }).click();
          await expect(cajon).toHaveCount(0);
          await esperarCalma(page, abierto.supabase);
          await comprobarSinFallos(page, abierto, `en «${panel.otra.menu}» (móvil)`);
          await focoEnElTitulo(page, `al ir a «${panel.otra.menu}» desde el cajón`);
          await expect(page).toHaveTitle(panel.otra.titulo);
          await unSoloH1(page, panel.otra, `en «${panel.otra.menu}» (móvil)`);
          await botonesDeIconoConNombre(page, `en «${panel.otra.menu}» (móvil)`);
        });

        await test.step("Cerrar el cajón sin cambiar de sección devuelve el foco a su botón", async () => {
          const mas = page.getByRole("button", { name: /^Más opciones/ });
          await mas.click();
          await expect(cajon).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(cajon).toHaveCount(0);
          await expect(mas).toBeFocused();
        });
      });
    });
  });
}

test("reducir movimiento: las transiciones CSS del panel son instantáneas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrir(page, PANELES[1]);
  // Contenedor plegable de un grupo del menú lateral (transición de 200 ms).
  const grupo = page.locator("aside nav [id]").first();
  const segundos = await grupo.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(segundos, "Duración de la transición con «reducir movimiento»").toBeLessThan(0.001);
});
