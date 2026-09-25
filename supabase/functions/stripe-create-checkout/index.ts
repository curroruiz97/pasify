// Pasify · stripe-create-checkout
// Crea una Checkout Session de Stripe para la compra de N entradas de un tier.
// Soporta Stripe Connect (destination charges); Pasify cobra application_fee.
//
// Flujo:
//   0) En producción solo con clave live de Stripe (assertLivePayments) y
//      siempre con sesión: sin comprador no hay límite por persona y una
//      reserva anónima retenía plazas 47 minutos.
//   1) Valida payload y URLs de vuelta (allowlist de orígenes propios).
//   2) `create_ticket_order` (SQL, service role) bloquea filas, valida stock,
//      aforo, ventana de venta y límites, y crea el pedido + entradas
//      'pending' de forma atómica. El precio sale de la BD, nunca del cliente.
//   3) Crea la Checkout Session con los datos que devuelve la RPC y la
//      enlaza al pedido con `set_order_stripe_session`.
//
// Body: { event_id, tier_id, qty, buyer: { email, first_name?, last_name?, phone? }, success_url, cancel_url }
// Returns 200: { url, order_id, session_id, expires_at }
// Errores: { error: <código>, message: <texto para el usuario> }
//   409 event_not_available | tier_not_available | sale_not_started | sale_ended | tier_sold_out | event_sold_out
//   400 invalid_payload | invalid_qty | qty_exceeds_per_user_max | buyer_email_required | invalid_return_url | amount_below_minimum
//   401 auth_required · 503 payments_unavailable
//   429 rate_limit_exceeded · 502 payment_provider_error · 500 order_create_failed | order_link_failed | internal_error

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type Stripe from "npm:stripe@14";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { requireStripe, assertLivePayments, DEFAULT_APPLICATION_FEE_PCT, STRIPE_TEST_MODE } from "../_shared/stripe.ts";
import { enforceRateLimit, RateLimitError } from "../_shared/rate-limit.ts";
import { APP_URL, DEFAULT_TIMEZONE, formatEventDateTime } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";

interface CheckoutPayload {
  event_id: string;
  tier_id: string;
  qty: number;
  buyer: { email: string; first_name?: string; last_name?: string; phone?: string };
  success_url: string;
  cancel_url: string;
}

