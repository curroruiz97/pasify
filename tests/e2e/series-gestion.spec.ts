import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, crearDatos, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Eventos de varios días y recurrentes: gestionarlos desde «Mis eventos»
 * (Supabase simulado; la edge function de cancelar también; nada de pagos).
 *
 *   - La lista junta las fechas de una serie en una fila con las cifras de la
 *     serie y se abre para ver cada fecha con su menú.
 *   - Cancelar: una fecha, ella y las siguientes, o toda la serie. Las fechas
 *     sin ventas las cancela cancel_event_series de una vez; las que tienen
 *     entradas, una a una la edge function partner-cancel-event (que reembolsa).
 *   - Publicar de una vez las fechas en borrador de una serie.
 *   - Editar una fecha de una serie: el editor lo dice y, al guardar cambios,
 *     pregunta a qué fechas se aplican (solo esta, esta y las siguientes, toda
 *     la serie; y por separado los tipos de entrada).
 *
 *   npm run test:e2e:partner
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

type Fila = Record<string, unknown>;

let erroresJs: string[] = [];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  expect(erroresJs, "Errores JS en la página").toEqual([]);
});

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

const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Datos: dos series y un evento suelto
// ---------------------------------------------------------------------------

const SERIE_A = "5e2e0000-0000-4000-8000-0000000000a1"; // viernes: 1 pasada, 3 por venir (una editada por separado)
const SERIE_B = "5e2e0000-0000-4000-8000-0000000000a2"; // 2 fechas en borrador

const idSesion = (n: number) => `5e2e0000-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`;
const idTipo = (n: number) => `5e2e0000-0000-4000-8000-00000000d${String(n).padStart(3, "0")}`;

interface Sesion {
  n: number;
  serie: string;
  /** Días desde ahora. */
  dias: number;
  status: "published" | "draft" | "cancelled";
  vendidas: number;
  excepcion?: boolean;
}

const SESIONES: Sesion[] = [
  { n: 1, serie: SERIE_A, dias: -7, status: "published", vendidas: 12 },
  { n: 2, serie: SERIE_A, dias: 7, status: "published", vendidas: 30 },
  { n: 3, serie: SERIE_A, dias: 14, status: "published", vendidas: 0, excepcion: true },
  { n: 4, serie: SERIE_A, dias: 21, status: "published", vendidas: 0 },
  { n: 5, serie: SERIE_B, dias: 30, status: "draft", vendidas: 0 },
  { n: 6, serie: SERIE_B, dias: 37, status: "draft", vendidas: 0 },
];

const TITULO = { [SERIE_A]: "Noche de los viernes", [SERIE_B]: "Sesión de los sábados" } as const;

function filasDe(ahora: number): Fila[] {
  return SESIONES.map((s) => ({
    id: idSesion(s.n),
    partner_id: IDS.usuario,
    org_id: IDS.org,
    venue_id: IDS.local,
    title: TITULO[s.serie as keyof typeof TITULO],
    description: "Descripción de la serie",
    city: "Madrid",
    venue_name: "Sala E2E · Principal",
    address: "Calle de Prueba 1",
    image_url: null,
    date_start: iso(ahora + s.dias * D + 21 * H - (ahora % D)),
    date_end: iso(ahora + s.dias * D + 21 * H - (ahora % D) + 6 * H),
    status: s.status,
    price_cents: 1500,
    capacity: 100,
    tickets_sold: s.vendidas,
    series_id: s.serie,
    series_date: iso(ahora + s.dias * D).slice(0, 10),
    series_exception: !!s.excepcion,
  }));
}

function tiposDe(s: Sesion): Fila {
  return {
    id: idTipo(s.n),
    event_id: idSesion(s.n),
    name: "General",
    description: null,
    price_cents: 1500,
    currency: "eur",
    capacity: 100,
    per_user_max: 4,
    status: "active",
    sort_order: 0,
    refundable_until_hours_before: null,
    transfer_allowed: true,
    sold: s.vendidas,
  };
}

