import { useCallback, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { esErrorDeRed } from "@/components/auth/authErrors";

/**
 * Cloudflare Turnstile en el alta (cliente y local) y en «¿Olvidaste tu
 * contraseña?».
 *
 *  - Solo en la web y solo si existe VITE_TURNSTILE_SITE_KEY. Sin la clave, la
 *    app funciona como antes. En la app nativa no se enseña: Apple y Google
 *    desaconsejan captchas de terceros dentro de las apps.
 *  - El token se comprueba con la edge function verify-captcha ANTES de
 *    signUp / resetPasswordForEmail. No se usa el captcha de Supabase Auth
 *    (options.captchaToken): al activarlo, GoTrue lo exige también para entrar
 *    con contraseña y en la app nativa, donde no hay widget.
 *  - Cada token vale una vez: tras comprobarlo (bien o mal) el widget se
 *    reinicia y da otro.
 */

export type AccionCaptcha = "signup" | "reset-password";

const SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "").trim();
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const MENSAJE_CAPTCHA_PENDIENTE = "Espera a que termine la comprobación de seguridad y vuelve a intentarlo.";
export const MENSAJE_CAPTCHA_NO_CARGA =
  "No hemos podido cargar la comprobación de seguridad. Revisa tu conexión (o el bloqueador de anuncios) y vuelve a intentarlo.";

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  size?: "normal" | "flexible" | "compact";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code?: string) => boolean | void;
  "timeout-callback"?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** ¿Se pide el captcha en esta plataforma? */
export const captchaActivo = (): boolean => SITE_KEY !== "" && !Capacitor.isNativePlatform();

export const captchaSiteKey = (): string => SITE_KEY;

let cargaScript: Promise<TurnstileApi> | null = null;

/** Carga el script de Turnstile una sola vez (si falla, el siguiente intento vuelve a probar). */
export function cargarTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!cargaScript) {
    cargaScript = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_no_disponible")));
      script.onerror = () => reject(new Error("turnstile_no_carga"));
      document.head.appendChild(script);
    }).catch((err) => {
      cargaScript = null;
      document.querySelectorAll(`script[src="${SCRIPT_URL}"]`).forEach((s) => s.remove());
      throw err;
    });
  }
  return cargaScript;
}

/** Error con un mensaje para el usuario. */
export class CaptchaError extends Error {}

/**
 * Comprueba el token con verify-captcha. Lanza CaptchaError con el mensaje
 * que hay que enseñar si no vale.
 */
export async function verificarCaptcha(token: string, accion: AccionCaptcha): Promise<void> {
  let error: unknown = null;
  let data: unknown = null;
  try {
    ({ data, error } = await supabase.functions.invoke("verify-captcha", { body: { token, action: accion } }));
  } catch (err) {
    error = err;
  }
  if (!error && (data as { success?: unknown } | null)?.success === true) return;

  if (error instanceof FunctionsHttpError) {
    const status = (error.context as Response | undefined)?.status;
    if (status === 429) throw new CaptchaError("Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
    if (status === 503) throw new CaptchaError("Ahora mismo no podemos hacer la comprobación de seguridad. Inténtalo dentro de un rato.");
  } else if (error instanceof FunctionsFetchError || (error && esErrorDeRed(error))) {
    throw new CaptchaError("No hay conexión con Pasify. Revisa tu red y vuelve a intentarlo.");
  }
  throw new CaptchaError("No hemos podido comprobar que no eres un robot. Vuelve a intentarlo.");
}

export interface CaptchaWidgetProps {
  accion: AccionCaptcha;
  onToken: (token: string | null) => void;
  /** Al cambiar, el widget se reinicia (token nuevo). */
  resetKey: number;
}

/**
 * Estado del captcha de un formulario. Sin captcha (nativo o sin clave),
 * `listo` es siempre true y `verificar` no hace nada.
 */
export function useCaptcha(accion: AccionCaptcha) {
  const activo = captchaActivo();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const reset = useCallback(() => {
    setToken(null);
    setResetKey((n) => n + 1);
  }, []);

  /** Lanza CaptchaError si no hay token o no vale. El token se gasta siempre. */
  const verificar = useCallback(async () => {
    if (!activo) return;
    if (!token) throw new CaptchaError(MENSAJE_CAPTCHA_PENDIENTE);
    try {
      await verificarCaptcha(token, accion);
    } finally {
      reset();
    }
  }, [activo, token, accion, reset]);

  const widget: CaptchaWidgetProps = { accion, onToken: setToken, resetKey };
  return { activo, listo: !activo || token !== null, verificar, reset, widget };
}
