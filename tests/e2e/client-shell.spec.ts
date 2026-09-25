import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import {
  FAKE_SUPABASE_URL,
  IDS,
  instalarSupabaseFalso,
  simularAppNativa,
  type SupabaseFalso,
} from "./support/fake-supabase";

/**
 * Smoke de la app del cliente (/#/client-dashboard) sin backend real.
 *
 * Mismo Supabase simulado que el panel de local (support/fake-supabase.ts),
 * con la sesión sembrada del usuario de pruebas; aquí, además, ese usuario es
 * CLIENTE (get_user_roles) y tiene sus propios datos: locales, entradas (una
 * válida, una usada, una de un evento cancelado y una reembolsada), favoritos
 * (uno próximo y uno pasado) y puntos con niveles que traen ventajas.
 *
 * Lo que se protege (auditoría, Ola 1 del cliente):
 *   - D-7: En vivo, Concierge y las recomendaciones inventadas de la home solo
 *     existen en modo demo (flag client_showcase), en la web y con la franja
 *     "DEMO · datos ficticios". Sin demo no están en el menú y su URL lleva a
 *     Inicio. En la app nativa, nunca. Ni con demo se citan marcas reales.
 *   - Sin demo no aparece nada de lo que se prometía sin tenerlo:
 *     "Próximamente", "amigos tuyos", "Curado por IA", ventajas de nivel…
 *   - Cartera con estados reales: evento cancelado sin QR, reembolsadas en su
 *     sección plegada. Favoritos separados en Próximos y Pasados.
 *   - Ajustes de la cuenta se abre desde el perfil.
 *
 * Ola 2 del cliente:
 *   - B2-03: el corazón de los locales guarda (partner_favorites.partner_id)
 *     y el local sale en Favoritos · Locales.
 *   - B2-10: una sola ciudad, la del perfil (Madrid), filtra los locales y los
 *     próximos eventos de Inicio; «Toda España» la quita y se guarda en el
 *     perfil. Editar perfil la enseña.
 *   - Cartera: «Reenviar email» (Enviado / Espera un poco), «Enviar a un
 *     amigo» (y después «Transferencia pendiente») y la devolución según la
 *     política del tipo (con fecha límite o «Sin devolución»).
 *
 * Corre con la config del panel (arranca Vite con el Supabase falso, un
 * worker, hora de Madrid y sin service worker): va en su `testMatch` y en el
 * `testIgnore` de playwright.config.ts (su proyecto "mobile" no tiene barra
 * lateral).
 *   npm run test:e2e:partner
 *   npx playwright test -c playwright.partner.config.ts client-shell
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

/** Pantallas de error: boundary global (main.tsx) y de sección. */
const TEXTO_DE_FALLO = /Algo no ha ido bien|Algo ha ido mal|Esta sección ha fallado|Wallet temporalmente no disponible/;

/** Nunca, ni en la demo: marcas y locales reales. */
const MARCAS_REALES = /Pacha|Razzmatazz|Ushua|Solomun|Sala Apolo/i;

/** Sin modo demo, además: lo que se prometía sin existir. */
const PROMESAS_SIN_DEMO =
  /Pacha|Razzmatazz|amigos tuyos|Próximamente|Curado por IA|DEMO · datos ficticios|descuento|5\s?€ para los dos|≈\s?5\s?€/i;

/** Vistas que cualquier cliente ve siempre (etiquetas del menú). */
const VISTAS_BASICAS = ["Inicio", "Favoritos", "Tickets", "Pasify Points", "Soporte"];
/** Maquetas (solo modo demo). */
const MAQUETAS = ["En vivo", "Concierge"];

const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Datos del cliente
// ---------------------------------------------------------------------------

const C = {
  local1: "c11e0000-0000-4000-8000-0000000000a1",
  local2: "c11e0000-0000-4000-8000-0000000000a2",
  /** En Barcelona: con la ciudad del perfil (Madrid) no sale en Inicio. */
  local3: "c11e0000-0000-4000-8000-0000000000a3",
  eventoProximo: "c11e0000-0000-4000-8000-0000000000e1",
  eventoPasado: "c11e0000-0000-4000-8000-0000000000e2",
  eventoCancelado: "c11e0000-0000-4000-8000-0000000000e3",
  eventoReembolsado: "c11e0000-0000-4000-8000-0000000000e4",
  eventoGala: "c11e0000-0000-4000-8000-0000000000e5",
  eventoBarcelona: "c11e0000-0000-4000-8000-0000000000e6",
  /** Devolución hasta 24 h antes; se puede transferir. */
  tipoConDevolucion: "c11e0000-0000-4000-8000-0000000000f1",
  /** Sin devolución (refundable_until_hours_before NULL). */
  tipoSinDevolucion: "c11e0000-0000-4000-8000-0000000000f2",
  pedido1: "c11e0000-0000-4000-8000-0000000000d1",
  pedido5: "c11e0000-0000-4000-8000-0000000000d5",
  transferencia5: "c11e0000-0000-4000-8000-0000000000c5",
} as const;

