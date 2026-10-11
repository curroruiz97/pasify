import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { diasDesdeEnero, momentoEnMadrid, ventanaDelInforme } from "../../src/components/partner/reportWindow";
import {
  FAKE_SUPABASE_URL,
  IDS,
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

/**
 * `antesDeEntrar`: rutas propias del test, por encima del Supabase falso (en
 * Playwright la última ruta registrada va primero) y antes de cargar el panel.
 */
async function abrirPanel(
  page: Page,
  opciones: OpcionesSupabaseFalso = {},
  antesDeEntrar?: () => Promise<void>,
): Promise<Panel> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, opciones);
  await antesDeEntrar?.();
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
    // Plegado, el grupo tiene visibility: hidden (NavTree lo saca del Tab y del
    // lector) y la recupera un fotograma después de abrirse: hasta entonces sus
    // filas no tienen texto visible y allInnerTexts() no las cuenta.
    const hijos = arbol.page().locator(`[id="${await grupo.getAttribute("aria-controls")}"]`);
    await expect(hijos.getByRole("button").first()).toBeVisible();
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

// ---------------------------------------------------------------------------
// Ola 2 · panel de local: reembolsos, Mis eventos, políticas de cada tipo de
// entrada y cuenta suspendida. Lo que el mock común no trae (solicitudes de
// reembolso, la suspensión, decide-refund, escrituras) se contesta aquí.
// ---------------------------------------------------------------------------

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

type Fila = Record<string, unknown>;

/** Respuesta JSON con las mismas cabeceras CORS que el Supabase falso. */
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

const SOLICITUD = {
  pendienteVieja: "5e2e0000-0000-4000-8000-000000000070",
  pendienteNueva: "5e2e0000-0000-4000-8000-000000000071",
  reembolsada: "5e2e0000-0000-4000-8000-000000000072",
  rechazada: "5e2e0000-0000-4000-8000-000000000073",
  fallida: "5e2e0000-0000-4000-8000-000000000074",
  enCurso: "5e2e0000-0000-4000-8000-000000000075",
} as const;

/**
 * Solicitudes de reembolso de la organización (refund_requests con sus
 * relaciones, como las devuelve PostgREST, filtradas por estado y ordenadas
 * como pide la app) y la edge function decide-refund, que las decide de
 * verdad: la lectura siguiente ya las trae decididas.
 */
async function simularReembolsos(page: Page) {
  const ahora = Date.now();
  const hace = (horas: number) => new Date(ahora - horas * 3_600_000).toISOString();
  const solicitud = (id: string, status: string, horas: number, extra: Fila = {}): Fila => ({
    id,
    event_id: IDS.eventoProximo,
    amount_cents: 2000,
    currency: "EUR",
    reason: "No puedo ir",
    status,
    decision_note: null,
    decided_at: status === "pending" ? null : hace(horas - 1),
    auto_approved: false,
    created_at: hace(horas),
    events: { title: "Concierto E2E", date_start: new Date(ahora + 7 * 86_400_000).toISOString(), venue_id: IDS.local },
    tickets: { ticket_tiers: { name: "Anticipada" } },
    ...extra,
  });
  // Desordenadas a propósito: el orden lo pide la app (order=created_at).
  const filas: Fila[] = [
    solicitud(SOLICITUD.reembolsada, "refunded", 50),
    solicitud(SOLICITUD.pendienteNueva, "pending", 2, { reason: "Tengo covid" }),
    solicitud(SOLICITUD.rechazada, "rejected", 60, { decision_note: "Fuera del plazo del local" }),
    solicitud(SOLICITUD.pendienteVieja, "pending", 30, { reason: "Me operan ese día" }),
    solicitud(SOLICITUD.fallida, "failed", 40),
    solicitud(SOLICITUD.enCurso, "processing", 20),
  ];
  const decisiones: Fila[] = [];

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/refund_requests",
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      const params = new URL(req.url()).searchParams;
      const estado = params.get("status");
      const lista =
        estado === "eq.pending"
          ? filas.filter((f) => f.status === "pending")
          : estado === "neq.pending"
            ? filas.filter((f) => f.status !== "pending")
            : [...filas];
      const desc = (params.get("order") ?? "").endsWith(".desc");
      lista.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (desc ? -1 : 1));
      await responderJson(route, lista);
    },
  );
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/functions/v1/decide-refund",
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      const cuerpo = (req.postDataJSON() ?? {}) as Fila;
      decisiones.push(cuerpo);
      const status = cuerpo.decision === "approve" ? "refunded" : "rejected";
      const fila = filas.find((f) => f.id === cuerpo.request_id);
      if (fila) Object.assign(fila, { status, decision_note: cuerpo.note ?? null, decided_at: new Date().toISOString() });
      await responderJson(route, { status });
    },
  );
  return { decisiones };
}

/** organizations.suspended_at (la app la lee en su propia consulta): suspendida desde ayer. */
async function simularSuspension(page: Page) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/organizations",
    async (route) => {
      const req = route.request();
      const select = new URL(req.url()).searchParams.get("select") ?? "";
      if (req.method() !== "GET" || !select.includes("suspended_at")) return route.fallback();
      await responderJson(route, { suspended_at: new Date(Date.now() - 86_400_000).toISOString() });
    },
  );
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

