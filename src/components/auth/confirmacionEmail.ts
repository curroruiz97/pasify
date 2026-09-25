import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { WEB_BASE } from "@/lib/redirect-url";

/**
 * Confirmación del email al darse de alta («Confirm email» de Supabase Auth).
 *
 * Con la confirmación activada, signUp crea el usuario (y los triggers le dan
 * rol y perfil con los datos del formulario) pero no abre sesión: hasta que
 * abre el enlace del email no puede entrar. Sin confirmación, signUp abre
 * sesión y todo sigue como antes.
 *
 * El enlace vuelve a la raíz de la web sin ruta (`https://…/`): GoTrue le
 * añade `#access_token=…`, que auth-js lee (detectSessionInUrl) y RootRoute
 * lleva a su panel. Con una ruta de HashRouter delante (`/#/…`) el fragmento
 * quedaría detrás de otro `#` y auth-js no lo leería. Esa URL tiene que estar
 * en Auth › URL Configuration › Redirect URLs (la de «Entrar con Google» ya
 * lo está); si no, GoTrue usa la Site URL.
 */

/** GoTrue deja pedir un email de confirmación por minuto. */
export const ESPERA_REENVIO_S = 60;

/** Adónde vuelve el enlace del email: la web pública (también desde la app, que no tiene https). */
export const urlTrasConfirmarEmail = (): string =>
  `${Capacitor.isNativePlatform() ? WEB_BASE : window.location.origin}/`;

/** Vuelve a mandar el email de confirmación del alta. */
export async function reenviarEmailDeConfirmacion(email: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo: urlTrasConfirmarEmail() },
  });
  return { error: error ?? null };
}

/** Cuenta atrás en segundos: [restantes, empezar(segundos)]. */
export function useCuentaAtras(inicial = 0): [number, (segundos: number) => void] {
  const [restante, setRestante] = useState(inicial);
  useEffect(() => {
    if (restante <= 0) return;
    const t = setTimeout(() => setRestante((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [restante]);
  return [restante, setRestante];
}
