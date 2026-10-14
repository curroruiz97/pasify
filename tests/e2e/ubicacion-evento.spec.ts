import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";
import {
  cityOptions,
  esLocalSinCompletar,
  formatEventPlace,
  placeFromVenue,
  samePlace,
  venueOptionLabel,
} from "../../src/lib/eventPlace";

/**
 * Lugar de un evento (A1): al cambiar de local, «Madrid · local» ya no se queda.
 *
 * Causas que se protegen (ver src/lib/eventPlace.ts):
 *   - al cambiar de local, la ciudad y la dirección se heredaban del local
 *     anterior si al nuevo le faltaban (`v.city || prev.city`);
 *   - el selector de ciudad enseñaba el texto de ejemplo «Madrid» cuando la
 *     ciudad del evento no estaba en la lista;
 *   - al editar, lo que le faltaba al evento se rellenaba con el local por
 *     defecto de la cuenta («Principal») y se guardaba sin pedirlo;
 *   - los locales con el mismo nombre («Principal · Madrid» ×3) no se
 *     distinguían en el selector.
 *
 * La primera parte es lógica pura; la segunda recorre el editor con el
 * Supabase simulado (support/fake-supabase.ts) y varios locales.
 *   npm run test:e2e:partner
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

test.describe("lib/eventPlace (puro)", () => {
  test("placeFromVenue: el lugar del local, entero; lo que falta queda vacío", () => {
    expect(placeFromVenue(null)).toEqual({ city: "", venueName: "", address: "" });
    expect(placeFromVenue({ name: "  Sala   Norte ", city: "Bilbao", address: null })).toEqual({
      city: "Bilbao",
      venueName: "Sala Norte",
      address: "",
    });
    // Un local sin ciudad ni dirección no hereda nada: no hay «anterior» en la función.
    expect(placeFromVenue({ name: "Nave", city: undefined, address: undefined })).toEqual({
      city: "",
      venueName: "Nave",
      address: "",
    });
  });

  test("samePlace ignora mayúsculas, tildes y espacios", () => {
    expect(
      samePlace(
        { city: "málaga", venueName: "Sala  Sur", address: "Calle Larios 1" },
        { city: "Malaga", venueName: "sala sur", address: " calle larios 1 " },
      ),
    ).toBe(true);
    expect(
      samePlace({ city: "Madrid", venueName: "A", address: "x" }, { city: "Madrid", venueName: "A", address: "y" }),
    ).toBe(false);
  });

  test("formatEventPlace: sin «Madrid · Madrid» y sin el nombre de relleno «Principal»", () => {
    // El nombre de relleno de la cuenta nueva no se enseña a quien compra.
    expect(formatEventPlace({ venue_name: "Principal", address: "Calle Mayor 1", city: "Madrid" })).toEqual({
      short: "Madrid",
      long: "Calle Mayor 1 · Madrid",
      maps: "Calle Mayor 1, Madrid",
      name: "",
    });
    // Con nombre comercial, ocupa su sitio.
    expect(formatEventPlace({ venue_name: "Principal", address: "Calle Mayor 1", city: "Madrid" }, "Sala Kapital")).toEqual({
      short: "Sala Kapital · Madrid",
      long: "Sala Kapital · Calle Mayor 1 · Madrid",
      maps: "Sala Kapital, Calle Mayor 1, Madrid",
      name: "Sala Kapital",
    });
    // Una sala con nombre propio manda sobre el nombre comercial.
    expect(formatEventPlace({ venue_name: "Sala X", city: "Bilbao" }, "Sala Kapital").short).toBe("Sala X · Bilbao");
    // La ciudad escrita ya en la dirección no se repite.
    expect(formatEventPlace({ venue_name: "Sala X", address: "Calle Mayor 1, 28012 Madrid", city: "Madrid" })).toMatchObject({
      long: "Sala X · Calle Mayor 1, 28012 Madrid",
      maps: "Sala X, Calle Mayor 1, 28012 Madrid",
    });
    // Trozos repetidos (sin distinguir tildes) y vacíos.
    expect(formatEventPlace({ venue_name: "Málaga", city: "Malaga" }).short).toBe("Málaga");
    expect(formatEventPlace(null)).toEqual({ short: "", long: "", maps: "", name: "" });
    expect(formatEventPlace({ venue_name: null, address: null, city: null }).long).toBe("");
  });

  test("esLocalSinCompletar: solo el «Principal» sin dirección", () => {
    expect(esLocalSinCompletar({ name: "Principal", address: null })).toBe(true);
    expect(esLocalSinCompletar({ name: " principal ", address: "  " })).toBe(true);
    expect(esLocalSinCompletar({ name: "Principal", address: "Calle Mayor 1" })).toBe(false);
    expect(esLocalSinCompletar({ name: "Sala Principal", address: null })).toBe(false);
    expect(esLocalSinCompletar(null)).toBe(false);
  });

  test("venueOptionLabel distingue locales con el mismo nombre y ciudad", () => {
    const a = { id: "a", name: "Principal", city: "Madrid", address: "Calle Mayor 1" };
    const b = { id: "b", name: "Principal", city: "Madrid", address: "Gran Vía 9" };
    const c = { id: "c", name: "Principal", city: "Madrid", address: null };
    const d = { id: "d", name: "Sala Norte", city: "Bilbao", address: "Gran Vía 1" };
    const todos = [a, b, c, d];
    expect(venueOptionLabel(d, todos)).toBe("Sala Norte · Bilbao");
    expect(venueOptionLabel(a, todos)).toBe("Principal · Madrid · Calle Mayor 1");
    expect(venueOptionLabel(b, todos)).toBe("Principal · Madrid · Gran Vía 9");
    expect(venueOptionLabel(c, todos)).toBe("Principal · Madrid");
    // Mismo nombre, ciudad y dirección: se numeran.
    const e1 = { id: "e1", name: "Nave", city: "Getafe", address: "Polígono 7" };
    const e2 = { id: "e2", name: "Nave", city: "Getafe", address: "Polígono 7" };
    expect(venueOptionLabel(e1, [e1, e2])).toBe("Nave · Getafe · Polígono 7 (1)");
    expect(venueOptionLabel(e2, [e1, e2])).toBe("Nave · Getafe · Polígono 7 (2)");
    expect(venueOptionLabel({ id: "z", name: null, city: null, address: null }, [])).toBe("Local sin nombre");
  });

  test("cityOptions incluye la ciudad guardada aunque no esté en la lista", () => {
    const lista = [{ name: "Madrid" }, { name: "Barcelona" }];
    expect(cityOptions(lista, "Bilbao")).toEqual(["Madrid", "Barcelona", "Bilbao"]);
    expect(cityOptions(lista, "madrid")).toEqual(["Madrid", "Barcelona"]);
    expect(cityOptions(lista, "")).toEqual(["Madrid", "Barcelona"]);
    expect(cityOptions([], "Sitges")).toEqual(["Sitges"]);
  });
});

// ---------------------------------------------------------------------------
// Editor con varios locales
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;

let erroresJs: string[] = [];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect(erroresJs, "Errores JS en la página").toEqual([]);
});

const L = {
  norte: "5e2e0000-0000-4000-8000-0000000000a1",
  sur: "5e2e0000-0000-4000-8000-0000000000a2",
  principalA: "5e2e0000-0000-4000-8000-0000000000a3",
  principalB: "5e2e0000-0000-4000-8000-0000000000a4",
} as const;

const BASE_LOCAL = {
  brand_id: IDS.marca,
  org_id: IDS.org,
  business_category: "club",
  postal_code: null,
  country: "ES",
  timezone: "Europe/Madrid",
  capacity: 300,
  cover_image_url: null,
  description: null,
  phone: null,
  email: null,
  opening_hours: {},
  status: "active",
};

/** El local de la cuenta (Madrid) y otros cuatro: uno en una ciudad fuera de la lista, otro sin dirección… */
const LOCALES: Fila[] = [
  { ...BASE_LOCAL, id: IDS.local, slug: "principal", name: "Sala E2E · Principal", city: "Madrid", address: "Calle de Prueba 1" },
  { ...BASE_LOCAL, id: L.norte, slug: "norte", name: "Sala Norte", city: "Bilbao", address: null },
  { ...BASE_LOCAL, id: L.sur, slug: "sur", name: "Sala Sur", city: "Barcelona", address: "Carrer de Mallorca 5" },
  { ...BASE_LOCAL, id: L.principalA, slug: "principal-a", name: "Principal", city: "Madrid", address: "Calle Mayor 1" },
  { ...BASE_LOCAL, id: L.principalB, slug: "principal-b", name: "Principal", city: "Madrid", address: null },
];

