import { expect, test, type Page, type Request } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./support/fake-supabase";

/**
 * Compra (Ola 2 · C1) sin backend real: página del evento, selector de
 * entradas, entradas gratis y volver atrás desde Stripe.
 *
 * Mismo Supabase simulado que el panel (support/fake-supabase.ts), con la
 * sesión sembrada del usuario de pruebas como CLIENTE. Encima, las rutas de
 * este spec: tipos de entrada del evento, `event_availability`,
 * `stripe-create-checkout`, `cancel-checkout` y el pedido con sus entradas.
 *
 * Lo que se protege:
 *   - B1-04: la disponibilidad es la del servidor (event_availability, con
 *     las reservas en curso), nunca con cifras: «Últimas entradas» o
 *     «Agotado». Un tipo que capacity − sold daría por disponible sale
 *     agotado si el servidor lo dice, y la cantidad no pasa de lo que queda.
 *   - B1-04: volver de Stripe sin pagar (cancel_url con `?order_id=`) anula
 *     el pedido con cancel-checkout, lo avisa y limpia la URL; si ya estaba
 *     pagado, lleva a la confirmación.
 *   - B1-17: condiciones de devolución y transferencia por tipo antes de pagar.
 *   - D-2: tipo a 0 € → «Conseguir gratis», sin Stripe, y la confirmación
 *     lee el pedido directamente (`/ticket/success?order_id=…&free=1`).
 *   - Evento que ya no se ve: «Este evento ya no está disponible» con el
 *     calendario a mano.
 *
 * Corre con la config del panel (Supabase falso, un worker, hora de Madrid):
 * va en su `testMatch` y en el `testIgnore` de playwright.config.ts.
 *   npx playwright test -c playwright.partner.config.ts checkout-back
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

/** Pantallas de error: boundary global (main.tsx) y de sección. */
const TEXTO_DE_FALLO = /Algo no ha ido bien|Algo ha ido mal|Esta sección ha fallado/;

const EVENTO = IDS.eventoProximo; // "Concierto E2E", publicado, dentro de 7 días

const T = {
  general: "c0b0e000-0000-4000-8000-0000000000a1",
  vip: "c0b0e000-0000-4000-8000-0000000000a2",
  gratis: "c0b0e000-0000-4000-8000-0000000000a3",
  agotado: "c0b0e000-0000-4000-8000-0000000000a4",
  pedidoGratis: "c0b0e000-0000-4000-8000-0000000000b1",
  pedidoPendiente: "c0b0e000-0000-4000-8000-0000000000b2",
  pedidoPagado: "c0b0e000-0000-4000-8000-0000000000b3",
} as const;

type Fila = Record<string, unknown>;

const tipo = (t: Fila): Fila => ({
  event_id: EVENTO,
  description: null,
  currency: "eur",
  per_user_max: 10,
  sale_starts_at: null,
  sale_ends_at: null,
  status: "active",
  ...t,
});

/** Por capacity − sold los cuatro estarían a la venta; el servidor dice otra cosa. */
const TIPOS: Fila[] = [
  tipo({ id: T.general, name: "General", price_cents: 2000, capacity: 200, sold: 40, sort_order: 0, refundable_until_hours_before: 48, transfer_allowed: true }),
  tipo({ id: T.vip, name: "VIP", price_cents: 5000, capacity: 20, sold: 10, sort_order: 1, refundable_until_hours_before: null, transfer_allowed: false }),
  tipo({ id: T.gratis, name: "Invitación", price_cents: 0, capacity: 100, sold: 0, sort_order: 2, refundable_until_hours_before: null, transfer_allowed: false }),
  tipo({ id: T.agotado, name: "Early", price_cents: 1500, capacity: 50, sold: 30, sort_order: 3, refundable_until_hours_before: 24, transfer_allowed: true }),
];

const DISPONIBILIDAD = [
  { tier_id: T.general, remaining: 150, sold_out: false },
  { tier_id: T.vip, remaining: 2, sold_out: false }, // pocas: «Últimas entradas», y máximo 2
  { tier_id: T.gratis, remaining: 80, sold_out: false },
  { tier_id: T.agotado, remaining: 0, sold_out: true }, // reservas en curso: agotado
];

