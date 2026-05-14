// [TEST MODE] Sincronizza direttamente la sub Partner dallo Stripe Checkout Session.
// Chiamata dal client in /partner/success come fallback garantito se il webhook
// è lento o fallisce. Verifica l'appartenenza del session_id all'utente loggato.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY_TEST")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authorization required" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId: string | undefined = body.session_id;
    if (!sessionId) return json({ error: "session_id required" }, 400);

    // Recupera checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    // Verifica appartenenza: metadata.partner_id deve coincidere con l'utente
    const partnerIdMeta = session.metadata?.partner_id;
    if (!partnerIdMeta || partnerIdMeta !== user.id) {
      return json({ error: "Session does not belong to current user" }, 403);
    }

    const subscription =
      typeof session.subscription === "object" && session.subscription
        ? session.subscription
        : typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : null;

    if (!subscription) {
      return json({ error: "No subscription on session yet" }, 400);
    }

    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

    const subItem = subscription.items.data[0];
    const subUnitAmount = subItem?.price?.unit_amount ?? null;
    const subInterval = subItem?.price?.recurring?.interval ?? "month";
    let subMonthlyAmountCents: number | null = null;
    if (subUnitAmount != null) {
      if (subInterval === "year") subMonthlyAmountCents = Math.round(subUnitAmount / 12);
      else if (subInterval === "week") subMonthlyAmountCents = Math.round((subUnitAmount * 52) / 12);
      else if (subInterval === "day") subMonthlyAmountCents = Math.round((subUnitAmount * 365) / 12);
      else subMonthlyAmountCents = subUnitAmount;
    }

    const payload = {
      partner_id: user.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: subItem?.price.id,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      monthly_amount_cents: subMonthlyAmountCents,
      updated_at: new Date().toISOString(),
    };

    // UPDATE first, INSERT if none (robusto, non dipende da ON CONFLICT)
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("partner_subscriptions")
      .update(payload)
      .eq("partner_id", user.id)
      .select("id");

    if (updateError) {
      console.error("update error:", updateError);
      return json({ error: updateError.message }, 500);
    }

    if (!updated || updated.length === 0) {
      const { error: insertError } = await supabaseAdmin
        .from("partner_subscriptions")
        .insert(payload);
      if (insertError) {
        console.error("insert error:", insertError);
        return json({ error: insertError.message }, 500);
      }
    }

    return json({
      ok: true,
      status: subscription.status,
      subscription_id: subscription.id,
      action: updated && updated.length > 0 ? "updated" : "inserted",
    });
  } catch (err) {
    console.error("sync-session error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
