import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso } from "./support/fake-supabase";
import { defaultRule, expandRule, formatDayShort, type RecurrenceRule } from "../../src/lib/recurrence";

/**
 * Eventos de varios días y recurrentes: el editor («Nuevo evento»), con
 * Supabase simulado (support/fake-supabase.ts) y la función create_event_series
 * interceptada. No se crea nada de verdad ni se paga nada.
 *
 *   - El selector de fechas: una fecha, varios días seguidos o una serie
 *     (semanal con días, mensual, fechas elegidas); la vista previa enseña
 *     exactamente las fechas que se crearán y deja quitar y volver a poner.
 *   - Lo que se manda al crear: tipo, regla, zona horaria, evento, tipos de
 *     entrada y una sesión por fecha, con la hora del local aunque cambie la
 *     hora de verano a invierno en medio.
 *   - Un envío repetido (corte de red) usa la misma clave y no crea dos
 *     series; si cambia algo, es otro intento.
 *   - Las fechas ya pasadas: en borrador valen; al publicar se omiten y se dice.
 *   - Editar un evento no ofrece series (cada fecha se edita sola).
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

async function abrirPanel(page: Page, antesDeEntrar?: () => Promise<void>) {
  erroresJs = [];
  page.on("pageerror", (err) => erroresJs.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page);
  await antesDeEntrar?.();
  await page.goto("/#/partner-dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Métricas" })).toBeVisible({ timeout: 90_000 });
  return supabase;
}

/** «Mis eventos» → «Nuevo evento». */
async function abrirNuevoEvento(page: Page): Promise<Locator> {
  await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo evento" });
  await expect(editor.getByText(/^Paso \d\d \/ 06$/)).toBeVisible();
  return editor;
}

const paso = (editor: Locator, n: number) => editor.getByText(`Paso ${String(n).padStart(2, "0")} / 06`);
const siguiente = (editor: Locator) => editor.getByRole("button", { name: "Siguiente" });

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pad = (n: number) => String(n).padStart(2, "0");

/** «YYYY-MM-DD» del día `dia` del mes en curso + `meses` (por defecto, el mes que viene: siempre futuro). */
function diaDelMesQueViene(dia: number, meses = 1): string {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() + meses, dia);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** La celda del día `dia` del mes que se ve (no las de relleno de la semana de otro mes). */
const celda = (ambito: Page | Locator, dia: number) =>
  ambito.locator("button[name='day']:not(.day-outside)").filter({ hasText: new RegExp(`^${dia}$`) }).last();

/**
 * Lleva el calendario recién abierto al mes de `iso` leyendo el rótulo del mes
 * (no se cuenta con en qué mes abre: depende del día elegido y del foco) y
 * pulsa ese día. Si el selector anterior aún se está cerrando hay dos
 * calendarios en el DOM: vale el último, el recién abierto.
 */
async function pulsarFecha(ambito: Page | Locator, iso: string) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const objetivo = anio * 12 + (mes - 1);
  for (let i = 0; i < 48; i++) {
    const rotulo = ((await ambito.locator("[aria-live='polite']").last().textContent()) ?? "").trim().toLowerCase();
    const m = /^([a-záéíóú]+)\s+(\d{4})$/.exec(rotulo);
    if (!m) throw new Error(`No entiendo el mes del calendario: «${rotulo}»`);
    const actual = Number(m[2]) * 12 + MESES.indexOf(m[1]);
    if (actual === objetivo) break;
    await ambito.locator(`button[name='${actual < objetivo ? "next-month" : "previous-month"}']`).last().click();
  }
  await celda(ambito, dia).click();
}

/** Abre el selector de fecha `selector` y elige `iso`. */
async function elegirFecha(page: Page, editor: Locator, selector: string, iso: string) {
  await editor.locator(selector).click();
  await pulsarFecha(page, iso);
}

/** Clave del borrador de «Nuevo evento» del local de prueba. */
const CLAVE_BORRADOR = `pasify.draft.${IDS.usuario}.evento.${IDS.usuario}`;

type ProgramacionBorrador = { kind: "single" | "multi_day" | "recurring"; rule: RecurrenceRule };