/** Fila que devuelve `create_ticket_order`. */
interface CreatedOrder {
  order_id: string;
  request_id: string;
  org_id: string | null;
  event_title: string;
  event_date_start: string;
  event_image_url: string | null;
  venue_name: string | null;
  city: string | null;
  timezone: string | null;
  tier_name: string;
  unit_price_cents: number;
  qty: number;
  subtotal_cents: number;
  fee_cents: number;
  currency: string;
  expires_at: string;
  stripe_destination_account: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_QTY = 10;
/** Importe mínimo que Stripe acepta en EUR (0,50 €). */
const STRIPE_MIN_AMOUNT_CENTS = 50;
/**
 * Minutos que el pedido retiene el stock. La sesión de Stripe caduca a la vez
 * que el pedido (Stripe exige un mínimo de 30 min): así el pedido nunca
 * caduca antes de que el cliente pueda pagarlo.
 */
const ORDER_TTL_MINUTES = 32;

/** Errores de negocio que lanza `create_ticket_order` (RAISE EXCEPTION '<código>'). */
const ORDER_ERRORS: Record<string, { status: number; message: string }> = {
  event_not_available: { status: 409, message: "Este evento ya no está a la venta." },
  tier_not_available: { status: 409, message: "Este tipo de entrada ya no está disponible." },
  sale_not_started: { status: 409, message: "La venta de estas entradas todavía no ha empezado." },
  sale_ended: { status: 409, message: "La venta de estas entradas ha terminado." },
  tier_sold_out: { status: 409, message: "No quedan suficientes entradas de este tipo. Prueba con menos cantidad u otro tipo de entrada." },
  event_sold_out: { status: 409, message: "El evento está completo: no quedan entradas." },
  invalid_qty: { status: 400, message: "La cantidad de entradas no es válida." },
  qty_exceeds_per_user_max: { status: 400, message: "Has superado el máximo de entradas por persona para este tipo de entrada." },
  buyer_email_required: { status: 400, message: "Necesitamos un email válido para enviarte las entradas." },
  buyer_user_required: { status: 401, message: "Inicia sesión para comprar tus entradas." },
};

function fail(status: number, code: string, message: string): Response {
  return jsonResponse({ error: code, message }, { status });
}

/** Busca el código de negocio dentro del mensaje de error de PostgREST. */
function matchOrderError(message: string | undefined): string | null {
  if (!message) return null;
  for (const code of Object.keys(ORDER_ERRORS)) {
    if (new RegExp(`\\b${code}\\b`).test(message)) return code;
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Allowlist de URLs de vuelta. Sin ella, cualquiera podría crear un pago de
   Pasify que al terminar mande al cliente a una web de phishing.
   --------------------------------------------------------------------------- */
const ALLOWED_RETURN_ORIGINS: Set<string> = (() => {
  const set = new Set<string>();
  const add = (raw: string) => {
    try {
      const u = new URL(raw.trim());
      if (u.protocol === "https:" || u.protocol === "http:") set.add(u.origin);
    } catch {
      /* entrada mal formada: se ignora */
    }
  };
  // APP_URL (secreto APP_BASE_URL), dominio definitivo y la web que hoy está
  // en producción (la app nativa vuelve siempre a ella: ver redirect-url.ts).
  [APP_URL, "https://pasify.es", "https://www.pasify.es", "https://pasifyy.vercel.app"].forEach(add);
  (Deno.env.get("ALLOWED_RETURN_ORIGINS") ?? "").split(",").filter((s) => s.trim()).forEach(add);
  return set;
})();

function isAllowedReturnUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (ALLOWED_RETURN_ORIGINS.has(u.origin)) return true;
  // Desarrollo local contra el Stripe de pruebas (no mueve dinero real).
  return STRIPE_TEST_MODE && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** Añade parámetros respetando el HashRouter: `https://x/#/ruta` → `https://x/#/ruta?a=1`. */
function appendParams(url: string, params: string): string {
  const hashIdx = url.indexOf("#");
  const tail = hashIdx >= 0 ? url.slice(hashIdx) : url;
  return `${url}${tail.includes("?") ? "&" : "?"}${params}`;
}

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  return s || null;
};

async function readApplicationFeePct(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_app_setting_text", { _key: "application_fee_pct" });
  if (error) {
    logger.warn("application_fee_pct_read_failed", { error: error.message });
    return DEFAULT_APPLICATION_FEE_PCT;
  }
  // app_settings.value es JSONB: puede llegar como `5`, `"5"` o `"5.5"`.
  const n = Number.parseFloat(String(data ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_APPLICATION_FEE_PCT;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  const log = logger.child({ function: "stripe-create-checkout" });

  try {
    // En producción con una clave de Stripe que no es live no se reserva
    // nada: 503 payments_unavailable (ver _shared/stripe.ts).
    assertLivePayments();

    // Solo con sesión (la app ya la exige antes de llegar aquí).
    let user: { id: string; email: string | null };
    try {
      user = await requireUser(req);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        return fail(401, "auth_required", "Inicia sesión para comprar tus entradas.");
      }
      throw err;
    }

    try {
      await enforceRateLimit({ key: `checkout:${user.id}`, max: 20, windowSec: 3600 });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return fail(429, "rate_limit_exceeded", "Demasiados intentos de compra. Espera unos minutos y vuelve a probar.");
      }
      throw err;
    }

    let body: Partial<CheckoutPayload>;
    try {
      body = (await req.json()) as Partial<CheckoutPayload>;
    } catch {
      return fail(400, "invalid_payload", "La petición no es válida.");
    }

    const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
    const tierId = typeof body.tier_id === "string" ? body.tier_id.trim() : "";
    if (!UUID_RE.test(eventId) || !UUID_RE.test(tierId)) {
      return fail(400, "invalid_payload", "Falta el evento o el tipo de entrada.");
    }
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return fail(400, "invalid_qty", `Puedes comprar entre 1 y ${MAX_QTY} entradas por pedido.`);
    }
    const buyerEmail = cleanText(body.buyer?.email, 254)?.toLowerCase() ?? "";
    if (!EMAIL_RE.test(buyerEmail)) {
      return fail(400, "buyer_email_required", ORDER_ERRORS.buyer_email_required.message);
    }
    if (!isAllowedReturnUrl(body.success_url) || !isAllowedReturnUrl(body.cancel_url)) {
      log.warn("return_url_rejected", {
        success_origin: safeOrigin(body.success_url),
        cancel_origin: safeOrigin(body.cancel_url),
      });
      return fail(400, "invalid_return_url", "La dirección de vuelta del pago no está permitida.");
    }
    const successUrl = body.success_url as string;
    const cancelUrl = body.cancel_url as string;

    // Stripe no cobra importes por debajo de 0,50 €: mejor avisar antes de
    // reservar stock que dejar un pedido colgado 30 minutos.
    const { data: tierPrice } = await supabaseAdmin
      .from("ticket_tiers")
      .select("price_cents")
      .eq("id", tierId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (tierPrice && tierPrice.price_cents * qty < STRIPE_MIN_AMOUNT_CENTS) {
      return fail(
        400,
        "amount_below_minimum",
        tierPrice.price_cents === 0
          ? "Esta entrada es gratuita y todavía no se puede reservar desde aquí."
          : "El importe es inferior al mínimo que admite el pago con tarjeta (0,50 €).",
      );
    }

    const feePct = await readApplicationFeePct();

    // 1) Pedido + entradas 'pending' en una sola transacción con bloqueo.
    const { data: rows, error: rpcErr } = await supabaseAdmin.rpc("create_ticket_order", {
      _event_id: eventId,
      _tier_id: tierId,
      _qty: qty,
      _buyer_user_id: user.id,
      _buyer_email: buyerEmail,
      _buyer_first_name: cleanText(body.buyer?.first_name, 100),
      _buyer_last_name: cleanText(body.buyer?.last_name, 100),
      _buyer_phone: cleanText(body.buyer?.phone, 30),
      _fee_pct: feePct,
      _ttl_minutes: ORDER_TTL_MINUTES,
    });
    if (rpcErr) {
      const code = matchOrderError(rpcErr.message);
      if (code) {
        log.info("order_rejected", { code, event_id: eventId, tier_id: tierId, qty });
        return fail(ORDER_ERRORS[code].status, code, ORDER_ERRORS[code].message);
      }
      log.error("order_create_failed", { error: rpcErr.message, code: rpcErr.code, event_id: eventId });
      return fail(500, "order_create_failed", "No hemos podido reservar tus entradas. Inténtalo de nuevo.");
    }
    const order = (Array.isArray(rows) ? rows[0] : rows) as CreatedOrder | undefined;
    if (!order?.order_id) {
      log.error("order_create_empty", { event_id: eventId });
      return fail(500, "order_create_failed", "No hemos podido reservar tus entradas. Inténtalo de nuevo.");
    }

    const olog = logger.child({ function: "stripe-create-checkout", order_id: order.order_id, user_id: user.id });

    // 2) Checkout Session con el precio que devuelve la BD.
    const tz = order.timezone || DEFAULT_TIMEZONE;
    const when = formatEventDateTime(order.event_date_start, tz, "short");
    const where = [order.venue_name, order.city].filter(Boolean).join(", ");
    const image = validImageUrl(order.event_image_url);
    const destination = order.stripe_destination_account || null;

    const nowSec = Math.floor(Date.now() / 1000);
    const minExpires = nowSec + 30 * 60 + 60; // Stripe: >= 30 min (+60 s de margen)
    const maxExpires = nowSec + 24 * 3600 - 60; // Stripe: <= 24 h
    const orderExpires = Math.floor(new Date(order.expires_at).getTime() / 1000);
    const expiresAt = Math.min(Math.max(Number.isFinite(orderExpires) ? orderExpires : minExpires, minExpires), maxExpires);

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      locale: "es",
      payment_method_types: ["card"],
      line_items: [{
        quantity: order.qty,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: order.unit_price_cents,
          product_data: {
            name: `${order.event_title} · ${order.tier_name}`.slice(0, 250),
            description: [when, where].filter(Boolean).join(" · ").slice(0, 500) || undefined,
            images: image ? [image] : undefined,
          },
        },
      }],
      customer_email: buyerEmail,
      client_reference_id: order.order_id,
      success_url: appendParams(successUrl, `order_id=${order.order_id}&session_id={CHECKOUT_SESSION_ID}`),
      cancel_url: appendParams(cancelUrl, `order_id=${order.order_id}`),
      expires_at: expiresAt,
      metadata: {
        order_id: order.order_id,
        event_id: eventId,
        tier_id: tierId,
        qty: String(order.qty),
        request_id: order.request_id,
        buyer_user_id: user.id,
      },
      payment_intent_data: {
        description: `Pasify · ${order.event_title} · ${order.qty} × ${order.tier_name}`.slice(0, 500),
        metadata: {
          order_id: order.order_id,
          event_id: eventId,
          ...(destination ? { partner_account: destination } : {}),
        },
        ...(destination
          ? {
              application_fee_amount: order.fee_cents,
              transfer_data: { destination },
              on_behalf_of: destination,
            }
          : {}),
      },
    };

    const stripe = requireStripe();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(params, { idempotencyKey: `checkout-${order.order_id}` });
    } catch (err) {
      // Sin sesión no se ha cobrado nada: se anula el pedido para liberar las
      // plazas en el acto.
      const e = err as { type?: string; code?: string; message?: string };
      olog.error("stripe_session_create_failed", { type: e.type, code: e.code, error: e.message });
      const { error: cancelErr } = await supabaseAdmin.rpc("cancel_ticket_order", { _order_id: order.order_id });
      if (cancelErr) olog.warn("order_cancel_failed", { error: cancelErr.message });
      return fail(
        502,
        "payment_provider_error",
        "No hemos podido abrir la pasarela de pago. No se te ha cobrado nada: inténtalo de nuevo en unos minutos.",
      );
    }

