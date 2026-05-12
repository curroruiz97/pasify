// Cancella la subscription di un Partner (chiamata solo da admin).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing auth" }, 401);

    const token = auth.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    // Verifica ruolo admin
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles || []).some((r: any) => r.role === "admin");
    if (!isAdmin) return json({ error: "Admin only" }, 403);

    const body = await req.json();
    const subscriptionId = body.subscription_id;
    const immediate = body.immediate === true;
    if (!subscriptionId) return json({ error: "subscription_id required" }, 400);

    // Cancel via Stripe API
    let canceled;
    if (immediate) {
      canceled = await stripe.subscriptions.cancel(subscriptionId);
    } else {
      // Cancel at period end (recommended — il partner finisce il periodo pagato)
      canceled = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }

    // Aggiorna DB
    await sb
      .from("partner_subscriptions")
      .update({
        status: canceled.status,
        cancel_at_period_end: canceled.cancel_at_period_end,
      })
      .eq("stripe_subscription_id", subscriptionId);

    return json({ ok: true, status: canceled.status, cancel_at_period_end: canceled.cancel_at_period_end });
  } catch (err) {
    console.error("cancel-partner-subscription error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
