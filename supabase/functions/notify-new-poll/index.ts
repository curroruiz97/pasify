// Pasify · notify-new-poll — RETIRADA (410 Gone)
// Función legacy de Students Life (encuestas) que seguía publicada en
// producción: push con texto libre a TODOS los dispositivos registrados. Solo
// la llama código sin ruta (components/social/CreatePoll).
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete notify-new-poll` y borrar esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
