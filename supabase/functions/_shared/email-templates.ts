// Pasify · Plantillas email enterprise con branding terracota/dark editorial.
// Todas las plantillas son responsive, soportan dark mode email clients,
// y siguen el design system Pasify (Geist + Instrument Serif + terracota).

import { esc } from "./resend.ts";

/**
 * URL pública de la web (HashRouter: las rutas van tras `/#`). Se configura
 * con el secreto APP_BASE_URL. El fallback es la web que hoy está viva
 * (pasify.es todavía no resuelve): si apuntara a un dominio muerto, los
 * enlaces "Ver entrada" de los correos no llevarían a ninguna parte.
 */
export const APP_URL = (Deno.env.get("APP_BASE_URL") || "https://pasifyy.vercel.app").trim().replace(/\/+$/, "");
// El mismo que la Ayuda de la app (pasify.es aún no tiene correo).
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "comunicacion@avenuemedia.io";
const PLATFORM_NAME = "Pasify";

/* ===========================================================================
   Formato (fechas en la zona horaria del local, importes en es-ES)
   =========================================================================== */
export const DEFAULT_TIMEZONE = "Europe/Madrid";

function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Fecha y hora de un evento en la zona horaria del local (por defecto
 * Europe/Madrid). Nunca en UTC: un evento a las 23:30 en Madrid no puede
 * salir como "21:30" en la entrada.
 *   long:  "Sábado, 4 de octubre de 2026 · 23:30 h"
 *   short: "Sáb, 4 oct 2026 · 23:30 h"
 */
