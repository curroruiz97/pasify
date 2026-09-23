// Pasify · moderate-content — RETIRADA (410 Gone)
// Función legacy de Students Life (moderación de posts/chat con Gemini) que
// seguía publicada en producción. Solo la llama código sin ruta (components/
// social, pages/ChatConversation, shared/UploadSheet); abierta, cualquiera
// gastaba nuestra API key.
// Este stub existe para que el deploy sobrescriba esa versión. Una vez
// desplegado: `supabase functions delete moderate-content` y borrar esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
