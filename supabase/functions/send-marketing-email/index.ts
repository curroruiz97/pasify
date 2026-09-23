// Pasify · send-marketing-email — RETIRADA (410 Gone)
// Legacy de Students Life: email masivo a "usuarios inactivos" leyendo tablas
// que no existen en Pasify (discounts, marketing_email_log, access_logs), sin
// autenticación y con un modo test_email que mandaba a cualquier dirección.
// El stub no toca nada; se deja para que el deploy sobrescriba la versión
// publicada. Después se puede borrar la función y esta carpeta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
