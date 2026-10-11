import { MAX_TICKETS_PER_ORDER } from "@/components/tickets/ticketUtils";

/**
 * Límites de un tipo de entrada: cupo y máximo por persona.
 *
 *   - Cupo (`ticket_tiers.capacity`): vacío = sin límite (NULL); si no, un
 *     entero de 1 o más (la BD lo exige: CHECK capacity > 0). Con ventas no
 *     puede bajar de lo vendido (trg_enforce_tier_immutable_on_sales).
 *   - Máximo por persona (`ticket_tiers.per_user_max`): un entero de 1 a 10.
 *     La BD no lo acota, pero la reserva de entradas rechaza cualquier compra
 *     con `qty > per_user_max`: con 0 o un negativo el tipo no se puede vender
 *     nunca. Y un pedido no pasa de 10 entradas (RPC de reserva y
 *     stripe-create-checkout); es el mismo tope que usa la web de compra
 *     (`MAX_TICKETS_PER_ORDER`), así que no se ofrece más.
 *
 * Antes se leían con `parseInt`: "2.5" valía 2, "1e3" valía 1 y un 0 o un
 * negativo en «Máx. por usuario» se guardaba tal cual.
 */

/** Más entradas por persona de las que caben en un pedido no tienen efecto. */
export const MAX_PER_USER = MAX_TICKETS_PER_ORDER;

/** Mayor cupo que cabe en `ticket_tiers.capacity` (INT de Postgres). */
const MAX_INT4 = 2_147_483_647;

/**
 * Lo escrito, ya leído. `error` es null si vale; `value` es null si no vale
 * (y, en el cupo, también cuando se deja vacío: sin límite). Sin unión
 * discriminada: el proyecto no usa strictNullChecks y no estrecharía.
 */
export interface Parsed<T> {
  value: T | null;
  error: string | null;
}

/** Entero de 1 a `max` escrito solo con cifras ("12"); null si no lo es (decimales, signo, "1e3", texto). */
const entero = (raw: string, max: number): number | null => {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
};

/** Cupo escrito: vacío = sin límite (value null); si no, un entero ≥ 1 (y ≥ `vendidas`). */
export const parseCapacity = (raw: string, vendidas = 0): Parsed<number> => {
  if (raw.trim() === "") return { value: null, error: null };
  const n = entero(raw, MAX_INT4);
  if (n === null) {
    return { value: null, error: "Escribe un número entero de 1 o más, o déjalo vacío para no poner límite." };
  }
  if (n < vendidas) {
    return { value: null, error: `No puede ser menor que las entradas ya vendidas (${vendidas}).` };
  }
  return { value: n, error: null };
};

/** Máximo por persona escrito: un entero de 1 a MAX_PER_USER (vacío no vale). */
export const parsePerUserMax = (raw: string): Parsed<number> => {
  const n = entero(raw, MAX_PER_USER);
  return n === null
    ? { value: null, error: `Escribe un número entero entre 1 y ${MAX_PER_USER}.` }
    : { value: n, error: null };
};

/** Cupo para la BD (null = sin límite). Solo se llama tras validar: con un valor no válido falla, no adivina. */
export const capacityForDb = (raw: string): number | null => {
  const r = parseCapacity(raw);
  if (r.error) throw new Error(`Cupo no válido: ${r.error}`);
  return r.value;
};

/** Máximo por persona para la BD. Solo se llama tras validar: con un valor no válido falla en vez de poner uno por defecto. */
export const perUserMaxForDb = (raw: string): number => {
  const r = parsePerUserMax(raw);
  if (r.error) throw new Error(`Máximo por usuario no válido: ${r.error}`);
  return r.value;
};