/** Borrador completo y válido (con su programación) en el paso y con la fecha dados. */
const borradorSerie = (opts: {
  titulo?: string;
  paso?: number;
  fecha: string;
  programacion: ProgramacionBorrador;
  publicar?: boolean;
  inicio?: string;
  fin?: string;
}) => ({
  v: 1,
  step: opts.paso ?? 5,
  title: opts.titulo ?? "Noche de series",
  description: "",
  dateTime: { date: opts.fecha, startTime: opts.inicio ?? "23:30", endTime: opts.fin ?? "06:00" },
  location: { city: "Madrid", venueName: "Sala E2E · Principal", address: "Calle de Prueba 1" },
  tiers: [
    {
      _key: "tipo-0",
      name: "General",
      description: "",
      priceEur: "15.00",
      capacity: "100",
      perUserMax: "4",
      active: true,
      refundMode: "none",
      refundHours: "48",
      transferAllowed: true,
    },
  ],
  imageUrl: "",
  willPublish: opts.publicar ?? true,
  venueId: IDS.local,
  timeZone: "Europe/Madrid",
  schedule: opts.programacion,
});

async function sembrarBorrador(page: Page, borrador: ReturnType<typeof borradorSerie>) {
  await page.addInitScript(
    ({ clave, datos }) => window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: datos })),
    { clave: CLAVE_BORRADOR, datos: borrador },
  );
}

/** Intercepta create_event_series: guarda lo que manda la app y responde con `responder`. */
async function simularCreacionDeSerie(
  page: Page,
  responder: (n: number, cuerpo: Fila, route: Route) => Promise<void> | void = async (_n, cuerpo, route) =>
    responderJson(route, {
      series_id: "5e2e0000-0000-4000-8000-0000000000a1",
      event_ids: (cuerpo._sessions as unknown[]).map((_, i) => `5e2e0000-0000-4000-8000-00000000b${String(i).padStart(3, "0")}`),
      already_created: false,
    }),
) {
  const llamadas: Fila[] = [];
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/rpc/create_event_series",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const cuerpo = route.request().postDataJSON() as Fila;
      llamadas.push(cuerpo);
      await responder(llamadas.length, cuerpo, route);
    },
  );
  return llamadas;
}

const regla = (cambios: Partial<RecurrenceRule>): RecurrenceRule => ({ ...defaultRule("recurring"), ...cambios });

/** Hora y día de reloj de Madrid de un instante. */
const enMadrid = (iso: string) => {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => partes.find((p) => p.type === t)!.value;
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
};

// ---------------------------------------------------------------------------
// El selector de fechas
// ---------------------------------------------------------------------------

