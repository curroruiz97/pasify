// Pasify · stripe-create-checkout
// Compra de N entradas de un tier: crea la Checkout Session de Stripe o, si el
// tipo cuesta 0 €, emite las entradas gratis sin pasar por Stripe.
// Soporta Stripe Connect (destination charges); Pasify cobra application_fee.
//
// Flujo:
//   0) Siempre con sesión: sin comprador no hay límite por persona y una
//      reserva anónima retenía plazas 47 minutos.
//   1) Valida el payload.
//   2) Antes de reservar, resuelve los pedidos 'pending' del mismo comprador y
//      evento (vuelve atrás desde Stripe y quiere comprar menos: su reserva
//      anterior le contaba para el máximo por persona). Caduca su sesión y
//      libera las plazas; si alguno resulta cobrado se confirma y no se anula
//      (settlePendingOrder, _shared/order-paid.ts).
//   3a) Tipo de 0 €: `create_free_ticket_order` (mismos bloqueos y límites,
//       pedido ya pagado a 0 €) y, en segundo plano, email con QR y avisos
//       (sin puntos). Sin Stripe: vale aunque los pagos estén en pruebas.
//   3b) Tipo de pago: en producción solo con clave live (assertLivePayments),
//       URLs de vuelta de la allowlist (_shared/urls.ts),
//       `create_ticket_order` (bloquea filas, valida stock, aforo, ventana de
//       venta, límites y local suspendido, y crea pedido + entradas 'pending'
//       de forma atómica; el precio sale de la BD, nunca del cliente) y la
//       Checkout Session enlazada al pedido con `set_order_stripe_session`.
//
// Body: { event_id, tier_id, qty, buyer: { email, first_name?, last_name?, phone? }, success_url, cancel_url }
//       (las URLs solo hacen falta para un tipo de pago)
// Returns 200: { url, order_id, session_id, expires_at }  ·  gratis: { free: true, order_id }
// Errores: { error: <código>, message: <texto para el usuario> }
//   409 event_not_available | tier_not_available | sale_not_started | sale_ended | tier_sold_out | event_sold_out
//       org_suspended | tier_not_free
//   400 invalid_payload | invalid_qty | qty_exceeds_per_user_max | buyer_email_required | invalid_return_url | amount_below_minimum
//   401 auth_required · 503 payments_unavailable
//   429 rate_limit_exceeded · 502 payment_provider_error · 500 order_create_failed | order_link_failed | internal_error

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type Stripe from "npm:stripe@14";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { requireStripe, stripe as stripeClient, assertLivePayments, DEFAULT_APPLICATION_FEE_PCT } from "../_shared/stripe.ts";
import { enforceRateLimit, RateLimitError } from "../_shared/rate-limit.ts";
import { DEFAULT_TIMEZONE, formatEventDateTime } from "../_shared/email-templates.ts";
import { isAllowedReturnUrl, safeOrigin } from "../_shared/urls.ts";
import { handleFreeOrderCreated, settlePendingOrder } from "../_shared/order-paid.ts";
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

/** Fila que devuelve `create_free_ticket_order`. */
interface CreatedFreeOrder {
  order_id: string;
  request_id: string;
  org_id: string | null;
  event_id: string;
  qty: number;
}

type Log = ReturnType<typeof logger.child>;

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
/** Pedidos pendientes anteriores que se resuelven como mucho por petición. */
const MAX_PENDING_TO_RELEASE = 10;
/**
 * Un pedido pendiente sin sesión y más reciente que esto lo está preparando
 * ahora mismo otra petición del mismo comprador: no se toca.
 */
const FRESH_UNLINKED_ORDER_MS = 2 * 60 * 1000;

