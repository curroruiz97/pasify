// Pasify · stripe-sync-session-test — RETIRADA (410 Gone)
// Copia [TEST MODE] de Students Life que seguía publicada en producción:
// escribía partner_subscriptions con la service role a partir de un checkout
// de Stripe en modo test. Con stripe-create-checkout-test, suscripción activa
// pagando con una tarjeta de prueba.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete stripe-sync-session-test` y borrar
// esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
