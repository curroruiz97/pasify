// Pasify · Plantillas email enterprise con branding terracota/dark editorial.
// Todas las plantillas son responsive, soportan dark mode email clients,
// y siguen el design system Pasify (Geist + Instrument Serif + terracota).

import { esc } from "./resend.ts";

const APP_URL = Deno.env.get("APP_BASE_URL") ?? "https://pasify.es";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "hola@pasify.es";
const PLATFORM_NAME = "Pasify";

/* ===========================================================================
   Layout base (header + footer + branding consistente)
   =========================================================================== */
export interface BaseEmailOptions {
  title: string;
  preheader?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Footer extra (legal, unsubscribe) */
  footer?: string;
}

export function renderBaseEmail(o: BaseEmailOptions): string {
  const preheader = o.preheader ?? "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(o.title)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    body, .bg { background:#0B0908 !important; color:#F4EEE2 !important; }
    .card { background:#1A1612 !important; border-color:#26211C !important; }
    .meta { color:#8A8275 !important; }
    .divider { border-color:#26211C !important; }
  }
  a { color:#E8542A; text-decoration:none; }
  .pasify-btn:hover { filter: brightness(1.05); }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#F7F3EC;font-family:'Geist',Inter,-apple-system,BlinkMacSystemFont,sans-serif;color:#1A1612;">
<!-- Preheader (oculto en la lista) -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#F7F3EC;mso-hide:all;">${esc(preheader)}</div>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F7F3EC;padding:32px 12px;" class="bg">
  <tr>
    <td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="padding:0 8px 24px 8px;">
            <a href="${APP_URL}" target="_blank" style="display:inline-block;">
              <img src="${APP_URL}/pasify-logo.png" alt="Pasify" width="120" height="auto" style="display:block;border:0;outline:0;height:auto;" />
            </a>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td class="card" style="background:#FFFFFF;border:1px solid #E8E1D4;border-radius:18px;padding:36px;box-shadow:0 4px 16px rgba(184,56,26,0.06);">
            <h1 style="margin:0 0 16px 0;font-family:'Geist','Inter',sans-serif;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.025em;color:#1A1612;">
              ${o.title}
            </h1>
            <div style="font-size:15px;line-height:1.6;color:#3D3327;">
              ${o.body}
            </div>
            ${o.ctaUrl && o.ctaLabel ? `
            <div style="margin:28px 0 8px 0;">
              <a class="pasify-btn" href="${o.ctaUrl}" target="_blank"
                style="display:inline-block;padding:14px 28px;background:linear-gradient(180deg,#FF7A4D 0%,#E8542A 55%,#B8381A 100%);color:#FFFFFF;font-weight:600;font-size:15px;text-decoration:none;border-radius:999px;letter-spacing:-0.005em;box-shadow:inset 0 1px 0 rgba(255,255,255,0.35),0 6px 16px -4px rgba(232,84,42,0.45);">
                ${esc(o.ctaLabel)}
              </a>
            </div>` : ""}
            ${o.footer ? `<div class="meta divider" style="margin-top:32px;padding-top:20px;border-top:1px solid #E8E1D4;font-size:12px;line-height:1.5;color:#8A8275;">${o.footer}</div>` : ""}
          </td>
        </tr>

        <!-- Footer global -->
        <tr>
          <td style="padding:24px 16px 8px 16px;font-size:11px;line-height:1.6;color:#8A8275;font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:0.05em;text-transform:uppercase;text-align:center;" class="meta">
            ${PLATFORM_NAME} · El sistema operativo de los eventos · Madrid, España
          </td>
        </tr>
        <tr>
          <td style="padding:0 16px 16px 16px;font-size:11px;line-height:1.6;color:#8A8275;text-align:center;" class="meta">
            ¿Dudas? Escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:#E8542A;">${SUPPORT_EMAIL}</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/legal/privacy" style="color:#8A8275;">Privacidad</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/legal/terms" style="color:#8A8275;">Términos</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/* ===========================================================================
   Plantillas concretas
   =========================================================================== */

export function welcomeEmail(firstName: string | null): { subject: string; html: string } {
  const greeting = firstName ? `Bienvenido, ${esc(firstName)}` : "Bienvenido a Pasify";
  return {
    subject: `${greeting} 🎟️`,
    html: renderBaseEmail({
      title: `${greeting}.`,
      preheader: "Tu cuenta está lista. Descubre eventos cerca de ti.",
      body: `
        <p>Estamos encantados de tenerte. Pasify es donde se viven los mejores eventos de España — descubre locales, compra entradas y vive cada noche como toca.</p>
        <p>Tu cuenta ya está activa. Puedes empezar ahora mismo.</p>
      `,
      ctaLabel: "Descubrir eventos",
      ctaUrl: `${APP_URL}/#/client-dashboard`,
    }),
  };
}

export function ticketPurchasedEmail(opts: {
  firstName: string | null;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  tickets: Array<{ tierName: string; qrToken: string; amountCents: number }>;
  totalCents: number;
  orderId: string;
}): { subject: string; html: string } {
  const formatEur = (cents: number) => `${(cents / 100).toFixed(2)} €`;
  const ticketsHtml = opts.tickets.map((t) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #E8E1D4;">
        <div style="font-weight:500;color:#1A1612;">${esc(t.tierName)}</div>
        <div style="font-size:11px;font-family:'Geist Mono',monospace;color:#8A8275;letter-spacing:0.06em;">QR · ${t.qrToken.slice(0, 8)}····</div>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #E8E1D4;text-align:right;font-family:'Geist Mono',monospace;color:#1A1612;font-weight:500;">${formatEur(t.amountCents)}</td>
    </tr>
  `).join("");

  return {
    subject: `Tus entradas para ${opts.eventTitle}`,
    html: renderBaseEmail({
      title: `Tus entradas están <span style="font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;">listas</span>.`,
      preheader: `${opts.tickets.length} entrada(s) para ${opts.eventTitle} · ${opts.eventDate}`,
      body: `
        <p>${opts.firstName ? `Hola ${esc(opts.firstName)}, gracias` : "Gracias"} por tu compra. Estas son tus entradas para:</p>
        <div style="margin:20px 0;padding:16px;background:linear-gradient(135deg,rgba(232,84,42,0.06),rgba(184,56,26,0.02));border:1px solid rgba(232,84,42,0.25);border-radius:14px;">
          <div style="font-size:11px;font-family:'Geist Mono',monospace;text-transform:uppercase;letter-spacing:0.18em;color:#E8542A;">Evento</div>
          <div style="font-size:18px;font-weight:600;margin-top:4px;color:#1A1612;">${esc(opts.eventTitle)}</div>
          <div style="font-size:13px;color:#5C544A;margin-top:6px;">${esc(opts.venueName)} · ${esc(opts.eventDate)}</div>
        </div>
        <table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:16px 0;">
          ${ticketsHtml}
          <tr>
            <td style="padding:14px 0 0 0;font-weight:600;color:#1A1612;">Total</td>
            <td style="padding:14px 0 0 0;text-align:right;font-family:'Geist Mono',monospace;font-weight:600;font-size:16px;color:#E8542A;">${formatEur(opts.totalCents)}</td>
          </tr>
        </table>
        <p style="font-size:13px;color:#5C544A;">En la puerta te escanearán el QR de cada entrada. Las tienes siempre disponibles en tu Wallet Pasify.</p>
      `,
      ctaLabel: "Ver mis tickets",
      ctaUrl: `${APP_URL}/#/client-dashboard`,
      footer: `Order ID: <code style="font-family:'Geist Mono',monospace;color:#8A8275;">${opts.orderId.slice(0, 8)}</code> · ¿Quieres reembolsar o transferir? Entra en Mis tickets.`,
    }),
  };
}

export function refundDecidedEmail(opts: {
  firstName: string | null;
  eventTitle: string;
  amountCents: number;
  status: "approved" | "rejected";
  decisionNote: string | null;
}): { subject: string; html: string } {
  const formatEur = (cents: number) => `${(cents / 100).toFixed(2)} €`;
  if (opts.status === "approved") {
    return {
      subject: `Reembolso aprobado · ${opts.eventTitle}`,
      html: renderBaseEmail({
        title: "Reembolso aprobado.",
        preheader: `Te devolvemos ${formatEur(opts.amountCents)} a tu tarjeta original.`,
        body: `
          <p>${opts.firstName ? `Hola ${esc(opts.firstName)}` : "Hola"}, hemos aprobado tu solicitud de reembolso para <strong>${esc(opts.eventTitle)}</strong>.</p>
          <p>Recibirás <strong>${formatEur(opts.amountCents)}</strong> en la misma tarjeta con la que pagaste, en un plazo de <strong>3-7 días laborables</strong>.</p>
          ${opts.decisionNote ? `<p style="font-size:13px;color:#5C544A;padding:12px;background:#F7F3EC;border-radius:8px;">${esc(opts.decisionNote)}</p>` : ""}
        `,
        ctaLabel: "Ver detalles",
        ctaUrl: `${APP_URL}/#/client-dashboard`,
      }),
    };
  }
  return {
    subject: `Sobre tu solicitud de reembolso · ${opts.eventTitle}`,
    html: renderBaseEmail({
      title: "Sobre tu reembolso.",
      preheader: "Tu solicitud no procede en este momento.",
      body: `
        <p>${opts.firstName ? `Hola ${esc(opts.firstName)}` : "Hola"}, hemos revisado tu solicitud de reembolso para <strong>${esc(opts.eventTitle)}</strong>.</p>
        <p>En este caso, no procede el reembolso según la política del local.</p>
        ${opts.decisionNote ? `<p style="font-size:13px;color:#5C544A;padding:12px;background:#F7F3EC;border-radius:8px;"><strong>Razón:</strong> ${esc(opts.decisionNote)}</p>` : ""}
        <p>Si crees que se trata de un error, contesta a este email y un agente humano lo revisará en menos de 24h.</p>
      `,
      ctaLabel: "Escribir a soporte",
      ctaUrl: `mailto:${SUPPORT_EMAIL}`,
    }),
  };
}

export function teamInvitationEmail(opts: {
  orgName: string;
  inviterName: string | null;
  role: string;
  acceptUrl: string;
}): { subject: string; html: string } {
  const rolePretty: Record<string, string> = {
    owner: "Propietario",
    admin: "Administrador",
    manager: "Manager",
    rrpp: "RRPP",
    door_staff: "Staff de puerta",
    pos_staff: "Staff TPV",
    read_only: "Solo lectura",
  };
  return {
    subject: `Te invitan a unirte a ${opts.orgName} en Pasify`,
    html: renderBaseEmail({
      title: `Te invitan a <span style="font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;">${esc(opts.orgName)}</span>.`,
      preheader: `${opts.inviterName ?? "El equipo"} te ha invitado a unirte como ${rolePretty[opts.role] ?? opts.role}.`,
      body: `
        <p>${opts.inviterName ? `<strong>${esc(opts.inviterName)}</strong> te ha invitado` : "Te han invitado"} a unirte al equipo de <strong>${esc(opts.orgName)}</strong> como <strong>${esc(rolePretty[opts.role] ?? opts.role)}</strong>.</p>
        <p>Aceptar la invitación te da acceso a la plataforma Pasify para gestionar eventos, escanear entradas, ver ventas en tiempo real y mucho más, según los permisos de tu rol.</p>
      `,
      ctaLabel: "Aceptar invitación",
      ctaUrl: opts.acceptUrl,
      footer: "Esta invitación caduca en 14 días. Si no esperabas este email, puedes ignorarlo sin problema.",
    }),
  };
}

export function ticketTransferEmail(opts: {
  fromName: string | null;
  eventTitle: string;
  eventDate: string;
  acceptUrl: string;
  message: string | null;
}): { subject: string; html: string } {
  return {
    subject: `${opts.fromName ?? "Alguien"} te ha enviado una entrada para ${opts.eventTitle}`,
    html: renderBaseEmail({
      title: "Te han enviado una entrada.",
      preheader: `${opts.fromName ?? "Un amigo"} te transfiere una entrada para ${opts.eventTitle}`,
      body: `
        <p>${opts.fromName ? `<strong>${esc(opts.fromName)}</strong> te ha transferido` : "Te han transferido"} una entrada para:</p>
        <div style="margin:16px 0;padding:16px;background:linear-gradient(135deg,rgba(232,84,42,0.06),rgba(184,56,26,0.02));border:1px solid rgba(232,84,42,0.25);border-radius:14px;">
          <div style="font-size:18px;font-weight:600;color:#1A1612;">${esc(opts.eventTitle)}</div>
          <div style="font-size:13px;color:#5C544A;margin-top:4px;">${esc(opts.eventDate)}</div>
        </div>
        ${opts.message ? `<p style="padding:12px;background:#F7F3EC;border-left:3px solid #E8542A;border-radius:6px;font-style:italic;color:#5C544A;">"${esc(opts.message)}"</p>` : ""}
        <p>Para activarla en tu cuenta solo tienes que pulsar el botón. La entrada quedará en tu Wallet Pasify y el QR original del remitente se anulará automáticamente.</p>
      `,
      ctaLabel: "Aceptar entrada",
      ctaUrl: opts.acceptUrl,
      footer: "Esta transferencia caduca en 7 días.",
    }),
  };
}

export function partnerApprovedEmail(opts: { businessName: string | null }): { subject: string; html: string } {
  return {
    subject: "Tu cuenta de local en Pasify está aprobada",
    html: renderBaseEmail({
      title: "Tu local <span style=\"font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;\">está dentro</span>.",
      preheader: "Ya puedes crear eventos, vender tickets y recibir pagos.",
      body: `
        <p>${opts.businessName ? `Has sido aprobado como <strong>${esc(opts.businessName)}</strong>.` : "Tu cuenta de local ha sido aprobada."}</p>
        <p>Ya puedes empezar a publicar eventos, configurar tu Stripe Connect para recibir pagos y acceder a todo el sistema operativo Pasify: pricing IA, marketing, AutoPilot y más.</p>
      `,
      ctaLabel: "Abrir mi dashboard",
      ctaUrl: `${APP_URL}/#/partner-dashboard`,
    }),
  };
}

export function payoutArrivedEmail(opts: {
  businessName: string | null;
  amountCents: number;
  currency: string;
  arrivalDate: string;
}): { subject: string; html: string } {
  const formatAmount = (c: number) => `${(c / 100).toFixed(2)} ${opts.currency}`;
  return {
    subject: `Payout recibido · ${formatAmount(opts.amountCents)}`,
    html: renderBaseEmail({
      title: "Tu payout está en camino.",
      preheader: `${formatAmount(opts.amountCents)} llegan a tu cuenta el ${opts.arrivalDate}`,
      body: `
        <p>Acabamos de procesar un payout de <strong>${formatAmount(opts.amountCents)}</strong> ${opts.businessName ? `para <strong>${esc(opts.businessName)}</strong>` : "para tu cuenta"}.</p>
        <p>El dinero estará en tu cuenta bancaria el <strong>${esc(opts.arrivalDate)}</strong>.</p>
      `,
      ctaLabel: "Ver finanzas",
      ctaUrl: `${APP_URL}/#/partner-dashboard`,
    }),
  };
}

export function magicLinkEmail(opts: { url: string; kind: string }): { subject: string; html: string } {
  const subjects: Record<string, string> = {
    password_reset: "Recupera tu contraseña de Pasify",
    email_verify: "Verifica tu email",
    login: "Tu enlace de acceso a Pasify",
  };
  return {
    subject: subjects[opts.kind] ?? "Enlace de acceso a Pasify",
    html: renderBaseEmail({
      title: "Tu enlace seguro.",
      preheader: "Caduca en 60 minutos · uso único",
      body: `
        <p>Pulsa el botón para continuar. Este enlace está firmado, caduca en <strong>60 minutos</strong> y solo funciona una vez.</p>
        <p>Si no has sido tú, ignora este email y tu cuenta seguirá segura.</p>
      `,
      ctaLabel: "Continuar a Pasify",
      ctaUrl: opts.url,
    }),
  };
}
