/**
 * Pasify · utilidades de presentación de entradas.
 *
 * Funciones puras (sin React) que comparten el selector de entradas
 * (TierPickerSheet), la cartera (ClientDashboard + TicketQRModal), las
 * páginas de vuelta de Stripe (TicketSuccess, TicketReturn) y la entrada
 * pública (PublicTicket).
 *
 * Fechas: un evento se muestra SIEMPRE en su hora local (Europe/Madrid por
 * defecto), no en la del dispositivo. Quien abre la entrada desde Londres
 * tiene que ver la misma hora que pone en la puerta del local.
 */

export const DEFAULT_EVENT_TIMEZONE = "Europe/Madrid";

/** Tope por pedido que valida `stripe-create-checkout` (qty 1..10). */
export const MAX_TICKETS_PER_ORDER = 10;

/**
 * Código de puerta: los 8 primeros caracteres del `qr_token` en mayúsculas.
 * Es lo que teclea el portero (`scan_ticket_by_code`) si el QR no se lee, y
 * cambia con el QR cuando la entrada se transfiere. Mismo cálculo que
 * `ticketDoorCode` en supabase/functions/_shared/email-templates.ts.
 */
export function ticketDoorCode(qrToken: string | null | undefined): string | null {
  const hex = (qrToken ?? "").replace(/-/g, "");
  return hex.length >= 8 ? hex.slice(0, 8).toUpperCase() : null;
}

// ============================================================ precios

