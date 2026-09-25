import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { WEB_BASE } from "@/lib/redirect-url";

/**
 * Enlaces públicos que se comparten fuera de la app (WhatsApp, Instagram,
 * cartel con QR) y enlaces del embudo de compra.
 *
 * Siempre con la web pública: desde la app nativa window.location.origin es
 * el origen interno de la WebView (`capacitor://localhost`, `https://localhost`)
 * y el enlace no serviría fuera.
 *
 * Sin `#`: el servidor nunca ve lo que va detrás del `#`, y WhatsApp y
 * compañía necesitan el id para pintar la vista previa. Vercel pasa `/e/:id`
 * y `/p/:id` a `api/e/[id].ts` y `api/p/[id].ts`: a los rastreadores les
 * sirven las etiquetas og:* y a los navegadores les redirigen a la página de
 * la app (`/#/e/:id`, `/#/p/:id`).
 */

/** Enlace público de un evento: página PublicEvent. */
export const publicEventUrl = (eventId: string): string =>
  `${WEB_BASE}/e/${encodeURIComponent(eventId)}`;

/** Enlace público de un local: página PublicPartnerPage. */
export const publicPartnerUrl = (partnerId: string): string =>
  `${WEB_BASE}/p/${encodeURIComponent(partnerId)}`;

const isCancel = (err: unknown) =>
  err instanceof Error && /cancel|abort/i.test(`${err.name} ${err.message}`);

/** Copia un enlace al portapapeles (o lo enseña si no se puede). */
async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Enlace copiado", { description: url });
  } catch {
    toast.message("Copia este enlace", { description: url });
  }
}

/** Hoja nativa, Web Share o, si no hay, portapapeles. */
async function shareLink(url: string, title: string, dialogTitle: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text: title, url, dialogTitle });
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text: title, url });
      return;
    }
  } catch (err) {
    // Cerrar la hoja de compartir no es un error.
    if (isCancel(err)) return;
  }
  await copyLink(url);
}

/** Comparte el enlace del evento. */
export async function shareEventLink(eventId: string, title: string): Promise<void> {
  await shareLink(publicEventUrl(eventId), title, "Compartir evento");
}

/** Comparte el enlace de la ficha de un local. */
export async function sharePartnerLink(partnerId: string, name: string): Promise<void> {
  await shareLink(publicPartnerUrl(partnerId), name, "Compartir local");
}

/** Copia el enlace del evento al portapapeles (o lo enseña si no se puede). */
export async function copyEventLink(eventId: string): Promise<void> {
  await copyLink(publicEventUrl(eventId));
}

// ---------------------------------------------------------------- embudo

/**
 * Ruta actual de la app (HashRouter), con su query: "/e/<id>",
 * "/calendar?event=<id>"… Sin ruta reconocible, el calendario.
 */
export function currentAppPath(): string {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  return hash.startsWith("#/") ? hash.slice(1) : "/calendar";
}

/**
 * Login que, al terminar, vuelve a `next`. `next` es SIEMPRE una ruta
 * relativa de la app que empieza por "/" (nunca "//", que el navegador
 * tomaría como otro dominio): Login, registro y OAuth la reenvían tal cual.
 * Antes se mandaba a /register-client y, si el comprador ya tenía cuenta
 * y pulsaba "Iniciar sesión" o entraba con Google/Apple, perdía el evento.
 */
export function loginPathWithNext(next: string = currentAppPath()): string {
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/calendar";
  return `/login?next=${encodeURIComponent(safe)}`;
}

// ---------------------------------------------------------------- transferencias

/**
 * Ruta de la app para aceptar una entrada enviada (página AcceptTransfer).
 * El email de la transferencia enlaza a `${WEB_BASE}/#/transferencia?token=…`.
 */
export const transferPath = (token: string): string =>
  `/transferencia?token=${encodeURIComponent(token)}`;
