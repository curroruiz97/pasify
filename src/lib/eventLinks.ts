import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { WEB_BASE } from "@/lib/redirect-url";

/**
 * Enlace público de un evento (`/#/e/:id`, página PublicEvent). Siempre con
 * la web pública: desde la app nativa window.location.origin es el origen
 * interno de la WebView y el enlace no serviría fuera.
 */
export const publicEventUrl = (eventId: string): string => `${WEB_BASE}/#/e/${eventId}`;

const isCancel = (err: unknown) =>
  err instanceof Error && /cancel|abort/i.test(`${err.name} ${err.message}`);

/** Comparte el enlace del evento: hoja nativa, Web Share o portapapeles. */
export async function shareEventLink(eventId: string, title: string): Promise<void> {
  const url = publicEventUrl(eventId);
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text: title, url, dialogTitle: "Compartir evento" });
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
  await copyEventLink(eventId);
}

/** Copia el enlace del evento al portapapeles (o lo enseña si no se puede). */
export async function copyEventLink(eventId: string): Promise<void> {
  const url = publicEventUrl(eventId);
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Enlace copiado", { description: url });
  } catch {
    toast.message("Copia este enlace", { description: url });
  }
}