test.describe("ola 2", () => {
  test("reembolsos: pendientes primero y con su número en el menú; aprobar se confirma y rechazar pide el motivo", async ({
    page,
  }) => {
    let reembolsos!: Awaited<ReturnType<typeof simularReembolsos>>;
    const panel = await abrirPanel(page, {}, async () => {
      reembolsos = await simularReembolsos(page);
    });

    const enMenu = page.locator("aside nav").getByRole("button", { name: /^Reembolsos/ });
    await expect(enMenu, "Número de pendientes en el menú").toHaveText(/Reembolsos\s*2/);
    await enMenu.click();
    await esperarCalma(page, panel.supabase);
    await comprobarSinFallos(page, panel, "en Reembolsos");
    await expect(page.locator("main h1").first()).toHaveText("Reembolsos");

    const tarjetas = page.getByTestId("solicitud-reembolso");
    await expect(tarjetas).toHaveCount(6);
    // Pendientes primero: la que más lleva esperando, delante.
    await expect(tarjetas.nth(0)).toHaveAttribute("data-status", "pending");
    await expect(tarjetas.nth(0)).toContainText("Me operan ese día");
    await expect(tarjetas.nth(1)).toHaveAttribute("data-status", "pending");
    await expect(tarjetas.nth(1)).toContainText("Tengo covid");
    // Evento, tipo e importe.
    await expect(tarjetas.nth(0)).toContainText("Concierto E2E");
    await expect(tarjetas.nth(0)).toContainText("Anticipada");
    await expect(tarjetas.nth(0)).toContainText("20,00");
    // Estados de las decididas, en claro.
    await expect(tarjetas.filter({ hasText: "Reembolsada" })).toHaveCount(1);
    await expect(tarjetas.filter({ hasText: "Fallida · la revisa Pasify" })).toHaveCount(1);
    await expect(tarjetas.filter({ hasText: "En curso" })).toHaveCount(1);
    await expect(tarjetas.filter({ hasText: "Fuera del plazo del local" })).toHaveCount(1);

    // Rechazar: el motivo es obligatorio (5 caracteres o más).
    await tarjetas.nth(0).getByRole("button", { name: "Rechazar" }).click();
    const dialogo = page.getByRole("dialog");
    const confirmarRechazo = dialogo.getByRole("button", { name: "Rechazar" });
    await expect(confirmarRechazo).toBeDisabled();
    await dialogo.getByLabel("Motivo del rechazo").fill("No");
    await expect(confirmarRechazo).toBeDisabled();
    await dialogo.getByLabel("Motivo del rechazo").fill("Fuera del plazo de 48 horas");
    await confirmarRechazo.click();
    await expect(dialogo).toHaveCount(0);
    expect(reembolsos.decisiones).toEqual([
      { request_id: SOLICITUD.pendienteVieja, decision: "reject", note: "Fuera del plazo de 48 horas" },
    ]);
    await expect(enMenu, "Al decidir baja el número").toHaveText(/Reembolsos\s*1/);

    // Aprobar: se confirma con el importe delante.
    await tarjetas.filter({ hasText: "Tengo covid" }).getByRole("button", { name: "Aprobar" }).click();
    const confirmacion = page.getByRole("alertdialog");
    await expect(confirmacion).toContainText("20,00");
    await confirmacion.getByRole("button", { name: "Aprobar y devolver" }).click();
    await expect(confirmacion).toHaveCount(0);
    expect(reembolsos.decisiones[1]).toEqual({ request_id: SOLICITUD.pendienteNueva, decision: "approve" });
    await expect(enMenu, "Sin pendientes no hay número").toHaveText(/^\s*Reembolsos\s*$/);
    await expect(tarjetas.filter({ hasText: "Reembolsada" })).toHaveCount(2);
    await comprobarSinFallos(page, panel, "tras decidir");
  });

  test("mis eventos: pestañas con su número, búsqueda por título y vendidas sobre el aforo", async ({ page }) => {
    const panel = await abrirPanel(page);
    await menuLateral(page).ir("Mis eventos");
    await esperarCalma(page, panel.supabase);
    await comprobarSinFallos(page, panel, "en Mis eventos");

    const pestanas = page.getByRole("tablist", { name: "Eventos por estado" });
    const pestana = (nombre: string) => pestanas.getByRole("tab", { name: new RegExp(`^${nombre}`) });
    await expect(pestana("Próximos")).toHaveAttribute("aria-selected", "true");
    await expect(pestana("Próximos")).toHaveText(/Próximos\s*2/);
    await expect(pestana("Borradores")).toHaveText(/Borradores\s*1/);
    await expect(pestana("Pasados")).toHaveText(/Pasados\s*1/);

    const filas = page.locator("main table tbody tr");
    // Próximos por fecha: el de esta noche (en curso) y el de la semana que viene.
    await expect(filas).toHaveCount(2);
    await expect(filas.nth(0)).toContainText("Noche E2E");
    await expect(filas.nth(1)).toContainText("Concierto E2E");
    // Vendidas sobre el aforo (el que mantiene el trigger), con su barra.
    await expect(filas.nth(0).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "120");
    await expect(filas.nth(0).getByRole("progressbar")).toHaveAttribute("aria-valuemax", "300");

    // Búsqueda por título sin mayúsculas ni tildes; los números de las pestañas la cuentan.
    await page.getByLabel("Buscar eventos por título").fill("CONCIERTO");
    await expect(filas).toHaveCount(1);
    await expect(pestana("Borradores")).toHaveText(/Borradores\s*0/);
    await page.getByRole("button", { name: "Borrar búsqueda" }).first().click();

    await pestana("Borradores").click();
    await expect(filas).toHaveCount(1);
    await expect(filas.first()).toContainText("Borrador E2E");
    await pestana("Pasados").click();
    await expect(filas).toHaveCount(1);
    await expect(filas.first()).toContainText("Fiesta pasada E2E");
    await comprobarSinFallos(page, panel, "en las pestañas de Mis eventos");
  });

  test("editor: devoluciones y transferencia de un tipo vendido, en el resumen y al guardar; hora del local", async ({
    page,
  }) => {
    let escrituras!: Awaited<ReturnType<typeof simularEscrituras>>;
    const panel = await abrirPanel(page, {}, async () => {
      escrituras = await simularEscrituras(page);
    });
    await menuLateral(page).ir("Mis eventos");
    await esperarCalma(page, panel.supabase);

    await page
      .locator("main table tbody tr")
      .filter({ hasText: "Concierto E2E" })
      .getByRole("button", { name: "Acciones del evento" })
      .click();
    await page.getByRole("menuitem", { name: "Editar evento" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor.locator("#evt-title")).toHaveValue("Concierto E2E");
    await esperarCalma(page, panel.supabase);

    // Cuándo y dónde: rotulado con la ciudad del local.
    await editor.getByRole("button", { name: /Cuándo y dónde/ }).click();
    await expect(editor.getByTestId("evt-time-zone")).toHaveText("Hora de Madrid");
    await editor.getByLabel("Ubicación exacta").fill("Calle de Prueba 1");

    // Tipos de entrada: el tipo ya vendido enseña sus políticas y avisa.
    await editor.getByRole("button", { name: /Tipos de entrada/ }).click();
    await expect(editor.getByRole("radio", { name: "Hasta" })).toBeChecked();
    await expect(editor.getByLabel("Horas antes del evento")).toHaveValue("24");
    const transferible = editor.getByRole("switch", { name: "Se puede transferir" });
    await expect(transferible).toBeChecked();
    await expect(editor.getByText("Afecta a las solicitudes nuevas.")).toBeVisible();
    await editor.getByRole("radio", { name: "Sin devolución (salvo cancelación)" }).click();
    await transferible.click();
    await expect(transferible).not.toBeChecked();

    // Resumen: las dos políticas y la hora del local.
    await editor.getByRole("button", { name: /Resumen$/ }).first().click();
    await expect(editor.getByText("Sin devolución (salvo cancelación)").first()).toBeVisible();
    await expect(editor.getByText("No se puede transferir").first()).toBeVisible();
    await expect(editor.getByText(/Hora de Madrid/).first()).toBeVisible();

    await editor.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Cambios guardados").first()).toBeVisible();
    const tipo = escrituras.find((e) => e.tabla === "ticket_tiers");
    expect(tipo?.cuerpo, "Políticas guardadas en el tipo").toMatchObject({
      refundable_until_hours_before: null,
      transfer_allowed: false,
    });
    await comprobarSinFallos(page, panel, "al editar las políticas");
  });

  test("cuenta suspendida: franja fija y «Publicar» desactivado con la explicación", async ({ page }) => {
    const panel = await abrirPanel(page, {}, () => simularSuspension(page));
    const franja = page.getByTestId("franja-suspendida");
    await expect(franja).toHaveText(
      "Tu cuenta está suspendida: no puedes publicar ni vender entradas. Escríbenos desde Soporte.",
    );

    await menuLateral(page).ir("Mis eventos");
    await esperarCalma(page, panel.supabase);
    await expect(franja, "La franja sigue en cada sección").toBeVisible();
    await page.getByRole("tablist", { name: "Eventos por estado" }).getByRole("tab", { name: /^Borradores/ }).click();
    await page
      .locator("main table tbody tr")
      .filter({ hasText: "Borrador E2E" })
      .getByRole("button", { name: "Acciones del evento" })
      .click();
    const publicar = page.getByRole("menuitem", { name: /Publicar/ });
    await expect(publicar).toBeVisible();
    await expect(publicar).toHaveAttribute("aria-disabled", "true");
    await expect(publicar).toContainText("Tu cuenta está suspendida");
    await page.keyboard.press("Escape");
    await comprobarSinFallos(page, panel, "con la cuenta suspendida");
  });
});

// ---------------------------------------------------------------------------
// Informes del local: páginas de 1.000, eventos de la organización, fallos que
// no dan cifras a medias y días de Madrid. El Supabase falso no trae la tabla
// `tickets` de los informes (embebe events, filtra con events.or y corta a
// 1.000 filas como PostgREST), así que se contesta aquí.
// ---------------------------------------------------------------------------

/**
 * «Ahora» de estos tests: miércoles 1 de abril de 2026, 23:30 en Madrid (CEST)
 * y ya jueves 2, 10:30, en Auckland. Los últimos 7 días de Madrid incluyen el
 * cambio de hora del domingo 29 de marzo (un día de 23 horas).
 */
const AHORA_INFORMES = Date.parse("2026-04-01T21:30:00Z");
const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;
/** db-max-rows de Supabase: PostgREST nunca devuelve más, pida lo que pida `limit`. */
const MAX_FILAS_POSTGREST = 1_000;

const COMPANERO = "5e2e0000-0000-4000-8000-0000000000c1";
const OTRA_ORG = "5e2e0000-0000-4000-8000-0000000000c2";

interface EntradaInforme {
  id: string;
  event_id: string;
  status: string;
  amount_paid_cents: number;
  paid_at: string;
  used_at: string | null;
  buyer_user_id: string | null;
  buyer_email: string;
  created_at: string;
  /** Lo que embebe `events!inner(partner_id,org_id)`. */
  events: { partner_id: string; org_id: string | null };
}

const idEntrada = (n: number) => `5e2e1000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Una entrada vendida de «Noche E2E» (la de Sala E2E) por 10 €, salvo que se diga otra cosa. */
function entrada(n: number, pagadaEl: string | number, extra: Partial<EntradaInforme> = {}): EntradaInforme {
  const paid_at = new Date(pagadaEl).toISOString();
  return {
    id: idEntrada(n),
    event_id: IDS.eventoHoy,
    status: "paid",
    amount_paid_cents: 1_000,
    paid_at,
    used_at: null,
    buyer_user_id: null,
    buyer_email: `comprador${n}@e2e.pasify.test`,
    // Se crea un minuto antes de pagarse: el orden de lectura (created_at, id) es el de venta.
    created_at: new Date(Date.parse(paid_at) - 60_000).toISOString(),
    events: { partner_id: IDS.usuario, org_id: IDS.org },
    ...extra,
  };
}

interface PeticionEntradas {
  /** `offset` de `.range()`. */
  desde: number;
  /** `limit` de `.range()`. */
  limite: number;
  orden: string | null;
  /** Filtro `events.or` (el de la tabla embebida). */
  filtroEventos: string | null;
  columnas: string;
  /** Límites de `paid_at`, sin el operador. */
  pagadaDesde: string | null;
  pagadaAntesDe: string | null;
  /** Es la lectura del periodo previo: acaba antes de «ahora». */
  previo: boolean;
}

interface FalloPostgrest {
  status: number;
  code: string;
  message: string;
}

interface EntradasSimuladas {
  peticiones: PeticionEntradas[];
  /** Si devuelve un fallo, esa petición falla como lo haría PostgREST. */
  fallo: ((p: PeticionEntradas) => FalloPostgrest | null) | null;
  /** Milisegundos que tarda en contestar esa petición. */
  retraso: ((p: PeticionEntradas) => number) | null;
  /** Cambia lo que contesta una página: una venta que cambia de sitio entre páginas, p. ej. */
  alServir: ((p: PeticionEntradas, lote: EntradaInforme[]) => EntradaInforme[]) | null;
}

/** Respuesta JSON de PostgREST (con las cabeceras CORS del Supabase falso). */
async function responderPostgrest(route: Route, json: unknown, status = 200, cabeceras: Record<string, string> = {}) {
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "content-range, x-supabase-api-version",
      "content-type": "application/json; charset=utf-8",
      ...cabeceras,
    },
    body: JSON.stringify(json),
  });
}

/** Parte «a,b(c,d),e» por las comas de primer nivel: las de dentro de paréntesis no cuentan. */
function partirPorComas(texto: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const c of texto) {
    if (c === "(") profundidad++;
    if (c === ")") profundidad--;
    if (c === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

const sinParentesis = (texto: string) => texto.replace(/^\(|\)$/g, "");

/** `columna.operador.valor` de PostgREST: solo `eq` e `in`, lo que usan los informes. */
function cumpleCondicion(condicion: string, fila: Record<string, unknown>): boolean {
  const [columna, operador, ...resto] = condicion.split(".");
  const valor = resto.join(".");
  const actual = fila[columna] === null || fila[columna] === undefined ? null : String(fila[columna]);
  if (operador === "eq") return actual === valor;
  if (operador === "in") return actual !== null && partirPorComas(sinParentesis(valor)).includes(actual);
  throw new Error(`Operador de PostgREST sin simular: ${condicion}`);
}

/** Todos los filtros de la URL, también los de la tabla embebida (`events.or`, `events.partner_id`). */
function cumpleFiltros(fila: EntradaInforme, params: URLSearchParams): boolean {
  for (const [clave, valor] of params) {
    if (["select", "order", "limit", "offset"].includes(clave)) continue;
    if (clave === "events.or") {
      if (!partirPorComas(sinParentesis(valor)).some((c) => cumpleCondicion(c, fila.events))) return false;
    } else if (clave.startsWith("events.")) {
      if (!cumpleCondicion(`${clave.slice("events.".length)}.${valor}`, fila.events)) return false;
    } else if (clave === "paid_at") {
      // Fechas ISO en UTC con el mismo formato: se ordenan como texto.
      const [operador, ...resto] = valor.split(".");
      const limite = resto.join(".");
      if (operador === "gte" && !(fila.paid_at >= limite)) return false;
      if (operador === "lt" && !(fila.paid_at < limite)) return false;
    } else if (!cumpleCondicion(`${clave}.${valor}`, fila as unknown as Record<string, unknown>)) {
      return false;
    }
  }
  return true;
}

function ordenarPorUrl(filas: EntradaInforme[], orden: string | null): EntradaInforme[] {
  if (!orden) return filas;
  const criterios = orden.split(",").map((c) => {
    const [columna, sentido] = c.split(".");
    return { columna: columna as keyof EntradaInforme, desc: sentido === "desc" };
  });
  return [...filas].sort((a, b) => {
    for (const { columna, desc } of criterios) {
      const va = String(a[columna]);
      const vb = String(b[columna]);
      if (va !== vb) return (va < vb ? -1 : 1) * (desc ? -1 : 1);
    }
    return 0;
  });
}

/**
 * Las lecturas de tickets de los informes (las que embeben events con !inner):
 * filtran, ordenan y paginan como PostgREST, con su tope de 1.000 filas, y se
 * apuntan. Los títulos de los eventos los contesta la misma simulación.
 */
async function simularEntradas(
  page: Page,
  tabla: EntradaInforme[],
  titulos: Record<string, string> = { [IDS.eventoHoy]: "Noche E2E" },
): Promise<EntradasSimuladas> {
  const estado: EntradasSimuladas = { peticiones: [], fallo: null, retraso: null, alServir: null };
  const ordenadas = new Map<string, EntradaInforme[]>();

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/tickets",
    async (route) => {
      const req = route.request();
      const params = new URL(req.url()).searchParams;
      const columnas = params.get("select") ?? "";
      if (req.method() !== "GET" || !columnas.includes("events!inner")) return route.fallback();

      // paid_at=gte.<fecha> y paid_at=lt.<fecha>: las fechas llevan puntos (milisegundos).
      const fechas = params.getAll("paid_at").map((f) => f.split("."));
      const limiteDe = (operador: string) => fechas.find(([op]) => op === operador)?.slice(1).join(".") ?? null;
      const pagadaAntesDe = limiteDe("lt");
      const desde = Number(params.get("offset") ?? 0);
      const pedidas = Number(params.get("limit") ?? MAX_FILAS_POSTGREST);
      const peticion: PeticionEntradas = {
        desde,
        limite: pedidas,
        orden: params.get("order"),
        filtroEventos: params.get("events.or"),
        columnas,
        pagadaDesde: limiteDe("gte"),
        pagadaAntesDe,
        previo: pagadaAntesDe !== null && Date.parse(pagadaAntesDe) <= AHORA_INFORMES,
      };
      estado.peticiones.push(peticion);

      const retraso = estado.retraso?.(peticion) ?? 0;
      if (retraso > 0) await new Promise((resolver) => setTimeout(resolver, retraso));
      const fallo = estado.fallo?.(peticion);
      if (fallo) {
        await responderPostgrest(route, { code: fallo.code, message: fallo.message, details: null, hint: null }, fallo.status);
        return;
      }
      // La tabla no cambia durante el test: filtrar y ordenar una vez por consulta (sin offset ni limit).
      const consulta = [...params].filter(([k]) => k !== "offset" && k !== "limit").join("&");
      let filas = ordenadas.get(consulta);
      if (!filas) {
        filas = ordenarPorUrl(
          tabla.filter((f) => cumpleFiltros(f, params)),
          peticion.orden,
        );
        ordenadas.set(consulta, filas);
      }
      const completo = filas.slice(desde, desde + Math.min(pedidas, MAX_FILAS_POSTGREST));
      const lote = estado.alServir ? estado.alServir(peticion, completo) : completo;
      await responderPostgrest(route, lote, 200, {
        "content-range": lote.length ? `${desde}-${desde + lote.length - 1}/*` : "*/0",
      });
    },
  );

  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/events",
    async (route) => {
      const req = route.request();
      const params = new URL(req.url()).searchParams;
      // Solo «id, title» (los títulos de los informes); la lista de eventos la contesta el falso.
      if (req.method() !== "GET" || (params.get("select") ?? "").replace(/\s/g, "") !== "id,title") return route.fallback();
      const ids = partirPorComas(sinParentesis((params.get("id") ?? "").replace(/^in\./, "")));
      const filas = Object.entries(titulos)
        .filter(([id]) => ids.includes(id))
        .map(([id, title]) => ({ id, title }));
      await responderPostgrest(route, filas);
    },
  );

  return estado;
}