interface Plumbing {
  /** Cuerpos de lo que se escribe (PATCH/POST/DELETE) en `events`, por método. */
  escrituras: Array<{ metodo: string; url: string; cuerpo: Fila | null }>;
  tiposEscritos: Array<{ metodo: string; url: string; cuerpo: unknown }>;
  rpc: Record<string, Fila[]>;
  cancelaciones: Fila[];
}

interface OpcionesPlumbing {
  /** Respuesta de cancel_event_series. */
  cancelSerie?: (cuerpo: Fila) => Fila | { error: Fila; status: number };
  /** Respuesta de la edge function de cancelar, por llamada. */
  edge?: (n: number, cuerpo: Fila) => { status: number; json: unknown };
  /** Qué hace una RPC de series: devolver un error HTTP en vez de su resultado. */
  rpcFalla?: Partial<Record<"update_event_series" | "apply_event_tiers_to_series", { status: number; json: unknown }>>;
}

/** Datos de las series y captura de lo que la app escribe. Antes de `goto`. */
async function instalarSeries(page: Page, opciones: OpcionesPlumbing = {}): Promise<Plumbing> {
  const ahora = Date.now();
  const filas = filasDe(ahora);
  const base = crearDatos(ahora).tablas.events as Fila[];
  const plumbing: Plumbing = { escrituras: [], tiposEscritos: [], rpc: {}, cancelaciones: [] };

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.searchParams;
      const quiereObjeto = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
      if (req.method() === "GET") {
        const id = p.get("id");
        if (id?.startsWith("eq.")) {
          const fila = filas.find((f) => f.id === id.slice(3));
          if (!fila) return route.fallback();
          return responderJson(route, quiereObjeto ? fila : [fila]);
        }
        const sid = p.get("series_id");
        if (sid?.startsWith("eq.")) return responderJson(route, filas.filter((f) => f.series_id === sid.slice(3)));
        // La lista de «Mis eventos» (filtro or=…): los del local de siempre y las series.
        if (p.has("or")) return responderJson(route, [...base, ...filas]);
        return route.fallback();
      }
      const cuerpo = (req.postDataJSON() as Fila | null) ?? null;
      plumbing.escrituras.push({ metodo: req.method(), url: `${url.pathname}${url.search}`, cuerpo });
      // PATCH con ?id=eq.X o ?id=in.(…): una fila por id.
      const id = p.get("id") ?? "";
      const ids = id.startsWith("in.") ? id.slice(4, -1).split(",") : id.startsWith("eq.") ? [id.slice(3)] : [];
      return responderJson(route, ids.map((i) => ({ id: i })));
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/ticket_tiers",
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.searchParams;
      const ev = p.get("event_id") ?? "";
      const delasSeries = (id: string) => SESIONES.some((s) => idSesion(s.n) === id);
      if (req.method() === "GET") {
        if (ev.startsWith("eq.") && delasSeries(ev.slice(3))) {
          const s = SESIONES.find((x) => idSesion(x.n) === ev.slice(3))!;
          return responderJson(route, [tiposDe(s)]);
        }
        if (ev.startsWith("in.")) {
          const ids = ev.slice(4, -1).split(",");
          const con = SESIONES.filter((s) => ids.includes(idSesion(s.n))).map((s) => ({ event_id: idSesion(s.n) }));
          if (con.length > 0) return responderJson(route, con);
        }
        return route.fallback();
      }
      const cuerpo = req.postDataJSON() as unknown;
      plumbing.tiposEscritos.push({ metodo: req.method(), url: `${url.pathname}${url.search}`, cuerpo });
      const id = p.get("id") ?? "";
      if (id.startsWith("eq.")) return responderJson(route, [{ id: id.slice(3) }]);
      if (id.startsWith("in.")) return responderJson(route, id.slice(4, -1).split(",").map((i) => ({ id: i })));
      const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      return responderJson(route, lista.map((_, i) => ({ id: `5e2e0000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}` })), 201);
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/event_series",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const rule = {
        v: 1,
        kind: "recurring",
        frequency: "weekly",
        interval: 1,
        weekdays: [5],
        monthlyMode: "day_of_month",
        endMode: "count",
        endsOn: "",
        count: 4,
        customDates: [],
        excluded: [],
        startsOn: "2026-01-02",
      };
      const quiereObjeto = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
      const fila = { id: SERIE_A, kind: "recurring", rule, time_zone: "Europe/Madrid", status: "active" };
      return responderJson(route, quiereObjeto ? fila : [fila]);
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && /^\/rest\/v1\/rpc\/(update_event_series|apply_event_tiers_to_series|cancel_event_series)$/.test(url.pathname),
    async (route) => {
      const nombre = new URL(route.request().url()).pathname.split("/").pop() as string;
      const cuerpo = route.request().postDataJSON() as Fila;
      (plumbing.rpc[nombre] ??= []).push(cuerpo);
      const falla = opciones.rpcFalla?.[nombre as "update_event_series" | "apply_event_tiers_to_series"];
      if (falla) return responderJson(route, falla.json, falla.status);
      if (nombre === "update_event_series") return responderJson(route, { updated: 3, skipped_exceptions: 1 });
      if (nombre === "apply_event_tiers_to_series") return responderJson(route, { applied: 2, skipped_with_sales: 1 });
      const r = opciones.cancelSerie?.(cuerpo) ?? { cancelled: 2, needs_refunds: [] };
      if ("error" in r) return responderJson(route, r.error, r.status);
      return responderJson(route, r);
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/functions/v1/partner-cancel-event",
    async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      const cuerpo = route.request().postDataJSON() as Fila;
      plumbing.cancelaciones.push(cuerpo);
      const r = opciones.edge?.(plumbing.cancelaciones.length, cuerpo) ?? {
        status: 200,
        json: { event_id: cuerpo.event_id, already_cancelled: false, refunded: 2, failed: 0, remaining: 0, refunds_pending: false, tickets_without_account: 0 },
      };
      return responderJson(route, r.json, r.status);
    },
  );

  return plumbing;
}

