// DEBUG (temporaneo): ritorna i prefissi dei secret Stripe live per verificare
// allineamento senza esporre i valori. Restituisce solo primi 15 chars.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  const mask = (v: string | undefined) => {
    if (!v) return "UNDEFINED";
    if (v.length < 10) return `LEN=${v.length}`;
    return `${v.slice(0, 15)}…(len=${v.length})`;
  };

  const report = {
    STRIPE_SECRET_KEY: mask(Deno.env.get("STRIPE_SECRET_KEY")),
    STRIPE_PRICE_PARTNER: Deno.env.get("STRIPE_PRICE_PARTNER") ?? "UNDEFINED",
    STRIPE_WEBHOOK_SECRET: mask(Deno.env.get("STRIPE_WEBHOOK_SECRET")),
    STRIPE_SECRET_KEY_TEST: mask(Deno.env.get("STRIPE_SECRET_KEY_TEST")),
    STRIPE_PRICE_PARTNER_TEST: Deno.env.get("STRIPE_PRICE_PARTNER_TEST") ?? "UNDEFINED",
  };

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
