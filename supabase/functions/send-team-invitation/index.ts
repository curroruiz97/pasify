// Pasify · send-team-invitation
// Envía email de invitación cuando organization_members se inserta o se reaprovisiona.
// Body: { member_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { supabaseAdmin, requireUser, callerHasOrgRole } from "../_shared/supabase.ts";
import { sendEmail } from "../_shared/resend.ts";
import { teamInvitationEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";
import { safeErrorResponse } from "../_shared/internal-auth.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://pasify.es";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
    await requireUser(req);
    const { member_id } = await req.json();
    if (!member_id) return errorResponse("invalid_payload", 400);

    const { data: member } = await supabaseAdmin
      .from("organization_members")
      .select("id, email, role, invitation_token, org_id, invited_by, organizations(name)")
      .eq("id", member_id)
      .maybeSingle();
    if (!member) return errorResponse("member_not_found", 404);

    // Verificar permisos (owner/admin del org). has_org_role usa auth.uid(): con
    // el cliente admin devolvía siempre false; va con el JWT del usuario.
    if (!(await callerHasOrgRole(req, member.org_id, ["owner", "admin"]))) return errorResponse("forbidden", 403);

    const { data: inviter } = await supabaseAdmin.from("profiles").select("first_name, last_name").eq("id", member.invited_by).maybeSingle();
    const inviterName = inviter ? `${inviter.first_name ?? ""} ${inviter.last_name ?? ""}`.trim() : null;

    const acceptUrl = `${APP_BASE_URL}/#/accept-invitation?token=${member.invitation_token}`;
    const email = teamInvitationEmail({
      orgName: (member.organizations as any)?.name ?? "tu organización",
      inviterName,
      role: member.role,
      acceptUrl,
    });

    await sendEmail({
      to: member.email,
      ...email,
      idempotencyKey: `invite-${member.id}`,
      tags: [{ name: "kind", value: "team_invitation" }],
    });

    logger.info("team_invitation_sent", { member_id, role: member.role });
    return jsonResponse({ ok: true });
  } catch (err) {
    logger.error("send-team-invitation failed", { error: String(err) });
    return safeErrorResponse(err);
  }
});
