// Pasify · stripe-create-portal-test — RETIRADA (410 Gone)
// Copia [TEST MODE] de Students Life que seguía publicada en producción (portal
// de facturación con las claves de Stripe de test). PartnerManage solo la usa
// si VITE_STRIPE_TEST_MODE === "true", que en producción no se cumple.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete stripe-create-portal-test` y borrar
// esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
