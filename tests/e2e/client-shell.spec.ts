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
  eventoProximo: "c11e0000-0000-4000-8000-0000000000e1",
  eventoPasado: "c11e0000-0000-4000-8000-0000000000e2",
  eventoCancelado: "c11e0000-0000-4000-8000-0000000000e3",
  eventoReembolsado: "c11e0000-0000-4000-8000-0000000000e4",
} as const;

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
    entrada(1, C.eventoProximo, "paid"),
    entrada(2, C.eventoPasado, "used", { used_at: iso(ahora - 10 * D + H) }),
    entrada(3, C.eventoCancelado, "paid"),
    entrada(4, C.eventoReembolsado, "refunded"),
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

  return { locales, eventos, entradas, favoritos, niveles, movimientos };
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

async function instalarDatosDeCliente(page: Page, { demo }: { demo: boolean }) {
  const datos = datosCliente(Date.now());
  const soloLectura = (req: Request) => req.method() === "GET" || req.method() === "HEAD";

  await responder(page, "/rest/v1/rpc/get_user_roles", () => ["client"]);
  await responder(page, "/rest/v1/rpc/get_feature_flag", (_req, _url, args) =>
    args._code === "client_showcase" ? demo : false,
  );
  await responder(page, "/rest/v1/public_partners", (req) => (soloLectura(req) ? datos.locales : undefined));
  await responder(page, "/rest/v1/events", (req, url) => (soloLectura(req) ? filtrarEventos(datos.eventos, url) : undefined));
  await responder(page, "/rest/v1/tickets", (req) => (soloLectura(req) ? datos.entradas : undefined));
  await responder(page, "/rest/v1/favorites_v2", (req) => (soloLectura(req) ? datos.favoritos : undefined));
  await responder(page, "/rest/v1/loyalty_levels", (req) => (soloLectura(req) ? datos.niveles : undefined));
  await responder(page, "/rest/v1/loyalty_points", (req) => (soloLectura(req) ? datos.movimientos : undefined));
  await responder(page, "/rest/v1/rpc/loyalty_balance", () => 750);
  await responder(page, "/rest/v1/rpc/get_or_create_my_referral_code", () => "ABCD1234");
}

// ---------------------------------------------------------------------------
// Apertura, esperas y comprobaciones
// ---------------------------------------------------------------------------

interface App {
  supabase: SupabaseFalso;
  /** `pageerror` desde que se abrió la app. */
  errores: string[];
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
  await instalarDatosDeCliente(page, { demo });
  const app: App = { supabase, errores };
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
      // Sin corazón de locales (guardaba mal): ninguna tarjeta lo lleva.
      await expect(page.locator("main").getByRole("button", { name: /favoritos/i })).toHaveCount(0);
      await page.getByRole("button", { name: "Todos" }).click();
    });

    await test.step("Tickets: cancelado sin QR y reembolsadas plegadas", async () => {
      await irA(page, app, "Tickets");
      await expect(page.getByText("Evento cancelado · te devolvemos el importe")).toBeVisible();
      // Válida y usada con QR; la del evento cancelado, no.
      await expect(page.getByRole("button", { name: /Ver mi QR/ })).toHaveCount(2);
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