async function responderJson(route: Route, json: unknown, status = 200) {
  const req = route.request();
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-origin": req.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "content-range, x-supabase-api-version",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(json),
  });
}

/** Los cinco locales de la organización en lugar del único del Supabase simulado. */
async function conVariosLocales(page: Page) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/venues",
    async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      if (route.request().method() !== "GET") return route.fallback();
      return responderJson(route, LOCALES);
    },
  );
}

/** Escrituras de «Nuevo evento»: el evento y sus tipos, con lo que mandó la app. */
async function simularCreacion(page: Page) {
  const eventos: Fila[] = [];
  await page.route(
    (url) =>
      url.origin === ORIGEN_SUPABASE && (url.pathname === "/rest/v1/events" || url.pathname === "/rest/v1/ticket_tiers"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      const cuerpo = req.postDataJSON() as Fila | Fila[];
      if (new URL(req.url()).pathname.endsWith("/events")) {
        eventos.push(cuerpo as Fila);
        return responderJson(route, [{ id: "5e2e0000-0000-4000-8000-0000000000e1" }], 201);
      }
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      return responderJson(
        route,
        filas.map((_, i) => ({ id: `5e2e0000-0000-4000-8000-0000000000f${i}` })),
        201,
      );
    },
  );
  return { eventos };
}

