// Pasify · accept-team-invitation
// Endpoint público (verify_jwt = false) que acepta una invitación de equipo.
// Si el usuario no está autenticado, redirige a registro/login con next=accept.
//
// Body: { token } o GET ?token=...
//
//   Con sesión → acepta. La cuenta tiene que ser la invitada (403 email_mismatch)
//     y tener el email confirmado (403 email_not_confirmed). Una invitación que
//     ya no está pendiente o vigente, o que cambia mientras se acepta (otra
//     aceptación, una cancelación, un reenvío con token nuevo), da 400
//     invalid_or_expired.
//   Sin sesión → solo describe una invitación pendiente y vigente, con límite
//     por IP (429 rate_limit_exceeded). Una aceptada, cancelada o caducada da
//     el mismo 400 que un token inexistente.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";
import { enforceRateLimit, clientIp } from "../_shared/rate-limit.ts";

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
        // El email de la cuenta solo prueba algo si está confirmado: sin confirmar,
        // cualquiera pudo registrarse con el correo del invitado.
        if (!userData.user.email_confirmed_at) {
          return errorResponse("email_not_confirmed", 403, "email_not_confirmed");
        }
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

        // Entre el SELECT de arriba y este UPDATE la fila puede haber cambiado: otra
        // aceptación, una cancelación o un reenvío (invite_member regenera el token).
        // Por eso el UPDATE vuelve a exigir 'pending' y el mismo token, y solo se da
        // por aceptada si ha tocado exactamente una fila.
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("organization_members")
          .update({
            user_id: userData.user.id,
            status: "active",
            accepted_at: new Date().toISOString(),
          })
          .eq("id", member.id)
          .eq("status", "pending")
          .eq("invitation_token", token)
          .select("id");
        if (updateError) throw new Error(`accept_invitation_update_failed: ${updateError.message}`);
        if (!updated || updated.length !== 1) {
          logger.warn("invitation_accept_conflict", { member_id: member.id, user_id: userData.user.id });
          return errorResponse("invalid_or_expired", 400);
        }

        logger.info("invitation_accepted", { member_id: member.id, user_id: userData.user.id });
        return jsonResponse({ ok: true, org_id: member.org_id, org_name: (member.organizations as any)?.name });
      }
    }

    // No autenticado → devolver metadata para que el front guíe al signup.
    // Es pública: límite por IP y solo invitaciones pendientes y vigentes, como en
    // la rama con sesión (una aceptada, cancelada o caducada no enseña nada).
    await enforceRateLimit({ key: `accept_team_invitation:ip:${clientIp(req)}`, max: 120, windowSec: 600 });
    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("email, role, organizations(name, slug)")
      .eq("invitation_token", token)
      .eq("status", "pending")
      .gt("invitation_expires_at", new Date().toISOString())
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
    return safeErrorResponse(err);
  }
});