test.describe("selector de fechas", () => {
  test("por defecto una fecha; «Varios días» y «Se repite» enseñan sus campos", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Noche de prueba");
    await siguiente(editor).click();
    await expect(paso(editor, 2)).toBeVisible();

    const tipos = editor.getByRole("radiogroup", { name: "Tipo de evento según sus fechas" });
    await expect(tipos.getByRole("radio", { name: /Una fecha/ })).toHaveAttribute("aria-checked", "true");
    await expect(editor.getByLabel("Día del evento")).toBeVisible();
    await expect(editor.getByTestId("sched-preview")).toHaveCount(0);

    await editor.getByTestId("sched-kind-multi_day").click();
    await expect(tipos.getByRole("radio", { name: /Varios días/ })).toHaveAttribute("aria-checked", "true");
    await expect(editor.getByText("Primer día *")).toBeVisible();
    await expect(editor.getByText("Último día *")).toBeVisible();

    await editor.getByTestId("sched-kind-recurring").click();
    await expect(editor.getByTestId("sched-frequency")).toBeVisible();
    await expect(editor.getByTestId("sched-interval")).toHaveValue("1");
    await expect(editor.getByTestId("sched-count")).toHaveValue("8");
    await expect(editor.getByLabel("Empieza el")).toBeVisible();

    // Volver a una fecha deja el selector de siempre.
    await editor.getByTestId("sched-kind-single").click();
    await expect(editor.getByLabel("Día del evento")).toBeVisible();
    await expect(editor.getByTestId("sched-frequency")).toHaveCount(0);
  });

  test("varios días seguidos: el último día se acerca solo, la vista previa lista cada fecha y deja quitar y volver a poner", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Festival de tres días");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-multi_day").click();

    // Primer día: el 15 del mes que viene. El último queda dos días después.
    await elegirFecha(page, editor, "#evt-date", diaDelMesQueViene(15));
    const d1 = diaDelMesQueViene(15);
    const d2 = diaDelMesQueViene(16);
    const d3 = diaDelMesQueViene(17);
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 3 fechas");
    for (const d of [d1, d2, d3]) await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();
    await expect(editor.getByTestId("sched-summary")).toContainText("3 días seguidos");

    // Quitar el del medio (un día de cierre): quedan 2 y se puede volver a poner.
    await editor.getByTestId(`sched-exclude-${d2}`).click();
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 2 fechas");
    await expect(editor.getByTestId(`sched-date-${d2}`)).toHaveCount(0);
    await expect(editor.getByTestId(`sched-restore-${d2}`)).toBeVisible();
    await editor.getByTestId(`sched-restore-${d2}`).click();
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 3 fechas");

    // Con una sola fecha en pie no se puede quitar más (una serie sin fechas no existe).
    await editor.getByTestId(`sched-exclude-${d1}`).click();
    await editor.getByTestId(`sched-exclude-${d2}`).click();
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 1 fecha");
    await expect(editor.getByTestId(`sched-exclude-${d3}`)).toBeDisabled();
  });

  test("varios días: un último día que no es posterior al primero, o a más de 30 días, no se puede crear", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Largo");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-multi_day").click();
    await elegirFecha(page, editor, "#evt-date", diaDelMesQueViene(5));

    // El último día igual que el primero: no son «varios» días.
    await elegirFecha(page, editor, "#sched-last-day", diaDelMesQueViene(5));
    await expect(editor.getByTestId("sched-error")).toContainText("al menos 2 días");
    await siguiente(editor).click();
    await expect(page.getByText(/al menos 2 días/).first()).toBeVisible();
    await expect(paso(editor, 2)).toBeVisible();

    // Dos meses más allá del mes en curso: pasa de 30 días.
    await elegirFecha(page, editor, "#sched-last-day", diaDelMesQueViene(20, 3));
    await expect(editor.getByTestId("sched-error")).toContainText("hasta 30 días");

    // Y uno bueno (el 7: tres días) lo deja pasar.
    await elegirFecha(page, editor, "#sched-last-day", diaDelMesQueViene(7));
    await expect(editor.getByTestId("sched-error")).toHaveCount(0);
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 3 fechas");
    await siguiente(editor).click();
    await expect(paso(editor, 3)).toBeVisible();
  });

  test("se repite cada semana: los días, la cuenta de fechas y el final por fecha", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Todos los viernes");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-recurring").click();
    await elegirFecha(page, editor, "#evt-date", diaDelMesQueViene(15));
    const primera = diaDelMesQueViene(15);

    // Semanal por defecto, el día de la semana de la primera fecha: 8 fechas.
    const base = regla({ frequency: "weekly", endMode: "count", count: 8 });
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 8 fechas");
    await expect(editor.getByTestId(`sched-date-${expandRule(primera, base).dates[7]}`)).toBeVisible();
    // Más de 12 fechas se pliegan: «Ver las N fechas».
    await editor.getByTestId("sched-count").fill("20");
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 20 fechas");
    await expect(editor.getByTestId("sched-toggle-all")).toHaveText("Ver las 20 fechas");
    await editor.getByTestId("sched-toggle-all").click();
    await expect(editor.getByTestId("sched-toggle-all")).toHaveText("Ver menos");
    await editor.getByTestId("sched-count").fill("6");

    // Viernes y sábado: 6 fechas alternando (se marcan los que faltan y luego se quitan los que sobran).
    const deseados = new Set([5, 6]);
    for (const quita of [false, true]) {
      for (let dia = 1; dia <= 7; dia++) {
        const marcado = (await editor.getByTestId(`sched-weekday-${dia}`).getAttribute("aria-pressed")) === "true";
        if (quita ? marcado && !deseados.has(dia) : !marcado && deseados.has(dia)) {
          await editor.getByTestId(`sched-weekday-${dia}`).click();
        }
      }
    }
    const dosDias = expandRule(primera, regla({ frequency: "weekly", weekdays: [5, 6], endMode: "count", count: 6 })).dates;
    await expect(editor.getByTestId("sched-preview-count")).toHaveText(`Se crearán ${dosDias.length} fechas`);
    for (const d of dosDias) await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();

    // Cada 2 semanas.
    await editor.getByTestId("sched-interval").fill("2");
    const cada2 = expandRule(primera, regla({ frequency: "weekly", interval: 2, weekdays: [5, 6], endMode: "count", count: 6 })).dates;
    for (const d of cada2) await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();

    // Hasta una fecha: «El día» + selector.
    await editor.getByTestId("sched-end-until").check();
    await expect(editor.locator("#sched-ends-on")).toBeVisible();
    await editor.getByTestId("sched-end-count").check();
    await expect(editor.getByTestId("sched-count")).toBeEnabled();

    // Siempre queda algún día marcado.
    await editor.getByTestId("sched-weekday-6").click();
    await editor.getByTestId("sched-weekday-5").click();
    await expect(editor.getByTestId("sched-weekday-5")).toHaveAttribute("aria-pressed", "true");
  });

  test("cada mes: el mismo día o el mismo día de la semana", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Mensual");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-recurring").click();
    await elegirFecha(page, editor, "#evt-date", diaDelMesQueViene(15));
    const primera = diaDelMesQueViene(15);

    await editor.getByTestId("sched-frequency").click();
    await page.getByRole("option", { name: "Cada mes" }).click();
    await expect(editor.getByTestId("sched-monthly-day")).toBeChecked();
    await editor.getByTestId("sched-count").fill("4");
    for (const d of expandRule(primera, regla({ frequency: "monthly", endMode: "count", count: 4 })).dates) {
      await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();
    }
    await editor.getByTestId("sched-monthly-nth").check();
    for (const d of expandRule(primera, regla({ frequency: "monthly", monthlyMode: "nth_weekday", endMode: "count", count: 4 })).dates) {
      await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();
    }
    await expect(editor.getByTestId("sched-summary")).toContainText("de cada mes");
  });

  test("fechas elegidas a mano en el calendario", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Fechas sueltas");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-recurring").click();
    await editor.getByTestId("sched-frequency").click();
    await page.getByRole("option", { name: "Fechas elegidas" }).click();

    const calendario = editor.getByTestId("sched-custom");
    await expect(calendario).toBeVisible();
    // Sin fechas todavía: no se regaña, se explica.
    await expect(editor.getByTestId("sched-error")).toHaveCount(0);
    for (const dia of [10, 24, 17]) await pulsarFecha(calendario, diaDelMesQueViene(dia));
    const fechas = [diaDelMesQueViene(10), diaDelMesQueViene(17), diaDelMesQueViene(24)];
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 3 fechas");
    for (const d of fechas) await expect(editor.getByTestId(`sched-date-${d}`)).toBeVisible();
    // Pulsar otra vez un día lo quita.
    await pulsarFecha(calendario, diaDelMesQueViene(17));
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 2 fechas");
    // Las horas se piden aparte; el día de la primera fecha ya no se pregunta.
    await expect(editor.locator("#evt-date")).toHaveCount(0);
    await expect(editor.locator("#evt-start")).toBeVisible();
  });

  test("lo que no se puede crear se dice y no deja pasar", async ({ page }) => {
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await editor.locator("#evt-title").fill("Con errores");
    await siguiente(editor).click();
    await editor.getByTestId("sched-kind-recurring").click();
    await elegirFecha(page, editor, "#evt-date", diaDelMesQueViene(15));

    await editor.getByTestId("sched-interval").fill("0");
    await expect(editor.getByTestId("sched-error")).toContainText("entre 1 y 52");
    await siguiente(editor).click();
    await expect(page.getByText(/entre 1 y 52/).first()).toBeVisible();
    await expect(paso(editor, 2)).toBeVisible();
    await editor.getByTestId("sched-interval").fill("1");

    await editor.getByTestId("sched-count").fill("101");
    await expect(editor.getByTestId("sched-error")).toContainText("entre 1 y 100");
    await editor.getByTestId("sched-count").fill("5");
    await expect(editor.getByTestId("sched-error")).toHaveCount(0);

    // Hasta una fecha anterior a la primera.
    await editor.getByTestId("sched-end-until").check();
    await elegirFecha(page, editor, "#sched-ends-on", diaDelMesQueViene(2, 0));
    await expect(editor.getByTestId("sched-error")).toContainText("anterior a la primera");
  });
});