/** 1200 → "12 €", 1250 → "12,50 €". */
export function formatPriceCents(cents: number, currency = "EUR"): string {
  const value = (Number.isFinite(cents) ? cents : 0) / 100;
  const decimals = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: (currency || "EUR").toUpperCase(),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} €`;
  }
}

/**
 * Etiqueta de precio de un evento en las tarjetas. `events.price_cents` es el
 * mínimo de sus tipos de entrada, así que siempre es un "Desde".
 */
export function eventPriceLabel(
  cents: number | null | undefined,
  currency = "EUR"
): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  if (cents <= 0) return "Gratis";
  return `Desde ${formatPriceCents(cents, currency)}`;
}

// ============================================================ fechas

const validTimeZones = new Map<string, boolean>();

function resolveTimeZone(tz?: string | null): string {
  if (!tz) return DEFAULT_EVENT_TIMEZONE;
  if (!validTimeZones.has(tz)) {
    try {
      new Intl.DateTimeFormat("es-ES", { timeZone: tz });
      validTimeZones.set(tz, true);
    } catch {
      validTimeZones.set(tz, false);
    }
  }
  return validTimeZones.get(tz) ? tz : DEFAULT_EVENT_TIMEZONE;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIn(
  iso: string | null | undefined,
  tz: string | null | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  const d = toDate(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat("es-ES", { ...options, timeZone: resolveTimeZone(tz) }).format(d);
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Sábado, 12 de octubre" */
export const formatEventDate = (iso: string | null | undefined, tz?: string | null) =>
  capitalize(formatIn(iso, tz, { weekday: "long", day: "numeric", month: "long" }));

/** "sáb, 12 oct" */
export const formatEventDateShort = (iso: string | null | undefined, tz?: string | null) =>
  formatIn(iso, tz, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");

/** "23:30" */
export const formatEventTime = (iso: string | null | undefined, tz?: string | null) =>
  formatIn(iso, tz, { hour: "2-digit", minute: "2-digit" });

/** "Sábado, 12 de octubre · 23:30" */
export function formatEventDateTime(iso: string | null | undefined, tz?: string | null): string {
  const date = formatEventDate(iso, tz);
  const time = formatEventTime(iso, tz);
  return date && time ? `${date} · ${time}` : date || time;
}

/** "12 de octubre a las 23:45" (p. ej. cuándo se validó una entrada). */
export function formatMomentLong(iso: string | null | undefined, tz?: string | null): string {
  const date = formatIn(iso, tz, { day: "numeric", month: "long" });
  const time = formatEventTime(iso, tz);
  return date && time ? `${date} a las ${time}` : date;
}

/** Piezas de las píldoras de fecha de las tarjetas: { day: "12", month: "oct" }. */
export function eventDayMonth(
  iso: string | null | undefined,
  tz?: string | null
): { day: string; month: string } | null {
  const d = toDate(iso);
  if (!d) return null;
  const parts = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: resolveTimeZone(tz),
  }).formatToParts(d);
  return {
    day: parts.find((p) => p.type === "day")?.value ?? "",
    month: (parts.find((p) => p.type === "month")?.value ?? "").replace(/\./g, ""),
  };
}

// ============================================================ tipos de entrada

export interface TierOption {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  capacity: number | null;
  sold: number;
  per_user_max: number;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  sort_order: number;
}

export type TierAvailability =
  | { kind: "available"; maxQty: number; remaining: number | null }
  | { kind: "sold_out" }
  | { kind: "not_started"; startsAt: string }
  | { kind: "ended" };

/**
 * Misma regla que aplica `stripe-create-checkout` antes de cobrar: aforo del
 * tipo, ventana de venta y máximo por persona (y el tope de 10 por pedido).
 */
export function tierAvailability(tier: TierOption, now: number = Date.now()): TierAvailability {
  const remaining =
    tier.capacity != null ? Math.max(0, tier.capacity - (tier.sold ?? 0)) : null;
  if (remaining === 0) return { kind: "sold_out" };

  const startsAt = tier.sale_starts_at ? Date.parse(tier.sale_starts_at) : NaN;
  if (Number.isFinite(startsAt) && startsAt > now) {
    return { kind: "not_started", startsAt: tier.sale_starts_at as string };
  }
  const endsAt = tier.sale_ends_at ? Date.parse(tier.sale_ends_at) : NaN;
  if (Number.isFinite(endsAt) && endsAt < now) return { kind: "ended" };

  const perUser =
    tier.per_user_max && tier.per_user_max > 0 ? tier.per_user_max : MAX_TICKETS_PER_ORDER;
  const maxQty = Math.min(perUser, remaining ?? MAX_TICKETS_PER_ORDER, MAX_TICKETS_PER_ORDER);
  if (maxQty < 1) return { kind: "sold_out" };
  return { kind: "available", maxQty, remaining };
}

// ============================================================ titular

export interface TicketNameFields {
  holder_first_name?: string | null;
  holder_last_name?: string | null;
  holder_email?: string | null;
  buyer_first_name?: string | null;
  buyer_last_name?: string | null;
  buyer_email?: string | null;
  transferred_to_user_id?: string | null;
}

/**
 * Nombre a mostrar del titular. Tras una transferencia el titular cambia pero
 * los campos `buyer_*` siguen siendo del comprador original: en ese caso no
 * los usamos como respaldo.
 */
export function ticketHolderName(t: TicketNameFields): string {
  const holder = [t.holder_first_name, t.holder_last_name].filter(Boolean).join(" ").trim();
  if (holder) return holder;
  if (!t.transferred_to_user_id) {
    const buyer = [t.buyer_first_name, t.buyer_last_name].filter(Boolean).join(" ").trim();
    if (buyer) return buyer;
  }
  return t.holder_email || (!t.transferred_to_user_id ? t.buyer_email ?? "" : "");
}

// ============================================================ errores de edge functions

const CODE_RE = /^[a-z][a-z0-9_]*$/;
const GENERIC_CODES = new Set(["generic_error", "internal_error"]);

/**
 * Lee el error de una edge function aceptando los dos formatos en uso:
 *   - contrato nuevo: `{ error: "<code>", message: "<texto para el usuario>" }`
 *   - `_shared/cors.ts` antiguo: `{ error: { message, code } }`, donde
 *     `message` a veces es el código y a veces un texto técnico.
 * `message` solo se rellena con texto pensado para el usuario (el `message`
 * de primer nivel); el texto técnico va a `detail`, para los logs.
 * `codes` trae todos los códigos encontrados, por si el útil no es el primero.
 */
export function parseEdgeError(body: unknown): {
  code: string | null;
  codes: string[];
  message: string | null;
  detail: string | null;
} {
  const codes: string[] = [];
  let message: string | null = null;
  let detail: string | null = null;

  const asCode = (v: unknown) => {
    if (typeof v === "string" && CODE_RE.test(v.trim())) codes.push(v.trim());
  };

  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") asCode(b.error);
    if (b.error && typeof b.error === "object") {
      const e = b.error as Record<string, unknown>;
      asCode(e.code);
      if (typeof e.message === "string") {
        if (CODE_RE.test(e.message.trim())) asCode(e.message);
        else detail = e.message;
      }
    }
    asCode(b.code);
    if (typeof b.message === "string" && b.message.trim()) {
      if (CODE_RE.test(b.message.trim())) asCode(b.message);
      else message = b.message.trim();
    }
  }

  const code = codes.find((c) => !GENERIC_CODES.has(c)) ?? codes[0] ?? null;
  return { code, codes, message, detail };
}
