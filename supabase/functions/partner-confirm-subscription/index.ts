// Pasify · partner-confirm-subscription — RETIRADA (410 Gone)
// Era el respaldo de /partner/success para confirmar una suscripción Premium
// si no llegaba el webhook. Premium se ha retirado (decisión D3 del plan del
// panel de local): todos los locales tienen el plan gratuito y
// partner-subscribe-checkout ya no crea sesiones. Además escribía
// plan_code 'premium' en la organización de los metadatos de la sesión sin
// comprobar que quien llamaba fuera de esa organización.
// El stub no toca nada; se deja para que el deploy sobrescriba la versión
// publicada. Las suscripciones que ya existan en Stripe las sigue
// gestionando stripe-webhook (el mapeo de estados vive en _shared/stripe.ts).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve((req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  return jsonResponse({ error: "gone" }, { status: 410 });
});