/** Abre Métricas con el reloj parado en AHORA_INFORMES y `tabla` como tickets vendidos. */
async function abrirInformes(page: Page, tabla: EntradaInforme[], titulos?: Record<string, string>) {
  let entradas!: EntradasSimuladas;
  const panel = await abrirPanel(page, {}, async () => {
    await page.clock.setFixedTime(AHORA_INFORMES);
    entradas = await simularEntradas(page, tabla, titulos);
  });
  return { panel, entradas };
}

/** Elige otro periodo en el selector de los informes. */
async function elegirPeriodo(page: Page, etiqueta: "7 días" | "30 días" | "90 días" | "Año") {
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: etiqueta, exact: true }).click();
}

/** Lo que enseñan los informes, por testid, rol y texto. */
const informe = (page: Page) => ({
  entradas: page.getByTestId("kpi-entradas-valor"),
  recaudado: page.getByTestId("kpi-recaudado-valor"),
  deltaEntradas: page.getByTestId("kpi-entradas-delta"),
  deltaRecaudado: page.getByTestId("kpi-recaudado-delta"),
  grafica: page.getByTestId("grafica-ventas"),
  incompleto: page.getByRole("alert").filter({ hasText: "Informe incompleto" }),
  parcial: page.getByRole("status").filter({ hasText: "Informe parcial" }),
  desactualizado: page.getByRole("status").filter({ hasText: "El informe no se ha podido actualizar" }),
  sinVentas: page.getByText("Aún no hay ventas"),
});