    // 3) Enlazar la sesión al pedido. Sin esto el webhook no encontraría el
    //    pedido al cobrar: si falla, anulamos la sesión y no damos la URL.
    const { error: linkErr } = await supabaseAdmin.rpc("set_order_stripe_session", {
      _order_id: order.order_id,
      _session_id: session.id,
    });
    if (linkErr || !session.url) {
      olog.error("order_link_failed", { session_id: session.id, error: linkErr?.message ?? "missing_session_url" });
      await stripe.checkout.sessions.expire(session.id).catch((e) =>
        olog.warn("stripe_session_expire_failed", { session_id: session.id, error: String(e) })
      );
      const { error: cancelErr } = await supabaseAdmin.rpc("cancel_ticket_order", { _order_id: order.order_id });
      if (cancelErr) olog.warn("order_cancel_failed", { error: cancelErr.message });
      return fail(500, "order_link_failed", "No hemos podido preparar el pago. No se te ha cobrado nada: inténtalo de nuevo.");
    }

    olog.info("checkout_session_created", {
      session_id: session.id,
      amount_total: order.subtotal_cents,
      fee_cents: destination ? order.fee_cents : 0,
      connect: !!destination,
    });

    return jsonResponse({
      url: session.url,
      order_id: order.order_id,
      session_id: session.id,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    });
  } catch (err) {
    // Errores conocidos (payments_unavailable…): su código y su texto tal cual.
    if (err instanceof HttpError) {
      log.warn("checkout_rejected", { code: err.code, status: err.status });
      return fail(err.status, err.code, err.message);
    }
    log.error("stripe-create-checkout failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal_error", "Ha ocurrido un error inesperado. Inténtalo de nuevo.");
  }
});

function safeOrigin(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw).origin;
  } catch {
    return "invalid";
  }
}

/** Stripe rechaza la sesión entera si una imagen no es una URL https válida. */
function validImageUrl(raw: string | null): string | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
