import { expect, test, type Locator, type Page } from "@playwright/test";
import { IDS, instalarSupabaseFalso } from "./support/fake-supabase";
import { EVENTO, T, prepararCompra, responder, soloLectura, type Fila } from "./support/compra-falsa";

/**
 * Escritorio, tablet y móvil de lo que ve el público al comprar (Supabase
 * simulado; sin pagos): la página del evento, el selector de entradas, la
 * confirmación, el calendario y la tira de la home.
 *
 * No mira píxeles: mide cajas. En cada tamaño comprueba que no hay scroll
 * horizontal, que lo que se abre (hoja o diálogo) está centrado y dentro de la
 * pantalla, y que el escritorio aprovecha el ancho (dos columnas, la compra a
 * la vista, 4 carteles por fila) sin que el móvil cambie.
 *
 * Los tamaños son los de las capturas de la auditoría: 1440×900 (escritorio),
 * 1024×768 (escritorio justo en el corte `lg`), 820×1180 (tablet) y 390×844
 * (móvil).
 *
 * Corre con la config del panel (Supabase falso, un worker, hora de Madrid):
 *   npx playwright test -c playwright.partner.config.ts rediseno-desktop
 */

interface Tamano {
  nombre: string;
  ancho: number;
  alto: number;
  /** ≥ 1024 px: diálogo y dos columnas. */
  escritorio: boolean;
  /** Carteles por fila en el calendario. */
  carteles: number;
}

const TAMANOS: Tamano[] = [
  { nombre: "escritorio 1440", ancho: 1440, alto: 900, escritorio: true, carteles: 4 },
  { nombre: "escritorio 1024", ancho: 1024, alto: 768, escritorio: true, carteles: 3 },
  { nombre: "tablet 820", ancho: 820, alto: 1180, escritorio: false, carteles: 3 },
  { nombre: "móvil 390", ancho: 390, alto: 844, escritorio: false, carteles: 2 },
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

type Caja = { x: number; y: number; width: number; height: number };

async function caja(l: Locator): Promise<Caja> {
  const b = await l.boundingBox();
  if (!b) throw new Error("el elemento no tiene caja (¿oculto?)");
  return b;
}

/** La caja cuando deja de moverse (animaciones de entrada de hojas y diálogos). */
async function cajaEstable(l: Locator): Promise<Caja> {
  let anterior = "";
  let seguidas = 0;
  for (let i = 0; i < 60; i++) {
    const b = await l.boundingBox();
    const clave = b ? [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10).join(",") : "";
    if (b && clave === anterior) {
      seguidas += 1;
      if (seguidas >= 3) return b;
    } else {
      seguidas = 0;
    }
    anterior = clave;
    await l.page().waitForTimeout(100);
  }
  throw new Error("la caja no se estabiliza");
}

const derecha = (b: Caja) => b.x + b.width;
const abajo = (b: Caja) => b.y + b.height;

async function sinDesbordeHorizontal(page: Page, donde: string) {
  const d = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, ancho: document.documentElement.clientWidth }));
  expect(d.scroll, `scroll horizontal ${donde}`).toBeLessThanOrEqual(d.ancho + 1);
}

/** ¿Algún ascendiente (hasta `hasta`) tiene `position: fixed`? */
const estaFijo = (l: Locator) =>
  l.evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === "fixed") return true;
    }
    return false;
  });

let erroresJs: string[] = [];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect(erroresJs, "Errores JS en la página").toEqual([]);
});

function vigilarErrores(page: Page) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
}

// ---------------------------------------------------------------------------
// Eventos de prueba para el calendario y la home
// ---------------------------------------------------------------------------

const DIA = 86_400_000;

function eventosPublicos(n: number): Fila[] {
  const ahora = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `5e0c0000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}`,
    partner_id: IDS.usuario,
    title: `Noche ${i + 1}`,
    description: null,
    city: "Madrid",
    venue_name: "Sala Aurora",
    address: "Calle Mayor 1",
    price_cents: 1500,
    currency: "eur",
    capacity: 300,
    tickets_sold: 10,
    image_url: null,
    category: null,
    status: "published",
    venue_id: null,
    date_start: new Date(ahora + (2 + i) * DIA).toISOString(),
    date_end: new Date(ahora + (2 + i) * DIA + 6 * 3_600_000).toISOString(),
  }));
}

