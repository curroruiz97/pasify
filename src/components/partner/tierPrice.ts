/**
 * Precio de un tipo de entrada.
 *
 * Stripe no cobra importes de 0,01 a 0,49 €: una entrada de pago cuesta al
 * menos 0,50 € (la BD lo exige con trg_ticket_tiers_guard_min_price). La
 * regla de las entradas de 0 € no cambia aquí: depende de la decisión
 * pendiente sobre entradas gratis.
 */
export const MIN_PAID_PRICE_CENTS = 50;

/** Mayor importe que cabe en `ticket_tiers.price_cents` (INT de Postgres). */
const MAX_PRICE_CENTS = 2_147_483_647;

/**
 * Céntimos de un precio escrito ("12.50", "12,5" o "12"); null si no es un
 * importe válido: solo cifras, coma o punto y como mucho dos decimales.
 *
 * Con `parseFloat` suelto, "12,5" valía 12, "12.999" se redondeaba a 13 € sin
 * avisar, "1e3" pasaba por 1.000 € y "0,30" o "0.001" se quedaban en 0 (una
 * entrada gratis donde se quería cobrar).
 */
export const priceEurToCents = (priceEur: string): number | null => {
  const text = priceEur.trim();
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text.replace(",", ".")) * 100);
  return cents <= MAX_PRICE_CENTS ? cents : null;
};

/**
 * Céntimos para la BD. Solo se llama tras validar: con un precio que no vale
 * falla en vez de dejarlo en 0 € (una entrada gratis donde se quería cobrar).
 */
export const priceCentsForDb = (priceEur: string): number => {
  const cents = priceEurToCents(priceEur);
  if (cents === null) throw new Error(`Precio no válido: «${priceEur}»`);
  return cents;
};

/** Precio entre 0,01 y 0,49 €, que Stripe no puede cobrar. */
export const isBelowStripeMinimum = (priceEur: string): boolean => {
  const cents = priceEurToCents(priceEur);
  return cents !== null && cents > 0 && cents < MIN_PAID_PRICE_CENTS;
};

/** Aviso de un precio escrito que no se entiende; null si es válido o está vacío (eso lo pide «Siguiente»). */
export const priceFormatError = (priceEur: string): string | null =>
  priceEur.trim() !== "" && priceEurToCents(priceEur) === null
    ? "Escribe el precio en euros con hasta dos decimales, por ejemplo 12,50."
    : null;
