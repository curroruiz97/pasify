import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";
import {
  EVENT_CATEGORIES,
  effectiveEventCategory,
  eventCategoryFromVenue,
  eventCategoryLabel,
  isEventCategory,
} from "../../src/lib/eventCategories";

/**
 * Clasificación de eventos (A3): Bar, Discoteca y Festival, de extremo a
 * extremo con Supabase simulado.
 *
 *   - Editor: al crear se elige la categoría (obligatoria, con la del local
 *     como propuesta si coincide), se guarda en `events.category`, se puede
 *     cambiar al editar y un evento anterior sin categoría no se obliga ni se
 *     reescribe.
 *   - Calendario público: filtro por categoría con cuántos hay de cada una,
 *     en la URL (?cat=), con la categoría del evento y, si no tiene, la de su
 *     local; sin resultados, lo dice y deja volver.
 *   - Home del cliente: las categorías Bar, Discoteca y Festival filtran también
 *     la tira de eventos, no solo los locales.
 *
 *   npm run test:e2e:partner
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

type Fila = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

test.describe("lib/eventCategories (puro)", () => {
  test("las categorías de evento y su vocabulario", () => {
    expect(EVENT_CATEGORIES.map((c) => c.value)).toEqual(["bar", "discoteca", "festival"]);
    expect(EVENT_CATEGORIES.map((c) => c.label)).toEqual(["Bar", "Discoteca", "Festival"]);
    expect(isEventCategory("bar")).toBe(true);
    expect(isEventCategory("Bar")).toBe(false);
    expect(isEventCategory("rooftop")).toBe(false);
    expect(isEventCategory(null)).toBe(false);
    expect(eventCategoryLabel("festival")).toBe("Festival");
    expect(eventCategoryLabel("rooftop")).toBeNull();
    expect(eventCategoryLabel(null)).toBeNull();
  });

  test("categoría del local → categoría de evento solo donde coincide", () => {
    expect(eventCategoryFromVenue("bar")).toBe("bar");
    expect(eventCategoryFromVenue("discoteca")).toBe("discoteca");
    expect(eventCategoryFromVenue(" Club ")).toBe("discoteca");
    expect(eventCategoryFromVenue("festival")).toBe("festival");
    // Sala, rooftop, beach club, restaurante, teatro y otro no dicen de qué es el evento.
    for (const c of ["sala", "rooftop", "beachclub", "restaurante", "teatro", "otro", "", null, undefined]) {
      expect(eventCategoryFromVenue(c as string | null | undefined), String(c)).toBeNull();
    }
  });

  test("effectiveEventCategory: la del evento manda; sin ella, la de su local", () => {
    expect(effectiveEventCategory("bar", "discoteca")).toBe("bar");
    expect(effectiveEventCategory("festival", null)).toBe("festival");
    expect(effectiveEventCategory(null, "discoteca")).toBe("discoteca");
    expect(effectiveEventCategory(undefined, "club")).toBe("discoteca");
    expect(effectiveEventCategory(null, "sala")).toBeNull();
    expect(effectiveEventCategory(null, null)).toBeNull();
    // Un valor que no es categoría de evento (dato antiguo) se ignora, no se enseña ni rompe.
    expect(effectiveEventCategory("rooftop", "bar")).toBe("bar");
    expect(effectiveEventCategory("rooftop", "sala")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let erroresJs: string[] = [];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect(erroresJs, "Errores JS en la página").toEqual([]);
});

async function responderJson(route: Route, json: unknown, status = 200) {
  const req = route.request();
  const filas = Array.isArray(json) ? json.length : 1;
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-origin": req.headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "content-range, x-supabase-api-version",
      "content-type": "application/json; charset=utf-8",
      "content-range": filas ? `0-${filas - 1}/${filas}` : "*/0",
    },
    body: JSON.stringify(json),
  });
}