async function conEventosPublicos(page: Page, n: number) {
  vigilarErrores(page);
  await instalarSupabaseFalso(page, { roles: ["client"] });
  const filas = eventosPublicos(n);
  await responder(page, "/rest/v1/events", (req) => (soloLectura(req) ? { json: filas } : undefined));
  await responder(page, "/rest/v1/public_partners", (req) => (soloLectura(req) ? { json: [] } : undefined));
}

// ---------------------------------------------------------------------------
// Tests, un bloque por tamaño
// ---------------------------------------------------------------------------

for (const tam of TAMANOS) {
  test.describe(tam.nombre, () => {
    test.use({ viewport: { width: tam.ancho, height: tam.alto } });

    test("página del evento: la compra a la vista en escritorio, la barra fija abajo en tablet y móvil", async ({ page }) => {
      vigilarErrores(page);
      await prepararCompra(page);
      await page.goto(`/#/e/${EVENTO}`);
      await expect(page.getByRole("heading", { level: 1, name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });
      await sinDesbordeHorizontal(page, "en la página del evento");

      const evento = page.locator("main article").first();
      const entradas = page.getByTestId("compra-evento");
      const cta = page.getByRole("button", { name: "Conseguir entradas" });
      const logo = page.getByRole("link", { name: "Ver más eventos" });
      const cEvento = await caja(evento);
      const cEntradas = await caja(entradas);
      const cCta = await caja(cta);

      // La cabecera y el contenido comparten margen izquierdo.
      expect(Math.abs((await caja(logo)).x - cEvento.x), "logo alineado con el evento").toBeLessThanOrEqual(1.5);

      if (tam.escritorio) {
        // Dos columnas: el evento a la izquierda y las entradas a la derecha, de la misma altura de arranque.
        expect(cEntradas.x).toBeGreaterThanOrEqual(derecha(cEvento) - 1);
        expect(Math.abs(cEntradas.y - cEvento.y)).toBeLessThanOrEqual(2);
        // El botón de compra se ve sin bajar y no es una barra fija.
        expect(abajo(cCta), "el botón de compra cabe en la pantalla").toBeLessThanOrEqual(tam.alto);
        expect(await estaFijo(cta)).toBe(false);
        expect(derecha(cEntradas)).toBeLessThanOrEqual(tam.ancho);
        // La tarjeta se queda a la vista al bajar (sticky).
        expect(await entradas.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
      } else {
        // Una columna: las entradas debajo del evento y el botón en una barra fija abajo.
        expect(cEntradas.y).toBeGreaterThanOrEqual(abajo(cEvento) - 1);
        expect(await estaFijo(cta)).toBe(true);
        expect(abajo(cCta)).toBeGreaterThan(tam.alto - 40);
        expect(abajo(cCta)).toBeLessThanOrEqual(tam.alto);
        expect(await entradas.evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
      }
    });

    test("selector de entradas: centrado y dentro de la pantalla; cambia de tipo y de cantidad y pide ese pago", async ({ page }) => {
      const compra = await prepararCompra(page);
      // «Stripe» es la propia app (/#/calendar): el navegador sale de la página del evento sin llegar a ningún Stripe.
      compra.checkout = () => ({
        json: {
          url: `${new URL(page.url()).origin}/#/calendar`,
          order_id: "c0b0e000-0000-4000-8000-0000000000b9",
          session_id: "cs_test_e2e",
        },
      });
      vigilarErrores(page);
      await page.goto(`/#/e/${EVENTO}`);
      await expect(page.getByRole("heading", { level: 1, name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });
      await page.getByRole("button", { name: "Conseguir entradas" }).click();

      const selector = page.getByRole("dialog");
      await expect(selector.getByRole("radiogroup", { name: "Tipo de entrada" })).toBeVisible();
      const c = await cajaEstable(selector);

      // Dentro de la pantalla y centrado en horizontal, en todos los tamaños.
      expect(c.x, "no se sale por la izquierda").toBeGreaterThanOrEqual(-0.5);
      expect(derecha(c), "no se sale por la derecha").toBeLessThanOrEqual(tam.ancho + 0.5);
      expect(Math.abs(c.x + c.width / 2 - tam.ancho / 2), "centrado en horizontal").toBeLessThanOrEqual(1.5);
      expect(c.y).toBeGreaterThanOrEqual(-0.5);
      expect(abajo(c)).toBeLessThanOrEqual(tam.alto + 0.5);

      if (tam.escritorio) {
        // Diálogo centrado también en vertical y a dos columnas: los tipos a la izquierda y la cantidad, el total y el pago a la derecha.
        expect(c.width).toBeLessThanOrEqual(897);
        expect(Math.abs(c.y + c.height / 2 - tam.alto / 2), "centrado en vertical").toBeLessThanOrEqual(2);
        const cTipos = await caja(selector.getByRole("radiogroup", { name: "Tipo de entrada" }));
        const cResumen = await caja(selector.getByTestId("resumen-compra"));
        expect(cResumen.x).toBeGreaterThanOrEqual(derecha(cTipos) - 1);
        expect(Math.abs(cResumen.y - cTipos.y)).toBeLessThanOrEqual(2);
      } else {
        // Hoja desde abajo, pegada al borde de abajo; en tablet con 672 px como mucho.
        expect(Math.abs(abajo(c) - tam.alto), "pegada abajo").toBeLessThanOrEqual(1.5);
        if (tam.ancho >= 640) expect(c.width).toBeLessThanOrEqual(673);
        else expect(c.width).toBeGreaterThanOrEqual(tam.ancho - 1);
      }

      // Todo lo necesario para pagar se ve sin salir de la pantalla.
      const pagar = selector.getByRole("button", { name: /Continuar al pago/ });
      const cPagar = await caja(pagar);
      expect(abajo(cPagar)).toBeLessThanOrEqual(tam.alto);
      expect(cPagar.y).toBeGreaterThanOrEqual(0);
      await expect(selector.getByText("Total", { exact: true })).toBeVisible();

      // Funciona igual: VIP, dos entradas, 100 €.
      await selector.getByRole("radio", { name: /VIP/ }).click();
      await selector.getByRole("button", { name: "Añadir una entrada" }).click();
      await expect(selector.getByText("2 × VIP")).toBeVisible();
      await expect(selector.getByText(/^100\s?€$/)).toBeVisible();
      await pagar.click();

      await expect.poll(() => compra.pagos.length).toBe(1);
      expect(compra.pagos[0]).toMatchObject({ event_id: EVENTO, tier_id: T.vip, qty: 2 });
      await expect(page).toHaveURL(/#\/calendar/);
    });

    test("confirmación: entradas y pedido a dos columnas en escritorio, una columna en tablet y móvil", async ({ page }) => {
      vigilarErrores(page);
      await prepararCompra(page);
      await page.goto(`/#/ticket/success?order_id=${T.pedidoGratis}&free=1`);
      await expect(page.getByRole("heading", { name: /Tus entradas están listas/ })).toBeVisible({ timeout: 90_000 });
      const qr = page.getByRole("img", { name: /Código QR de la entrada/ });
      await expect(qr).toHaveCount(2);
      for (const i of [0, 1]) {
        await expect(qr.nth(i)).toBeVisible();
        expect(await qr.nth(i).evaluate((img) => (img as HTMLImageElement).naturalWidth), `QR ${i + 1} cargado`).toBeGreaterThan(0);
      }
      await sinDesbordeHorizontal(page, "en la confirmación");

      const tarjetas = page.getByRole("region", { name: "Tus entradas" }).locator("article");
      const resumen = page.locator("main article").filter({ hasText: "Concierto E2E" }).last();
      const c1 = await caja(tarjetas.nth(0));
      const c2 = await caja(tarjetas.nth(1));
      const cResumen = await caja(resumen);

      if (tam.escritorio) {
        // Las dos entradas, una junto a otra, a la izquierda; el pedido a la derecha y a la vista.
        expect(Math.abs(c1.y - c2.y), "entradas en la misma fila").toBeLessThanOrEqual(1);
        expect(c2.x).toBeGreaterThanOrEqual(derecha(c1) - 1);
        expect(cResumen.x).toBeGreaterThanOrEqual(derecha(c2) - 1);
        expect(await resumen.locator("xpath=..").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
        // «Ver en mi cartera» está en la columna del pedido, no debajo de las entradas.
        const cartera = await caja(page.getByRole("button", { name: /Ver en mi cartera/ }));
        expect(cartera.x).toBeGreaterThanOrEqual(derecha(c2) - 1);
      } else if (tam.ancho >= 640) {
        // Tablet: una columna, dos entradas por fila.
        expect(Math.abs(c1.y - c2.y)).toBeLessThanOrEqual(1);
        expect(c2.x).toBeGreaterThanOrEqual(derecha(c1) - 1);
        expect(cResumen.y).toBeGreaterThanOrEqual(abajo(c2) - 1);
      } else {
        // Móvil: una entrada debajo de otra, a todo el ancho de la columna.
        expect(c2.y).toBeGreaterThanOrEqual(abajo(c1) - 1);
        expect(Math.abs(c1.x - c2.x)).toBeLessThanOrEqual(1);
        expect(cResumen.y).toBeGreaterThanOrEqual(abajo(c2) - 1);
      }
    });

    test("confirmación con una sola entrada: centrada en su columna, no pegada a la izquierda", async ({ page }) => {
      vigilarErrores(page);
      await prepararCompra(page);
      await page.goto(`/#/ticket/success?order_id=${T.pedidoPagado}`);
      await expect(page.getByRole("heading", { name: /Tu entrada está lista/ })).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("img", { name: /Código QR de la entrada/ })).toHaveCount(1);
      await sinDesbordeHorizontal(page, "en la confirmación de una entrada");

      const columna = await caja(page.getByRole("region", { name: "Tus entradas" }));
      const tarjeta = await caja(page.getByRole("region", { name: "Tus entradas" }).locator("article").first());
      expect(Math.abs(tarjeta.x + tarjeta.width / 2 - (columna.x + columna.width / 2)), "centrada en su columna").toBeLessThanOrEqual(1.5);
      if (tam.escritorio) expect(tarjeta.width).toBeLessThanOrEqual(353);
    });

    test("calendario: los carteles alineados con el título y con el ancho aprovechado", async ({ page }) => {
      await conEventosPublicos(page, 9);
      await page.goto("/#/calendar");
      await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
      const cartel = page.locator("article[id^='event-card-']");
      await expect(cartel).toHaveCount(9);
      await sinDesbordeHorizontal(page, "en el calendario");

      const titulo = await caja(page.getByRole("heading", { name: "Próximos eventos" }));
      const primero = await caja(cartel.first());
      expect(Math.abs(primero.x - titulo.x), "la rejilla arranca donde el título").toBeLessThanOrEqual(1);

      // Cuántos carteles caben en la primera fila.
      const cajas = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => caja(cartel.nth(i))));
      const enLaPrimeraFila = cajas.filter((c) => Math.abs(c.y - primero.y) <= 1).length;
      expect(enLaPrimeraFila, "carteles por fila").toBe(tam.carteles);
      // Ocupa el contenedor entero: el último cartel de la fila acaba donde acaba el botón de vista.
      const ultimo = cajas[enLaPrimeraFila - 1];
      const vista = await caja(page.getByRole("group", { name: "Vista" }));
      expect(Math.abs(derecha(ultimo) - derecha(vista)), "la rejilla llega al margen derecho").toBeLessThanOrEqual(1);
      // Y todos cargan sus botones de compra a la vista.
      await expect(cartel.first().getByRole("button", { name: /Comprar entradas/ })).toBeVisible();
    });
  });
}

// ---------------------------------------------------------------------------
// La tira de la home del cliente
// ---------------------------------------------------------------------------

test.describe("home del cliente: tira de próximos eventos", () => {
  test.describe("escritorio", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("con más tarjetas de las que caben salen las flechas y mueven la fila", async ({ page }) => {
      await conEventosPublicos(page, 9);
      await page.goto("/#/client-dashboard");
      const tira = page.getByRole("region", { name: "Próximos eventos" });
      await expect(tira).toBeVisible({ timeout: 90_000 });
      const pista = tira.locator("div.overflow-x-auto");
      const siguiente = tira.getByRole("button", { name: "Más eventos" });
      const anterior = tira.getByRole("button", { name: "Eventos anteriores" });

      // Al principio solo se puede ir hacia delante.
      await expect(siguiente).toBeVisible();
      await expect(anterior).toHaveCount(0);
      expect(await pista.evaluate((el) => el.scrollLeft)).toBe(0);

      await siguiente.click();
      await expect.poll(() => pista.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
      await expect(anterior).toBeVisible();

      // «Eventos anteriores» vuelve hacia atrás.
      const antes = await pista.evaluate((el) => el.scrollLeft);
      await anterior.click();
      await expect.poll(() => pista.evaluate((el) => el.scrollLeft)).toBeLessThan(antes - 100);

      // Al final de la fila ya no hay «Más eventos»; al principio, ya no hay «Eventos anteriores».
      await pista.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await expect(siguiente).toHaveCount(0);
      await expect(anterior).toBeVisible();
      await pista.evaluate((el) => el.scrollTo({ left: 0 }));
      await expect(anterior).toHaveCount(0);
      await expect(siguiente).toBeVisible();
      await sinDesbordeHorizontal(page, "en la home");
    });

    test("con pocas tarjetas no hay flechas", async ({ page }) => {
      await conEventosPublicos(page, 2);
      await page.goto("/#/client-dashboard");
      const tira = page.getByRole("region", { name: "Próximos eventos" });
      await expect(tira).toBeVisible({ timeout: 90_000 });
      await expect(tira.getByRole("button", { name: "Más eventos" })).toHaveCount(0);
      await expect(tira.getByRole("button", { name: "Eventos anteriores" })).toHaveCount(0);
    });
  });

  test.describe("móvil", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("se desliza con el dedo: sin flechas", async ({ page }) => {
      await conEventosPublicos(page, 9);
      await page.goto("/#/client-dashboard");
      const tira = page.getByRole("region", { name: "Próximos eventos" });
      await expect(tira).toBeVisible({ timeout: 90_000 });
      await expect(tira.getByRole("button", { name: "Más eventos" })).toBeHidden();
      await expect(tira.getByRole("button", { name: "Eventos anteriores" })).toHaveCount(0);
      await sinDesbordeHorizontal(page, "en la home del móvil");
    });
  });
});

// ---------------------------------------------------------------------------
// La hoja global (Sheet) ya no se descentra
// ---------------------------------------------------------------------------

test.describe("hoja desde abajo (Sheet) en tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("otras hojas de la app, como el selector de ciudad, también quedan centradas", async ({ page }) => {
    await conEventosPublicos(page, 3);
    await page.goto("/#/calendar");
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: /^Ciudad: .*Cambiar$/ }).click();
    const hoja = page.getByRole("dialog", { name: "Elige tu ciudad" });
    await expect(hoja).toBeVisible();
    const c = await cajaEstable(hoja);
    expect(c.x, "no se sale por la izquierda").toBeGreaterThanOrEqual(-0.5);
    expect(derecha(c), "no se sale por la derecha").toBeLessThanOrEqual(820.5);
    expect(Math.abs(c.x + c.width / 2 - 410), "centrada en horizontal").toBeLessThanOrEqual(1.5);
    expect(c.width).toBeLessThanOrEqual(673);
  });

  test("el selector arranca en el centro y no se sale por la derecha (framer-motion pisaba el translate)", async ({ page }) => {
    vigilarErrores(page);
    await prepararCompra(page);
    await page.goto(`/#/e/${EVENTO}`);
    await expect(page.getByRole("heading", { level: 1, name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Conseguir entradas" }).click();
    const hoja = page.getByRole("dialog");
    await expect(hoja).toBeVisible();
    const c = await cajaEstable(hoja);
    expect(c.x).toBeCloseTo((820 - c.width) / 2, 0);
    // El estilo en línea de framer-motion ya no lleva translateX: la hoja se centra con márgenes.
    expect(await hoja.evaluate((el) => getComputedStyle(el).marginLeft)).not.toBe("0px");
  });
});