export function formatEventDateTime(
  iso: string | null | undefined,
  timeZone?: string | null,
  style: "long" | "short" = "long",
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = safeTimeZone(timeZone);
  const date = new Intl.DateTimeFormat(
    "es-ES",
    style === "long"
      ? { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" },
  ).format(d);
  const time = new Intl.DateTimeFormat("es-ES", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${capitalize(date)} · ${time} h`;
}

/** Importe en céntimos → "30,00 €". */
export function formatMoney(cents: number, currency = "EUR"): string {
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;
  const code = (currency || "EUR").toUpperCase();
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** Texto de una línea (sin saltos): para asuntos y cabeceras. */
const oneLine = (s: string | null | undefined) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

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
    /* Los colores de texto van inline: sin estas clases, en modo oscuro
       quedaba texto oscuro sobre la tarjeta oscura. */
    .title, .ink { color:#F4EEE2 !important; }
    .copy { color:#D9D0C3 !important; }
    .muted { color:#A89F92 !important; }
    .panel { background:#221D18 !important; border-color:#3A322A !important; }
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
            <h1 class="title" style="margin:0 0 16px 0;font-family:'Geist','Inter',sans-serif;font-size:28px;line-height:1.15;font-weight:600;letter-spacing:-0.025em;color:#1A1612;">
              ${o.title}
            </h1>
            <div class="copy" style="font-size:15px;line-height:1.6;color:#3D3327;">
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
            <a href="${APP_URL}/privacidad.html" style="color:#8A8275;">Privacidad</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/#/soporte" style="color:#8A8275;">Ayuda</a>
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

export interface TicketEmailTicket {
  id: string;
  /** `tickets.access_url_token`: credencial de los enlaces públicos de la entrada. */
  accessToken: string | null;
  tierName: string;
  holderName: string | null;
  amountCents: number;
  /** Código para teclear en la puerta si el QR no se lee (ver `ticketDoorCode`). */
  doorCode?: string | null;
}

export interface TicketEmailEvent {
  title: string;
  dateStart: string;
  venueName: string | null;
  address: string | null;
  city: string | null;
  /** Zona horaria del local. Por defecto Europe/Madrid. */
  timezone?: string | null;
}

/** Página pública de la entrada (`/#/entrada/:id?k=`), sin sesión. */
export function ticketViewUrl(ticketId: string, accessToken: string): string {
  return `${APP_URL}/#/entrada/${encodeURIComponent(ticketId)}?k=${encodeURIComponent(accessToken)}`;
}

/** PNG del QR servido por la edge function pública `ticket-qr`. */
export function ticketQrImageUrl(supabaseUrl: string, ticketId: string, accessToken: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/ticket-qr?id=${encodeURIComponent(ticketId)}&k=${encodeURIComponent(accessToken)}`;
}

/**
 * Código de puerta: los 8 primeros caracteres del `qr_token` en mayúsculas.
 * Es lo que teclea el portero (`scan_ticket_by_code`) si el QR no se lee, y
 * cambia con el QR cuando la entrada se transfiere.
 */
export function ticketDoorCode(qrToken: string | null | undefined): string | null {
  const hex = (qrToken ?? "").replace(/-/g, "");
  return hex.length >= 8 ? hex.slice(0, 8).toUpperCase() : null;
}

/** Referencia corta del pedido que se enseña al cliente ("A1B2C3D4"). */
export function orderReference(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Email con las entradas de un pedido pagado: un QR por entrada (imagen
 * servida por `ticket-qr`), el tipo, el titular y un enlace "Ver entrada"
 * que abre la página pública de esa entrada (fallback si el cliente de
 * correo bloquea imágenes). Incluye versión de texto plano.
 */
export function ticketPurchasedEmail(opts: {
  firstName: string | null;
  event: TicketEmailEvent;
  tickets: TicketEmailTicket[];
  totalCents: number;
  currency?: string;
  orderId: string;
  /** Base pública de Supabase (SUPABASE_URL) para las imágenes QR. */
  supabaseUrl: string;
}): { subject: string; html: string; text: string } {
  const currency = opts.currency || "EUR";
  const n = opts.tickets.length;
  const single = n === 1;
  const title = oneLine(opts.event.title) || "tu evento";
  const when = formatEventDateTime(opts.event.dateStart, opts.event.timezone, "long");
  const venue = oneLine(opts.event.venueName);
  const address = oneLine(opts.event.address);
  const city = oneLine(opts.event.city);
  // "Sala X" + "Calle Y 1, Madrid"; sin sala, la ciudad va en la primera línea.
  const placeLine = venue || city;
  const cityInAddress = !!city && address.toLowerCase().includes(city.toLowerCase());
  const addressLine = [address, venue && !cityInAddress ? city : ""].filter(Boolean).join(", ");
  const ref = orderReference(opts.orderId);
  const firstName = oneLine(opts.firstName);

  const mono = "font-family:'Geist Mono',ui-monospace,monospace;";
  const eyebrow = `${mono}font-size:11px;text-transform:uppercase;letter-spacing:0.18em;`;

  const ticketsHtml = opts.tickets.map((t, i) => {
    const holder = oneLine(t.holderName);
    const tier = oneLine(t.tierName) || "Entrada";
    const qrBlock = t.accessToken
      ? `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px auto 0 auto;">
          <tr>
            <td style="background:#FFFFFF;padding:10px;border:1px solid #E8E1D4;border-radius:12px;">
              <img src="${esc(ticketQrImageUrl(opts.supabaseUrl, t.id, t.accessToken))}" width="220" height="220" alt="QR de tu entrada" style="display:block;width:220px;height:220px;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
        </table>
        ${t.doorCode ? `<div class="muted" style="margin-top:10px;font-size:12px;color:#5C544A;">Código para la puerta: <span style="${mono}font-size:14px;letter-spacing:0.12em;color:#1A1612;">${esc(t.doorCode)}</span></div>` : ""}
        <div style="margin-top:18px;">
          <a href="${esc(ticketViewUrl(t.id, t.accessToken))}" target="_blank"
            style="display:inline-block;padding:12px 26px;background:#E8542A;background-image:linear-gradient(180deg,#FF7A4D 0%,#E8542A 55%,#B8381A 100%);color:#FFFFFF;font-weight:600;font-size:14px;text-decoration:none;border-radius:999px;">
            Ver entrada
          </a>
        </div>`
      : `<p class="muted" style="margin:14px 0 0 0;font-size:13px;color:#5C544A;">Abre la app Pasify (Mis entradas) para ver el QR de esta entrada.</p>`;
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="panel" style="margin:0 0 16px 0;background:#FBF8F3;border:1px solid #E8E1D4;border-radius:16px;">
        <tr>
          <td align="center" style="padding:24px 20px;text-align:center;">
            <div class="muted" style="${eyebrow}color:#8A8275;">Entrada ${i + 1} de ${n}</div>
            <div class="ink" style="font-size:18px;font-weight:600;margin-top:6px;color:#1A1612;">${esc(tier)}</div>
            ${holder ? `<div class="muted" style="font-size:13px;margin-top:4px;color:#5C544A;">A nombre de ${esc(holder)}</div>` : ""}
            ${qrBlock}
          </td>
        </tr>
      </table>`;
  }).join("");

  // Resumen agrupado por tipo y precio: "2 × General · 30,00 €".
  const groups = new Map<string, { tier: string; count: number; cents: number }>();
  for (const t of opts.tickets) {
    const tier = oneLine(t.tierName) || "Entrada";
    const key = `${tier}|${t.amountCents}`;
    const g = groups.get(key) ?? { tier, count: 0, cents: 0 };
    g.count += 1;
    g.cents += t.amountCents;
    groups.set(key, g);
  }
  const summaryRows = [...groups.values()].map((g) => `
    <tr>
      <td class="ink" style="padding:8px 0;border-bottom:1px solid #E8E1D4;color:#1A1612;">${g.count} × ${esc(g.tier)}</td>
      <td class="ink" style="padding:8px 0;border-bottom:1px solid #E8E1D4;text-align:right;${mono}color:#1A1612;">${esc(formatMoney(g.cents, currency))}</td>
    </tr>`).join("");

  const showQrText = single
    ? "Enseña este QR en la puerta. También lo tienes en la app Pasify (Mis entradas)."
    : "Enseña el QR de cada entrada en la puerta: cada código vale para una persona. También los tienes en la app Pasify (Mis entradas).";

  const html = renderBaseEmail({
    title: `${single ? "Tu entrada está" : "Tus entradas están"} <span style="font-family:'Instrument Serif',serif;font-style:italic;color:#E8542A;font-weight:400;">${single ? "lista" : "listas"}</span>.`,
    preheader: `${single ? "1 entrada" : `${n} entradas`} · ${title}${when ? ` · ${when}` : ""}`,
    body: `
      <p>${firstName ? `Hola ${esc(firstName)}, gracias` : "Gracias"} por tu compra. ${single ? "Aquí tienes tu entrada" : `Aquí tienes tus ${n} entradas`} para:</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="panel" style="margin:20px 0;background:#FDF3EE;border:1px solid #F3C9B8;border-radius:14px;">
        <tr>
          <td style="padding:16px 18px;">
            <div style="${eyebrow}color:#E8542A;">Evento</div>
            <div class="ink" style="font-size:18px;font-weight:600;margin-top:4px;color:#1A1612;">${esc(title)}</div>
            ${when ? `<div class="muted" style="font-size:14px;margin-top:8px;color:#5C544A;">${esc(when)}</div>` : ""}
            ${placeLine ? `<div class="muted" style="font-size:14px;margin-top:2px;color:#5C544A;">${esc(placeLine)}</div>` : ""}
            ${addressLine ? `<div class="muted" style="font-size:13px;margin-top:2px;color:#8A8275;">${esc(addressLine)}</div>` : ""}
          </td>
        </tr>
      </table>
      ${ticketsHtml}
      <p style="margin:20px 0 6px 0;"><strong>${esc(showQrText)}</strong></p>
      <p class="muted" style="margin:0 0 20px 0;font-size:13px;color:#5C544A;">¿No ves el código? Pulsa «Ver entrada» para abrirlo en el navegador.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:8px 0 0 0;">
        ${summaryRows}
        <tr>
          <td class="ink" style="padding:12px 0 0 0;font-weight:600;color:#1A1612;">Total pagado</td>
          <td style="padding:12px 0 0 0;text-align:right;${mono}font-weight:600;font-size:16px;color:#E8542A;">${esc(formatMoney(opts.totalCents, currency))}</td>
        </tr>
      </table>
      <p class="muted" style="margin:16px 0 0 0;font-size:13px;color:#5C544A;">Referencia del pedido: <span style="${mono}letter-spacing:0.06em;">${esc(ref)}</span></p>
    `,
    footer: `Cada QR es personal y solo se valida una vez: no reenvíes este correo. ¿Necesitas ayuda? Responde a este mensaje indicando la referencia ${esc(ref)}.`,
  });

  const textTickets = opts.tickets.map((t, i) => {
    const holder = oneLine(t.holderName);
    const lines = [`Entrada ${i + 1} de ${n} · ${oneLine(t.tierName) || "Entrada"}${holder ? ` · A nombre de ${holder}` : ""}`];
    lines.push(t.accessToken
      ? `Ver entrada (con el QR): ${ticketViewUrl(t.id, t.accessToken)}`
      : "Abre la app Pasify (Mis entradas) para ver el QR.");
    if (t.doorCode) lines.push(`Código para la puerta: ${t.doorCode}`);
    return lines.join("\n");
  }).join("\n\n");

  const text = [
    firstName ? `Hola ${firstName},` : "Hola,",
    "",
    `Gracias por tu compra. ${single ? "Aquí tienes tu entrada" : `Aquí tienes tus ${n} entradas`} para:`,
    "",
    ...[title, when, placeLine, addressLine].filter(Boolean),
    "",
    textTickets,
    "",
    showQrText,
    "",
    `Total pagado: ${formatMoney(opts.totalCents, currency)}`,
    `Referencia del pedido: ${ref}`,
    "",
    "Cada QR es personal y solo se valida una vez: no reenvíes este correo.",
    `¿Necesitas ayuda? Responde a este mensaje o escríbenos a ${SUPPORT_EMAIL}.`,
    "",
    `${PLATFORM_NAME} · ${APP_URL}`,
  ].join("\n");

  return {
    subject: `${single ? "Tu entrada" : `Tus ${n} entradas`} para ${title}`,
    html,
    text,
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
