import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/integrations/supabase/client";

// URL pública del sitio (dominio Vercel temporal o definitivo). Hardcode
// obligatorio porque en app nativa `window.location.origin` es `http://localhost`
// (WebView). Configurable vía env var `VITE_PUBLIC_WEB_URL` para que el
// switch dev/staging/prod sea una sola línea en .env.
const WEB_BASE =
  import.meta.env.VITE_PUBLIC_WEB_URL ||
  import.meta.env.VITE_APP_BASE_URL ||
  "https://pasifyy.vercel.app";

/**
 * Abre una página del sitio web en Safari/Chrome de sistema pasando los tokens
 * de la sesión actual para que el usuario quede logueado sin reintroducir
 * credenciales.
 *
 * Flujo:
 *   app nativa → crea URL https://pasifyy.vercel.app/#/auth/bridge?access=...&refresh=...&next=<path>
 *   → abre con plugin Capacitor Browser (SFSafariViewController / Custom Tabs)
 *   → el web lee los tokens, hace setSession y redirige a `next`
 *
 * En web normal usa window.open en nueva tab.
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
