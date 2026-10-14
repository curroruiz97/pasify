import type { Page, Request } from "@playwright/test";
import { FAKE_SUPABASE_URL, IDS, instalarSupabaseFalso, type SupabaseFalso } from "./fake-supabase";

/**
 * Compra sin backend real, para los specs que recorren la página del evento y
 * el selector de entradas: encima del Supabase simulado (fake-supabase.ts,
 * sesión sembrada como CLIENTE) responde a
 *   - los tipos de entrada del evento (`ticket_tiers`) y `event_availability`;
 *   - `event_ticket_allowance` (cuántas entradas lleva ya quien compra);
 *   - `ticket_orders` y `tickets` (la confirmación);
 *   - `stripe-create-checkout` y `cancel-checkout` (NUNCA hay pago real: el
 *     Supabase y Stripe son simulados y cualquier petición a un host de fuera
 *     se aborta).
 *
 * Mismo reparto de datos que checkout-back.spec.ts (que sigue teniendo su
 * copia): evento «Concierto E2E» con General, VIP (quedan 2), Invitación
 * (gratis) y Early (agotado).
 */

export const ORIGEN_SUPABASE = new URL(FAKE_SUPABASE_URL).origin;

/** El evento publicado de pruebas, dentro de 7 días. */
export const EVENTO = IDS.eventoProximo;

export const T = {
  general: "c0b0e000-0000-4000-8000-0000000000a1",
  vip: "c0b0e000-0000-4000-8000-0000000000a2",
  gratis: "c0b0e000-0000-4000-8000-0000000000a3",
  agotado: "c0b0e000-0000-4000-8000-0000000000a4",
  pedidoGratis: "c0b0e000-0000-4000-8000-0000000000b1",
  pedidoPendiente: "c0b0e000-0000-4000-8000-0000000000b2",
  pedidoPagado: "c0b0e000-0000-4000-8000-0000000000b3",
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
  tipo({ id: T.general, name: "General", price_cents: 2000, capacity: 200, sold: 40, sort_order: 0, refundable_until_hours_before: 48, transfer_allowed: true }),
  tipo({ id: T.vip, name: "VIP", price_cents: 5000, capacity: 20, sold: 10, sort_order: 1, refundable_until_hours_before: null, transfer_allowed: false }),
  tipo({ id: T.gratis, name: "Invitación", price_cents: 0, capacity: 100, sold: 0, sort_order: 2, refundable_until_hours_before: null, transfer_allowed: false }),
  tipo({ id: T.agotado, name: "Early", price_cents: 1500, capacity: 50, sold: 30, sort_order: 3, refundable_until_hours_before: 24, transfer_allowed: true }),
];

export const DISPONIBILIDAD = [
  { tier_id: T.general, remaining: 150, sold_out: false },
  { tier_id: T.vip, remaining: 2, sold_out: false },
  { tier_id: T.gratis, remaining: 80, sold_out: false },
  { tier_id: T.agotado, remaining: 0, sold_out: true },
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

export const PEDIDOS = [pedido(T.pedidoGratis, 0), pedido(T.pedidoPagado, 2000)];
export const ENTRADAS = [
  entrada(1, T.pedidoGratis, T.gratis),
  entrada(2, T.pedidoGratis, T.gratis),
  entrada(3, T.pedidoPagado, T.general),
];

// ---------------------------------------------------------------------------
// Rutas propias encima del Supabase falso (las registradas después ganan)
// ---------------------------------------------------------------------------

export type Respuesta = { status?: number; json: unknown } | undefined;
export type Manejador = (req: Request, url: URL, args: Record<string, unknown>) => Respuesta;

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
  /** Cuerpos de las llamadas a stripe-create-checkout (lo que mandó la app). */
  pagos: Record<string, unknown>[];
  /** Cuerpos de las llamadas a cancel-checkout. */
  cancelaciones: Record<string, unknown>[];
  /** Lo que contesta `event_ticket_allowance`: cuántas lleva ya quien compra. Se puede cambiar a mitad de test. */
  allowance: { held: number; limit: number; fallo: boolean };
  /** Veces que se ha pedido `event_ticket_allowance`. */
  peticionesAllowance: number;
  /** Respuesta de stripe-create-checkout; por defecto, la reserva gratis o un 409 de agotado. */
  checkout: ((args: Record<string, unknown>) => Respuesta) | null;
}

export async function prepararCompra(page: Page): Promise<Compra> {
  const errores: string[] = [];
  page.on("pageerror", (err) => errores.push(err.stack ?? `${err.name}: ${err.message}`));
  const supabase = await instalarSupabaseFalso(page, { roles: ["client"] });
  const compra: Compra = {
    supabase,
    errores,
    pagos: [],
    cancelaciones: [],
    allowance: { held: 0, limit: 10, fallo: false },
    peticionesAllowance: 0,
    checkout: null,
  };

  await responder(page, "/rest/v1/ticket_tiers", (req, url) => (soloLectura(req) ? { json: filtrar(TIPOS, url) } : undefined));
  await responder(page, "/rest/v1/rpc/event_availability", (_req, _url, args) =>
    args._event_id === EVENTO ? { json: DISPONIBILIDAD } : { json: [] },
  );
  await responder(page, "/rest/v1/rpc/event_ticket_allowance", () => {
    compra.peticionesAllowance++;
    if (compra.allowance.fallo) {
      return {
        status: 404,
        json: { code: "PGRST202", message: "Could not find the function public.event_ticket_allowance", details: null, hint: null },
      };
    }
    const { held, limit } = compra.allowance;
    // RETURNS TABLE: PostgREST devuelve una lista con una fila.
    return { json: [{ max_per_buyer: limit, held, remaining: Math.max(0, limit - held) }] };
  });
  await responder(page, "/rest/v1/ticket_orders", (req, url) => (soloLectura(req) ? { json: filtrar(PEDIDOS, url) } : undefined));
  await responder(page, "/rest/v1/tickets", (req, url) => (soloLectura(req) ? { json: filtrar(ENTRADAS, url) } : undefined));
  await responder(page, "/functions/v1/cancel-checkout", (_req, _url, args) => {
    compra.cancelaciones.push(args);
    return { json: { status: "cancelled" } };
  });
  await responder(page, "/functions/v1/stripe-create-checkout", (_req, _url, args) => {
    compra.pagos.push(args);
    if (compra.checkout) return compra.checkout(args);
    return args.tier_id === T.gratis
      ? { json: { free: true, order_id: T.pedidoGratis } }
      : { status: 409, json: { error: "tier_sold_out", message: "No quedan suficientes entradas de este tipo." } };
  });
  return compra;
}