const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const BASE_LOCAL = {
  brand_id: IDS.marca,
  org_id: IDS.org,
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

const LOC = {
  club: IDS.local,
  bar: "5e2e0000-0000-4000-8000-0000000000a5",
  sala: "5e2e0000-0000-4000-8000-0000000000a6",
} as const;

/** Locales de la organización con la categoría de cada uno. */
async function conLocales(page: Page, categorias: Array<keyof typeof LOC>) {
  const filas: Fila[] = categorias.map((c) => ({
    ...BASE_LOCAL,
    id: LOC[c],
    slug: `local-${c}`,
    name: c === "club" ? "Sala E2E · Principal" : `Local ${c}`,
    city: "Madrid",
    address: `Calle ${c} 1`,
    business_category: c,
  }));
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/venues",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return responderJson(route, filas);
    },
  );
}

const CLAVE_BORRADOR = `pasify.draft.${IDS.usuario}.evento.${IDS.usuario}`;

/** Borrador de «Nuevo evento» con todo válido salvo, si se pide, la categoría. */
async function sembrarBorrador(page: Page, opciones: { step: number; category?: string; venueId?: string }) {
  const borrador = {
    v: 1,
    step: opciones.step,
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
    venueId: opciones.venueId ?? IDS.local,
    ...(opciones.category !== undefined ? { category: opciones.category } : {}),
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
const siguiente = (editor: Locator) => editor.getByRole("button", { name: "Siguiente" });
const categorias = (editor: Locator) => editor.getByRole("radiogroup", { name: /Categoría/ });
const radio = (editor: Locator, nombre: string) => categorias(editor).getByRole("radio", { name: nombre });
/** Elige una categoría pulsando su etiqueta (el radio es solo para teclado y lectores de pantalla). */
const elegir = (editor: Locator, nombre: string) => categorias(editor).locator("label", { hasText: nombre }).click();

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

/** PATCH a events y ticket_tiers aceptados (una fila cambiada), con su cuerpo apuntado. */
async function simularEscrituras(page: Page) {
  const escrituras: Array<{ tabla: string; cuerpo: Fila }> = [];
  await page.route(
    (url) =>
      url.origin === ORIGEN_SUPABASE && (url.pathname === "/rest/v1/events" || url.pathname === "/rest/v1/ticket_tiers"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "PATCH") return route.fallback();
      const url = new URL(req.url());
      const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
      escrituras.push({ tabla: url.pathname.replace("/rest/v1/", ""), cuerpo: (req.postDataJSON() ?? {}) as Fila });
      await responderJson(route, [{ id }]);
    },
  );
  return escrituras;
}

/** El evento «Concierto E2E» con su categoría (el del Supabase simulado no tiene), para abrirlo en edición. */
async function conEventoClasificado(page: Page, category: string) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
      if (req.method() !== "GET" || id !== IDS.eventoProximo) return route.fallback();
      return responderJson(route, {
        id: IDS.eventoProximo,
        title: "Concierto E2E",
        description: null,
        city: "Madrid",
        venue_name: "Sala E2E · Principal",
        address: "Calle de Prueba 1",
        date_start: iso(Date.now() + 7 * D),
        date_end: iso(Date.now() + 7 * D + 4 * H),
        image_url: null,
        status: "published",
        capacity: 200,
        price_cents: 2000,
        venue_id: IDS.local,
        category,
      });
    },
  );
}

