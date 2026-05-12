import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/integrations/supabase/client";

// URL pubblico del sito (dove gira Vercel). Obbligatorio hardcode perché
// nell'app nativa `window.location.origin` è `http://localhost` (WebView).
const WEB_BASE = import.meta.env.VITE_PUBLIC_WEB_URL || "https://studentslife.es";

/**
 * Apre una pagina del sito web in Safari/Chrome di sistema passando i token
 * della sessione corrente così l'utente è loggato senza reinserire credenziali.
 *
 * Flusso:
 *   app nativa → crea URL https://studentslife.es/#/auth/bridge?access=...&refresh=...&next=<path>
 *   → apre con Capacitor Browser plugin (SFSafariViewController / Custom Tabs)
 *   → il web legge i token, fa setSession e reindirizza a next
 *
 * Su web standard usa window.open in nuova tab.
 */
export async function openWebWithAuth(nextPath: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const isNative = Capacitor.isNativePlatform();
  const base = isNative
    ? WEB_BASE
    : (typeof window !== "undefined" ? window.location.origin : WEB_BASE);

  const params = new URLSearchParams({
    access: session.access_token,
    refresh: session.refresh_token,
    next: nextPath,
  });
  const url = `${base}/#/auth/bridge?${params.toString()}`;

  if (isNative) {
    // SFSafariViewController (iOS) / Custom Tabs (Android) — richiesto da
    // App Store e Google Play per pagamenti esterni fuori dalla WebView.
    await Browser.open({ url, presentationStyle: "popover" });
    return true;
  }

  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    window.location.href = url;
  }
  return true;
}
