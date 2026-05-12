// Pasify · partner-stripe-create-portal-link
// Genera un Stripe Billing Portal session URL para que el partner
// gestione su Stripe Connect account o su subscription Pasify.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser } from "../_shared/supabase.ts";
import { requireStripe } from "../_shared/stripe.ts";
import { logger } from "../_shared/logger.ts";

interface Payload {
  org_id: string;
  return_url: string;
  /** "connect_express" → Express Dashboard del Connect account.
   *  "billing"         → Customer Portal de la subscription Pasify. */
  kind: "connect_express" | "billing";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    const user = await requireUser(req);
    const body = (await req.json()) as Payload;
    if (!body.org_id || !body.return_url || !body.kind) return errorResponse("invalid_payload", 400);

    const { data: hasRole } = await supabaseAdmin.rpc("has_org_role", {
      _org_id: body.org_id,
      _roles: ["owner", "admin"],
    });
    if (!hasRole) return errorResponse("forbidden", 403);

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("stripe_connect_account_id, stripe_customer_id")
      .eq("id", body.org_id)
      .maybeSingle();
    if (!org) return errorResponse("org_not_found", 404);

    const stripe = requireStripe();
    let url: string;
    if (body.kind === "connect_express") {
      if (!org.stripe_connect_account_id) return errorResponse("no_connect_account", 404);
      const link = await stripe.accounts.createLoginLink(org.stripe_connect_account_id);
      url = link.url;
    } else {
      if (!org.stripe_customer_id) return errorResponse("no_customer", 404);
      const session = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: body.return_url,
      });
      url = session.url;
    }

    logger.info("portal_link_created", { org_id: body.org_id, kind: body.kind });
    return jsonResponse({ url });
  } catch (err) {
    logger.error("partner-stripe-create-portal-link failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