test.describe("editor: categoría del evento", () => {
  test("al crear, sin categoría que proponer: se pide, se elige, sale en el resumen y se guarda con el evento", async ({
    page,
  }) => {
    let creacion!: Awaited<ReturnType<typeof simularCreacion>>;
    // Un local de sala no dice de qué es el evento: nada que proponer. Borrador de antes de las categorías.
    await sembrarBorrador(page, { step: 0 });
    await abrirPanel(page, async () => {
      await conLocales(page, ["sala"]);
      creacion = await simularCreacion(page);
    });
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 1)).toBeVisible();

    await expect(categorias(editor).getByRole("radio")).toHaveCount(3);
    for (const nombre of ["Bar", "Discoteca", "Festival"]) {
      await expect(radio(editor, nombre), `«${nombre}» preseleccionada sin motivo`).not.toBeChecked();
    }
    await expect(editor.getByText(/^Categoría \*$/)).toBeVisible();

    // Sin categoría no se avanza.
    await siguiente(editor).click();
    await expect(page.getByText("Elige la categoría del evento").first()).toBeVisible();
    await expect(paso(editor, 1)).toBeVisible();

    await elegir(editor, "Festival");
    await expect(radio(editor, "Festival")).toBeChecked();
    await expect(radio(editor, "Bar")).not.toBeChecked();

    // Sale en la vista previa y deja avanzar hasta el resumen.
    await expect(editor.getByText("Vista previa").first()).toBeVisible();
    await expect(editor.locator("aside").getByText("Festival").first()).toBeVisible();
    for (let n = 2; n <= 6; n++) {
      await siguiente(editor).click();
      await expect(paso(editor, n)).toBeVisible();
    }
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado").first()).toBeVisible();

    expect(creacion.eventos).toHaveLength(1);
    expect(creacion.eventos[0]).toMatchObject({ category: "festival", status: "draft", title: "Noche de prueba" });
  });

  test("un local de discoteca propone «Discoteca» y no hace falta tocar nada; la propuesta sigue al local salvo que se elija otra", async ({
    page,
  }) => {
    await abrirPanel(page, () => conLocales(page, ["club", "bar", "sala"]));
    const editor = await abrirNuevoEvento(page);

    // Local por defecto: «club» (una discoteca) → propone «Discoteca».
    await expect(radio(editor, "Discoteca")).toBeChecked();
    await editor.locator("#evt-title").fill("Fiesta de prueba");

    // Cambiar a un bar, sin haber tocado la categoría: la propuesta lo sigue.
    await siguiente(editor).click();
    await expect(paso(editor, 2)).toBeVisible();
    await editor.locator("#evt-local").click();
    await page.getByRole("option", { name: /Local bar/ }).click();
    await editor.getByRole("button", { name: "Anterior" }).click();
    await expect(radio(editor, "Bar")).toBeChecked();

    // Una elección explícita no se pisa al cambiar de local.
    await elegir(editor, "Festival");
    await siguiente(editor).click();
    await editor.locator("#evt-local").click();
    await page.getByRole("option", { name: /Sala E2E · Principal/ }).click();
    await editor.getByRole("button", { name: "Anterior" }).click();
    await expect(radio(editor, "Festival")).toBeChecked();

    // Con la categoría que propone un local de sala no se propone nada, pero la elegida sigue.
    await siguiente(editor).click();
    await editor.locator("#evt-local").click();
    await page.getByRole("option", { name: /Local sala/ }).click();
    await editor.getByRole("button", { name: "Anterior" }).click();
    await expect(radio(editor, "Festival")).toBeChecked();
  });

  test("un borrador con categoría la conserva aunque su local proponga otra", async ({ page }) => {
    await sembrarBorrador(page, { step: 0, category: "bar", venueId: IDS.local });
    await abrirPanel(page, () => conLocales(page, ["club"]));
    const editor = await abrirNuevoEvento(page);
    await expect(radio(editor, "Bar")).toBeChecked();
    await expect(radio(editor, "Discoteca")).not.toBeChecked();
  });

  test("un borrador anterior a las categorías recibe la que propone su local", async ({ page }) => {
    await sembrarBorrador(page, { step: 0, venueId: IDS.local });
    await abrirPanel(page, () => conLocales(page, ["club"]));
    const editor = await abrirNuevoEvento(page);
    await expect(radio(editor, "Discoteca")).toBeChecked();
  });

  test("al editar un evento clasificado: se ve su categoría, se cambia y se guarda; el resto del evento no se toca", async ({
    page,
  }) => {
    let escrituras!: Awaited<ReturnType<typeof simularEscrituras>>;
    await abrirPanel(page, async () => {
      await conLocales(page, ["club"]);
      await conEventoClasificado(page, "discoteca");
      escrituras = await simularEscrituras(page);
    });
    const editor = await abrirEdicion(page, "Concierto E2E");
    await expect(radio(editor, "Discoteca")).toBeChecked();
    // En edición la categoría no se marca como obligatoria.
    await expect(editor.getByText(/^Categoría$/)).toBeVisible();

    await elegir(editor, "Festival");
    await expect(radio(editor, "Festival")).toBeChecked();
    await editor.getByRole("button", { name: /Resumen$/ }).first().click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados").first()).toBeVisible();

    const evento = escrituras.find((e) => e.tabla === "events");
    expect(evento?.cuerpo).toMatchObject({ category: "festival", title: "Concierto E2E", city: "Madrid" });
  });

  test("un evento anterior sin categoría se edita sin obligar a clasificarlo, y se puede clasificar", async ({ page }) => {
    let escrituras!: Awaited<ReturnType<typeof simularEscrituras>>;
    await abrirPanel(page, async () => {
      escrituras = await simularEscrituras(page);
    });
    const editor = await abrirEdicion(page, "Concierto E2E");
    // Sin categoría: ninguna marcada, y se dice qué falta sin bloquear nada.
    for (const nombre of ["Bar", "Discoteca", "Festival"]) await expect(radio(editor, nombre)).not.toBeChecked();
    await expect(editor.getByText(/aún no tiene categoría/)).toBeVisible();

    // El evento de prueba no trae dirección: sin ella no se llega a guardar.
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await editor.getByLabel("Ubicación exacta").fill("Calle de Prueba 1");

    // Guardar sin clasificar: se deja, y no se inventa ninguna (category null).
    await editor.getByRole("button", { name: /Resumen$/ }).first().click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados").first()).toBeVisible();
    await expect(page.getByText("Elige la categoría del evento")).toHaveCount(0);
    const sin = escrituras.find((e) => e.tabla === "events");
    expect(sin?.cuerpo).toMatchObject({ category: null });
  });
});

