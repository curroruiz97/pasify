import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";
import {
  MAX_TICKETS_PER_ORDER,
  type TierLiveAvailability,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * Pasify · tipos de entrada de un evento, para el selector de compra
 * (useTicketCheckout) y la página pública del evento (PublicEvent).
 *
 * La disponibilidad sale de la RPC `event_availability`, que cuenta también
 * las reservas en curso (pedidos pendientes de pago). Antes se calculaba con
 * capacity − sold: el selector decía «Queda 1» y el servidor contestaba
 * «agotado», también después de «Actualizar disponibilidad». Si la RPC falla
 * o no contesta a tiempo, se sigue con la estimación de antes: mejor vender
 * con una cifra aproximada que no dejar abrir el selector.
 */

/** Columnas de `ticket_tiers` que necesitan el selector y la página del evento. */
export const TIER_COLUMNS =
  "id, name, description, price_cents, currency, capacity, sold, per_user_max, sale_starts_at, sale_ends_at, sort_order, refundable_until_hours_before, transfer_allowed";

/** Ninguna carga puede dejar el botón de compra girando para siempre. */
const TIERS_TIMEOUT_MS = 15_000;
/** Lo que se espera a `event_availability` antes de seguir sin ella. */
const AVAILABILITY_TIMEOUT_MS = 6_000;

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

/** `event_availability` aún no está en los types generados. */
type AvailabilityRpc = {
  rpc: (fn: "event_availability", args: { _event_id: string }) => PromiseLike<RpcResult>;
};

/** Fila de `ticket_tiers` con TIER_COLUMNS. */
export interface TierRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  capacity: number | null;
  sold: number | null;
  per_user_max: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  sort_order: number | null;
  refundable_until_hours_before: number | null;
  transfer_allowed: boolean | null;
}

const toCount = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
};

/**
 * Disponibilidad por tipo (`tier_id` → plazas libres / agotado). null si la
 * RPC falla o tarda: quien llama se queda con capacity − sold. Un tipo que
 * la RPC no devuelve también se estima como antes.
 */
export async function fetchEventAvailability(
  eventId: string
): Promise<Map<string, TierLiveAvailability> | null> {
  try {
    const { data, error } = await withTimeout(
      (supabase as unknown as AvailabilityRpc).rpc("event_availability", { _event_id: eventId }),
      AVAILABILITY_TIMEOUT_MS,
      "rpc event_availability"
    );
    if (error || !Array.isArray(data)) {
      console.warn(
        "[tiers] event_availability no disponible; se estima con capacity - sold",
        error?.message ?? data
      );
      return null;
    }
    const byTier = new Map<string, TierLiveAvailability>();
    for (const row of data as Array<Record<string, unknown> | null>) {
      if (!row || typeof row.tier_id !== "string") continue;
      const remaining = toCount(row.remaining);
      // Un valor ilegible no es "sin límite": ese tipo se estima como antes.
      if (remaining === undefined) continue;
      byTier.set(row.tier_id, { remaining, soldOut: row.sold_out === true });
    }
    return byTier;
  } catch (err) {
    console.warn("[tiers] event_availability sin respuesta; se estima con capacity - sold", err);
    return null;
  }
}

export function toTierOption(t: TierRow, live?: TierLiveAvailability | null): TierOption {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    price_cents: t.price_cents ?? 0,
    currency: t.currency || "EUR",
    capacity: t.capacity ?? null,
    sold: t.sold ?? 0,
    per_user_max: t.per_user_max ?? MAX_TICKETS_PER_ORDER,
    sale_starts_at: t.sale_starts_at ?? null,
    sale_ends_at: t.sale_ends_at ?? null,
    sort_order: t.sort_order ?? 0,
    refundable_until_hours_before:
      typeof t.refundable_until_hours_before === "number" ? t.refundable_until_hours_before : null,
    transfer_allowed: t.transfer_allowed === true,
    live: live ?? null,
  };
}

/** Tipos ACTIVOS del evento, en su orden, con la disponibilidad real si se puede. */
export async function fetchEventTiers(eventId: string): Promise<TierOption[]> {
  const [tiersRes, availability] = await Promise.all([
    withTimeout(
      supabase
        .from("ticket_tiers")
        .select(TIER_COLUMNS)
        .eq("event_id", eventId)
        .eq("status", "active")
        .order("sort_order", { ascending: true }),
      TIERS_TIMEOUT_MS,
      "ticket_tiers"
    ),
    fetchEventAvailability(eventId),
  ]);
  if (tiersRes.error) throw new Error(tiersRes.error.message);
  return ((tiersRes.data ?? []) as TierRow[]).map((t) => toTierOption(t, availability?.get(t.id)));
}
