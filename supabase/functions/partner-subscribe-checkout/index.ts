// Pasify · partner-subscribe-checkout — RETIRADA (410 Gone)
// El plan Premium de 29,99 € se ha retirado (decisión D3 del plan del panel
// de local): Pasify gana con la comisión por entrada y todos los locales
// tienen el plan gratuito desde el alta (claim_partner_free_plan). Además,
// cualquier miembro de la organización, incluido el portero, podía dejar el
// plan en 'incomplete' y la URL de vuelta no se validaba.
// El stub no toca nada; se deja para que el deploy sobrescriba la versión
// publicada. Las suscripciones que ya existan en Stripe las sigue
// gestionando stripe-webhook.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