// ---------------------------------------------------------------------------
// Crear la serie
// ---------------------------------------------------------------------------

test.describe("crear la serie", () => {
  const FECHA = "2099-10-16"; // viernes; la serie cruza el cambio de hora de octubre (domingo 25)
  const SEMANAL = regla({ frequency: "weekly", weekdays: [5], endMode: "count", count: 4 });

  test("publicar manda una sesión por fecha, con la hora del local aunque cambie la hora, los tipos y una clave", async ({ page }) => {
    await sembrarBorrador(page, borradorSerie({ fecha: FECHA, programacion: { kind: "recurring", rule: SEMANAL } }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    // El borrador vuelve en el paso del resumen, con la serie.
    await expect(paso(editor, 6)).toBeVisible();
    await expect(editor.getByTestId("summary-series").first()).toContainText("Todos los viernes · 4 fechas");
    await editor.getByRole("button", { name: "Publicar evento" }).click();

    await expect(page.getByText("Serie publicada · 4 fechas")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Nuevo evento" })).toHaveCount(0);
    expect(llamadas).toHaveLength(1);
    const c = llamadas[0];
    expect(c._kind).toBe("recurring");
    expect(c._time_zone).toBe("Europe/Madrid");
    expect(c._request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c._event).toMatchObject({
      title: "Noche de series",
      city: "Madrid",
      venue_name: "Sala E2E · Principal",
      address: "Calle de Prueba 1",
      venue_id: IDS.local,
      status: "published",
    });
    expect(c._tiers).toEqual([
      expect.objectContaining({ name: "General", price_cents: 1500, capacity: 100, per_user_max: 4, status: "active", currency: "EUR" }),
    ]);
    expect(c._rule).toMatchObject({ v: 1, kind: "recurring", frequency: "weekly", startsOn: FECHA, count: 4, weekdays: [5] });

    const sesiones = c._sessions as Array<{ date: string; start: string; end: string }>;
    const esperadas = expandRule(FECHA, SEMANAL).dates;
    expect(sesiones.map((s) => s.date)).toEqual(esperadas);
    for (const s of sesiones) {
      // 23:30 → 06:00 del día siguiente, hora de Madrid, también tras el cambio de hora.
      expect(enMadrid(s.start), `inicio de ${s.date}`).toEqual({ fecha: s.date, hora: "23:30" });
      expect(enMadrid(s.end).hora, `fin de ${s.date}`).toBe("06:00");
      expect(Date.parse(s.end) - Date.parse(s.start)).toBeGreaterThan(5 * 3_600_000);
    }
    // Entre viernes consecutivos no siempre hay 168 h en UTC: la hora de reloj es lo que se mantiene.
    const saltos = sesiones.slice(1).map((s, i) => (Date.parse(s.start) - Date.parse(sesiones[i].start)) / 3_600_000);
    expect(saltos.some((h) => h !== 168), "ninguna semana cruza el cambio de hora").toBe(true);
    // El borrador del dispositivo ya no hace falta.
    await page.waitForTimeout(700);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), CLAVE_BORRADOR)).toBeNull();
  });

  test("un envío repetido (se cortó la red) usa la misma clave; si cambia algo, es otro intento", async ({ page }) => {
    await sembrarBorrador(page, borradorSerie({ fecha: FECHA, programacion: { kind: "recurring", rule: SEMANAL } }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page, async (n, cuerpo, route) => {
        if (n <= 2) return route.abort("failed");
        return responderJson(route, {
          series_id: "5e2e0000-0000-4000-8000-0000000000a1",
          event_ids: (cuerpo._sessions as unknown[]).map((_, i) => `5e2e0000-0000-4000-8000-00000000b${String(i).padStart(3, "0")}`),
          already_created: n === 4,
        });
      });
    });
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 6)).toBeVisible();

    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("No se ha guardado la serie")).toBeVisible();
    await expect(page.getByText(/si vuelves a guardar lo mismo, no se crea dos veces/)).toBeVisible();
    // El editor sigue abierto con todo lo escrito.
    await expect(paso(editor, 6)).toBeVisible();
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect.poll(() => llamadas.length).toBe(2);
    expect(llamadas[1]._request_id, "el reintento con los mismos datos cambió de clave").toBe(llamadas[0]._request_id);

    // Cambia el título: ya es otra serie, otra clave (y esta vez sí llega).
    await page.getByRole("dialog", { name: "Nuevo evento" }).getByRole("button", { name: /Datos básicos/ }).click();
    await editor.locator("#evt-title").fill("Noche de series, segunda");
    await editor.getByRole("button", { name: /Resumen/ }).click();
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("Serie publicada · 4 fechas")).toBeVisible();
    expect(llamadas).toHaveLength(3);
    expect(llamadas[2]._request_id).not.toBe(llamadas[0]._request_id);
  });

  test("el servidor rechaza con un código y el editor lo explica sin cerrarse", async ({ page }) => {
    await sembrarBorrador(page, borradorSerie({ fecha: FECHA, programacion: { kind: "recurring", rule: SEMANAL } }));
    await abrirPanel(page, async () => {
      await simularCreacionDeSerie(page, async (_n, _c, route) =>
        responderJson(route, { code: "P0001", message: "series_sessions_overlap", details: null, hint: null }, 400),
      );
    });
    const editor = await abrirNuevoEvento(page);
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("No se ha guardado la serie")).toBeVisible();
    await expect(page.getByText(/Dos fechas de la serie se pisan/)).toBeVisible();
    await expect(paso(editor, 6)).toBeVisible();
  });

  test("varios días seguidos se crea como multi_day, con su regla", async ({ page }) => {
    const multi = { ...defaultRule("multi_day"), endMode: "until" as const, endsOn: "2099-10-18" };
    await sembrarBorrador(page, borradorSerie({ fecha: "2099-10-16", programacion: { kind: "multi_day", rule: multi }, publicar: false }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    await expect(editor.getByTestId("summary-series").first()).toContainText("Varios días seguidos · 3 fechas");
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado · 3 fechas")).toBeVisible();
    const c = llamadas[0];
    expect(c._kind).toBe("multi_day");
    expect((c._event as Fila).status).toBe("draft");
    expect((c._sessions as Array<{ date: string }>).map((s) => s.date)).toEqual(["2099-10-16", "2099-10-17", "2099-10-18"]);
    expect(c._rule).toMatchObject({ v: 1, kind: "multi_day", frequency: "daily", endMode: "until", endsOn: "2099-10-18", startsOn: "2099-10-16" });
  });

  test("las fechas quitadas en la vista previa no se crean", async ({ page }) => {
    const rule = regla({ frequency: "weekly", weekdays: [5], endMode: "count", count: 4, excluded: ["2099-10-23"] });
    await sembrarBorrador(page, borradorSerie({ fecha: FECHA, programacion: { kind: "recurring", rule } }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    await expect(editor.getByTestId("summary-series").first()).toContainText("3 fechas");
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("Serie publicada · 3 fechas")).toBeVisible();
    const fechas = (llamadas[0]._sessions as Array<{ date: string }>).map((s) => s.date);
    expect(fechas).toEqual(["2099-10-16", "2099-10-30", "2099-11-06"]);
  });
});

// ---------------------------------------------------------------------------
// Fechas pasadas
// ---------------------------------------------------------------------------

test.describe("fechas que ya han pasado", () => {
  const ELEGIDAS = regla({ frequency: "custom", customDates: ["2020-01-03", "2099-06-12", "2099-06-19"] });

  test("en borrador valen; al publicar se omiten y se dice", async ({ page }) => {
    await sembrarBorrador(
      page,
      borradorSerie({ fecha: "2020-01-03", programacion: { kind: "recurring", rule: ELEGIDAS }, paso: 1 }),
    );
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();
    // Se va a publicar: la de 2020 ya ha pasado y se avisa.
    await expect(editor.getByTestId("sched-past")).toContainText("1 fecha ya ha pasado");
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 2 fechas");
    await expect(siguiente(editor)).toBeEnabled();

    // Como borrador, las 3.
    for (const n of [3, 4, 5, 6]) {
      await siguiente(editor).click();
      await expect(paso(editor, n)).toBeVisible();
    }
    await editor.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado · 3 fechas")).toBeVisible();
    expect((llamadas[0]._sessions as unknown[]).length).toBe(3);
    expect((llamadas[0]._event as Fila).status).toBe("draft");
  });

  test("al publicar, las pasadas no se mandan y el aviso lo cuenta", async ({ page }) => {
    await sembrarBorrador(page, borradorSerie({ fecha: "2020-01-03", programacion: { kind: "recurring", rule: ELEGIDAS } }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText("Serie publicada · 2 fechas")).toBeVisible();
    await expect(page.getByText(/Una fecha que ya había pasado no se ha creado/)).toBeVisible();
    expect((llamadas[0]._sessions as Array<{ date: string }>).map((s) => s.date)).toEqual(["2099-06-12", "2099-06-19"]);
  });

  test("si todas han pasado, publicar no es posible y se dice", async ({ page }) => {
    const pasadas = regla({ frequency: "custom", customDates: ["2020-01-03", "2020-01-10"] });
    await sembrarBorrador(page, borradorSerie({ fecha: "2020-01-03", programacion: { kind: "recurring", rule: pasadas } }));
    let llamadas!: Fila[];
    await abrirPanel(page, async () => {
      llamadas = await simularCreacionDeSerie(page);
    });
    const editor = await abrirNuevoEvento(page);
    await editor.getByRole("button", { name: "Publicar evento" }).click();
    await expect(page.getByText(/Todas las fechas ya han pasado/).first()).toBeVisible();
    expect(llamadas).toHaveLength(0);
    await expect(paso(editor, 6)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Borradores y edición
// ---------------------------------------------------------------------------

test.describe("borrador y edición", () => {
  test("una serie a medias se recupera tal cual; uno anterior a las series, como una fecha", async ({ page }) => {
    const SEMANAL = regla({ frequency: "weekly", weekdays: [5, 6], endMode: "count", count: 4 });
    await sembrarBorrador(page, borradorSerie({ fecha: "2099-10-16", programacion: { kind: "recurring", rule: SEMANAL }, paso: 1 }));
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();
    await expect(editor.getByTestId("sched-kind-recurring")).toHaveAttribute("aria-checked", "true");
    await expect(editor.getByTestId("sched-weekday-5")).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByTestId("sched-weekday-6")).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByTestId("sched-count")).toHaveValue("4");
    await expect(editor.getByTestId("sched-preview-count")).toHaveText("Se crearán 4 fechas");
  });

  test("un borrador sin programación (de antes de las series) se abre como una fecha", async ({ page }) => {
    const antiguo = borradorSerie({ fecha: "2099-10-16", programacion: { kind: "single", rule: defaultRule("recurring") }, paso: 1 }) as Record<string, unknown>;
    delete antiguo.schedule;
    await page.addInitScript(
      ({ clave, datos }) => window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: datos })),
      { clave: CLAVE_BORRADOR, datos: antiguo },
    );
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();
    await expect(editor.getByTestId("sched-kind-single")).toHaveAttribute("aria-checked", "true");
    await expect(editor.locator("#evt-date")).toContainText("octubre");
  });

  test("un borrador con una programación estropeada se abre como una fecha, sin romper", async ({ page }) => {
    const roto = borradorSerie({ fecha: "2099-10-16", programacion: { kind: "single", rule: defaultRule("recurring") }, paso: 1 }) as Record<string, unknown>;
    roto.schedule = { kind: "recurring", rule: { frequency: "cada-rato", interval: "mucho" } };
    await page.addInitScript(
      ({ clave, datos }) => window.localStorage.setItem(clave, JSON.stringify({ savedAt: Date.now(), data: datos })),
      { clave: CLAVE_BORRADOR, datos: roto },
    );
    await abrirPanel(page);
    const editor = await abrirNuevoEvento(page);
    await expect(paso(editor, 2)).toBeVisible();
    await expect(editor.getByTestId("sched-kind-single")).toHaveAttribute("aria-checked", "true");
  });

  test("editar un evento no ofrece series: cada fecha se edita sola", async ({ page }) => {
    await abrirPanel(page);
    await page.locator("aside nav").getByRole("button", { name: "Mis eventos", exact: true }).click();
    await page
      .locator("main table tbody tr")
      .filter({ hasText: "Concierto E2E" })
      .getByRole("button", { name: "Acciones del evento" })
      .click();
    await page.getByRole("menuitem", { name: "Editar evento" }).click();
    const editor = page.getByRole("dialog", { name: "Editar evento" });
    await expect(editor.locator("#evt-title")).toHaveValue("Concierto E2E");
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await expect(editor.getByLabel("Día del evento")).toBeVisible();
    await expect(editor.getByTestId("sched-kind-recurring")).toHaveCount(0);
  });
});

// Lo que enseña la vista previa para unas fechas conocidas (formato de las pastillas).
test("las pastillas de fecha son «vie 16 oct»", () => {
  expect(formatDayShort("2099-10-16")).toBe("vie 16 oct");
});
