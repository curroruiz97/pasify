// Pasify · debug-stripe-config — RETIRADA (410 Gone)
// Devolvía a cualquiera los primeros 15 caracteres de STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET y de las claves de test. Se deja este stub para que el
// deploy sobrescriba la versión publicada; una vez desplegado se puede borrar
// la función (`supabase functions delete debug-stripe-config`) y esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