const CLAVE_BORRADOR = `pasify.draft.${IDS.usuario}.evento.${IDS.usuario}`;

/** Borrador de «Nuevo evento» en «Cuándo y dónde», con el local de la cuenta (Madrid). */
async function sembrarBorrador(page: Page, step: number) {
  const borrador = {
    v: 1,
    step,
    title: "Noche de prueba",
    description: "",
    dateTime: { date: "2099-06-12", startTime: "23:30", endTime: "06:00" },
    location: { city: "Madrid", venueName: "Sala E2E · Principal", address: "Calle de Prueba 1" },
    tiers: [
      {
        _key: "tipo-0",
        name: "General",
        description: "",
        priceEur: "15.00",
        capacity: "",
        perUserMax: "4",
        active: true,
        refundMode: "none",
        refundHours: "48",
        transferAllowed: true,
      },
    ],
    imageUrl: "",
    willPublish: true,
    venueId: IDS.local,
    timeZone: "Europe/Madrid",
  };
  await page.addInitScript(
    ({ clave, b }) => {
      try {
        window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: b }));
      } catch {
        /* sin storage */
      }
    },
    { clave: CLAVE_BORRADOR, b: borrador },
  );
}

async function abrirPanel(page: Page, antesDeEntrar?: () => Promise<void>) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  await instalarSupabaseFalso(page);
  await antesDeEntrar?.();
  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 90_000 });
}

async function abrirNuevoEvento(page: Page): Promise<Locator> {
  await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo evento" });
  await expect(editor.getByText(/^Paso \d\d \/ 06$/)).toBeVisible();
  return editor;
}

async function abrirEdicion(page: Page, titulo: string): Promise<Locator> {
  await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
  await page
    .locator("main table tbody tr")
    .filter({ hasText: titulo })
    .getByRole("button", { name: "Acciones del evento" })
    .click();
  await page.getByRole("menuitem", { name: "Editar evento" }).click();
  const editor = page.getByRole("dialog", { name: "Editar evento" });
  await expect(editor.locator("#evt-title")).toHaveValue(titulo);
  return editor;
}

const paso = (editor: Locator, n: number) => editor.getByText(`Paso ${String(n).padStart(2, "0")} / 06`);

/** Elige un local en el selector «Local». */
async function elegirLocal(page: Page, editor: Locator, etiqueta: string) {
  await editor.locator("#evt-local").click();
  await page.getByRole("option", { name: etiqueta, exact: true }).click();
}

