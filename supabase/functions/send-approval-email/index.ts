// Pasify · send-approval-email
// Email "tu cuenta está aprobada". Solo admins de plataforma: la llama
// components/admin/UsersManagement.tsx al aprobar una cuenta. Antes era pública
// (cualquiera mandaba emails con nuestra marca a cualquier dirección), metía el
// nombre sin escapar en el HTML y arrastraba textos y logo de Students Life.
//
// Body: { user_email, user_name, user_type: 'partner' | 'client' | ... }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/supabase.ts";
import { sendEmail, esc } from "../_shared/resend.ts";
import { renderBaseEmail, APP_URL } from "../_shared/email-templates.ts";
import { HttpError } from "../_shared/internal-auth.ts";
import { logger } from "../_shared/logger.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ApprovalEmailRequest {
  user_email: string;
  user_name?: string | null;
  user_type?: string | null;
}

function approvalEmail(name: string | null, isPartner: boolean): { subject: string; html: string } {
  const greeting = name ? `Hola ${esc(name)}, ` : "";
  if (isPartner) {
    return {
      subject: "Tu cuenta de local en Pasify está aprobada",
      html: renderBaseEmail({
        title: "Tu cuenta de local está aprobada.",
        preheader: "Ya puedes publicar eventos y vender entradas.",
        body: `
          <p>${greeting}hemos revisado tu cuenta de local y ya está activa.</p>
          <p>Desde tu panel puedes publicar eventos, vender entradas, escanearlas en la puerta y ver tus ventas en tiempo real.</p>
        `,
        ctaLabel: "Abrir mi panel",
        ctaUrl: `${APP_URL}/#/partner-dashboard`,
      }),
    };
  }
  return {
    subject: "Tu cuenta de Pasify está aprobada",
    html: renderBaseEmail({
      title: "Tu cuenta está aprobada.",
      preheader: "Ya puedes descubrir eventos y comprar entradas.",
      body: `
        <p>${greeting}tu cuenta de Pasify ya está activa.</p>
        <p>Descubre eventos cerca de ti, compra tus entradas y tenlas siempre a mano en tu Wallet Pasify.</p>
      `,
      ctaLabel: "Descubrir eventos",
      ctaUrl: `${APP_URL}/#/client-dashboard`,
    }),
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
    const admin = await requireAdmin(req);

    const body = (await req.json().catch(() => ({}))) as ApprovalEmailRequest;
    const email = typeof body.user_email === "string" ? body.user_email.trim() : "";
    if (!EMAIL_RE.test(email)) return jsonResponse({ error: "invalid_email" }, { status: 400 });

    // UsersManagement manda "Usuario" cuando no hay nombre: mejor sin saludo.
    const rawName = typeof body.user_name === "string" ? body.user_name.trim().slice(0, 80) : "";
    const name = rawName && rawName !== "Usuario" ? rawName : null;

    const message = approvalEmail(name, body.user_type === "partner");
    await sendEmail({
      to: email,
      ...message,
      tags: [{ name: "kind", value: "account_approved" }],
    });

    logger.info("approval_email_sent", { function: "send-approval-email", admin_id: admin.id, user_type: body.user_type ?? null });
    return jsonResponse({ success: true });
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code }, { status: err.status });
    logger.error("send-approval-email failed", { error: String(err) });
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }
});
