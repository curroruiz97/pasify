// Cancela la suscripción de un local. Solo admins de plataforma (has_role admin);
// la llama components/admin/SubscriptionsManagement.tsx.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { supabaseAdmin, requireUser, isPlatformAdmin } from "../_shared/supabase.ts";
import { HttpError } from "../_shared/internal-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    if (!(await isPlatformAdmin(user.id))) return json({ error: "Admin only" }, 403);

    const body = await req.json();
    const subscriptionId = body.subscription_id;
    const immediate = body.immediate === true;
    if (typeof subscriptionId !== "string" || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      return json({ error: "subscription_id required" }, 400);
    }

    // Cancel via Stripe API
    let canceled;
    try {
      if (immediate) {
        canceled = await stripe.subscriptions.cancel(subscriptionId);
      } else {
        // Cancelar a fin de periodo (recomendado: el local disfruta lo que ya pagó)
        canceled = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      }
    } catch (stripeErr) {
      console.error("cancel-partner-subscription stripe error:", stripeErr);
      return json({ error: "No se pudo cancelar la suscripción en Stripe" }, 502);
    }

    // Aggiorna DB
    await supabaseAdmin
      .from("partner_subscriptions")
      .update({
        status: canceled.status,
        cancel_at_period_end: canceled.cancel_at_period_end,
      })
      .eq("stripe_subscription_id", subscriptionId);

    return json({ ok: true, status: canceled.status, cancel_at_period_end: canceled.cancel_at_period_end });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code }, err.status);
    console.error("cancel-partner-subscription error:", err);
    return json({ error: "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
