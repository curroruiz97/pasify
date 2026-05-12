// Pasify · partner-onboard-stripe-connect
// Crea o reutiliza Stripe Connect account para la organización del partner
// y devuelve un account_link URL para que el owner complete onboarding.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { logger } from "../_shared/logger.ts";

interface Payload {
  org_id: string;
  return_url: string;
  refresh_url: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    await enforceRateLimit({ key: `connect_onboard:${user.id}`, max: 10, windowSec: 3600 });

    const body = (await req.json()) as Payload;
    if (!body.org_id || !body.return_url || !body.refresh_url) return errorResponse("invalid_payload", 400);

    // Verificar que el user es owner/admin del org
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("id, name, country, contact_email, owner_id, stripe_connect_account_id, billing_email")
      .eq("id", body.org_id)
      .maybeSingle();
    if (!org) return errorResponse("org_not_found", 404);

    const { data: isOwner } = await supabaseAdmin.rpc("has_org_role", {
      _org_id: body.org_id,
      _roles: ["owner", "admin"],
    });
    if (org.owner_id !== user.id && !isOwner) return errorResponse("forbidden", 403);

    const stripe = requireStripe();

    // 1) Crear/usar Connect account
    let accountId = org.stripe_connect_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        country: org.country ?? "ES",
        email: org.billing_email ?? org.contact_email ?? user.email ?? undefined,
        business_type: "company",
        metadata: { pasify_org_id: body.org_id },
      });
      accountId = account.id;
      await supabaseAdmin
        .from("organizations")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", body.org_id);
    }

    // 2) Account link
    const link = await stripe.accountLinks.create({
      account: accountId!,
      return_url: body.return_url,
      refresh_url: body.refresh_url,
      type: "account_onboarding",
    });

    logger.info("connect_onboard_link_created", { org_id: body.org_id, account: accountId });
    return jsonResponse({ url: link.url, account_id: accountId });
  } catch (err) {
    logger.error("partner-onboard-stripe-connect failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