/** Pares [offset, limit] de las páginas pedidas, del periodo o del previo. */
const paginasPedidas = (entradas: EntradasSimuladas, previo: boolean) =>
  entradas.peticiones.filter((p) => p.previo === previo).map((p) => [p.desde, p.limite]);

/** 1.500 ventas de 10 € en el periodo de 30 días y 1.200 de 5 € en el previo, más lo que no cuenta. */
function ventasDeMasDeMil(): EntradaInforme[] {
  const periodo = Array.from({ length: 1_500 }, (_, i) =>
    entrada(i + 1, AHORA_INFORMES - HORA_MS - (i % 25) * DIA_MS),
  );
  const previo = Array.from({ length: 1_200 }, (_, i) =>
    entrada(10_000 + i, AHORA_INFORMES - (31 + (i % 25)) * DIA_MS, { amount_paid_cents: 500 }),
  );
  const noCuentan = [
    // Reembolsadas dentro del periodo y ventas anteriores al periodo previo.
    ...Array.from({ length: 10 }, (_, i) => entrada(20_000 + i, AHORA_INFORMES - DIA_MS, { status: "refunded" })),
    ...Array.from({ length: 10 }, (_, i) => entrada(30_000 + i, AHORA_INFORMES - 90 * DIA_MS)),
  ];
  // Desordenadas a propósito: el orden lo pide la app (order=created_at,id).
  return [...noCuentan, ...previo, ...periodo];
}

