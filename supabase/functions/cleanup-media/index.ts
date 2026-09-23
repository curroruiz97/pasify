// Pasify · cleanup-media — RETIRADA (410 Gone)
// Función legacy de Students Life que seguía publicada en producción (su código
// vive en tools/legacy-supabase-functions/). Borraba con la service role
// cualquier fichero de cualquier bucket cuya URL se le pasara en el body:
// cualquiera con un JWT (la anon key vale) podía vaciar Storage.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete cleanup-media` y borrar esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
