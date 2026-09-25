import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
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
