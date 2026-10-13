import { expect, test, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, instalarSupabaseFalso } from "./support/fake-supabase";

/**
 * Eventos de varios días y recurrentes vistos por el público (Supabase
 * simulado; sin pagos):
 *
 *   - Calendario: una tarjeta por serie, con la fecha más próxima (o la que
 *     se buscaba con ?event=) y «N fechas · ver todas»; el diálogo lista cada
 *     fecha con su hora, precio y si está agotada, y se compra una a una. La
 *     vista de mes enseña cada fecha en su día.
 *   - Home del cliente: una tarjeta por serie en «Próximos eventos».
 *   - Ficha pública del local (/p/:id): una tarjeta por serie, con «N fechas ·
 *     ver todas», y el calendario del local con cada fecha en su día.
 *   - Página del evento: cómo se repite y todas las fechas, con la actual
 *     marcada, las agotadas y un enlace a cada una.
 *   - Un servidor sin la migración de series sigue funcionando (sin series).
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

/** El primer viernes, a las 20:00 UTC, que quede al menos `minDias` días por delante. */
function viernesDesde(ahora: number, minDias: number): number {
  const d = new Date(ahora + minDias * D);
  d.setUTCHours(20, 0, 0, 0);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

/** «viernes 30 de octubre»: el día como lo nombra la vista de mes (hora de Madrid, la del navegador de las pruebas). */
function nombreDelDia(ms: number): string {
  const partes = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" }).formatToParts(new Date(ms));
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${de("weekday")} ${de("day")} de ${de("month")}`;
}

/** El día del mes y el mes («30», «octubre 2026») en la hora de Madrid, como los enseña el calendario del local. */
function diaYMes(ms: number): { dia: string; mes: string } {
  const f = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { ...opciones, timeZone: "Europe/Madrid" }).formatToParts(new Date(ms));
  const dia = f({ day: "numeric" }).find((p) => p.type === "day")?.value ?? "";
  const partes = f({ month: "long", year: "numeric" });
  const mes = `${partes.find((p) => p.type === "month")?.value ?? ""} ${partes.find((p) => p.type === "year")?.value ?? ""}`;
  return { dia, mes };
}

/** Cuándo empieza cada fecha de los datos de prueba. */
function calendario(ahora: number) {
  const primero = viernesDesde(ahora, 3);
  const festival = viernesDesde(ahora, 30);
  return {
    viernes: [0, 1, 2, 3].map((i) => primero + 7 * i * D),
    // Entre la primera y la segunda fecha de los viernes.
    suelto: primero + 2 * D,
    festival: [0, 1, 2].map((i) => festival + i * D),
  };
}

const SOCIO = "5e0c0000-0000-4000-8000-0000000000d1";
const SERIE_VIERNES = "5e0c0000-0000-4000-8000-0000000000a1";
const SERIE_FESTIVAL = "5e0c0000-0000-4000-8000-0000000000a2";

const id = (n: number) => `5e0c0000-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`;
const IDS = {
  viernes: [id(1), id(2), id(3), id(4)],
  suelto: id(5),
  festival: [id(6), id(7), id(8)],
};

function eventos(ahora: number): Fila[] {
  const cuando = calendario(ahora);
  const base = (extra: Fila): Fila => ({
    partner_id: SOCIO,
    description: null,
    city: "Madrid",
    venue_name: "Sala Aurora",
    address: "Calle Mayor 1",
    price_cents: 1500,
    currency: "eur",
    capacity: 100,
    tickets_sold: 10,
    image_url: null,
    category: null,
    status: "published",
    venue_id: null,
    ...extra,
  });
  const viernes = IDS.viernes.map((eid, i) =>
    base({
      id: eid,
      title: "Noche de los viernes",
      date_start: iso(cuando.viernes[i]),
      date_end: iso(cuando.viernes[i] + 6 * H),
      // La segunda fecha está agotada.
      tickets_sold: i === 1 ? 100 : 10,
      series_id: SERIE_VIERNES,
      series_date: iso(cuando.viernes[i]).slice(0, 10),
    }),
  );
  const festival = IDS.festival.map((eid, i) =>
    base({
      id: eid,
      title: "Festival de tres días",
      date_start: iso(cuando.festival[i]),
      date_end: iso(cuando.festival[i] + 8 * H),
      price_cents: 4000,
      series_id: SERIE_FESTIVAL,
      series_date: iso(cuando.festival[i]).slice(0, 10),
    }),
  );
  const suelto = base({
    id: IDS.suelto,
    title: "Concierto suelto",
    date_start: iso(cuando.suelto),
    date_end: iso(cuando.suelto + 4 * H),
    series_id: null,
    series_date: null,
  });
  return [...viernes, suelto, ...festival].sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)));
}

const RULE_VIERNES = {
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

const RULE_FESTIVAL = {
  v: 1,
  kind: "multi_day",
  frequency: "daily",
  interval: 1,
  weekdays: [],
  monthlyMode: "day_of_month",
  endMode: "until",
  endsOn: "2026-12-31",
  count: 3,
  customDates: [],
  excluded: [],
  startsOn: "2026-12-29",
};

interface OpcionesCatalogo {
  /** Un servidor sin la migración: la consulta con las columnas de serie falla. */
  sinMigracion?: boolean;
  /** Solo se ve una fecha de la serie de los viernes (las demás ya pasaron o están retiradas). */
  unaSolaFecha?: boolean;
}

/** El catálogo público: eventos (lista, uno solo y las fechas de una serie), tipos de entrada, locales y reglas. */
async function conCatalogo(page: Page, opciones: OpcionesCatalogo = {}) {
  const ahora = Date.now();
  let filas = eventos(ahora);
  if (opciones.unaSolaFecha) filas = filas.filter((f) => f.series_id !== SERIE_VIERNES || f.id === IDS.viernes[0]);
  const peticiones: string[] = [];
  const quitaSerie = (f: Fila): Fila => {
    const { series_id: _s, series_date: _d, ...resto } = f;
    void _s;
    void _d;
    return resto;
  };

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      const url = new URL(req.url());
      const p = url.searchParams;
      const select = p.get("select") ?? "";
      peticiones.push(`select=${select}`);
      const pideSerie = /series_(id|date)/.test(select);
      if (opciones.sinMigracion && pideSerie) {
        return responderJson(route, { code: "42703", message: "column events.series_id does not exist", details: null, hint: null }, 400);
      }
      const salida = (lista: Fila[]) => (opciones.sinMigracion ? lista.map(quitaSerie) : lista);
      const quiereObjeto = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
      const eid = p.get("id");
      if (eid?.startsWith("eq.")) {
        const fila = filas.find((f) => f.id === eid.slice(3));
        if (!fila) {
          return quiereObjeto
            ? responderJson(route, { code: "PGRST116", message: "no rows", details: null, hint: null }, 406)
            : responderJson(route, []);
        }
        return responderJson(route, quiereObjeto ? salida([fila])[0] : salida([fila]));
      }
      const sid = p.get("series_id");
      if (sid?.startsWith("eq.")) return responderJson(route, filas.filter((f) => f.series_id === sid.slice(3)));
      return responderJson(route, salida(filas));
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/event_series",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const quiereObjeto = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
      const pedida = new URL(route.request().url()).searchParams.get("id")?.replace(/^eq\./, "");
      const festival = pedida === SERIE_FESTIVAL;
      const fila = {
        id: festival ? SERIE_FESTIVAL : SERIE_VIERNES,
        kind: festival ? "multi_day" : "recurring",
        rule: festival ? RULE_FESTIVAL : RULE_VIERNES,
        time_zone: "Europe/Madrid",
        status: "active",
      };
      return responderJson(route, quiereObjeto ? fila : [fila]);
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/public_partners",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return responderJson(route, [
        { id: SOCIO, business_name: "Sala Aurora", business_category: "discoteca", city: "Madrid", avatar_url: null, cover_image_url: null },
      ]);
    },
  );

  // Los tipos de entrada de cualquier fecha (la página del evento los pide).
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/ticket_tiers",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const ev = new URL(route.request().url()).searchParams.get("event_id") ?? "";
      if (!ev.startsWith("eq.")) return route.fallback();
      return responderJson(route, [
        {
          id: `5e0c0000-0000-4000-8000-0000000f${ev.slice(-4)}`,
          event_id: ev.slice(3),
          name: "General",
          description: null,
          price_cents: 1500,
          currency: "eur",
          capacity: 100,
          sold: 10,
          per_user_max: 4,
          status: "active",
          sale_starts_at: null,
          sale_ends_at: null,
          refundable_until_hours_before: null,
          transfer_allowed: true,
          sort_order: 0,
        },
      ]);
    },
  );
  return { peticiones };
}

async function abrir(page: Page, ruta: string, opciones: OpcionesCatalogo = {}, supabase: Parameters<typeof instalarSupabaseFalso>[1] = { roles: ["client"] }) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  await instalarSupabaseFalso(page, supabase);
  const catalogo = await conCatalogo(page, opciones);
  await page.goto(ruta);
  return catalogo;
}

const tarjetas = (page: Page) => page.locator("article[id^='event-card-']");
const verFechas = (page: Page, eid: string) => page.getByTestId(`serie-ver-fechas-${eid}`);

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

test.describe("calendario público", () => {
  test("una tarjeta por serie con «N fechas»; los eventos sueltos, como siempre", async ({ page }) => {
    await abrir(page, "/#/calendar", {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });

    // 8 eventos en total, 3 tarjetas: la serie de los viernes (4), el suelto y el festival (3).
    await expect(tarjetas(page)).toHaveCount(3);
    await expect(tarjetas(page).nth(0)).toHaveAttribute("id", `event-card-${IDS.viernes[0]}`);
    await expect(tarjetas(page).nth(1)).toHaveAttribute("id", `event-card-${IDS.suelto}`);
    await expect(tarjetas(page).nth(2)).toHaveAttribute("id", `event-card-${IDS.festival[0]}`);

    await expect(verFechas(page, IDS.viernes[0])).toContainText("4 fechas · ver todas");
    await expect(verFechas(page, IDS.festival[0])).toContainText("3 fechas · ver todas");
    await expect(page.locator(`[data-testid^='serie-ver-fechas-']`)).toHaveCount(2);
    await expect(tarjetas(page).nth(1).getByTestId(/serie-ver-fechas/)).toHaveCount(0);
  });

  test("«ver todas» lista cada fecha con su hora y su precio; la agotada no se puede comprar", async ({ page }) => {
    await abrir(page, "/#/calendar", {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await verFechas(page, IDS.viernes[0]).click();

    const dialogo = page.getByTestId("serie-fechas");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Noche de los viernes");
    await expect(dialogo).toContainText("4 fechas por celebrar");
    for (const eid of IDS.viernes) await expect(dialogo.getByTestId(`serie-fecha-${eid}`)).toBeVisible();
    await expect(dialogo.getByTestId(`serie-fecha-${IDS.viernes[0]}`)).toContainText(/Desde 15\s?€/);
    // La segunda está agotada: lo dice y su botón no deja comprar.
    await expect(dialogo.getByTestId(`serie-fecha-${IDS.viernes[1]}`)).toContainText("Agotado");
    await expect(dialogo.getByTestId(`serie-comprar-${IDS.viernes[1]}`)).toBeDisabled();
    await expect(dialogo.getByTestId(`serie-comprar-${IDS.viernes[2]}`)).toBeEnabled();
    // Cada fecha tiene su página.
    await expect(dialogo.getByTestId(`serie-fecha-${IDS.viernes[2]}`).getByRole("link", { name: "Ver" })).toHaveAttribute("href", new RegExp(`/e/${IDS.viernes[2]}$`));
  });

  test("comprar una fecha de la lista (sin sesión) lleva al login y vuelve a esa fecha", async ({ page }) => {
    await abrir(page, "/#/calendar", {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await verFechas(page, IDS.viernes[0]).click();
    await page.getByTestId(`serie-comprar-${IDS.viernes[2]}`).click();
    await expect(page).toHaveURL(/#\/login\?next=/);
    const next = decodeURIComponent(new URL(page.url().replace("/#", "")).searchParams.get("next") ?? "");
    expect(next).toBe(`/calendar?event=${IDS.viernes[2]}`);
  });

  test("con ?event= (vuelta del login) la tarjeta de la serie es la de esa fecha, resaltada", async ({ page }) => {
    await abrir(page, `/#/calendar?event=${IDS.viernes[2]}`, {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await expect(tarjetas(page)).toHaveCount(3);
    const tarjeta = page.locator(`#event-card-${IDS.viernes[2]}`);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toHaveClass(/ring-primary/);
    await expect(page.locator(`#event-card-${IDS.viernes[0]}`)).toHaveCount(0);
  });

  test("la vista de mes enseña cada fecha en su día, sin agrupar", async ({ page }) => {
    await abrir(page, "/#/calendar", {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Vista calendario" }).click();
    await expect(page.locator(`[data-testid^='serie-ver-fechas-']`)).toHaveCount(0);

    // Cada fecha de la serie está en su día; tocarlo enseña esa fecha y solo esa.
    const cuando = calendario(Date.now());
    for (const i of [0, 2]) {
      const etiqueta = `${nombreDelDia(cuando.viernes[i])}: Noche de los viernes`;
      const dia = page.getByRole("button", { name: etiqueta, exact: true });
      for (let intento = 0; intento < 3 && (await dia.count()) === 0; intento++) {
        await page.getByRole("button", { name: "Mes siguiente" }).click();
      }
      await dia.click();
      const seccion = page.getByRole("region", { name: "Eventos del día" });
      await expect(seccion.locator("article")).toHaveCount(1);
      await expect(seccion.locator(`#event-card-${IDS.viernes[i]}`)).toBeVisible();
      await expect(seccion.getByTestId(/serie-ver-fechas/)).toHaveCount(0);
    }

    // De vuelta a los carteles, la serie vuelve a ser una sola tarjeta.
    await page.getByRole("button", { name: "Vista posters" }).click();
    await expect(tarjetas(page)).toHaveCount(3);
  });

  test("un servidor sin la migración de series sigue mostrando el calendario (sin agrupar)", async ({ page }) => {
    const catalogo = await abrir(page, "/#/calendar", { sinMigracion: true }, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("heading", { name: "Próximos eventos" })).toBeVisible({ timeout: 90_000 });
    // Sin columnas de serie no hay manera de saber qué es de qué serie: 8 eventos, 8 tarjetas, ningún aviso roto.
    await expect(tarjetas(page)).toHaveCount(8);
    await expect(page.locator(`[data-testid^='serie-ver-fechas-']`)).toHaveCount(0);
    // Se pidió una vez con las columnas y se repitió sin ellas.
    expect(catalogo.peticiones.some((p) => /series_id/.test(p))).toBe(true);
    expect(catalogo.peticiones.some((p) => !/series_id/.test(p))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Home del cliente
// ---------------------------------------------------------------------------

test.describe("home del cliente", () => {
  test("«Próximos eventos» lleva una tarjeta por serie", async ({ page }) => {
    await abrir(page, "/#/client-dashboard");
    const tira = page.getByRole("region", { name: "Próximos eventos" });
    await expect(tira).toBeVisible({ timeout: 90_000 });
    // Serie de los viernes, suelto y festival (+ «Ver calendario»); sin las flechas de la fila (botones con aria-label).
    await expect(tira.locator("button:not([aria-label])")).toHaveCount(3 + 1);
    await expect(tira.getByTestId(`tira-fechas-${IDS.viernes[0]}`)).toContainText("4 fechas");
    await expect(tira.getByTestId(`tira-fechas-${IDS.festival[0]}`)).toContainText("3 fechas");
    await expect(tira.getByText("Concierto suelto")).toBeVisible();
    // Cada tarjeta abre la fecha que enseña.
    await tira.getByText("Concierto suelto").click();
    await expect(page).toHaveURL(new RegExp(`#/e/${IDS.suelto}$`));
  });
});

// ---------------------------------------------------------------------------
// Página del evento
// ---------------------------------------------------------------------------

test.describe("página de un evento de una serie", () => {
  test("cómo se repite y todas las fechas: la actual marcada, la agotada dicha, cada una con su enlace", async ({ page }) => {
    await abrir(page, `/#/e/${IDS.viernes[0]}`);
    await expect(page.getByRole("heading", { level: 1, name: "Noche de los viernes" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("serie-patron")).toContainText("Todos los viernes · 4 fechas");

    const fechas = page.getByTestId("otras-fechas");
    await expect(fechas).toContainText("Fechas · 4 fechas");
    await expect(fechas.getByTestId(`fecha-${IDS.viernes[0]}`)).toContainText("Estás aquí");
    await expect(fechas.getByTestId(`fecha-${IDS.viernes[0]}`)).toHaveAttribute("aria-current", "page");
    await expect(fechas.getByTestId(`fecha-${IDS.viernes[1]}`)).toContainText("Agotado");
    await expect(fechas.getByTestId(`fecha-${IDS.viernes[2]}`)).toContainText("Ver");

    // Ir a otra fecha abre su página.
    await fechas.getByTestId(`fecha-${IDS.viernes[2]}`).click();
    await expect(page).toHaveURL(new RegExp(`#/e/${IDS.viernes[2]}$`));
    await expect(page.getByTestId("otras-fechas").getByTestId(`fecha-${IDS.viernes[2]}`)).toContainText("Estás aquí");
    await expect(page.getByTestId("otras-fechas").getByTestId(`fecha-${IDS.viernes[0]}`)).toContainText("Ver");
  });

  test("un evento suelto no habla de series", async ({ page }) => {
    await abrir(page, `/#/e/${IDS.suelto}`);
    await expect(page.getByRole("heading", { level: 1, name: "Concierto suelto" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("serie-patron")).toHaveCount(0);
    await expect(page.getByTestId("otras-fechas")).toHaveCount(0);
  });

  test("si de la serie solo queda una fecha por celebrar, no se enseña lista", async ({ page }) => {
    await abrir(page, `/#/e/${IDS.viernes[0]}`, { unaSolaFecha: true });
    await expect(page.getByRole("heading", { level: 1, name: "Noche de los viernes" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("otras-fechas")).toHaveCount(0);
    await expect(page.getByTestId("serie-patron")).toHaveCount(0);
  });

  test("un evento de varios días seguidos lo dice y marca la fecha en la que se está", async ({ page }) => {
    await abrir(page, `/#/e/${IDS.festival[1]}`);
    await expect(page.getByRole("heading", { level: 1, name: "Festival de tres días" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("serie-patron")).toContainText("Varios días seguidos · 3 fechas");
    await expect(page.getByTestId("otras-fechas")).toContainText("Fechas · 3 fechas");
    await expect(page.getByTestId(`fecha-${IDS.festival[1]}`)).toContainText("Estás aquí");
    await expect(page.getByTestId(`fecha-${IDS.festival[0]}`)).toContainText("Ver");
    await expect(page.getByTestId(`fecha-${IDS.festival[2]}`)).toContainText("Ver");
  });

  test("si la regla de la serie no se puede leer, la página sigue con sus fechas (sin la frase)", async ({ page }) => {
    erroresJs = [];
    page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
    await instalarSupabaseFalso(page, { roles: ["client"] });
    await conCatalogo(page);
    // Una regla que no es la de ningún formato conocido (la escribió otro cliente).
    await page.route(
      (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/event_series",
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return responderJson(route, [{ id: SERIE_VIERNES, kind: "recurring", rule: { raro: true }, time_zone: "Europe/Madrid", status: "active" }]);
      },
    );
    await page.goto(`/#/e/${IDS.viernes[0]}`);
    await expect(page.getByRole("heading", { level: 1, name: "Noche de los viernes" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("serie-patron")).toContainText("Evento con varias fechas · 4 fechas");
    await expect(page.getByTestId("otras-fechas")).toContainText("Fechas · 4 fechas");
  });

  test("con más de 6 fechas se pliegan y la actual siempre se ve", async ({ page }) => {
    // Se añaden fechas a la serie con una ruta propia, por encima de la general.
    erroresJs = [];
    page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
    await instalarSupabaseFalso(page, { roles: ["client"] });
    await conCatalogo(page);
    const ahora = Date.now();
    const muchas: Fila[] = Array.from({ length: 9 }, (_, i) => ({
      id: id(100 + i),
      partner_id: SOCIO,
      title: "Cada día",
      description: null,
      city: "Madrid",
      venue_name: "Sala Aurora",
      address: "Calle Mayor 1",
      price_cents: 1000,
      currency: "eur",
      capacity: 50,
      tickets_sold: 0,
      image_url: null,
      category: null,
      status: "published",
      venue_id: null,
      date_start: iso(ahora + (2 + i) * D),
      date_end: iso(ahora + (2 + i) * D + 5 * H),
      series_id: SERIE_FESTIVAL,
      series_date: iso(ahora + (2 + i) * D).slice(0, 10),
    }));
    await page.route(
      (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
      async (route) => {
        const p = new URL(route.request().url()).searchParams;
        if (route.request().method() !== "GET") return route.fallback();
        const quiereObjeto = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
        const eid = p.get("id");
        if (eid?.startsWith("eq.")) {
          const fila = muchas.find((f) => f.id === eid.slice(3));
          return fila ? responderJson(route, quiereObjeto ? fila : [fila]) : route.fallback();
        }
        if (p.get("series_id")?.startsWith("eq.")) return responderJson(route, muchas);
        return route.fallback();
      },
    );
    // La penúltima: la 8.ª, más allá de las 6 primeras.
    await page.goto(`/#/e/${id(107)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Cada día" })).toBeVisible({ timeout: 90_000 });
    const lista = page.getByTestId("otras-fechas");
    await expect(lista.getByRole("listitem")).toHaveCount(7); // 6 + la actual
    await expect(lista.getByTestId(`fecha-${id(107)}`)).toContainText("Estás aquí");
    await page.getByTestId("otras-fechas-todas").click();
    await expect(lista.getByRole("listitem")).toHaveCount(9);
    await expect(page.getByTestId("otras-fechas-todas")).toHaveText("Ver menos");
  });
});

// ---------------------------------------------------------------------------
// Ficha pública del local
// ---------------------------------------------------------------------------

test.describe("ficha pública del local", () => {
  test("una tarjeta por serie, con «N fechas · ver todas»; el contador cuenta tarjetas", async ({ page }) => {
    await abrir(page, `/#/p/${SOCIO}`, {}, { roles: ["client"], sembrarSesion: "nunca" });
    const lista = page.getByRole("button", { name: /Próximos eventos/ });
    await expect(lista).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("article")).toHaveCount(3);
    await expect(lista).toContainText("03");
    await expect(page.getByTestId(`serie-ver-fechas-${IDS.viernes[0]}`)).toContainText("4 fechas · ver todas");
    await expect(page.getByTestId(`serie-ver-fechas-${IDS.festival[0]}`)).toContainText("3 fechas · ver todas");
    await expect(page.locator("article").filter({ hasText: "Concierto suelto" }).getByTestId(/serie-ver-fechas/)).toHaveCount(0);
  });

  test("«ver todas» abre la lista de fechas y cada una se compra por separado (sin sesión: al login, con esa fecha)", async ({ page }) => {
    await abrir(page, `/#/p/${SOCIO}`, {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("button", { name: /Próximos eventos/ })).toBeVisible({ timeout: 90_000 });
    await page.getByTestId(`serie-ver-fechas-${IDS.viernes[0]}`).click();

    const dialogo = page.getByTestId("serie-fechas");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("4 fechas por celebrar");
    for (const eid of IDS.viernes) await expect(dialogo.getByTestId(`serie-fecha-${eid}`)).toBeVisible();
    await expect(dialogo.getByTestId(`serie-comprar-${IDS.viernes[1]}`)).toBeDisabled();

    await dialogo.getByTestId(`serie-comprar-${IDS.viernes[3]}`).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page).toHaveURL(/#\/login\?next=/);
  });

  test("el calendario del local enseña cada fecha en su día", async ({ page }) => {
    await abrir(page, `/#/p/${SOCIO}`, {}, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("button", { name: /Próximos eventos/ })).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Calendario" }).click();

    // La tercera fecha de los viernes: se va a su mes y se toca su día.
    const { dia, mes } = diaYMes(calendario(Date.now()).viernes[2]);
    const cabecera = page.getByText(new RegExp(`^${mes.replace(" ", "\\s+")}$`, "i"));
    for (let intento = 0; intento < 3 && (await cabecera.count()) === 0; intento++) {
      await page.getByRole("button", { name: "Mes siguiente" }).click();
    }
    await expect(cabecera).toHaveCount(1);
    await page.getByRole("button", { name: dia, exact: true, disabled: false }).click();

    // En su día no hay «N fechas»: esa tarjeta es la de esa fecha.
    const tarjeta = page.locator("article").filter({ hasText: "Noche de los viernes" });
    await expect(tarjeta).toHaveCount(1);
    await expect(tarjeta.getByTestId(/serie-ver-fechas/)).toHaveCount(0);
  });

  test("un servidor sin la migración de series sigue enseñando los eventos del local", async ({ page }) => {
    await abrir(page, `/#/p/${SOCIO}`, { sinMigracion: true }, { roles: ["client"], sembrarSesion: "nunca" });
    await expect(page.getByRole("button", { name: /Próximos eventos/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("article")).toHaveCount(8);
    await expect(page.locator(`[data-testid^='serie-ver-fechas-']`)).toHaveCount(0);
  });
});