/** Entrada válida con devolución (Noche Futura) y la de la gala, con una transferencia pendiente. */
const ENTRADA_1 = "c11e0000-0000-4000-8000-000000000101";
const ENTRADA_5 = "c11e0000-0000-4000-8000-000000000105";

function datosCliente(ahora: number) {
  const locales = [
    {
      id: C.local1,
      business_name: "Sala Aurora E2E",
      business_category: "club",
      city: "Madrid",
      avatar_url: null,
      cover_image_url: null,
    },
    {
      id: C.local2,
      business_name: "Teatro Lumen E2E",
      business_category: "teatro",
      city: "Madrid",
      avatar_url: null,
      cover_image_url: null,
    },
    {
      id: C.local3,
      business_name: "Club Mar E2E",
      business_category: "club",
      city: "Barcelona",
      avatar_url: null,
      cover_image_url: null,
    },
  ];

  const evento = <T extends { id: string; title: string; date_start: string; status: string }>(e: T) => ({
    description: null,
    city: "Madrid",
    venue_name: null,
    address: null,
    image_url: null,
    partner_id: C.local1,
    price_cents: 1500,
    currency: "eur",
    capacity: 200,
    tickets_sold: 20,
    category: null,
    date_end: null,
    ...e,
  });
  const eventos = [
    evento({ id: C.eventoProximo, title: "Noche Futura E2E", date_start: iso(ahora + 3 * D), status: "published" }),
    evento({ id: C.eventoPasado, title: "Fiesta Pasada E2E", date_start: iso(ahora - 10 * D), status: "past" }),
    evento({ id: C.eventoCancelado, title: "Concierto Cancelado E2E", date_start: iso(ahora + 5 * D), status: "cancelled" }),
    evento({ id: C.eventoReembolsado, title: "Sesión Reembolsada E2E", date_start: iso(ahora + 8 * D), status: "published", partner_id: C.local2 }),
    evento({ id: C.eventoGala, title: "Gala Sin Devolución E2E", date_start: iso(ahora + 6 * D), status: "published" }),
    evento({
      id: C.eventoBarcelona,
      title: "Fiesta Mar E2E",
      date_start: iso(ahora + 4 * D),
      status: "published",
      partner_id: C.local3,
      city: "Barcelona",
    }),
  ];

  const entrada = (n: number, eventId: string, status: string, extra: Record<string, unknown> = {}) => ({
    id: `c11e0000-0000-4000-8000-00000000010${n}`,
    event_id: eventId,
    tier_id: null,
    qr_token: `c11e0000-0000-4000-8000-00000000020${n}`,
    status,
    buyer_user_id: IDS.usuario,
    transferred_to_user_id: null,
    buyer_first_name: "Clara",
    buyer_last_name: "E2E",
    buyer_email: "local@e2e.pasify.test",
    holder_first_name: null,
    holder_last_name: null,
    holder_email: null,
    amount_paid_cents: 1500,
    used_at: null,
    paid_at: iso(ahora - 2 * D - n * H),
    ...extra,
  });
  const entradas = [
    entrada(1, C.eventoProximo, "paid", { tier_id: C.tipoConDevolucion, order_id: C.pedido1 }),
    entrada(2, C.eventoPasado, "used", { used_at: iso(ahora - 10 * D + H) }),
    entrada(3, C.eventoCancelado, "paid"),
    entrada(4, C.eventoReembolsado, "refunded"),
    entrada(5, C.eventoGala, "paid", { tier_id: C.tipoSinDevolucion, order_id: C.pedido5 }),
  ];

  // Política de los tipos (lo que lee la cartera de ticket_tiers).
  const tipos = [
    { id: C.tipoConDevolucion, name: "Anticipada", transfer_allowed: true, refundable_until_hours_before: 24 },
    { id: C.tipoSinDevolucion, name: "Gala", transfer_allowed: true, refundable_until_hours_before: null },
  ];

  // favorites_v2 con el evento embebido (events!inner(...)).
  const favoritos = [C.eventoProximo, C.eventoPasado].map((id, i) => ({
    event_id: id,
    created_at: iso(ahora - (i + 1) * D),
    events: eventos.find((e) => e.id === id),
  }));

  // Niveles CON ventajas: la pantalla no debe enseñarlas (D-5).
  const niveles = [
    { id: "c11e0000-0000-4000-8000-0000000000b1", code: "bronze", name: "Bronze", min_points: 0, color: "#B8763C", sort_order: 1, perks: ["Newsletter prioritaria"] },
    { id: "c11e0000-0000-4000-8000-0000000000b2", code: "silver", name: "Silver", min_points: 500, color: "#C9C9C9", sort_order: 2, perks: ["10% descuento puerta"] },
    { id: "c11e0000-0000-4000-8000-0000000000b3", code: "platinum", name: "Platinum", min_points: 5000, color: "#E8E1D4", sort_order: 4, perks: ["Acceso VIP gratis"] },
  ];
  const movimientos = [
    {
      id: "c11e0000-0000-4000-8000-0000000000c1",
      change_amount: 150,
      reason: "Compra de entradas",
      reason_code: "purchase",
      balance_after: 750,
      expires_at: null,
      created_at: iso(ahora - 10 * D),
      event_id: C.eventoPasado,
      events: { title: "Fiesta Pasada E2E" },
    },
  ];

  return { locales, eventos, entradas, tipos, favoritos, niveles, movimientos };
}

