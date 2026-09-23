// Pasify · stripe-create-checkout-test — RETIRADA (410 Gone)
// Copia [TEST MODE] de Students Life que seguía publicada en producción: creaba
// checkouts con las claves de Stripe de test. Junto con
// stripe-sync-session-test permitía activar una suscripción pagando con una
// tarjeta de prueba.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete stripe-create-checkout-test` y borrar
// esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