/** Errores de negocio que lanzan las RPC de pedido (RAISE EXCEPTION '<código>'). */
const ORDER_ERRORS: Record<string, { status: number; message: string }> = {
  event_not_available: { status: 409, message: "Este evento ya no está a la venta." },
  tier_not_available: { status: 409, message: "Este tipo de entrada ya no está disponible." },
  sale_not_started: { status: 409, message: "La venta de estas entradas todavía no ha empezado." },
  sale_ended: { status: 409, message: "La venta de estas entradas ha terminado." },
  tier_sold_out: { status: 409, message: "No quedan suficientes entradas de este tipo. Prueba con menos cantidad u otro tipo de entrada." },
  event_sold_out: { status: 409, message: "El evento está completo: no quedan entradas." },
  org_suspended: { status: 409, message: "Este local no puede vender entradas ahora mismo." },
  tier_not_free: { status: 409, message: "El precio de esta entrada ha cambiado. Vuelve a intentarlo." },
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

/**
 * Efectos del pedido gratis sin hacer esperar la respuesta: la app pasa ya a
 * la página de confirmación. El runtime mantiene viva la función hasta que
 * terminan (EdgeRuntime.waitUntil); si no existe, se esperan aquí.
 */
async function runInBackground(task: Promise<unknown>): Promise<void> {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  await task;
}

/**
 * Paso 2: pedidos 'pending' anteriores de este comprador en este evento. Nunca
 * lanza: si uno no se puede resolver, la RPC de pedido decidirá con él
 * todavía reservado (como antes).
 */
async function releasePendingOrders(userId: string, eventId: string, log: Log): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("ticket_orders")
    .select("id, stripe_session_id, created_at")
    .eq("buyer_user_id", userId)
    .eq("event_id", eventId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_PENDING_TO_RELEASE);
  if (error) {
    log.warn("pending_orders_query_failed", { error: error.message });
    return;
  }
  for (const prev of (data ?? []) as Array<{ id: string; stripe_session_id: string | null; created_at: string }>) {
    const age = Date.now() - Date.parse(prev.created_at);
    if (!prev.stripe_session_id && Number.isFinite(age) && age < FRESH_UNLINKED_ORDER_MS) {
      log.info("previous_pending_order_in_flight", { previous_order_id: prev.id });
      continue;
    }
    try {
      const outcome = await settlePendingOrder(
        { id: prev.id, stripe_session_id: prev.stripe_session_id },
        { stripe: stripeClient, source: "stripe-create-checkout:release", cancelAs: "failed" },
      );
      log.info("previous_pending_order_settled", { previous_order_id: prev.id, outcome });
    } catch (err) {
      log.warn("previous_pending_order_settle_failed", {
        previous_order_id: prev.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Método no permitido.");

  const log = logger.child({ function: "stripe-create-checkout" });

  try {
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
    const buyer = {
      _buyer_user_id: user.id,
      _buyer_email: buyerEmail,
      _buyer_first_name: cleanText(body.buyer?.first_name, 100),
      _buyer_last_name: cleanText(body.buyer?.last_name, 100),
      _buyer_phone: cleanText(body.buyer?.phone, 30),
    };

    // El precio decide el camino (gratis o Stripe). La RPC lo vuelve a
    // comprobar con la fila bloqueada: aquí solo se elige.
    const { data: tierPrice, error: tierErr } = await supabaseAdmin
      .from("ticket_tiers")
      .select("price_cents")
      .eq("id", tierId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (tierErr) log.warn("tier_price_read_failed", { error: tierErr.message, tier_id: tierId });

    // ---------------------------------------------------------------------
    // 3a) Entradas gratis: sin Stripe
    // ---------------------------------------------------------------------
    if (tierPrice?.price_cents === 0) {
      await releasePendingOrders(user.id, eventId, log);

      const { data: rows, error: rpcErr } = await supabaseAdmin.rpc("create_free_ticket_order", {
        _event_id: eventId,
        _tier_id: tierId,
        _qty: qty,
        ...buyer,
      });
      if (rpcErr) {
        const code = matchOrderError(rpcErr.message);
        if (code) {
          log.info("free_order_rejected", { code, event_id: eventId, tier_id: tierId, qty });
          return fail(ORDER_ERRORS[code].status, code, ORDER_ERRORS[code].message);
        }
        log.error("free_order_create_failed", { error: rpcErr.message, code: rpcErr.code, event_id: eventId });
        return fail(500, "order_create_failed", "No hemos podido reservar tus entradas. Inténtalo de nuevo.");
      }
      const order = (Array.isArray(rows) ? rows[0] : rows) as CreatedFreeOrder | undefined;
      if (!order?.order_id) {
        log.error("free_order_create_empty", { event_id: eventId });
        return fail(500, "order_create_failed", "No hemos podido reservar tus entradas. Inténtalo de nuevo.");
      }

      log.info("free_order_created", { order_id: order.order_id, user_id: user.id, event_id: eventId, qty: order.qty });
      await runInBackground(handleFreeOrderCreated(order.order_id, "stripe-create-checkout:free"));
      return jsonResponse({ free: true, order_id: order.order_id });
    }

    // ---------------------------------------------------------------------
    // 3b) Entradas de pago
    // ---------------------------------------------------------------------
    // En producción con una clave de Stripe que no es live no se reserva
    // nada: 503 payments_unavailable (ver _shared/stripe.ts).
    assertLivePayments();

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
    if (tierPrice && tierPrice.price_cents * qty < STRIPE_MIN_AMOUNT_CENTS) {
      return fail(400, "amount_below_minimum", "El importe es inferior al mínimo que admite el pago con tarjeta (0,50 €).");
    }

    await releasePendingOrders(user.id, eventId, log);

    const feePct = await readApplicationFeePct();

    // 1) Pedido + entradas 'pending' en una sola transacción con bloqueo.
    const { data: rows, error: rpcErr } = await supabaseAdmin.rpc("create_ticket_order", {
      _event_id: eventId,
      _tier_id: tierId,
      _qty: qty,
      ...buyer,
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