/**
 * Lo que el cliente escribe durante el test (el Supabase simulado no guarda
 * nada): locales favoritos, ciudad del perfil, transferencias y reenvíos. Así
 * un refresco tras guardar devuelve lo guardado, como el servidor de verdad.
 */
interface EstadoCliente {
  localesFavoritos: { partner_id: string; created_at: string }[];
  ciudad: string | null;
  cambiosPerfil: Record<string, unknown>[];
  transferencias: { id: string; ticket_id: string; expires_at: string; created_at: string }[];
  envios: Record<string, unknown>[];
  /** order_id de cada «Reenviar email». */
  reenvios: unknown[];
}

// ---------------------------------------------------------------------------
// Rutas propias encima del Supabase falso (las registradas después ganan)
// ---------------------------------------------------------------------------

type Manejador = (req: Request, url: URL, args: Record<string, unknown>) => unknown;

async function responder(page: Page, ruta: string, manejar: Manejador) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === ruta,
    async (route) => {
      const req = route.request();
      // Preflight y escrituras: como las contesta el Supabase falso.
      if (req.method() === "OPTIONS") return route.fallback();
      const url = new URL(req.url());
      let args: Record<string, unknown> = {};
      if (req.method() === "POST") {
        try {
          args = (req.postDataJSON() as Record<string, unknown> | null) ?? {};
        } catch {
          args = {};
        }
      }
      const cuerpo = manejar(req, url, args);
      if (cuerpo === undefined) return route.fallback();
      const filas = Array.isArray(cuerpo) ? cuerpo.length : 1;
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          "content-type": "application/json; charset=utf-8",
          "content-range": filas ? `0-${filas - 1}/${filas}` : "*/0",
        },
        body: JSON.stringify(cuerpo),
      });
    },
  );
}

/** Respuesta con estado HTTP propio (escrituras, errores de edge functions). */
type RespuestaPropia = { status?: number; body?: unknown };

/**
 * Como `responder`, pero cada llamada decide el estado HTTP y el cuerpo. El
 * preflight lo contesta aquí con lo que pida el navegador: estas rutas usan
 * PATCH y DELETE, que un preflight sin Allow-Methods no dejaría pasar.
 */
async function responderCon(page: Page, ruta: string, manejar: (req: Request, url: URL) => RespuestaPropia | undefined) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === ruta,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") {
        const cabeceras = req.headers();
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": cabeceras["origin"] ?? "*",
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": cabeceras["access-control-request-method"] ?? "GET, POST, PATCH, DELETE",
            "access-control-allow-headers": cabeceras["access-control-request-headers"] ?? "*",
            "access-control-max-age": "600",
          },
        });
      }
      const respuesta = manejar(req, new URL(req.url()));
      if (respuesta === undefined) return route.fallback();
      const cuerpo = respuesta.body === undefined ? "" : JSON.stringify(respuesta.body);
      const filas = Array.isArray(respuesta.body) ? respuesta.body.length : cuerpo ? 1 : 0;
      await route.fulfill({
        status: respuesta.status ?? 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          ...(cuerpo ? { "content-type": "application/json; charset=utf-8" } : {}),
          "content-range": filas ? `0-${filas - 1}/${filas}` : "*/0",
        },
        body: cuerpo,
      });
    },
  );
}