const pedido = (id: string, total: number): Fila => ({
  id,
  event_id: EVENTO,
  status: "paid",
  total_cents: total,
  currency: "eur",
  buyer_email: "local@e2e.pasify.test",
  tickets_email_sent_at: null,
});

const entrada = (n: number, orderId: string, tierId: string): Fila => ({
  id: `c0b0e000-0000-4000-8000-0000000000c${n}`,
  order_id: orderId,
  event_id: EVENTO,
  tier_id: tierId,
  qr_token: `c0b0e000-0000-4000-8000-0000000000d${n}`,
  status: "paid",
  created_at: new Date().toISOString(),
  holder_first_name: "Local",
  holder_last_name: "E2E",
  holder_email: "local@e2e.pasify.test",
  buyer_first_name: "Local",
  buyer_last_name: "E2E",
  buyer_email: "local@e2e.pasify.test",
  transferred_to_user_id: null,
});

const PEDIDOS = [pedido(T.pedidoGratis, 0), pedido(T.pedidoPagado, 2000)];
const ENTRADAS = [
  entrada(1, T.pedidoGratis, T.gratis),
  entrada(2, T.pedidoGratis, T.gratis),
  entrada(3, T.pedidoPagado, T.general),
];

// ---------------------------------------------------------------------------
// Rutas propias encima del Supabase falso (las registradas después ganan)
// ---------------------------------------------------------------------------

type Respuesta = { status?: number; json: unknown } | undefined;
type Manejador = (req: Request, url: URL, args: Record<string, unknown>) => Respuesta;

async function responder(page: Page, ruta: string, manejar: Manejador) {
  await page.route(
    (url) => url.origin === ORIGEN_SUPABASE && url.pathname === ruta,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fallback();
      const url = new URL(req.url());
      let args: Record<string, unknown> = {};
      if (req.method() !== "GET" && req.method() !== "HEAD") {
        try {
          args = (req.postDataJSON() as Record<string, unknown> | null) ?? {};
        } catch {
          args = {};
        }
      }
      const respuesta = manejar(req, url, args);
      if (respuesta === undefined) return route.fallback();
      const filas = Array.isArray(respuesta.json) ? respuesta.json.length : 1;
      await route.fulfill({
        status: respuesta.status ?? 200,
        headers: {
          "access-control-allow-origin": req.headers()["origin"] ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "content-range, x-supabase-api-version",
          "content-type": "application/json; charset=utf-8",
          "content-range": filas ? `0-${filas - 1}/${filas}` : "*/0",
        },
        body: JSON.stringify(respuesta.json),
      });
    },
  );
}

/** `col=eq.x` e `col=in.(a,b)` de PostgREST: lo que piden el selector y la confirmación. */
function filtrar(filas: Fila[], url: URL): Fila[] {
  return filas.filter((fila) => {
    for (const [col, expr] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(col)) continue;
      const valor = fila[col] === null || fila[col] === undefined ? null : String(fila[col]);
      if (expr.startsWith("eq.") && valor !== expr.slice(3)) return false;
      if (expr.startsWith("in.(")) {
        const lista = expr
          .slice(4, -1)
          .split(",")
          .map((s) => s.replace(/"/g, "").trim());
        if (valor === null || !lista.includes(valor)) return false;
      }
    }
    return true;
  });
}

const soloLectura = (req: Request) => req.method() === "GET" || req.method() === "HEAD";

interface Compra {
  supabase: SupabaseFalso;
  errores: string[];
  /** Cuerpos de las llamadas a cancel-checkout. */
  cancelaciones: Record<string, unknown>[];
  /** Cuerpos de las llamadas a stripe-create-checkout. */
  pagos: Record<string, unknown>[];
}

async function prepararCompra(
  page: Page,
  { cancelStatus = "cancelled" }: { cancelStatus?: string } = {},
): Promise<Compra> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { roles: ["client"] });
  const compra: Compra = { supabase, errores, cancelaciones: [], pagos: [] };

  await responder(page, "/rest/v1/ticket_tiers", (req, url) => (soloLectura(req) ? { json: filtrar(TIPOS, url) } : undefined));
  await responder(page, "/rest/v1/rpc/event_availability", (_req, _url, args) =>
    args._event_id === EVENTO ? { json: DISPONIBILIDAD } : { json: [] },
  );
  await responder(page, "/rest/v1/ticket_orders", (req, url) => (soloLectura(req) ? { json: filtrar(PEDIDOS, url) } : undefined));
  await responder(page, "/rest/v1/tickets", (req, url) => (soloLectura(req) ? { json: filtrar(ENTRADAS, url) } : undefined));
  await responder(page, "/functions/v1/cancel-checkout", (_req, _url, args) => {
    compra.cancelaciones.push(args);
    return { json: { status: cancelStatus } };
  });
  await responder(page, "/functions/v1/stripe-create-checkout", (_req, _url, args) => {
    compra.pagos.push(args);
    // Solo el tipo gratis llega aquí en este spec: reserva sin Stripe.
    return args.tier_id === T.gratis
      ? { json: { free: true, order_id: T.pedidoGratis } }
      : { status: 409, json: { error: "tier_sold_out", message: "No quedan suficientes entradas de este tipo." } };
  });
  return compra;
}

