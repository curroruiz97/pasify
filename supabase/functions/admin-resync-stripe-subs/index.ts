// Admin recovery tool: walks every active/trialing/past_due Stripe
// subscription on the live account and upserts it into partner_subscriptions.
// Use this when the webhook has been disconnected and the DB has fallen
// out of sync with reality (e.g. Flamma Restauración paid but the row never
// arrived because Stripe could not deliver the event).
//
// Auth: only callers with role='admin' in user_roles are allowed.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const monthlyCentsFromItem = (item: Stripe.SubscriptionItem | undefined): number | null => {
  const unit = item?.price?.unit_amount;
  if (unit == null) return null;
  const interval = item?.price?.recurring?.interval ?? "month";
  if (interval === "year") return Math.round(unit / 12);
  if (interval === "week") return Math.round((unit * 52) / 12);
  if (interval === "day") return Math.round((unit * 365) / 12);
  return unit;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // --- Auth: require admin role ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authorization required" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !userData?.user) return json({ error: "Invalid token" }, 401);

    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleErr) return json({ error: "Role check failed: " + roleErr.message }, 500);
    if (isAdmin !== true) return json({ error: "Admin only" }, 403);

    // --- Walk every relevant Stripe subscription ---
    // We list with status=all to capture past_due and canceled too, since the
    // admin needs visibility into recently lapsed subs as well.
    const synced: Array<{
      partner_id: string | null;
      stripe_subscription_id: string;
      status: string;
      action: "inserted" | "updated" | "skipped";
      reason?: string;
    }> = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const it = stripe.subscriptions.list({ status: "all", limit: 100 });
    for await (const sub of it) {
      const partnerIdMeta = sub.metadata?.partner_id ?? null;
      let partnerId: string | null = partnerIdMeta;

      // Fallback: if the subscription has no partner_id metadata (legacy or
      // manually-created in Stripe), try to recover via an existing row
      // matching stripe_customer_id.
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      if (!partnerId) {
        const { data: existing } = await supabaseAdmin
          .from("partner_subscriptions")
          .select("partner_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        partnerId = existing?.partner_id ?? null;
      }

      if (!partnerId) {
        // Last resort: try matching by customer email → profiles.email.
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && !customer.deleted && customer.email) {
            const { data: prof } = await supabaseAdmin
              .from("profiles")
              .select("id")
              .ilike("email", customer.email)
              .maybeSingle();
            partnerId = prof?.id ?? null;
          }
        } catch (_) {
          /* ignore */
        }
      }

      if (!partnerId) {
        skipped++;
        synced.push({
          partner_id: null,
          stripe_subscription_id: sub.id,
          status: sub.status,
          action: "skipped",
          reason: "no partner_id metadata + no email match",
        });
        continue;
      }

      const item = sub.items.data[0];
      const payload = {
        partner_id: partnerId,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        stripe_price_id: item?.price.id ?? null,
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at_period_end: sub.cancel_at_period_end,
        monthly_amount_cents: monthlyCentsFromItem(item),
        updated_at: new Date().toISOString(),
      };

      // UPDATE first, INSERT if no row matched. Avoids ON CONFLICT noise.
      const { data: updatedRows, error: upErr } = await supabaseAdmin
        .from("partner_subscriptions")
        .update(payload)
        .eq("partner_id", partnerId)
        .select("id");

      if (upErr) {
        synced.push({
          partner_id: partnerId,
          stripe_subscription_id: sub.id,
          status: sub.status,
          action: "skipped",
          reason: "update error: " + upErr.message,
        });
        skipped++;
        continue;
      }

      if (!updatedRows || updatedRows.length === 0) {
        const { error: insErr } = await supabaseAdmin
          .from("partner_subscriptions")
          .insert(payload);
        if (insErr) {
          synced.push({
            partner_id: partnerId,
            stripe_subscription_id: sub.id,
            status: sub.status,
            action: "skipped",
            reason: "insert error: " + insErr.message,
          });
          skipped++;
        } else {
          inserted++;
          synced.push({
            partner_id: partnerId,
            stripe_subscription_id: sub.id,
            status: sub.status,
            action: "inserted",
          });
        }
      } else {
        updated++;
        synced.push({
          partner_id: partnerId,
          stripe_subscription_id: sub.id,
          status: sub.status,
          action: "updated",
        });
      }
    }

    return json({
      ok: true,
      total: synced.length,
      inserted,
      updated,
      skipped,
      details: synced,
    });
  } catch (err: any) {
    console.error("admin-resync-stripe-subs error:", err);
    return json({ error: err?.message ?? "Unexpected error" }, 500);
  }
});