test.describe("editor: el lugar sigue al local", () => {
  test("al cambiar de local, ciudad, nombre y dirección son los del local nuevo (sin heredar «Madrid» ni la dirección anterior)", async ({
    page,
  }) => {
    await sembrarBorrador(page, 1);
    await abrirPanel(page, () => conVariosLocales(page));
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();

    const ciudad = editor.locator("#evt-city");
    const nombre = editor.locator("#evt-venue");
    const direccion = editor.locator("#evt-addr");
    await expect(ciudad).toContainText("Madrid");
    await expect(direccion).toHaveValue("Calle de Prueba 1");

    // Los cinco locales se distinguen en el selector (los dos «Principal · Madrid» llevan su dirección).
    await editor.locator("#evt-local").click();
    for (const etiqueta of [
      "Sala E2E · Principal · Madrid",
      "Sala Norte · Bilbao",
      "Sala Sur · Barcelona",
      "Principal · Madrid · Calle Mayor 1",
      "Principal · Madrid",
    ]) {
      await expect(page.getByRole("option", { name: etiqueta, exact: true }), etiqueta).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // 1) Local de Bilbao, SIN dirección: la ciudad es Bilbao (no está en la lista y no sale «Madrid»),
    //    la sala es la suya y la dirección queda vacía en vez de la de «Calle de Prueba 1».
    await elegirLocal(page, editor, "Sala Norte · Bilbao");
    await expect(ciudad).toContainText("Bilbao");
    await expect(ciudad).not.toContainText("Madrid");
    await expect(nombre).toHaveValue("Sala Norte");
    await expect(direccion).toHaveValue("");
    await expect(editor.getByTestId("lugar-distinto-del-local")).toHaveCount(0);
    // Sin dirección no se avanza: el editor la pide.
    await editor.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByText("Añade la dirección exacta del evento").first()).toBeVisible();
    await expect(paso(editor, 2)).toBeVisible();

    // 2) Local de Barcelona, con dirección: todo suyo.
    await elegirLocal(page, editor, "Sala Sur · Barcelona");
    await expect(ciudad).toContainText("Barcelona");
    await expect(nombre).toHaveValue("Sala Sur");
    await expect(direccion).toHaveValue("Carrer de Mallorca 5");

    // 3) Datos tocados a mano: se avisa y «Usar los datos del local» los restablece.
    await direccion.fill("Otra calle 99");
    const aviso = editor.getByTestId("lugar-distinto-del-local");
    await expect(aviso).toContainText("Sala Sur · Barcelona");
    await aviso.getByRole("button", { name: "Usar los datos del local" }).click();
    await expect(direccion).toHaveValue("Carrer de Mallorca 5");
    await expect(aviso).toHaveCount(0);

    // 4) De vuelta al primero.
    await elegirLocal(page, editor, "Sala E2E · Principal · Madrid");
    await expect(ciudad).toContainText("Madrid");
    await expect(nombre).toHaveValue("Sala E2E · Principal");
    await expect(direccion).toHaveValue("Calle de Prueba 1");
  });

  test("un local con el nombre de relleno «Principal» y sin dirección se avisa (en Configuración se corrige)", async ({ page }) => {
    await sembrarBorrador(page, 1);
    await abrirPanel(page, () => conVariosLocales(page));
    const editor = await abrirNuevoEvento(page);
    await expect(editor.getByTestId("local-sin-completar")).toHaveCount(0);

    await elegirLocal(page, editor, "Principal · Madrid");
    const aviso = editor.getByTestId("local-sin-completar");
    await expect(aviso).toContainText("nombre de relleno de la cuenta");
    await expect(aviso).toContainText("Configuración");
    await expect(editor.locator("#evt-addr")).toHaveValue("");

    // El «Principal» con dirección ya no se avisa.
    await elegirLocal(page, editor, "Principal · Madrid · Calle Mayor 1");
    await expect(editor.getByTestId("local-sin-completar")).toHaveCount(0);
  });

  test("lo que se guarda al crear es el lugar del local elegido, con su venue_id", async ({ page }) => {
    let creacion!: Awaited<ReturnType<typeof simularCreacion>>;
    await sembrarBorrador(page, 1);
    await abrirPanel(page, async () => {
      await conVariosLocales(page);
      creacion = await simularCreacion(page);
    });
    const editor = await abrirNuevoEvento(page);
    await elegirLocal(page, editor, "Sala Sur · Barcelona");
    await expect(editor.locator("#evt-addr")).toHaveValue("Carrer de Mallorca 5");

    // «Siguiente» hasta el resumen y guardar como borrador.
    for (let n = 3; n <= 6; n++) {
      await editor.getByRole("button", { name: "Siguiente" }).click();
      await expect(paso(editor, n)).toBeVisible();
    }
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();

    expect(creacion.eventos).toHaveLength(1);
    expect(creacion.eventos[0]).toMatchObject({
      venue_id: L.sur,
      city: "Barcelona",
      venue_name: "Sala Sur",
      address: "Carrer de Mallorca 5",
      status: "draft",
    });
  });

  test("al editar un evento al que le falta el lugar no se le inventa el del local por defecto; «Usar los datos del local» lo rellena", async ({
    page,
  }) => {
    await abrirPanel(page, () => conVariosLocales(page));
    const editor = await abrirEdicion(page, "Concierto E2E");
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();

    // El evento de prueba solo trae ciudad (sin sala ni dirección): se ve tal cual, vacío.
    await expect(editor.locator("#evt-city")).toContainText("Madrid");
    await expect(editor.locator("#evt-venue")).toHaveValue("");
    await expect(editor.locator("#evt-addr")).toHaveValue("");

    const aviso = editor.getByTestId("lugar-distinto-del-local");
    await expect(aviso).toBeVisible();
    await aviso.getByRole("button", { name: "Usar los datos del local" }).click();
    await expect(editor.locator("#evt-venue")).toHaveValue("Sala E2E · Principal");
    await expect(editor.locator("#evt-addr")).toHaveValue("Calle de Prueba 1");
    await expect(aviso).toHaveCount(0);
  });
});