async function abrirPanel(page: Page, plumbing?: Plumbing) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  void plumbing;
  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 90_000 });
}

const irAMisEventos = (page: Page) =>
  page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();

const pestana = (page: Page, nombre: string) =>
  page.getByRole("tablist", { name: "Eventos por estado" }).getByRole("tab", { name: new RegExp(`^${nombre}`) });

/** Abre el menú de acciones de la fila (o la cabecera de serie) de la tabla. */
async function menuDeFila(fila: Locator, nombre = "Acciones del evento") {
  await fila.getByRole("button", { name: nombre }).click();
}

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------

test.describe("Mis eventos: las fechas de una serie, juntas", () => {
  test("una fila por serie con las cifras de la serie; se abre para ver cada fecha", async ({ page }) => {
    await instalarSupabaseFalso(page);
    await instalarSeries(page);
    await abrirPanel(page);
    await irAMisEventos(page);

    // «Próximos»: las 3 fechas por venir de la serie A (la pasada está en «Pasados»).
    const cabecera = page.getByTestId(`serie-${SERIE_A}`);
    await expect(cabecera).toBeVisible();
    await expect(cabecera).toContainText("Noche de los viernes");
    await expect(cabecera).toContainText("3 fechas");
    await expect(cabecera.getByTestId("vendidas")).toContainText("30"); // 30 + 0 + 0
    await expect(cabecera.getByTestId("serie-estado")).toContainText("3 publicadas");
    await expect(cabecera).toContainText("Próxima:");

    // Plegada: las fechas no salen sueltas.
    const filasHijas = page.locator("main table tbody tr[data-serie-hija]");
    await expect(filasHijas).toHaveCount(0);
    await page.getByTestId(`serie-alternar-${SERIE_A}`).click();
    await expect(page.getByTestId(`serie-alternar-${SERIE_A}`)).toHaveAttribute("aria-expanded", "true");
    await expect(filasHijas).toHaveCount(3);
    // Cada fecha tiene su menú de siempre.
    await menuDeFila(filasHijas.first());
    await expect(page.getByRole("menuitem", { name: "Editar evento" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Plegar otra vez.
    await page.getByTestId(`serie-alternar-${SERIE_A}`).click();
    await expect(filasHijas).toHaveCount(0);

    // Los eventos sueltos siguen en su fila, sin cabecera de serie.
    await expect(page.locator("main table tbody tr").filter({ hasText: "Concierto E2E" })).toHaveCount(1);

    // «Borradores»: la serie B, con sus dos fechas en borrador.
    await pestana(page, "Borradores").click();
    const cabeceraB = page.getByTestId(`serie-${SERIE_B}`);
    await expect(cabeceraB).toContainText("2 fechas");
    await expect(cabeceraB.getByTestId("serie-estado")).toContainText("2 borradores");

    // «Pasados»: la única fecha pasada de la serie A es un evento más.
    await pestana(page, "Pasados").click();
    await expect(page.getByTestId(`serie-${SERIE_A}`)).toHaveCount(0);
    await expect(page.locator("main table tbody tr").filter({ hasText: "Noche de los viernes" })).toHaveCount(1);
  });

  test("el menú de la cabecera actúa sobre toda la serie, aunque la pestaña solo enseñe una parte", async ({ page }) => {
    await instalarSupabaseFalso(page);
    await instalarSeries(page);
    await abrirPanel(page);
    await irAMisEventos(page);
    // Serie A, en «Próximos»: tiene 3 por venir y ningún borrador → solo «Cancelar la serie».
    await menuDeFila(page.getByTestId(`serie-${SERIE_A}`), "Acciones de la serie");
    await expect(page.getByRole("menuitem", { name: /Cancelar la serie \(3 fechas\)/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Publicar/ })).toHaveCount(0);
  });

  test("móvil: la serie es una tarjeta que se abre", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await instalarSupabaseFalso(page);
    await instalarSeries(page);
    erroresJs = [];
    page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
    await page.goto("/#/partner-dashboard/eventos");
    const tarjeta = page.getByTestId(`serie-movil-${SERIE_A}`);
    await expect(tarjeta).toBeVisible({ timeout: 90_000 });
    await expect(tarjeta).toContainText("3 fechas");
    await expect(tarjeta.getByRole("article")).toHaveCount(1);
    await page.getByTestId(`serie-alternar-movil-${SERIE_A}`).click();
    await expect(tarjeta.getByRole("article")).toHaveCount(4); // la cabecera y las 3 fechas
    // Sin scroll horizontal.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Publicar la serie
// ---------------------------------------------------------------------------

test.describe("publicar las fechas en borrador de una serie", () => {
  test("una sola escritura para todas las que tienen tipo de entrada", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    await irAMisEventos(page);
    await pestana(page, "Borradores").click();
    await menuDeFila(page.getByTestId(`serie-${SERIE_B}`), "Acciones de la serie");
    await page.getByRole("menuitem", { name: "Publicar las 2 fechas en borrador" }).click();

    await expect(page.getByText("2 fechas publicadas")).toBeVisible();
    const patch = plumbing.escrituras.filter((e) => e.metodo === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0].cuerpo).toEqual({ status: "published" });
    expect(decodeURIComponent(patch[0].url)).toContain(`in.(${idSesion(5)},${idSesion(6)})`);
  });
});

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

test.describe("cancelar una fecha o la serie", () => {
  test("solo esta fecha: la misma cancelación de siempre, sin tocar la serie", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    await irAMisEventos(page);
    await page.getByTestId(`serie-alternar-${SERIE_A}`).click();
    const fila = page.locator("main table tbody tr[data-serie-hija]").first();
    await menuDeFila(fila);
    await page.getByRole("menuitem", { name: "Cancelar evento" }).click();

    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo.getByTestId("cancel-alcance")).toBeVisible();
    await expect(dialogo.getByTestId("cancel-alcance-one")).toBeChecked();
    await expect(dialogo.getByRole("heading", { name: /^¿Cancelar «Noche de los viernes»\?$/ })).toBeVisible();
    await dialogo.getByLabel(/Motivo/).fill("Obras en la sala");
    await dialogo.getByRole("button", { name: "Cancelar evento y reembolsar" }).click();

    await expect(page.getByText("Evento cancelado")).toBeVisible();
    expect(plumbing.rpc.cancel_event_series ?? []).toHaveLength(0);
    expect(plumbing.cancelaciones).toEqual([{ event_id: idSesion(2), reason: "Obras en la sala" }]);
  });

  test("esta y las siguientes: las sin ventas de una vez y las que tienen entradas, una a una con reembolso", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page, {
      cancelSerie: () => ({ cancelled: 2, needs_refunds: [idSesion(2)] }),
    });
    await abrirPanel(page);
    await irAMisEventos(page);
    await page.getByTestId(`serie-alternar-${SERIE_A}`).click();
    await menuDeFila(page.locator("main table tbody tr[data-serie-hija]").first());
    await page.getByRole("menuitem", { name: "Cancelar evento" }).click();

    const dialogo = page.getByRole("alertdialog");
    await dialogo.getByTestId("cancel-alcance-following").click();
    await expect(dialogo.getByRole("heading", { name: /¿Cancelar 3 fechas de «Noche de los viernes»\?/ })).toBeVisible();
    // La primera tiene 30 entradas vendidas: se reembolsan.
    await expect(dialogo.getByTestId("resumen-serie")).toContainText("Se cancelarán 3 fechas. Una tiene entradas vendidas (30)");
    await dialogo.getByLabel(/Motivo/).fill("Cierre por obras");
    await dialogo.getByRole("button", { name: "Cancelar 3 fechas y reembolsar" }).click();

    await expect(page.getByText("3 fechas canceladas")).toBeVisible();
    expect(plumbing.rpc.cancel_event_series).toHaveLength(1);
    const c = plumbing.rpc.cancel_event_series[0];
    expect(c._series_id).toBe(SERIE_A);
    expect(c._reason).toBe("Cierre por obras");
    expect(typeof c._from).toBe("string"); // desde la fecha elegida
    // La edge function solo para la fecha con ventas.
    expect(plumbing.cancelaciones).toEqual([{ event_id: idSesion(2), reason: "Cierre por obras" }]);
  });

  test("toda la serie desde el menú de la cabecera: sin fecha de inicio", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page, { cancelSerie: () => ({ cancelled: 3, needs_refunds: [] }) });
    await abrirPanel(page);
    await irAMisEventos(page);
    await menuDeFila(page.getByTestId(`serie-${SERIE_A}`), "Acciones de la serie");
    await page.getByRole("menuitem", { name: /Cancelar la serie \(3 fechas\)/ }).click();

    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo.getByTestId("cancel-alcance-all")).toBeChecked();
    await expect(dialogo.getByTestId("resumen-serie")).toContainText("Se cancelarán 3 fechas. Una tiene entradas vendidas (30)");
    await dialogo.getByLabel(/Motivo/).fill("Cerramos");
    await dialogo.getByRole("button", { name: "Cancelar 3 fechas y reembolsar" }).click();
    await expect(page.getByText("3 fechas canceladas")).toBeVisible();
    expect(plumbing.rpc.cancel_event_series[0]._from).toBeNull();
    expect(plumbing.cancelaciones).toHaveLength(0);
  });

  test("si el límite de cancelaciones con reembolso se agota, lo hecho se queda y se explica", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page, {
      cancelSerie: () => ({ cancelled: 1, needs_refunds: [idSesion(2), idSesion(3)] }),
      edge: (n, cuerpo) =>
        n === 1
          ? { status: 200, json: { event_id: cuerpo.event_id, already_cancelled: false, refunded: 3, failed: 0, remaining: 0, refunds_pending: false, tickets_without_account: 0 } }
          : { status: 429, json: { error: { message: "rate_limit_exceeded", code: "generic_error" } } },
    });
    await abrirPanel(page);
    await irAMisEventos(page);
    await menuDeFila(page.getByTestId(`serie-${SERIE_A}`), "Acciones de la serie");
    await page.getByRole("menuitem", { name: /Cancelar la serie/ }).click();
    const dialogo = page.getByRole("alertdialog");
    await dialogo.getByLabel(/Motivo/).fill("Cerramos");
    await dialogo.getByRole("button", { name: /Cancelar 3 fechas y reembolsar/ }).click();

    await expect(page.getByText(/2 fechas canceladas; 1 no se ha podido cancelar/)).toBeVisible();
    await expect(page.getByText(/límite de cancelaciones con reembolso/)).toBeVisible();
    expect(plumbing.cancelaciones).toHaveLength(2);
  });

  test("un error de la función no deja el diálogo mudo", async ({ page }) => {
    await instalarSupabaseFalso(page);
    await instalarSeries(page, {
      cancelSerie: () => ({ error: { code: "42501", message: "Forbidden", details: null, hint: null }, status: 403 }),
    });
    await abrirPanel(page);
    await irAMisEventos(page);
    await menuDeFila(page.getByTestId(`serie-${SERIE_A}`), "Acciones de la serie");
    await page.getByRole("menuitem", { name: /Cancelar la serie/ }).click();
    const dialogo = page.getByRole("alertdialog");
    await dialogo.getByLabel(/Motivo/).fill("Cerramos");
    await dialogo.getByRole("button", { name: /Cancelar 3 fechas y reembolsar/ }).click();
    await expect(page.getByText("No se ha podido cancelar la serie")).toBeVisible();
    await expect(page.getByText("No tienes permiso para hacer esto en este evento.")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Editar una fecha de una serie
// ---------------------------------------------------------------------------

/** Menú de la fecha n → «Editar evento» → el editor abierto. */
async function abrirEdicionDeFecha(page: Page, n: number): Promise<Locator> {
  await irAMisEventos(page);
  await page.getByTestId(`serie-alternar-${SERIE_A}`).click();
  const filas = page.locator("main table tbody tr[data-serie-hija]");
  // Las fechas de la serie A en «Próximos» son la 2, la 3 y la 4.
  await menuDeFila(filas.nth(n - 2));
  await page.getByRole("menuitem", { name: "Editar evento" }).click();
  const editor = page.getByRole("dialog", { name: "Editar evento" });
  await expect(editor.locator("#evt-title")).toHaveValue("Noche de los viernes");
  return editor;
}

test.describe("editar una fecha de una serie", () => {
  test("el editor lo dice y, al guardar un cambio común, pregunta a qué fechas se aplica", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);

    const banner = editor.getByTestId("serie-banner");
    await expect(banner).toContainText("Esta fecha forma parte de una serie (todos los viernes), con 3 fechas por celebrar");
    await expect(banner).not.toContainText("editada por separado");

    await editor.locator("#evt-title").fill("Noche de los viernes · otoño");
    // Hasta el resumen y a guardar.
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();

    const alcance = page.getByTestId("serie-alcance");
    await expect(alcance).toBeVisible();
    await expect(alcance).toContainText("Has cambiado el título");
    await expect(alcance.getByTestId("alcance-datos-one")).toBeChecked();
    // Los tipos no se han tocado: no se pregunta por ellos.
    await expect(alcance.getByTestId("alcance-tipos")).toHaveCount(0);
    // «Esta y las siguientes»: esta (2) y las dos que siguen.
    await alcance.getByTestId("alcance-datos-following").click();
    // La 3.ª está editada por separado: se ofrece incluirla.
    await expect(alcance.getByTestId("alcance-excepciones")).toBeVisible();
    await alcance.getByTestId("alcance-guardar").click();

    await expect(page.getByText("Cambios guardados")).toBeVisible();
    await expect(page.getByText(/Cambios aplicados a 2 fechas más/)).toBeVisible();
    // Lo guardado en esta fecha: sin marcarla como editada por separado.
    const guardado = plumbing.escrituras.find((e) => e.metodo === "PATCH" && decodeURIComponent(e.url).includes(`id=eq.${idSesion(2)}`));
    expect(guardado?.cuerpo).toMatchObject({ title: "Noche de los viernes · otoño" });
    expect(guardado?.cuerpo).not.toHaveProperty("series_exception");
    // Y a las siguientes, solo lo que cambió.
    expect(plumbing.rpc.update_event_series).toHaveLength(1);
    const r = plumbing.rpc.update_event_series[0];
    expect(r._series_id).toBe(SERIE_A);
    expect(r._patch).toEqual({ title: "Noche de los viernes · otoño" });
    expect(r._include_exceptions).toBe(false);
    expect(typeof r._from).toBe("string");
  });

  test("«Solo esta fecha»: queda marcada como editada por separado y no se toca el resto", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);
    await editor.locator("#evt-title").fill("Especial de aniversario");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await page.getByTestId("serie-alcance").getByTestId("alcance-guardar").click();

    await expect(page.getByText("Cambios guardados")).toBeVisible();
    const guardado = plumbing.escrituras.find((e) => e.metodo === "PATCH" && decodeURIComponent(e.url).includes(`id=eq.${idSesion(2)}`));
    expect(guardado?.cuerpo).toMatchObject({ title: "Especial de aniversario", series_exception: true });
    expect(plumbing.rpc.update_event_series ?? []).toHaveLength(0);
    expect(plumbing.rpc.apply_event_tiers_to_series ?? []).toHaveLength(0);
  });

  test("«Toda la serie» con las editadas por separado incluidas", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);
    await editor.locator("#evt-desc").fill("Nueva descripción para todas");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    const alcance = page.getByTestId("serie-alcance");
    await expect(alcance).toContainText("Has cambiado la descripción");
    await alcance.getByTestId("alcance-datos-all").click();
    await alcance.getByTestId("alcance-excepciones").check();
    await alcance.getByTestId("alcance-guardar").click();

    await expect(page.getByText("Cambios guardados")).toBeVisible();
    const r = plumbing.rpc.update_event_series[0];
    expect(r._from).toBeNull(); // todas las que quedan
    expect(r._include_exceptions).toBe(true);
    expect(r._patch).toEqual({ description: "Nueva descripción para todas" });
  });

  test("cambiar la hora aplica la hora de reloj a las demás; el día no", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await editor.locator("#evt-start").click();
    const selector = page.locator("[data-radix-popper-content-wrapper]").last();
    await selector.getByRole("button", { name: "22", exact: true }).first().click();
    await selector.getByRole("button", { name: "00", exact: true }).last().click();
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    const alcance = page.getByTestId("serie-alcance");
    await expect(alcance).toContainText("Has cambiado la hora");
    await alcance.getByTestId("alcance-datos-all").click();
    await alcance.getByTestId("alcance-guardar").click();
    await expect(page.getByText("Cambios guardados")).toBeVisible();
    expect(plumbing.rpc.update_event_series[0]._patch).toEqual({ start_time: "22:00" });
  });

  test("cambiar los tipos de entrada: se pregunta aparte y se copian donde no hay ventas", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 3);
    await editor.getByRole("button", { name: /Tipos de entrada/ }).click();
    await editor.getByLabel(/^Precio/).fill("18");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();

    const alcance = page.getByTestId("serie-alcance");
    await expect(alcance).toContainText("Has cambiado los tipos de entrada");
    // El texto no habla de cambios comunes: no se tocó nada más.
    await expect(alcance.getByTestId("alcance-datos")).toHaveCount(0);
    await expect(alcance.getByTestId("alcance-tipos-one")).toBeChecked();
    await alcance.getByTestId("alcance-tipos-all").click();
    await expect(alcance).toContainText("conservan sus tipos tal como están");
    await alcance.getByTestId("alcance-guardar").click();

    await expect(page.getByText("Cambios guardados")).toBeVisible();
    await expect(page.getByText(/Tipos de entrada copiados a 2 fechas/)).toBeVisible();
    await expect(page.getByText(/1 con entradas o reservas se ha dejado como estaba/)).toBeVisible();
    expect(plumbing.rpc.apply_event_tiers_to_series).toEqual([{ _event_id: idSesion(3), _scope: "all" }]);
    expect(plumbing.rpc.update_event_series ?? []).toHaveLength(0);
    // Esta fecha sí guardó su precio.
    const tipo = plumbing.tiposEscritos.find((e) => e.metodo === "PATCH");
    expect(tipo?.cuerpo).toMatchObject({ price_cents: 1800 });
  });

  test("cambiar solo el día de esta fecha no pregunta nada", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await editor.locator("#evt-date").click();
    await page.locator("button[name='next-month']").last().click();
    await page.locator("button[name='day']:not(.day-outside)").filter({ hasText: /^20$/ }).last().click();
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados")).toBeVisible();
    await expect(page.getByTestId("serie-alcance")).toHaveCount(0);
    expect(plumbing.rpc.update_event_series ?? []).toHaveLength(0);
    // Mover el día de una fecha no la marca como editada por separado.
    const guardado = plumbing.escrituras.find((e) => e.metodo === "PATCH" && decodeURIComponent(e.url).includes(`id=eq.${idSesion(2)}`));
    expect(guardado?.cuerpo).not.toHaveProperty("series_exception");
  });

  test("si esta fecha se guarda pero las demás no, se dice y se puede repetir", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page, {
      rpcFalla: { update_event_series: { status: 400, json: { code: "P0001", message: "series_sessions_overlap", details: null, hint: null } } },
    });
    await abrirPanel(page);
    const editor = await abrirEdicionDeFecha(page, 2);
    await editor.locator("#evt-title").fill("Otro título");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    const alcance = page.getByTestId("serie-alcance");
    await alcance.getByTestId("alcance-datos-all").click();
    await alcance.getByTestId("alcance-guardar").click();

    await expect(page.getByText("Esta fecha se ha guardado, pero no las demás")).toBeVisible();
    await expect(page.getByText(/Dos fechas de la serie se pisan/)).toBeVisible();
    // El editor sigue abierto para repetirlo.
    await expect(page.getByRole("dialog", { name: "Editar evento" })).toBeVisible();
    expect(plumbing.rpc.update_event_series).toHaveLength(1);
  });

  test("un evento suelto no pregunta nada al guardar", async ({ page }) => {
    await instalarSupabaseFalso(page);
    const plumbing = await instalarSeries(page);
    await abrirPanel(page);
    await irAMisEventos(page);
    await page
      .locator("main table tbody tr")
      .filter({ hasText: "Concierto E2E" })
      .getByRole("button", { name: "Acciones del evento" })
      .click();
    await page.getByRole("menuitem", { name: "Editar evento" }).click();
    const editor = page.getByRole("dialog", { name: "Editar evento" });
    await expect(editor.locator("#evt-title")).toHaveValue("Concierto E2E");
    await expect(editor.getByTestId("serie-banner")).toHaveCount(0);
    await editor.locator("#evt-title").fill("Concierto E2E (bis)");
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await editor.getByLabel("Ubicación exacta").fill("Calle de Prueba 1");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados")).toBeVisible();
    await expect(page.getByTestId("serie-alcance")).toHaveCount(0);
    expect(plumbing.rpc.update_event_series ?? []).toHaveLength(0);
  });
});
