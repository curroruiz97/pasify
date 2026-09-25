import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  MENSAJE_CAPTCHA_NO_CARGA,
  captchaSiteKey,
  cargarTurnstile,
  type CaptchaWidgetProps,
} from "@/components/auth/captcha";

/**
 * Widget de Cloudflare Turnstile (modo gestionado: casi siempre se resuelve
 * solo). Lo pintan los formularios que usan useCaptcha(), solo cuando el
 * captcha está activo (web con VITE_TURNSTILE_SITE_KEY).
 */
export const TurnstileWidget = ({ accion, onToken, resetKey }: CaptchaWidgetProps) => {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let vivo = true;
    setEstado("cargando");
    cargarTurnstile()
      .then((turnstile) => {
        if (!vivo || !contenedorRef.current) return;
        const id = turnstile.render(contenedorRef.current, {
          sitekey: captchaSiteKey(),
          action: accion,
          theme: "light",
          language: "es",
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "timeout-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            // Turnstile reintenta solo; no se enseña su error en la consola.
            return true;
          },
        });
        widgetIdRef.current = id ?? null;
        setEstado("listo");
      })
      .catch(() => {
        if (vivo) setEstado("error");
      });
    return () => {
      vivo = false;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* ya no estaba */
        }
      }
      onTokenRef.current(null);
    };
  }, [accion, intento]);

  // Token gastado (useCaptcha.reset): se pide otro.
  const primerResetRef = useRef(true);
  useEffect(() => {
    if (primerResetRef.current) {
      primerResetRef.current = false;
      return;
    }
    const id = widgetIdRef.current;
    if (id && window.turnstile) {
      try {
        window.turnstile.reset(id);
      } catch {
        setIntento((n) => n + 1);
      }
    }
  }, [resetKey]);

  if (estado === "error") {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-800">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1.5">
          <p>{MENSAJE_CAPTCHA_NO_CARGA}</p>
          <button
            type="button"
            className="font-semibold text-orange-700 underline underline-offset-2"
            onClick={() => setIntento((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[65px]">
      {estado === "cargando" && (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Comprobación de seguridad…
        </div>
      )}
      <div ref={contenedorRef} />
    </div>
  );
};

export default TurnstileWidget;