async function sinFallos(page: Page, compra: Compra, donde: string) {
  expect(compra.errores, `Errores JS ${donde}`).toEqual([]);
  await expect(page.getByText(TEXTO_DE_FALLO), `Pantalla de error ${donde}`).toHaveCount(0);
  expect(compra.supabase.supabaseReal, "Peticiones a un Supabase real").toEqual([]);
}

const filaDeTipo = (page: Page, nombre: string) => page.locator("main li").filter({ hasText: nombre });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("página del evento: disponibilidad del servidor sin cifras y condiciones antes de pagar", async ({ page }) => {
  const compra = await prepararCompra(page);
  await page.goto(`/#/e/${EVENTO}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });

  // Agotado por el servidor aunque capacity − sold diga que quedan 20.
  await expect(filaDeTipo(page, "Early")).toContainText("Agotado");
  await expect(filaDeTipo(page, "VIP")).toContainText("Últimas entradas");
  await expect(filaDeTipo(page, "General")).not.toContainText("Últimas entradas");
  // Nunca la cifra de lo que queda.
  expect(await page.locator("body").innerText()).not.toMatch(/Quedan? \d|\d+ entradas? disponibles?/i);

  // Condiciones por tipo.
  await expect(filaDeTipo(page, "General")).toContainText("Devolución hasta 2 días antes del evento");
  await expect(filaDeTipo(page, "General")).toContainText("Transferible");
  await expect(filaDeTipo(page, "VIP")).toContainText("Sin devolución (salvo cancelación del evento)");
  await expect(filaDeTipo(page, "VIP")).toContainText("No transferible");
  await expect(filaDeTipo(page, "Early")).toContainText("Devolución hasta 24 h antes del evento");
  // Gratis: nada que devolver, solo la transferencia.
  await expect(filaDeTipo(page, "Invitación")).toContainText("No transferible");
  await expect(filaDeTipo(page, "Invitación")).not.toContainText("devolución", { ignoreCase: true });
  await expect(filaDeTipo(page, "Invitación")).toContainText("Gratis");

  // Hay un tipo gratis y otros de pago: el botón no promete un precio.
  await expect(page.getByRole("button", { name: "Conseguir entradas" })).toBeEnabled();
  await sinFallos(page, compra, "en la página del evento");
});

test("sin event_availability (la RPC falla): se sigue vendiendo con la estimación de antes", async ({ page }) => {
  const compra = await prepararCompra(page);
  // Registrada después: gana a la de prepararCompra.
  await responder(page, "/rest/v1/rpc/event_availability", () => ({
    status: 404,
    json: { code: "PGRST202", message: "Could not find the function public.event_availability", details: null, hint: null },
  }));
  await page.goto(`/#/e/${EVENTO}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });

  // capacity − sold: a Early le quedan 20 de 50, así que sigue a la venta.
  await expect(filaDeTipo(page, "Early")).not.toContainText("Agotado");
  await expect(filaDeTipo(page, "General")).toContainText("Devolución hasta 2 días antes del evento");
  await expect(page.getByRole("button", { name: "Conseguir entradas" })).toBeEnabled();
  await expect(page.getByText("No hemos podido cargar el evento")).toHaveCount(0);
  await sinFallos(page, compra, "sin event_availability");
});

test("selector: la cantidad no pasa de lo que queda y el tipo gratis se consigue sin Stripe", async ({ page }) => {
  const compra = await prepararCompra(page);
  await page.goto(`/#/e/${EVENTO}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Conseguir entradas" }).click();
  const selector = page.getByRole("dialog");
  await expect(selector.getByRole("radiogroup", { name: "Tipo de entrada" })).toBeVisible();
  await expect(selector.getByRole("radio", { name: /Early/ })).toBeDisabled();
  await expect(selector.getByText("Devolución hasta 2 días antes del evento")).toBeVisible();

  await test.step("VIP: «Últimas entradas» y como mucho 2", async () => {
    await selector.getByRole("radio", { name: /VIP/ }).click();
    const mas = selector.getByRole("button", { name: "Añadir una entrada" });
    await mas.click();
    await expect(mas).toBeDisabled();
    await expect(selector.getByText("Últimas entradas").first()).toBeVisible();
    expect(await selector.innerText()).not.toMatch(/Quedan? \d/i);
    await expect(selector.getByRole("button", { name: /Continuar al pago/ })).toBeVisible();
  });

  await test.step("Invitación (0 €): «Conseguir gratis» y a la confirmación sin Stripe", async () => {
    await selector.getByRole("radio", { name: /Invitación/ }).click();
    await expect(selector.getByText("Sin pago.", { exact: false })).toBeVisible();
    await selector.getByRole("button", { name: "Conseguir gratis" }).click();

    await expect(page).toHaveURL(new RegExp(`#/ticket/success\\?order_id=${T.pedidoGratis}&free=1$`));
    expect(compra.pagos).toHaveLength(1);
    expect(compra.pagos[0]).toMatchObject({ event_id: EVENTO, tier_id: T.gratis, qty: 2 });
    await expect(page.getByText("Reserva confirmada").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Tus entradas están listas/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Código QR de la entrada/ })).toHaveCount(2);
    await expect(page.getByText("Gratis", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ver en mi cartera/ })).toBeVisible();
  });

  await sinFallos(page, compra, "tras conseguir entradas gratis");
});