/** Cuerpo JSON de una escritura (PostgREST o edge function). */
function cuerpoDe(req: Request): Record<string, unknown> {
  try {
    const json = req.postDataJSON() as unknown;
    const fila = Array.isArray(json) ? json[0] : json;
    return fila && typeof fila === "object" ? (fila as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `id=in.(a,b)` y `status=eq.x` de PostgREST, lo que piden la cartera y el calendario. */
function filtrarEventos<T extends { id: string; status: string }>(eventos: T[], url: URL): T[] {
  let lista = eventos;
  const id = url.searchParams.get("id");
  if (id?.startsWith("in.(")) {
    const ids = id.slice(4, -1).split(",").map((s) => s.replace(/"/g, "").trim());
    lista = lista.filter((e) => ids.includes(e.id));
  }
  const status = url.searchParams.get("status");
  if (status?.startsWith("eq.")) lista = lista.filter((e) => e.status === status.slice(3));
  return lista;
}

async function instalarDatosDeCliente(page: Page, { demo }: { demo: boolean }): Promise<EstadoCliente> {
  const ahora = Date.now();
  const datos = datosCliente(ahora);
  const soloLectura = (req: Request) => req.method() === "GET" || req.method() === "HEAD";
  const estado: EstadoCliente = {
    localesFavoritos: [],
    ciudad: "Madrid",
    cambiosPerfil: [],
    transferencias: [
      { id: C.transferencia5, ticket_id: ENTRADA_5, expires_at: iso(ahora + 5 * D), created_at: iso(ahora - D) },
    ],
    envios: [],
    reenvios: [],
  };

  await responder(page, "/rest/v1/rpc/get_user_roles", () => ["client"]);
  await responder(page, "/rest/v1/rpc/get_feature_flag", (_req, _url, args) =>
    args._code === "client_showcase" ? demo : false,
  );
  await responder(page, "/rest/v1/public_partners", (req) => (soloLectura(req) ? datos.locales : undefined));
  await responder(page, "/rest/v1/events", (req, url) => (soloLectura(req) ? filtrarEventos(datos.eventos, url) : undefined));
  await responder(page, "/rest/v1/tickets", (req) => (soloLectura(req) ? datos.entradas : undefined));
  await responder(page, "/rest/v1/ticket_tiers", (req) => (soloLectura(req) ? datos.tipos : undefined));
  await responder(page, "/rest/v1/favorites_v2", (req) => (soloLectura(req) ? datos.favoritos : undefined));
  await responder(page, "/rest/v1/loyalty_levels", (req) => (soloLectura(req) ? datos.niveles : undefined));
  await responder(page, "/rest/v1/loyalty_points", (req) => (soloLectura(req) ? datos.movimientos : undefined));
  await responder(page, "/rest/v1/rpc/loyalty_balance", () => 750);
  await responder(page, "/rest/v1/rpc/get_or_create_my_referral_code", () => "ABCD1234");

  // Perfil con la ciudad (B2-10): lo que se guarda es lo que vuelve a leerse.
  await responderCon(page, "/rest/v1/profiles", (req) => {
    if (req.method() === "PATCH") {
      const cambios = cuerpoDe(req);
      estado.cambiosPerfil.push(cambios);
      if ("city" in cambios) estado.ciudad = (cambios.city as string | null) ?? null;
      return { status: 204 };
    }
    if (!soloLectura(req)) return undefined;
    const fila = {
      id: IDS.usuario,
      email: "local@e2e.pasify.test",
      first_name: "Clara",
      last_name: "E2E",
      phone: null,
      city: estado.ciudad,
      avatar_url: null,
      created_at: iso(ahora - 90 * D),
      account_status: "approved",
    };
    const objeto = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object+json");
    return { body: objeto ? fila : [fila] };
  });

  // Locales favoritos (B2-03): upsert, borrado y lectura.
  await responderCon(page, "/rest/v1/partner_favorites", (req, url) => {
    if (req.method() === "POST") {
      const partnerId = String(cuerpoDe(req).partner_id ?? "");
      if (partnerId && !estado.localesFavoritos.some((f) => f.partner_id === partnerId)) {
        estado.localesFavoritos.unshift({ partner_id: partnerId, created_at: new Date().toISOString() });
      }
      return { status: 201 };
    }
    if (req.method() === "DELETE") {
      const partnerId = (url.searchParams.get("partner_id") ?? "").replace(/^eq\./, "");
      estado.localesFavoritos = estado.localesFavoritos.filter((f) => f.partner_id !== partnerId);
      return { status: 204 };
    }
    return soloLectura(req) ? { body: estado.localesFavoritos } : undefined;
  });

  // Transferencias pendientes de quien envía («Transferencia pendiente»).
  await responderCon(page, "/rest/v1/ticket_transfers", (req) =>
    soloLectura(req) ? { body: estado.transferencias } : undefined,
  );

  // Edge functions de la cartera (Ola 2).
  await responderCon(page, "/functions/v1/resend-tickets-email", (req) => {
    if (req.method() !== "POST") return undefined;
    estado.reenvios.push(cuerpoDe(req).order_id);
    // Límite de 3 por hora en el servidor; aquí, al segundo.
    return estado.reenvios.length > 1
      ? { status: 429, body: { error: "rate_limit_exceeded", message: "Demasiados reenvíos." } }
      : { body: { sent: true } };
  });
  await responderCon(page, "/functions/v1/send-ticket-transfer", (req) => {
    if (req.method() !== "POST") return undefined;
    const cuerpo = cuerpoDe(req);
    estado.envios.push(cuerpo);
    const transferId = `c11e0000-0000-4000-8000-0000000000c${estado.envios.length}`;
    estado.transferencias.push({
      id: transferId,
      ticket_id: String(cuerpo.ticket_id ?? ""),
      expires_at: new Date(Date.now() + 7 * D).toISOString(),
      created_at: new Date().toISOString(),
    });
    return { body: { transfer_id: transferId } };
  });

  return estado;
}

// ---------------------------------------------------------------------------
// Apertura, esperas y comprobaciones
// ---------------------------------------------------------------------------

interface App {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió la app. */
  errores: string[];
  /** Lo que el cliente ha guardado (favoritos, ciudad, transferencias…). */
  estado: EstadoCliente;
}

let appActual: App | null = null;

test.afterEach(async ({ page }, testInfo) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const app = appActual;
  appActual = null;
  if (!app || app.supabase.sinMock.size === 0) return;
  // No falla: avisa de lo que la app pide y el mock no conoce, para ampliarlo.
  const lista = [...app.supabase.sinMock].sort().join("\n");
  await testInfo.attach("peticiones-sin-mock.txt", { body: lista, contentType: "text/plain" });
});

const buscador = (page: Page) => page.getByRole("textbox", { name: "Buscar locales" });

async function abrirCliente(page: Page, { demo = false }: { demo?: boolean } = {}): Promise<App> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page);
  const estado = await instalarDatosDeCliente(page, { demo });
  const app: App = { supabase, errores, estado };
  appActual = app;

  await page.goto("/#/client-dashboard");
  const pantallaDeError = page.getByText(TEXTO_DE_FALLO);
  // La primera carga de Vite en frío puede tardar, de ahí el margen.
  await expect(buscador(page).or(pantallaDeError).first()).toBeVisible({ timeout: 90_000 });
  await esperarCalma(page, supabase);
  await comprobarSinFallos(page, app, "al entrar");
  await expect(buscador(page)).toBeVisible();
  return app;
}

async function esperarCalma(page: Page, supabase: SupabaseFalso) {
  await page.waitForTimeout(300);
  await expect.poll(() => supabase.enVuelo(), { timeout: 10_000 }).toBe(0);
  await page.waitForTimeout(200);
}

async function comprobarSinFallos(page: Page, app: App, donde: string) {
  expect(app.errores, `Errores JS ${donde}`).toEqual([]);
  await expect(page.getByText(TEXTO_DE_FALLO), `Pantalla de error ${donde}`).toHaveCount(0);
  expect(app.supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
}

async function sinTextos(page: Page, patron: RegExp, donde: string) {
  const texto = await page.locator("body").innerText();
  expect(texto, `Texto prohibido ${donde}`).not.toMatch(patron);
}

/** Menú lateral (escritorio). Los grupos (Mi membresía) se despliegan. */
async function menuLateral(page: Page): Promise<Locator> {
  const arbol = page.locator("aside nav");
  for (const grupo of await arbol.locator("button[aria-expanded]").all()) {
    if ((await grupo.getAttribute("aria-expanded")) !== "true") await grupo.click();
  }
  return arbol;
}

/** Título de cada vista (Inicio no tiene: su marca es el buscador). */
const marcaDeVista = (page: Page, etiqueta: string): Locator =>
  etiqueta === "Inicio"
    ? buscador(page)
    : page.getByRole("heading", { level: 1, name: etiqueta === "Tickets" ? "Mis entradas" : etiqueta });

async function irA(page: Page, app: App, etiqueta: string) {
  const arbol = await menuLateral(page);
  await arbol.getByRole("button", { name: etiqueta }).first().click();
  await esperarCalma(page, app.supabase);
  await comprobarSinFallos(page, app, `en «${etiqueta}»`);
  await expect(marcaDeVista(page, etiqueta), `«${etiqueta}» no se abre`).toBeVisible();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("web", () => {
  test("cliente real: recorre sus vistas sin maquetas ni promesas", async ({ page }) => {
    const app = await abrirCliente(page);

    const arbol = await menuLateral(page);
    for (const etiqueta of VISTAS_BASICAS) {
      await expect(arbol.getByRole("button", { name: etiqueta }).first(), `Falta «${etiqueta}»`).toBeVisible();
    }
    for (const maqueta of [...MAQUETAS, "Mi membresía"]) {
      await expect(arbol.getByRole("button", { name: maqueta }), `Maqueta «${maqueta}» en el menú`).toHaveCount(0);
    }

    for (const etiqueta of VISTAS_BASICAS) {
      await test.step(`Vista «${etiqueta}»`, async () => {
        await irA(page, app, etiqueta);
        await sinTextos(page, PROMESAS_SIN_DEMO, `en «${etiqueta}»`);
      });
    }

    await test.step("Inicio: eventos de verdad y categorías con restaurantes y teatros", async () => {
      await irA(page, app, "Inicio");
      await expect(page.getByRole("region", { name: "Próximos eventos" })).toContainText("Noche Futura E2E");
      await expect(page.getByRole("button", { name: "Teatros" })).toBeVisible();
      await page.getByRole("button", { name: "Teatros" }).click();
      await expect(page.getByText("Teatro Lumen E2E")).toBeVisible();
      await expect(page.getByText("Sala Aurora E2E")).toHaveCount(0);
      // Vuelve el corazón de los locales (Ola 2, B2-03), sin guardar todavía.
      await expect(page.getByRole("button", { name: "Guardar Teatro Lumen E2E en favoritos" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await page.getByRole("button", { name: "Todos" }).click();
    });

    await test.step("Tickets: cancelado sin QR y reembolsadas plegadas", async () => {
      await irA(page, app, "Tickets");
      await expect(page.getByText("Evento cancelado · te devolvemos el importe")).toBeVisible();
      // Las dos válidas y la usada con QR; la del evento cancelado, no.
      await expect(page.getByRole("button", { name: /Ver mi QR/ })).toHaveCount(3);
      await expect(page.getByText("Aún no tienes")).toHaveCount(0);
      const reembolsadas = page.getByRole("button", { name: /Reembolsadas · 1/ });
      await expect(reembolsadas).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText("Sesión Reembolsada E2E")).toHaveCount(0);
      await reembolsadas.click();
      await expect(page.getByText("Sesión Reembolsada E2E")).toBeVisible();
    });

    await test.step("Favoritos: Próximos y Pasados; solo los próximos cuentan en el menú", async () => {
      await irA(page, app, "Favoritos");
      await expect(page.getByText("Próximos · 1")).toBeVisible();
      await expect(page.getByRole("button", { name: /Pasados · 1/ })).toBeVisible();
      await expect(page.getByText("cuenta atrás")).toHaveCount(0);
      const botonMenu = (await menuLateral(page)).getByRole("button", { name: "Favoritos" }).first();
      await expect(botonMenu).toContainText("1");
    });

    await test.step("Puntos: saldo sin ventajas ni euros", async () => {
      await irA(page, app, "Pasify Points");
      await expect(page.getByText("Pronto podrás canjearlos").first()).toBeVisible();
      await expect(page.getByText("750").first()).toBeVisible();
      await expect(page.getByText(/descuento|VIP gratis/i)).toHaveCount(0);
    });

    await test.step("Perfil → Ajustes de la cuenta", async () => {
      await page.locator("aside").getByRole("button", { name: "Abrir perfil" }).click();
      const perfil = page.getByRole("dialog");
      await expect(perfil.getByText("Próximamente")).toHaveCount(0);
      await perfil.getByRole("button", { name: /Ajustes de la cuenta/ }).click();
      await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("URL de una maqueta sin modo demo → Inicio", async () => {
      for (const ruta of ["/#/client-dashboard/live", "/#/client-dashboard/concierge"]) {
        await page.goto(ruta);
        await expect(page).toHaveURL(/#\/client-dashboard$/);
        await expect(buscador(page)).toBeVisible();
        await sinTextos(page, PROMESAS_SIN_DEMO, `tras abrir ${ruta}`);
      }
      await comprobarSinFallos(page, app, "tras las URL de maquetas");
    });
  });

  test("cuenta de demo: maquetas con la franja DEMO y sin marcas reales", async ({ page }) => {
    const app = await abrirCliente(page, { demo: true });
    const franjaDemo = page.getByText("DEMO · datos ficticios");

    // Inicio: las recomendaciones inventadas, siempre debajo de la franja.
    await expect(franjaDemo.first()).toBeVisible();
    await sinTextos(page, MARCAS_REALES, "en Inicio (demo)");

    const arbol = await menuLateral(page);
    for (const maqueta of MAQUETAS) {
      await expect(arbol.getByRole("button", { name: maqueta }), `Falta «${maqueta}» en la demo`).toBeVisible();
    }

    await test.step("En vivo", async () => {
      await irA(page, app, "En vivo");
      await expect(franjaDemo).toBeVisible();
      await page.getByRole("button", { name: /Activar modo evento/ }).click();
      // Sin acciones con dinero: la recarga está desactivada.
      await expect(page.getByRole("button", { name: /Recargar saldo/ })).toBeDisabled();
      await expect(page.getByText(/\+\s?(10|20|50)\s?€/)).toHaveCount(0);
      await sinTextos(page, MARCAS_REALES, "en En vivo");
      await expect(page.getByText(/reembols/i)).toHaveCount(0);
    });

    await test.step("Concierge", async () => {
      await irA(page, app, "Concierge");
      await expect(franjaDemo).toBeVisible();
      await sinTextos(page, MARCAS_REALES, "en Concierge");
    });

    await test.step("Las vistas reales no llevan la franja", async () => {
      for (const etiqueta of ["Tickets", "Favoritos", "Pasify Points", "Soporte"]) {
        await irA(page, app, etiqueta);
        await expect(franjaDemo, `Franja DEMO en «${etiqueta}»`).toHaveCount(0);
      }
    });
  });

  test("Ola 2: locales favoritos, una sola ciudad y acciones de la cartera", async ({ page }) => {
    const app = await abrirCliente(page);
    const { estado } = app;
    const main = page.locator("main");
    const toast = (texto: string) => page.locator("[data-sonner-toast]").getByText(texto, { exact: true });
    // Tarjeta de un local (su nombre sale también en los próximos eventos).
    const tarjetaLocal = (nombre: string) => main.getByRole("button", { name: `Ver ${nombre}`, exact: true });

    await test.step("Inicio: solo los locales y eventos de la ciudad del perfil", async () => {
      await expect(main.getByRole("button", { name: /Tu ciudad: Madrid/ })).toBeVisible();
      await expect(tarjetaLocal("Sala Aurora E2E")).toBeVisible();
      await expect(tarjetaLocal("Club Mar E2E")).toHaveCount(0);
      const proximos = page.getByRole("region", { name: "Próximos eventos" });
      await expect(proximos).toContainText("Noche Futura E2E");
      await expect(proximos).not.toContainText("Fiesta Mar E2E");
    });

    await test.step("Corazón de un local: se guarda y sale en Favoritos · Locales", async () => {
      await page.getByRole("button", { name: "Guardar Sala Aurora E2E en favoritos" }).click();
      const quitar = page.getByRole("button", { name: "Quitar Sala Aurora E2E de favoritos" });
      await expect(quitar).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => estado.localesFavoritos.map((f) => f.partner_id)).toEqual([C.local1]);
      await esperarCalma(page, app.supabase);
      // Tras el refresco sigue guardado (lo devuelve el servidor).
      await expect(quitar).toBeVisible();

      await irA(page, app, "Favoritos");
      await main.getByRole("button", { name: /^Locales/ }).click();
      await expect(tarjetaLocal("Sala Aurora E2E")).toBeVisible();
      await expect(main.getByRole("button", { name: "Quitar Sala Aurora E2E de favoritos" })).toBeVisible();
      await expect(tarjetaLocal("Teatro Lumen E2E")).toHaveCount(0);
    });

    await test.step("Ciudad: «Toda España» enseña lo de fuera y se guarda en el perfil", async () => {
      await irA(page, app, "Inicio");
      await main.getByRole("button", { name: /Tu ciudad/ }).click();
      const selector = page.getByRole("dialog");
      await expect(selector.getByRole("heading", { name: "Elige tu ciudad" })).toBeVisible();
      // Solo España: ni banderas ni países. Con límites de palabra: «Portugalete»
      // (Bizkaia) es un municipio español y está en la lista.
      await expect(selector.getByText(/\b(Francia|France|Italia|Portugal)\b/)).toHaveCount(0);
      await selector.getByRole("button", { name: /Toda España/ }).click();
      await expect(tarjetaLocal("Club Mar E2E")).toBeVisible();
      await expect.poll(() => estado.cambiosPerfil.some((c) => "city" in c && c.city === null)).toBe(true);
      await esperarCalma(page, app.supabase);
      await expect(main.getByRole("button", { name: /Tu ciudad: Toda España/ })).toBeVisible();
      await expect(page.getByRole("region", { name: "Próximos eventos" })).toContainText("Fiesta Mar E2E");
    });

    await test.step("Cartera: acciones según la política del tipo", async () => {
      await irA(page, app, "Tickets");
      const conDevolucion = page.locator("article", { hasText: "Noche Futura E2E" });
      await expect(conDevolucion.getByText(/Devolución hasta el/)).toBeVisible();
      await expect(conDevolucion.getByRole("button", { name: /Solicita el reembolso/ })).toBeVisible();
      await expect(conDevolucion.getByRole("button", { name: "ENVIAR A UN AMIGO" })).toBeVisible();
      await expect(conDevolucion.getByRole("button", { name: "REENVIAR EMAIL" })).toBeVisible();

      const sinDevolucion = page.locator("article", { hasText: "Gala Sin Devolución E2E" });
      await expect(sinDevolucion.getByText("Sin devolución (salvo cancelación)")).toBeVisible();
      await expect(sinDevolucion.getByText("Transferencia pendiente").first()).toBeVisible();
      await expect(sinDevolucion.getByRole("button", { name: "ENVIAR A UN AMIGO" })).toHaveCount(0);
      await expect(sinDevolucion.getByRole("button", { name: /Solicita el reembolso/ })).toHaveCount(0);

      // Evento cancelado y entrada usada: sin acciones.
      for (const titulo of ["Concierto Cancelado E2E", "Fiesta Pasada E2E"]) {
        const tarjeta = page.locator("article", { hasText: titulo });
        await expect(tarjeta.getByRole("button", { name: /ENVIAR A UN AMIGO|REENVIAR EMAIL|reembolso/i })).toHaveCount(0);
      }
    });

    await test.step("Reenviar email: «Enviado» y, al repetir, «Espera un poco» (429)", async () => {
      const tarjeta = page.locator("article", { hasText: "Noche Futura E2E" });
      await tarjeta.getByRole("button", { name: "REENVIAR EMAIL" }).click();
      await expect(toast("Enviado")).toBeVisible();
      await expect(tarjeta.getByRole("button", { name: "REENVIAR EMAIL" })).toBeEnabled();
      await tarjeta.getByRole("button", { name: "REENVIAR EMAIL" }).click();
      await expect(toast("Espera un poco")).toBeVisible();
      expect(estado.reenvios).toEqual([C.pedido1, C.pedido1]);
    });

    await test.step("Enviar a un amigo: email y mensaje; después, «Transferencia pendiente»", async () => {
      const tarjeta = page.locator("article", { hasText: "Noche Futura E2E" });
      await tarjeta.getByRole("button", { name: "ENVIAR A UN AMIGO" }).click();
      const hoja = page.getByRole("dialog");
      await expect(hoja.getByRole("heading", { name: "Enviar a un amigo" })).toBeVisible();
      await hoja.getByLabel("Email de tu amigo").fill("amiga@e2e.pasify.test");
      await hoja.getByLabel("Mensaje (opcional)").fill("¡Nos vemos dentro!");
      await hoja.getByRole("button", { name: "Enviar entrada" }).click();
      await expect(toast("Entrada enviada")).toBeVisible();
      expect(estado.envios).toEqual([
        { ticket_id: ENTRADA_1, to_email: "amiga@e2e.pasify.test", message: "¡Nos vemos dentro!" },
      ]);
      await expect(tarjeta.getByText("Transferencia pendiente").first()).toBeVisible();
      await expect(tarjeta.getByRole("button", { name: "ENVIAR A UN AMIGO" })).toHaveCount(0);
      // Con la transferencia pendiente tampoco se ofrece la devolución.
      await expect(tarjeta.getByRole("button", { name: /Solicita el reembolso/ })).toHaveCount(0);
      await esperarCalma(page, app.supabase);
      // Tras el refresco sigue pendiente (la lee de ticket_transfers).
      await expect(tarjeta.getByText("Transferencia pendiente").first()).toBeVisible();
    });

    await test.step("Editar perfil: la ciudad (o «Toda España») se edita ahí", async () => {
      await page.locator("aside").getByRole("button", { name: "Abrir perfil" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /Ajustes de la cuenta/ }).click();
      await page.getByRole("button", { name: "Editar perfil" }).click();
      const hoja = page.getByRole("dialog", { name: "Editar perfil" });
      await expect(hoja.getByText("Tu ciudad", { exact: true })).toBeVisible();
      // La ciudad del perfil ya es «Toda España» (paso anterior).
      await expect(hoja.getByRole("button", { name: "Toda España" })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
    });

    await comprobarSinFallos(page, app, "tras las acciones de la Ola 2");
  });
});

test.describe("app nativa (iOS, override de src/lib/platform.ts)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sin maquetas aunque la cuenta sea de demo", async ({ page }) => {
    await simularAppNativa(page, "ios");
    const app = await abrirCliente(page, { demo: true });
    await sinTextos(page, PROMESAS_SIN_DEMO, "en Inicio (app)");

    await page.getByRole("button", { name: "Más opciones" }).click();
    const cajon = page.getByRole("dialog");
    await expect(cajon.getByRole("button", { name: "Pasify Points" })).toBeVisible();
    for (const maqueta of [...MAQUETAS, "Mi membresía"]) {
      await expect(cajon.getByRole("button", { name: maqueta }), `Maqueta «${maqueta}» en la app`).toHaveCount(0);
    }
    await page.keyboard.press("Escape");

    await page.goto("/#/client-dashboard/live");
    await expect(page).toHaveURL(/#\/client-dashboard$/);
    await expect(buscador(page)).toBeVisible();
    await comprobarSinFallos(page, app, "tras abrir la URL de En vivo en la app");
  });
});
