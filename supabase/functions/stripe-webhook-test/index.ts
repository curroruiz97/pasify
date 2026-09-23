// Pasify · stripe-webhook-test — RETIRADA (410 Gone)
// Copia [TEST MODE] del webhook de Stripe de Students Life que seguía publicada
// en producción (claves y signing secret de test, datos fiscales de otra
// empresa). El webhook real es stripe-webhook.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete stripe-webhook-test` y borrar esta
// carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
