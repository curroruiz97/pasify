// Pasify · partner-stripe-refresh-account
// Sincroniza estado Stripe Connect account → organizations.stripe_connect_*
// Llamado desde frontend tras retornar del Connect Onboarding.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const { org_id } = await req.json();
    if (!org_id) return errorResponse("invalid_payload", 400);

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("stripe_connect_account_id")
      .eq("id", org_id)
      .maybeSingle();
    if (!org?.stripe_connect_account_id) return errorResponse("no_connect_account", 404);

    const { data: hasRole } = await supabaseAdmin.rpc("has_org_role", {
      _org_id: org_id,
      _roles: ["owner", "admin"],
    });
    if (!hasRole) return errorResponse("forbidden", 403);

    const stripe = requireStripe();
    const account = await stripe.accounts.retrieve(org.stripe_connect_account_id);

    await supabaseAdmin
      .from("organizations")
      .update({
        stripe_connect_charges_enabled: account.charges_enabled,
        stripe_connect_payouts_enabled: account.payouts_enabled,
        stripe_connect_onboarded: account.details_submitted && account.charges_enabled,
      })
      .eq("id", org_id);

    logger.info("connect_account_refreshed", { org_id, charges: account.charges_enabled, payouts: account.payouts_enabled });

    return jsonResponse({
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements,
    });
  } catch (err) {
    logger.error("partner-stripe-refresh-account failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
