// Pasify · ai-pricing-propose · cálculo de la sugerencia de precio.
//
// Función pura (sin Deno, red ni base de datos) aparte de index.ts para poder
// probarla con node. Decide si un tipo de entrada merece una propuesta y con
// qué precio; index.ts se ocupa de lo demás (ventas, duplicadas, guardado).

/** Lo mínimo que Stripe cobra en EUR (0,50 €). Mismo valor que STRIPE_MIN_AMOUNT_CENTS de stripe-create-checkout. */
export const MIN_PAID_PRICE_CENTS = 50;

export interface SuggestTier {
  price_cents: number;
  sold: number;
  capacity: number | null;
}

export interface PriceSuggestion {
  suggestedPrice: number;
  deltaPct: number;
  expectedUpliftCents: number;
  confidence: number;
  rationale: string;
}

/**
 * Propuesta para un tipo según su velocidad de venta frente a la esperada, o
 * null si no hay nada que proponer:
 *   - sin cupo, o con un precio que no llega al mínimo de cobro (gratis, o
 *     0,01 a 0,49 € de un tipo antiguo, que Stripe no podría cobrar);
 *   - ritmo normal (sin subida ni rebaja);
 *   - una rebaja cuyo precio, subido al mínimo, queda igual que el actual.
 * La sugerencia nunca baja de MIN_PAID_PRICE_CENTS y deltaPct es siempre finito
 * (el precio actual es mayor que 0).
 */
export function suggestPrice(tier: SuggestTier, hoursToEvent: number): PriceSuggestion | null {
  const { price_cents: price, sold, capacity } = tier;
  if (capacity == null || !(capacity > 0)) return null;
  if (!(price >= MIN_PAID_PRICE_CENTS)) return null;

  const fillRate = sold / capacity;
  const expectedFillRate = Math.max(0, Math.min(1, 1 - hoursToEvent / 336)); // 14d → 0% sold expected
  const velocity = fillRate - expectedFillRate;

  let suggestedPrice: number;
  let rationale: string;
  let confidence: number;

  // Sube si vende >25% más rápido de lo esperado
  if (velocity > 0.25 && fillRate > 0.3) {
    const uplift = Math.min(0.15, velocity * 0.4); // hasta +15%
    suggestedPrice = Math.round(price * (1 + uplift));
    rationale = `Velocidad de venta ${Math.round(velocity * 100)}% sobre baseline. Subida sugerida para optimizar revenue.`;
    confidence = Math.min(0.92, 0.6 + velocity);
  }
  // Baja si vende >25% más lento
  else if (velocity < -0.25 && hoursToEvent < 168) {
    const cut = Math.min(0.15, Math.abs(velocity) * 0.3);
    suggestedPrice = Math.round(price * (1 - cut));
    rationale = `Venta lenta (${Math.round(velocity * 100)}% bajo baseline). Rebaja sugerida para estimular conversión.`;
    confidence = Math.min(0.85, 0.55 + Math.abs(velocity));
  } else {
    return null; // sin cambio → no proposal
  }

  // Una rebaja no deja el tipo por debajo de lo que Stripe cobra.
  suggestedPrice = Math.max(MIN_PAID_PRICE_CENTS, suggestedPrice);
  if (suggestedPrice === price) return null; // sin cambio real → no proposal

  const deltaPct = ((suggestedPrice - price) / price) * 100;
  const expectedUpliftCents = Math.round((suggestedPrice - price) * (capacity - sold) * 0.7);

  return { suggestedPrice, deltaPct, expectedUpliftCents, confidence, rationale };
}