test.describe("informes del local", () => {
  test("más de mil ventas: se leen en páginas y suman completas, también en el periodo previo y en el CSV", async ({
    page,
  }) => {
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);

    // Con una sola página (el corte de PostgREST) saldrían 1.000 ventas y 10.000 €.
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });
    await expect(ver.recaudado).toHaveText("15.000€");
    // El periodo previo (1.200 ventas de 5 €) también se lee entero: +25 % de ventas y +150 % de ingresos.
    await expect(ver.deltaEntradas).toHaveText("25%");
    await expect(ver.deltaRecaudado).toHaveText("150%");
    await expect(ver.grafica).toHaveAttribute("data-dias", "30");
    await expect(ver.grafica).toHaveAttribute("data-entradas", "1500");
    await expect(ver.grafica).toHaveAttribute("data-ingresos-cents", "1500000");
    await expect(ver.incompleto).toHaveCount(0);
    await expect(ver.parcial).toHaveCount(0);

    // Dos páginas de mil por periodo (la segunda trae el resto, así que no hay tercera), con orden estable.
    expect(paginasPedidas(entradas, false), "Páginas del periodo").toEqual([[0, 1_000], [1_000, 1_000]]);
    expect(paginasPedidas(entradas, true), "Páginas del periodo previo").toEqual([[0, 1_000], [1_000, 1_000]]);
    expect(new Set(entradas.peticiones.map((p) => p.orden))).toEqual(new Set(["created_at.asc,id.asc"]));

    // El CSV lleva las mismas 1.500 ventas y suman lo mismo que los KPIs.
    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar CSV" }).click(),
    ]);
    expect(descarga.suggestedFilename()).toBe("pasify-ventas-30d-2026-04-01.csv");
    const csv = await readFile((await descarga.path()) as string, "utf8");
    expect(csv.charCodeAt(0), "El CSV sigue empezando por el BOM de UTF-8").toBe(0xfeff);
    const lineas = csv.slice(1).split("\r\n");
    expect(lineas, "Cabecera y una fila por venta").toHaveLength(1_501);
    const importes = lineas.slice(1).map((l) => Number(l.split(";")[2].replace(",", ".")));
    expect(importes.reduce((suma, importe) => suma + importe, 0)).toBe(15_000);
    await comprobarSinFallos(page, panel, "en los informes de más de mil ventas");
  });

  test("las ventas de los eventos de la organización cuentan aunque los creara otro miembro; las de otro local, no", async ({
    page,
  }) => {
    const eventos = {
      propio: { id: "5e2e0000-0000-4000-8000-0000000000e1", partner_id: IDS.usuario, org_id: null, titulo: "Fiesta propia sin organización" },
      companero: { id: "5e2e0000-0000-4000-8000-0000000000e2", partner_id: COMPANERO, org_id: IDS.org, titulo: "Noche del compañero" },
      ajeno: { id: "5e2e0000-0000-4000-8000-0000000000e3", partner_id: COMPANERO, org_id: OTRA_ORG, titulo: "Evento de otro local" },
    };
    const venta = (n: number, evento: (typeof eventos)[keyof typeof eventos], cents: number) =>
      entrada(n, AHORA_INFORMES - n * HORA_MS, {
        event_id: evento.id,
        amount_paid_cents: cents,
        events: { partner_id: evento.partner_id, org_id: evento.org_id },
      });
    const tabla = [
      venta(1, eventos.propio, 1_500),
      venta(2, eventos.propio, 1_500),
      venta(3, eventos.companero, 2_000),
      venta(4, eventos.companero, 2_500),
      venta(5, eventos.ajeno, 9_900),
      venta(6, eventos.ajeno, 9_900),
    ];
    const titulos = Object.fromEntries(Object.values(eventos).map((e) => [e.id, e.titulo]));
    const { panel, entradas } = await abrirInformes(page, tabla, titulos);
    const ver = informe(page);

    // Antes solo contaban las del propio creador (2 ventas, 30 €).
    await expect(ver.entradas).toHaveText("4", { timeout: 60_000 });
    await expect(ver.recaudado).toHaveText("75€");
    await expect(ver.grafica).toHaveAttribute("data-entradas", "4");
    const top = page.locator("article").filter({ has: page.getByText("Top eventos") });
    await expect(top).toContainText("Noche del compañero");
    await expect(top).toContainText("Fiesta propia sin organización");
    await expect(page.getByText("Evento de otro local")).toHaveCount(0);

    // Mismo criterio que «Mis eventos»: partner_id del usuario o org_id de sus organizaciones.
    const primera = entradas.peticiones[0];
    expect(primera.filtroEventos).toBe(`(partner_id.eq.${IDS.usuario},org_id.in.(${IDS.org}))`);
    expect(primera.columnas).toContain("events!inner(partner_id,org_id)");
    await comprobarSinFallos(page, panel, "en los informes de la organización");
  });

  test("si falla una página no hay cifras a medias: «Informe incompleto» y, al reintentar, el informe entero", async ({
    page,
  }) => {
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });

    // La segunda página del periodo se cae (statement timeout) mientras se cambia de periodo.
    entradas.fallo = (p) =>
      !p.previo && p.desde >= 1_000
        ? { status: 500, code: "57014", message: "canceling statement due to statement timeout" }
        : null;
    await elegirPeriodo(page, "90 días");

    // La app reintenta antes de rendirse; entonces, ni una cifra: ni KPIs, ni gráfica, ni «sin ventas».
    await expect(ver.incompleto).toBeVisible({ timeout: 30_000 });
    await expect(ver.incompleto).toContainText("statement timeout");
    await expect(ver.entradas).toHaveCount(0);
    await expect(ver.grafica).toHaveCount(0);
    await expect(ver.sinVentas).toHaveCount(0);
    await expect(page.getByText(/Datos reales · \d+ tickets?/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();

    // Reintentar con la base ya sana lee el periodo entero: 90 días son las 1.500 de 10 € y las 1.200 de 5 €, en tres páginas.
    entradas.fallo = null;
    entradas.peticiones.length = 0;
    await ver.incompleto.getByRole("button", { name: "Reintentar" }).click();
    await expect(ver.entradas).toHaveText("2700", { timeout: 30_000 });
    await expect(ver.recaudado).toHaveText("21.000€");
    await expect(ver.grafica).toHaveAttribute("data-dias", "90");
    await expect(ver.incompleto).toHaveCount(0);
    expect(paginasPedidas(entradas, false)).toEqual([[0, 1_000], [1_000, 1_000], [2_000, 1_000]]);
    await comprobarSinFallos(page, panel, "al reintentar el informe");
  });

  test("si falla la lectura del periodo previo, tampoco hay cifras: antes se ignoraba y el delta salía falso", async ({
    page,
  }) => {
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });

    entradas.fallo = (p) => (p.previo ? { status: 403, code: "42501", message: "permission denied for table tickets" } : null);
    await page.reload();

    await expect(ver.incompleto).toBeVisible({ timeout: 60_000 });
    await expect(ver.entradas).toHaveCount(0);
    await expect(ver.sinVentas).toHaveCount(0);
    await comprobarSinFallos(page, panel, "con el periodo previo caído");
  });

  test("una venta que sale en dos páginas porque cambia de sitio mientras se lee se cuenta una vez", async ({ page }) => {
    // Entre la primera y la segunda página se paga una reserva y la última venta de la primera
    // vuelve a salir al principio de la segunda (la lectura es por offsets).
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });

    let ultimaDeLaPrimera: EntradaInforme | undefined;
    entradas.alServir = (p, lote) => {
      if (p.previo) return lote;
      if (p.desde === 0) ultimaDeLaPrimera = lote.at(-1);
      return p.desde === 1_000 && ultimaDeLaPrimera ? [ultimaDeLaPrimera, ...lote] : lote;
    };
    await page.reload();

    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });
    await expect(ver.recaudado).toHaveText("15.000€");
    await expect(ver.grafica).toHaveAttribute("data-entradas", "1500");
    expect(ultimaDeLaPrimera, "Se repitió una venta en la segunda página").toBeDefined();
    await comprobarSinFallos(page, panel, "con una venta repetida entre páginas");
  });

  test("si una lectura falla, la otra no sigue pidiendo páginas de un informe que ya no vale", async ({ page }) => {
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });

    // La segunda página del periodo falla al momento; el previo tarda en dar la primera.
    entradas.fallo = (p) =>
      !p.previo && p.desde >= 1_000 ? { status: 403, code: "42501", message: "permission denied for table tickets" } : null;
    entradas.retraso = (p) => (p.previo ? 1_500 : 0);
    entradas.peticiones.length = 0;
    await page.reload();

    await expect(ver.incompleto).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2_500); // por si el previo aún pidiera su segunda página
    expect(paginasPedidas(entradas, false), "Páginas del periodo").toEqual([[0, 1_000], [1_000, 1_000]]);
    expect(paginasPedidas(entradas, true), "Páginas del previo: solo la que ya estaba en vuelo").toEqual([[0, 1_000]]);
    await comprobarSinFallos(page, panel, "con el periodo caído");
  });

  test("si no se saben las organizaciones del usuario no se lee con medio filtro: «Informe incompleto»", async ({
    page,
  }) => {
    let consultasDeOrganizaciones = 0;
    let entradas!: EntradasSimuladas;
    const panel = await abrirPanel(page, {}, async () => {
      await page.clock.setFixedTime(AHORA_INFORMES);
      entradas = await simularEntradas(page, ventasDeMasDeMil());
      // Solo falla la consulta de membresías de orgIdsDelLocal (select=org_id); la usa también «Mis eventos», que sigue con lo suyo.
      await page.route(
        (url) => url.origin === ORIGEN_SUPABASE && url.pathname === "/rest/v1/organization_members",
        async (route) => {
          const req = route.request();
          const select = new URL(req.url()).searchParams.get("select") ?? "";
          if (req.method() !== "GET" || select !== "org_id") return route.fallback();
          consultasDeOrganizaciones++;
          await responderPostgrest(
            route,
            { code: "42501", message: "permission denied for table organization_members", details: null, hint: null },
            403,
          );
        },
      );
    });
    const ver = informe(page);

    await expect(ver.incompleto).toBeVisible({ timeout: 60_000 });
    await expect(ver.entradas).toHaveCount(0);
    expect(consultasDeOrganizaciones, "Se preguntó por las organizaciones").toBeGreaterThan(0);
    // Sin organizaciones, filtrar solo por partner_id habría dado el informe de otro alcance sin avisar.
    expect(entradas.peticiones, "Lecturas de tickets").toEqual([]);
    await comprobarSinFallos(page, panel, "sin saber las organizaciones");
  });

  test("con un informe a la vista, un refresco fallido lo deja y avisa; reintentar lo quita", async ({ page }) => {
    const { panel, entradas } = await abrirInformes(page, ventasDeMasDeMil());
    const ver = informe(page);
    await expect(ver.entradas).toHaveText("1500", { timeout: 60_000 });

    // Pasa más de la mitad de un minuto (los datos caducan a los 30 s) y la próxima lectura falla.
    entradas.fallo = () => ({ status: 403, code: "42501", message: "permission denied for table tickets" });
    await page.clock.setFixedTime(AHORA_INFORMES + 60_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));

    await expect(ver.desactualizado).toBeVisible({ timeout: 30_000 });
    // El informe de antes sigue ahí, completo, y no se tapa con «incompleto».
    await expect(ver.entradas).toHaveText("1500");
    await expect(ver.incompleto).toHaveCount(0);

    entradas.fallo = null;
    await ver.desactualizado.getByRole("button", { name: "Reintentar" }).click();
    await expect(ver.desactualizado).toHaveCount(0, { timeout: 30_000 });
    await expect(ver.entradas).toHaveText("1500");
    await comprobarSinFallos(page, panel, "tras reintentar el refresco");
  });

  test("con más de 50.000 ventas se para en el tope de páginas y el informe sale como parcial", async ({ page }) => {
    // 60.000 ventas de 10 € en el periodo: la app lee 50 páginas de mil y avisa; no pide la 51.
    const tabla = Array.from({ length: 60_000 }, (_, i) =>
      entrada(i + 1, AHORA_INFORMES - HORA_MS - (i % 25) * DIA_MS),
    );
    const { panel, entradas } = await abrirInformes(page, tabla);
    const ver = informe(page);

    await expect(ver.entradas).toHaveText("50000", { timeout: 120_000 });
    await expect(ver.parcial).toBeVisible();
    await expect(ver.parcial).toContainText("más de 50.000 ventas");
    await expect(ver.recaudado).toHaveText("500.000€");
    // Con el periodo a medias, un delta contra el previo sería falso: no se enseña.
    await expect(ver.deltaEntradas).toHaveCount(0);
    await expect(ver.deltaRecaudado).toHaveCount(0);
    expect(paginasPedidas(entradas, false)).toHaveLength(50);
    expect(paginasPedidas(entradas, false).at(-1)).toEqual([49_000, 1_000]);
    await comprobarSinFallos(page, panel, "con más de 50.000 ventas");
  });

  test.describe("con el navegador en Auckland", () => {
    // Allí ya es jueves 2 de abril: los días y las horas siguen siendo los de Madrid, como en el CSV.
    test.use({ timezoneId: "Pacific/Auckland" });

    test("la ventana, la gráfica, los KPIs, el heatmap y el delta cuentan días de Madrid", async ({ page }) => {
      const tabla = [
        // Periodo: 7 días, de jueves 26 de marzo a miércoles 1 de abril, hora de Madrid.
        entrada(1, "2026-03-25T23:00:00Z", { amount_paid_cents: 1_000 }), // jue 26, 00:00: primer segundo
        entrada(2, "2026-03-26T22:59:59Z", { amount_paid_cents: 2_000 }), // jue 26, 23:59
        entrada(3, "2026-03-28T23:30:00Z", { amount_paid_cents: 3_000 }), // dom 29, 00:30 (CET)
        entrada(4, "2026-03-29T00:30:00Z", { amount_paid_cents: 4_000 }), // dom 29, 01:30 (CET), antes del cambio de hora
        entrada(5, "2026-03-29T21:30:00Z", { amount_paid_cents: 5_000 }), // dom 29, 23:30 (CEST)
        entrada(6, "2026-03-29T22:00:00Z", { amount_paid_cents: 6_000 }), // lun 30, 00:00 (CEST)
        entrada(7, "2026-04-01T21:00:00Z", { amount_paid_cents: 7_000, status: "used", used_at: "2026-04-01T21:10:00Z" }), // mié 1, 23:00
        // Mañana en Madrid (ya jueves 2 a las 00:00): ni en el periodo ni en el previo.
        entrada(8, "2026-04-01T22:00:00Z", { amount_paid_cents: 8_000 }),
        // Periodo previo: del jueves 19 al miércoles 25.
        entrada(9, "2026-03-25T22:59:59Z", { amount_paid_cents: 1_500 }), // mié 25, 23:59: último segundo
        entrada(10, "2026-03-18T23:00:00Z", { amount_paid_cents: 2_500 }), // jue 19, 00:00: primer segundo
        // Un segundo antes del previo.
        entrada(11, "2026-03-18T22:59:59Z", { amount_paid_cents: 9_900 }),
      ];
      const { panel, entradas } = await abrirInformes(page, tabla);
      const ver = informe(page);

      // Elegir «7 días» (por defecto salen 30) y esperar a que la gráfica sea de 7 columnas.
      await expect(ver.entradas).toBeVisible({ timeout: 60_000 });
      await elegirPeriodo(page, "7 días");
      await expect(ver.grafica).toHaveAttribute("data-dias", "7", { timeout: 30_000 });

      // Límites del periodo y del previo: medianoches de Madrid, no del navegador.
      const sinRepetir = (valores: Array<string | null>) => [...new Set(valores)];
      expect(
        sinRepetir(entradas.peticiones.filter((p) => !p.previo && p.pagadaDesde === "2026-03-25T23:00:00.000Z").map((p) => p.pagadaAntesDe)),
      ).toEqual(["2026-04-01T22:00:00.000Z"]);
      expect(
        sinRepetir(entradas.peticiones.filter((p) => p.previo && p.pagadaAntesDe === "2026-03-25T23:00:00.000Z").map((p) => p.pagadaDesde)),
      ).toEqual(["2026-03-18T23:00:00.000Z"]);

      // Los KPIs, la gráfica y el delta salen de las mismas 7 ventas del periodo y 2 del previo.
      await expect(ver.entradas).toHaveText("7");
      await expect(ver.recaudado).toHaveText("280€");
      await expect(ver.deltaEntradas).toHaveText("250%");
      await expect(ver.deltaRecaudado).toHaveText("600%");
      await expect(page.getByText("1/7 usados")).toBeVisible();
      await expect(ver.grafica).toHaveAttribute("data-entradas", "7");
      await expect(ver.grafica).toHaveAttribute("data-ingresos-cents", "28000");
      // Una columna por día de Madrid: el domingo del cambio de hora lleva tres ventas y el lunes, la de las 00:00.
      await expect(ver.grafica).toHaveAttribute(
        "data-serie",
        [
          "2026-03-26:2:3000",
          "2026-03-27:0:0",
          "2026-03-28:0:0",
          "2026-03-29:3:12000",
          "2026-03-30:1:6000",
          "2026-03-31:0:0",
          "2026-04-01:1:7000",
        ].join(" "),
      );
      await expect(ver.grafica).toContainText("26 mar");
      await expect(ver.grafica).toContainText("1 abr");

      // Heatmap en hora de Madrid (con la del navegador, la venta de las 00:00 del lunes saldría el domingo).
      for (const celda of ["Jue 0h", "Jue 23h", "Dom 0h", "Dom 1h", "Dom 23h", "Lun 0h", "Mié 23h"]) {
        await expect(page.locator(`[title="${celda} · 1"]`), celda).toHaveCount(1);
      }
      await expect(page.locator('[title$=" · 1"]')).toHaveCount(7);

      // «Año» empieza el 1 de enero en Madrid (antes arrancaba el 31 de diciembre) y tiene 91 días hasta hoy.
      await elegirPeriodo(page, "Año");
      await expect(ver.grafica).toHaveAttribute("data-dias", "91", { timeout: 30_000 });
      await expect(ver.grafica).toContainText("1 ene");
      expect(entradas.peticiones.some((p) => !p.previo && p.pagadaDesde === "2025-12-31T23:00:00.000Z")).toBe(true);
      await expect(ver.entradas).toHaveText("10"); // las 7 del periodo + 3 de marzo; la de mañana sigue fuera
      await comprobarSinFallos(page, panel, "en los informes con el navegador en Auckland");
    });
  });

  test("la ventana de días de Madrid: límites, cambios de hora y «Año»", () => {
    // Primavera: el domingo 29 de marzo dura 23 horas y entra en la ventana.
    expect(ventanaDelInforme(7, new Date("2026-04-01T21:30:00Z"))).toEqual({
      dias: 7,
      primerDia: "2026-03-26",
      ultimoDia: "2026-04-01",
      inicio: "2026-03-25T23:00:00.000Z", // 26/03 00:00 CET
      fin: "2026-04-01T22:00:00.000Z", // 02/04 00:00 CEST
      inicioPrevio: "2026-03-18T23:00:00.000Z", // 19/03 00:00 CET
    });
    // Otoño: el domingo 25 de octubre dura 25 horas.
    expect(ventanaDelInforme(3, new Date("2026-10-26T12:00:00Z"))).toEqual({
      dias: 3,
      primerDia: "2026-10-24",
      ultimoDia: "2026-10-26",
      inicio: "2026-10-23T22:00:00.000Z", // 24/10 00:00 CEST
      fin: "2026-10-26T23:00:00.000Z", // 27/10 00:00 CET
      inicioPrevio: "2026-10-20T22:00:00.000Z", // 21/10 00:00 CEST
    });
    // Un periodo de n días tiene n días y el previo, los n anteriores: acaba donde empieza el periodo.
    const v = ventanaDelInforme(30, new Date("2026-06-15T10:00:00Z"));
    expect([v.primerDia, v.ultimoDia]).toEqual(["2026-05-17", "2026-06-15"]);
    expect(Date.parse(v.fin) - Date.parse(v.inicio)).toBe(30 * 86_400_000);
    expect(Date.parse(v.inicio) - Date.parse(v.inicioPrevio)).toBe(30 * 86_400_000);

    // A las 00:30 del 1 de enero en Madrid ya es el año nuevo (en UTC aún es 31 de diciembre).
    expect(diasDesdeEnero(new Date("2026-12-31T23:30:00Z"))).toBe(1);
    expect(diasDesdeEnero(new Date("2026-03-01T12:00:00Z"))).toBe(60);
    expect(diasDesdeEnero(new Date("2026-10-11T10:00:00Z"))).toBe(284);

    expect(momentoEnMadrid("2026-03-29T22:00:00Z")).toEqual({ dia: "2026-03-30", hora: 0, diaSemana: 1 });
    expect(momentoEnMadrid("2026-10-25T23:30:00Z")).toEqual({ dia: "2026-10-26", hora: 0, diaSemana: 1 });
    expect(momentoEnMadrid(null)).toBeNull();
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
