import type { Page, Request } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./fake-supabase";

/**
 * Una compra sin backend real, para los specs que miran la página del evento, el
 * selector de entradas y la confirmación: tipos de entrada del evento,
 * `event_availability`, `stripe-create-checkout` y un pedido con sus entradas,
 * encima del Supabase simulado (support/fake-supabase.ts, sesión de CLIENTE).
 *
 * Los datos son los de checkout-back.spec.ts (mismos ids y precios).
 */

const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

export const EVENTO = IDS.eventoProximo; // «Concierto E2E», publicado, dentro de 7 días

export const T = {
  general: "c0b0e000-0000-4000-8000-0000000000a1",
  vip: "c0b0e000-0000-4000-8000-0000000000a2",
  gratis: "c0b0e000-0000-4000-8000-0000000000a3",
  pedidoDos: "c0b0e000-0000-4000-8000-0000000000b1", // dos entradas
  pedidoUna: "c0b0e000-0000-4000-8000-0000000000b3", // una entrada, pagada
} as const;

export type Fila = Record<string, unknown>;

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

export const TIPOS: Fila[] = [
  tipo({ id: T.general, name: "General", description: "Acceso general al evento", price_cents: 2000, capacity: 200, sold: 40, sort_order: 0, refundable_until_hours_before: 48, transfer_allowed: true }),
  tipo({ id: T.vip, name: "VIP", description: "Zona reservada · welcome drink", price_cents: 5000, capacity: 20, sold: 10, sort_order: 1, refundable_until_hours_before: null, transfer_allowed: false }),
  tipo({ id: T.gratis, name: "Invitación", price_cents: 0, capacity: 100, sold: 0, sort_order: 2, refundable_until_hours_before: null, transfer_allowed: false }),
];

export const DISPONIBILIDAD = [
  { tier_id: T.general, remaining: 150, sold_out: false },
  { tier_id: T.vip, remaining: 2, sold_out: false }, // pocas: «Últimas entradas», y como mucho 2
  { tier_id: T.gratis, remaining: 80, sold_out: false },
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

export const PEDIDOS = [pedido(T.pedidoDos, 0), pedido(T.pedidoUna, 2000)];
export const ENTRADAS = [
  entrada(1, T.pedidoDos, T.gratis),
  entrada(2, T.pedidoDos, T.gratis),
  entrada(3, T.pedidoUna, T.general),
];

type Respuesta = { status?: number; json: unknown } | undefined;
type Manejador = (req: Request, url: URL, args: Record<string, unknown>) => Respuesta;

/** Contesta a `ruta` en el Supabase simulado; devolver undefined deja pasar la petición a la ruta anterior. */
export async function responder(page: Page, ruta: string, manejar: Manejador) {
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
export function filtrar(filas: Fila[], url: URL): Fila[] {
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

export const soloLectura = (req: Request) => req.method() === "GET" || req.method() === "HEAD";

export interface Compra {
  supabase: SupabaseFalso;
  errores: string[];
  /** Cuerpos de las llamadas a stripe-create-checkout. */
  pagos: Record<string, unknown>[];
}

/**
 * Prepara la compra del «Concierto E2E» como cliente. `stripe-create-checkout`
 * contesta con una «página de Stripe» que es la propia app (`/#/calendar`): el
 * navegador sale de la página del evento sin llegar a ningún Stripe.
 */
export async function prepararCompra(page: Page): Promise<Compra> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { roles: ["client"] });
  const compra: Compra = { supabase, errores, pagos: [] };

  await responder(page, "/rest/v1/ticket_tiers", (req, url) => (soloLectura(req) ? { json: filtrar(TIPOS, url) } : undefined));
  await responder(page, "/rest/v1/rpc/event_availability", (_req, _url, args) =>
    args._event_id === EVENTO ? { json: DISPONIBILIDAD } : { json: [] },
  );
  await responder(page, "/rest/v1/ticket_orders", (req, url) => (soloLectura(req) ? { json: filtrar(PEDIDOS, url) } : undefined));
  await responder(page, "/rest/v1/tickets", (req, url) => (soloLectura(req) ? { json: filtrar(ENTRADAS, url) } : undefined));
  await responder(page, "/functions/v1/stripe-create-checkout", (_req, _url, args) => {
    compra.pagos.push(args);
    if (args.tier_id === T.gratis) return { json: { free: true, order_id: T.pedidoDos } };
    return {
      json: {
        url: `${new URL(page.url()).origin}/#/calendar`,
        order_id: "c0b0e000-0000-4000-8000-0000000000b9",
        session_id: "cs_test_e2e",
      },
    };
  });
  return compra;
}
