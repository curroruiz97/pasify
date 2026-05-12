// Pasify · accept-team-invitation
// Endpoint público (verify_jwt = false) que acepta una invitación de equipo.
// Si el usuario no está autenticado, redirige a registro/login con next=accept.
//
// Body: { token } o GET ?token=...

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    let token: string | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      token = url.searchParams.get("token");
    } else if (req.method === "POST") {
      const body = await req.json();
      token = body.token;
    } else {
      return errorResponse("method_not_allowed", 405);
    }
    if (!token) return errorResponse("token_required", 400);

    // Si hay JWT en headers, intenta aceptar via RPC accept_invitation
    const auth = req.headers.get("Authorization");
    if (auth) {
      const { data: userData } = await supabaseAdmin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
      if (userData.user) {
        const userClient = supabaseAdmin; // service role para llamar RPC
        // accept_invitation usa auth.uid() — necesitamos invocar como user
        // Truco: hacer match manual del token y status
        const { data: member } = await supabaseAdmin
          .from("organization_members")
          .select("id, email, org_id, organizations(name)")
          .eq("invitation_token", token)
          .eq("status", "pending")
          .gt("invitation_expires_at", new Date().toISOString())
          .maybeSingle();

        if (!member) return errorResponse("invalid_or_expired", 400);
        // Verificar email coincide
        const userEmail = userData.user.email?.toLowerCase();
        if (userEmail !== member.email.toLowerCase()) return errorResponse("email_mismatch", 403);

        await supabaseAdmin.from("organization_members").update({
          user_id: userData.user.id,
          status: "active",
          accepted_at: new Date().toISOString(),
        }).eq("id", member.id);

        logger.info("invitation_accepted", { member_id: member.id, user_id: userData.user.id });
        return jsonResponse({ ok: true, org_id: member.org_id, org_name: (member.organizations as any)?.name });
      }
    }

    // No autenticado → devolver metadata para que el front guíe al signup
    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("email, role, organizations(name, slug)")
      .eq("invitation_token", token)
      .maybeSingle();
    if (!member) return errorResponse("invalid_or_expired", 400);

    return jsonResponse({
      requires_auth: true,
      email: member.email,
      role: member.role,
      org_name: (member.organizations as any)?.name,
      org_slug: (member.organizations as any)?.slug,
    });
  } catch (err) {
    logger.error("accept-team-invitation failed", { error: String(err) });
    return errorResponse(err instanceof Error ? err.message : "internal_error", 500);
  }
});