// ---------------------------------------------------------------------------
// Calendario público y home del cliente
// ---------------------------------------------------------------------------

const P = {
  discoteca1: "ca7e0000-0000-4000-8000-0000000000d1",
  discoteca2: "ca7e0000-0000-4000-8000-0000000000d2",
  club: "ca7e0000-0000-4000-8000-0000000000d3",
  sala: "ca7e0000-0000-4000-8000-0000000000d4",
} as const;

const E = {
  bar: "ca7e0000-0000-4000-8000-0000000000e1",
  porLocalDiscoteca: "ca7e0000-0000-4000-8000-0000000000e2",
  porLocalClub: "ca7e0000-0000-4000-8000-0000000000e3",
  festival: "ca7e0000-0000-4000-8000-0000000000e4",
  sinClasificar: "ca7e0000-0000-4000-8000-0000000000e5",
} as const;

/** Locales con la categoría con la que se registraron (public_partners). */
const SOCIOS: Fila[] = [
  { id: P.discoteca1, business_name: "Sala Aurora", business_category: "discoteca", city: "Madrid", avatar_url: null, cover_image_url: null },
  { id: P.discoteca2, business_name: "Nave Noche", business_category: "discoteca", city: "Madrid", avatar_url: null, cover_image_url: null },
  { id: P.club, business_name: "Club Mar", business_category: "club", city: "Madrid", avatar_url: null, cover_image_url: null },
  { id: P.sala, business_name: "Sala Lumen", business_category: "sala", city: "Madrid", avatar_url: null, cover_image_url: null },
];

