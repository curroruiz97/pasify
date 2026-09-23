// Pasify · test-email — RETIRADA (410 Gone)
// Función de prueba de Students Life que seguía publicada en producción:
// mandaba un email con nuestro remitente a la dirección que se le pasara.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete test-email` y borrar esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