test("volver de Stripe sin pagar (cancel_url): se anula el pedido, se avisa y se limpia la URL", async ({ page }) => {
  const compra = await prepararCompra(page);
  await page.goto(`/#/e/${EVENTO}?order_id=${T.pedidoPendiente}`);
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible({ timeout: 90_000 });

  await expect.poll(() => compra.cancelaciones).toEqual([{ order_id: T.pedidoPendiente }]);
  await expect(page.getByText("Pago cancelado")).toBeVisible();
  await expect(page).not.toHaveURL(/order_id=/);

  // Recargar ya no lo repite: el parámetro ha salido de la URL.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Concierto E2E" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(compra.cancelaciones).toHaveLength(1);
  await sinFallos(page, compra, "al volver sin pagar");
});

test("volver de Stripe cuando el pago ya estaba hecho: a la confirmación", async ({ page }) => {
  const compra = await prepararCompra(page, { cancelStatus: "already_paid" });
  await page.goto(`/#/e/${EVENTO}?order_id=${T.pedidoPagado}`);

  await expect(page).toHaveURL(new RegExp(`#/ticket/success\\?order_id=${T.pedidoPagado}$`), { timeout: 90_000 });
  expect(compra.cancelaciones).toEqual([{ order_id: T.pedidoPagado }]);
  await expect(page.getByText("Compra confirmada").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tu entrada está lista/ })).toBeVisible();
  await sinFallos(page, compra, "al volver con el pago hecho");
});

// Un evento que la RLS ya no devuelve (local suspendido, despublicado) o que
// no existe, y un borrador (el Supabase falso no aplica RLS: llega la fila).
const NO_DISPONIBLES: Array<[string, string]> = [
  ["no existe o la RLS lo oculta", "5e2e0000-0000-4000-8000-0000000000ee"],
  ["despublicado (borrador)", IDS.eventoBorrador],
];
for (const [caso, id] of NO_DISPONIBLES) {
  test(`evento que ya no se ve (${caso}): «Este evento ya no está disponible» con el calendario`, async ({ page }) => {
    const compra = await prepararCompra(page);
    await page.goto(`/#/e/${id}`);
    await expect(page.getByRole("heading", { name: "Este evento ya no está disponible" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("link", { name: "Ver el calendario" })).toHaveAttribute("href", "#/calendar");
    await expect(page.getByText("Cargando el evento")).toHaveCount(0);
    await sinFallos(page, compra, "con el evento no disponible");
  });
}