function eventosDeCategorias(ahora: number, sinBares = false): Fila[] {
  const evento = (id: string, title: string, dias: number, extra: Fila): Fila => ({
    id,
    partner_id: P.discoteca1,
    title,
    description: null,
    date_start: iso(ahora + dias * D),
    date_end: iso(ahora + dias * D + 6 * H),
    city: "Madrid",
    venue_name: null,
    address: null,
    price_cents: 1500,
    currency: "eur",
    capacity: 200,
    tickets_sold: 10,
    image_url: null,
    category: null,
    status: "published",
    ...extra,
  });
  return [
    // Su categoría manda sobre la del local (un local de discoteca con una noche de bar).
    ...(sinBares ? [] : [evento(E.bar, "Noche de bar", 2, { category: "bar", partner_id: P.discoteca1 })]),
    // Sin categoría: la de su local.
    evento(E.porLocalDiscoteca, "Sesión de la sala", 3, { partner_id: P.discoteca2 }),
    evento(E.porLocalClub, "Fiesta del club", 4, { partner_id: P.club }),
    evento(E.festival, "Festival de verano", 5, { category: "festival", partner_id: P.discoteca2 }),
    // Sin categoría y de un local de sala: no se puede clasificar, solo sale en «Todos».
    evento(E.sinClasificar, "Concierto sin clasificar", 6, { partner_id: P.sala }),
  ];
}

async function conCatalogo(page: Page, opciones: { sinBares?: boolean } = {}) {
  const ahora = Date.now();
  const eventos = eventosDeCategorias(ahora, opciones.sinBares);
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      return responderJson(route, eventos);
    },
  );
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/public_partners",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return responderJson(route, SOCIOS);
    },
  );
}

const tarjetas = (page: Page) => page.locator("article[id^='event-card-']");
const chip = (page: Page, nombre: RegExp) => page.getByRole("group", { name: "Filtrar por categoría" }).getByRole("button", { name: nombre });

async function abrirCalendario(page: Page, query = "") {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  await instalarSupabaseFalso(page, { roles: ["client"] });
  await conCatalogo(page);
  await page.goto(`/#/calendar${query}`);
  await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
}

