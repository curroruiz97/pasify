/**
 * Precio de un tipo de entrada.
 *
 * Stripe no cobra importes de 0,01 a 0,49 €: una entrada de pago cuesta al
 * menos 0,50 € (la BD lo exige con trg_ticket_tiers_guard_min_price). La
 * regla de las entradas de 0 € no cambia aquí: depende de la decisión
 * pendiente sobre entradas gratis.
 */
export const MIN_PAID_PRICE_CENTS = 50;

/** Céntimos de un precio escrito ("12.50"); null si no es un número válido. */
export const priceEurToCents = (priceEur: string): number | null => {
  const value = parseFloat(priceEur);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

/** Precio entre 0,01 y 0,49 €, que Stripe no puede cobrar. */
export const isBelowStripeMinimum = (priceEur: string): boolean => {
  const cents = priceEurToCents(priceEur);
  return cents !== null && cents > 0 && cents < MIN_PAID_PRICE_CENTS;
};
