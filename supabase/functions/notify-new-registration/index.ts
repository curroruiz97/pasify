// Pasify · notify-new-registration
//
// Email de bienvenida a quien acaba de darse de alta. Lo llama
// RegisterClient.tsx justo después del alta, con la sesión ya abierta.
//   * Exige el JWT del usuario y escribe a SU email verificado, nunca al del
//     body. El tipo de cuenta sale de sus roles (has_role), no del body.
//   * Solo cuentas creadas hace menos de 24 h, como mucho 3 llamadas por hora
//     y un email por cuenta (clave de idempotencia).
//
// Antes mandaba al admin, con cada alta de CLIENTE, una plantilla heredada de
// Students Life ("La comunidad de los estudiantes", "Universidad",
// "pendiente de aprobación": las cuentas se aprueban solas desde la Fase 0).
// El aviso al admin de un LOCAL nuevo ya no sale de aquí: lo manda el servidor
// al crearse su organización (trg_organizations_notify_new_partner, migración
// 20260928160000), sin depender de la app.
//
// Body (opcional): { firstName? } · 200: { success, emailed, reason? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { hasPlatformRole, requireUser, supabaseAdmin } from "../_shared/supabase.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { knownError } from "../_shared/internal-auth.ts";
import { emailDelivered, esc, sendEmail } from "../_shared/resend.ts";
import { APP_URL, renderBaseEmail } from "../_shared/email-templates.ts";
import { logger } from "../_shared/logger.ts";

/** Solo se da la bienvenida a cuentas recién creadas. */
const WELCOME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const serif = "font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;";
const oneLine = (s: string | null | undefined): string => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

interface Mail {
  subject: string;
  html: string;
  text: string;
}

function clientWelcome(firstName: string | null): Mail {
  const url = `${APP_URL}/#/client-dashboard`;
  return {
    subject: "Te damos la bienvenida a Pasify",
    html: renderBaseEmail({
      title: firstName
        ? `Hola, ${esc(firstName)}. <span style="${serif}">Ya estás dentro</span>.`
        : `Te damos la <span style="${serif}">bienvenida</span>.`,
      preheader: "Tu cuenta de Pasify ya está activa: encuentra planes y lleva tus entradas en el móvil.",
      body: `
        <p>Tu cuenta ya está activa. Con Pasify:</p>
        <ul style="margin:12px 0 16px 0;padding-left:20px;">
          <li style="margin-bottom:6px;">Descubres los eventos y los locales de tu ciudad.</li>
          <li style="margin-bottom:6px;">Compras tus entradas en unos segundos, con pago seguro.</li>
          <li>Las llevas en el móvil, cada una con su QR para la puerta.</li>
        </ul>
        <p>Si algo no va bien, escríbenos desde Soporte en la app: lo lee una persona del equipo.</p>
      `,
      ctaLabel: "Descubrir eventos",
      ctaUrl: url,
    }),
    text: [
      firstName ? `Hola, ${firstName}. Ya estás dentro.` : "Te damos la bienvenida a Pasify.",
      "",
      "Tu cuenta ya está activa. Con Pasify descubres los eventos y los locales de tu ciudad, compras tus entradas en unos segundos y las llevas en el móvil, cada una con su QR para la puerta.",
      "",
      "Si algo no va bien, escríbenos desde Soporte en la app.",
      "",
      `Descubre eventos: ${url}`,
    ].join("\n"),
  };
}

function partnerWelcome(businessName: string | null): Mail {
  const url = `${APP_URL}/#/partner-dashboard`;
  return {
    subject: "Tu local ya está en Pasify",
    html: renderBaseEmail({
      title: `Tu local <span style="${serif}">ya está en Pasify</span>.`,
      preheader: "Crea tu primer evento, conecta tus cobros y empieza a vender.",
      body: `
        <p>${businessName ? `<strong>${esc(businessName)}</strong> ya tiene su cuenta activa.` : "Tu cuenta de local ya está activa."} Para empezar a vender:</p>
        <ol style="margin:12px 0 16px 0;padding-left:20px;">
          <li style="margin-bottom:6px;">Crea tu primer evento con sus tipos de entrada.</li>
          <li style="margin-bottom:6px;">Conecta tus cobros en «Cobros» para recibir el dinero de las ventas.</li>
          <li>Comparte el enlace del evento y valida las entradas en la puerta con el escáner.</li>
        </ol>
        <p>Cualquier duda, escríbenos desde Soporte en tu panel.</p>
      `,
      ctaLabel: "Abrir mi panel",
      ctaUrl: url,
    }),
    text: [
      businessName ? `${businessName} ya tiene su cuenta activa en Pasify.` : "Tu cuenta de local ya está activa en Pasify.",
      "",
      "Para empezar a vender: crea tu primer evento con sus tipos de entrada, conecta tus cobros en «Cobros» y comparte el enlace del evento. En la puerta, valida las entradas con el escáner.",
      "",
      "Cualquier duda, escríbenos desde Soporte en tu panel.",
      "",
      `Abre tu panel: ${url}`,
    ].join("\n"),
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const log = logger.child({ function: "notify-new-registration" });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  // Auth fuera del try de abajo: ese try responde 200 pase lo que pase.
  let user: { id: string; email: string | null };
  try {
    user = await requireUser(req);
    await enforceRateLimit({ key: `notify_registration:${user.id}`, max: 3, windowSec: 3600 });
  } catch (authError) {
    const known = knownError(authError);
    const code = known?.code ?? "unauthorized";
    return errorResponse(code, known?.status ?? 401, code);
  }

  try {
    if (!user.email) return jsonResponse({ success: true, emailed: false, reason: "no_email" });
    const raw = (await req.json().catch(() => ({}))) as { firstName?: unknown } | null;

    const [{ data: profile, error: profileError }, isPartner] = await Promise.all([
      supabaseAdmin.from("profiles").select("first_name, business_name, created_at").eq("id", user.id).maybeSingle(),
      hasPlatformRole(user.id, "partner"),
    ]);
    if (profileError) throw new Error(`profile_load_failed: ${profileError.message}`);

    const createdAt = profile?.created_at ? Date.parse(profile.created_at as string) : NaN;
    if (Number.isFinite(createdAt) && Date.now() - createdAt > WELCOME_MAX_AGE_MS) {
      return jsonResponse({ success: true, emailed: false, reason: "not_new" });
    }

    // El nombre, el del perfil (RegisterClient lo guarda antes de llamar);
    // el del body solo si aún no está.
    const firstName =
      oneLine((profile?.first_name as string | null) || (typeof raw?.firstName === "string" ? raw.firstName : "")).slice(0, 80) ||
      null;
    const mail = isPartner
      ? partnerWelcome(oneLine(profile?.business_name as string | null).slice(0, 120) || null)
      : clientWelcome(firstName);

    const res = await sendEmail({
      to: user.email,
      ...mail,
      idempotencyKey: `welcome-${user.id}`,
      tags: [{ name: "kind", value: isPartner ? "welcome_partner" : "welcome_client" }],
    });
    const emailed = emailDelivered(res);
    log.info("welcome_email", { user_id: user.id, partner: isPartner, emailed });
    return jsonResponse({ success: true, emailed });
  } catch (error) {
    // El alta ya está hecha: un fallo del email no es cosa del usuario.
    log.error("welcome_email_failed", { user_id: user.id, error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: true, emailed: false });
  }
});