test.describe("calendario público: filtro por categoría", () => {
  test("Todos / Bar / Discoteca / Festival con su cuenta, con la categoría del evento o, si no tiene, la de su local", async ({
    page,
  }) => {
    await abrirCalendario(page);
    await expect(tarjetas(page)).toHaveCount(5);

    // Cuántos hay de cada categoría (Discoteca: la de su local y la de «club»).
    await expect(chip(page, /^Todos\s*5$/)).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, /^Bar\s*1$/)).toBeVisible();
    await expect(chip(page, /^Discoteca\s*2$/)).toBeVisible();
    await expect(chip(page, /^Festival\s*1$/)).toBeVisible();

    // Bar: solo el que lo es por sí mismo (el local es de discoteca, pero el evento dice bar).
    await chip(page, /^Bar/).click();
    await expect(page).toHaveURL(/#\/calendar\?cat=bar$/);
    await expect(chip(page, /^Bar\s*1$/)).toHaveAttribute("aria-pressed", "true");
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Noche de bar" })).toBeVisible();
    await expect(tarjetas(page).first().getByTestId("categoria-evento")).toHaveText("Bar");

    // Discoteca: los dos que lo son por su local («discoteca» y «club»), no el de bar ni el festival.
    await chip(page, /^Discoteca/).click();
    await expect(page).toHaveURL(/#\/calendar\?cat=discoteca$/);
    await expect(tarjetas(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Sesión de la sala" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fiesta del club" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Noche de bar" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Festival de verano" })).toHaveCount(0);

    // Festival: el que lo es por sí mismo, aunque su local sea de discoteca.
    await chip(page, /^Festival/).click();
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Festival de verano" })).toBeVisible();

    // Todos: vuelve todo (también el que no se puede clasificar) y la URL se limpia.
    await chip(page, /^Todos/).click();
    await expect(tarjetas(page)).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "Concierto sin clasificar" })).toBeVisible();
    await expect(page).not.toHaveURL(/cat=/);
  });

  test("la categoría va en la URL: se puede compartir y sobrevive a recargar; una categoría inventada se ignora", async ({ page }) => {
    await abrirCalendario(page, "?cat=discoteca");
    await expect(chip(page, /^Discoteca\s*2$/)).toHaveAttribute("aria-pressed", "true");
    await expect(tarjetas(page)).toHaveCount(2);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await expect(chip(page, /^Discoteca\s*2$/)).toHaveAttribute("aria-pressed", "true");
    await expect(tarjetas(page)).toHaveCount(2);

    await page.goto("/#/calendar?cat=rooftop");
    await expect(chip(page, /^Todos\s*5$/)).toHaveAttribute("aria-pressed", "true");
    await expect(tarjetas(page)).toHaveCount(5);
  });

  test("sin eventos de esa categoría lo dice y deja volver a ver todos", async ({ page }) => {
    erroresJs = [];
    page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
    await instalarSupabaseFalso(page, { roles: ["client"] });
    await conCatalogo(page, { sinBares: true });
    await page.goto("/#/calendar?cat=bar");
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });

    await expect(chip(page, /^Bar\s*0$/)).toHaveAttribute("aria-pressed", "true");
    const vacio = page.getByTestId("sin-eventos-de-categoria");
    await expect(vacio).toContainText("No hay eventos de Bar en Madrid.");
    await expect(tarjetas(page)).toHaveCount(0);
    await vacio.getByRole("button", { name: "Ver todos los eventos" }).click();
    await expect(tarjetas(page)).toHaveCount(4);
    await expect(page).not.toHaveURL(/cat=/);
  });

  test("con ?event= (vuelta del login) el filtro no esconde la tarjeta de ese evento", async ({ page }) => {
    await abrirCalendario(page, `?event=${E.festival}&cat=bar`);
    await expect(page.getByRole("heading", { name: "Festival de verano" })).toBeVisible();
    await expect(chip(page, /^Todos\s*5$/)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("home del cliente: las categorías filtran también los eventos", () => {
  async function abrirHome(page: Page) {
    erroresJs = [];
    page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
    await instalarSupabaseFalso(page, { roles: ["client"] });
    await conCatalogo(page);
    await page.goto("/#/client-dashboard");
    await expect(page.getByRole("region", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
  }
  const tira = (page: Page) => page.getByRole("region", { name: "Próximos eventos" });
  const chipHome = (page: Page, nombre: string) => page.getByRole("button", { name: nombre, exact: true });

  test("Discotecas, Bares y Festivales filtran la tira de eventos con la misma regla que el calendario", async ({ page }) => {
    await abrirHome(page);
    await expect(tira(page).getByRole("button")).toHaveCount(5 + 1); // 5 eventos + «Ver calendario»

    await chipHome(page, "Discotecas").click();
    await expect(tira(page).getByRole("heading", { name: "Discotecas en Madrid" })).toBeVisible();
    await expect(tira(page).getByText("Sesión de la sala")).toBeVisible();
    await expect(tira(page).getByText("Fiesta del club")).toBeVisible();
    await expect(tira(page).getByText("Noche de bar")).toHaveCount(0);

    // Bares: el único evento de bar sale aunque ningún LOCAL sea de bar (la lista de locales queda vacía).
    await chipHome(page, "Bares").click();
    await expect(tira(page).getByRole("heading", { name: "Bares en Madrid" })).toBeVisible();
    await expect(tira(page).getByText("Noche de bar")).toBeVisible();
    await expect(tira(page).getByText("Sesión de la sala")).toHaveCount(0);

    await chipHome(page, "Festivales").click();
    await expect(tira(page).getByRole("heading", { name: "Festivales en Madrid" })).toBeVisible();
    await expect(tira(page).getByText("Festival de verano")).toBeVisible();

    // «Ver calendario» lleva al calendario con la misma categoría ya elegida.
    await tira(page).getByRole("button", { name: /Ver calendario/ }).click();
    await expect(page).toHaveURL(/#\/calendar\?cat=festival$/);
    await expect(page.getByRole("button", { name: /^Festival\s*1$/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("una categoría de local que no es de evento (Salas) esconde la tira; Todos la vuelve a enseñar", async ({ page }) => {
    await abrirHome(page);
    await chipHome(page, "Salas").click();
    await expect(page.getByRole("region", { name: "Próximos eventos" })).toHaveCount(0);
    await chipHome(page, "Todos").click();
    await expect(tira(page)).toBeVisible();
    await expect(tira(page).getByRole("heading", { name: "Qué hay en Madrid" })).toBeVisible();
  });
});
