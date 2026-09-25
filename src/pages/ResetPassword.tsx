import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CircleAlert, Loader2, Mail, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import { CaptchaError, useCaptcha } from "@/components/auth/captcha";
import { esLimiteDePeticiones, mensajeErrorAuth } from "@/components/auth/authErrors";
import { buildExternalReturnUrl } from "@/lib/redirect-url";
import { isNativeApp } from "@/lib/platform";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

/** Tras un envío, cuánto hay que esperar para pedir otro (GoTrue limita a uno por minuto). */
const ESPERA_REENVIO_S = 60;

/**
 * Recuperar contraseña: email, enviar y ya.
 *
 * GoTrue responde igual exista o no la cuenta, así que el mensaje tampoco lo
 * dice: "Si existe una cuenta con ese email, te hemos enviado un enlace".
 *
 * El enlace del email lleva a la web (`/#/update-password?token_hash=…`, ver
 * UpdatePassword), también desde la app: allí se pone la contraseña nueva y
 * se vuelve a la app a iniciar sesión.
 *
 * Con `?enlace=caducado` (main.tsx, al volver de un enlace que ya no vale) se
 * avisa antes de pedir uno nuevo. Antes esta pantalla presumía de cosas que
 * no hace (certificaciones, "cifrado extremo a extremo", un token de ejemplo,
 * un log de SMTP de mentira) y el enlace caducado acababa en un 404 en inglés.
 *
 * En la web, con VITE_TURNSTILE_SITE_KEY, cada envío (también el reenvío)
 * pasa antes por el captcha (components/auth/captcha.ts).
 */
const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const enlaceCaducado = searchParams.get("enlace") === "caducado";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviadoA, setEnviadoA] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [espera, setEspera] = useState(0);
  const captcha = useCaptcha("reset-password");

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const enviar = async (destino: string) => {
    const limpio = destino.trim();
    if (!limpio || loading || espera > 0) return;
    setLoading(true);
    setError(null);
    try {
      await captcha.verificar();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(limpio, {
        redirectTo: buildExternalReturnUrl("/update-password"),
      });
      if (resetError) throw resetError;
      setEnviadoA(limpio);
      setEspera(ESPERA_REENVIO_S);
    } catch (err) {
      if (err instanceof CaptchaError) {
        setError(err.message);
        return;
      }
      console.error("resetPasswordForEmail:", err);
      setError(mensajeErrorAuth(err));
      if (esLimiteDePeticiones(err)) setEspera(ESPERA_REENVIO_S);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void enviar(email);
  };

  return (
    <AuthShell
      headline={
        <>
          Recupera tu <span style={serif} className="text-orange-200">acceso</span>.
        </>
      }
      subline="Te enviamos por email un enlace para poner una contraseña nueva."
      imageUrl="/partner-hero.jpg"
    >
      {enlaceCaducado && !enviadoA && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>El enlace ha caducado o ya se ha usado. Pide uno nuevo.</span>
        </div>
      )}

      <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">¿Olvidaste tu contraseña?</h2>

      {enviadoA ? (
        <div role="status" className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div className="space-y-1.5 text-sm text-slate-600">
              <p className="font-medium text-slate-900">
                Si existe una cuenta con ese email, te hemos enviado un enlace.
              </p>
              <p>
                Revisa <span className="font-medium text-slate-900">{enviadoA}</span>, también la carpeta de spam. El
                enlace sirve una sola vez.
              </p>
              {isNativeApp() && (
                <p>El enlace se abre en el navegador. Cuando cambies la contraseña, vuelve a la app e inicia sesión.</p>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          {captcha.activo && espera <= 0 && <TurnstileWidget {...captcha.widget} />}

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full rounded-2xl"
            disabled={loading || espera > 0}
            onClick={() => void enviar(enviadoA)}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {espera > 0 ? `Reenviar en ${espera} s` : "Reenviar el enlace"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
            onClick={() => {
              setEnviadoA(null);
              setError(null);
            }}
          >
            Usar otro email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-500">Escribe el email con el que te registraste.</p>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-slate-700">
              Email
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="tu@email.com"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 focus-visible:ring-orange-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          {captcha.activo && <TurnstileWidget {...captcha.widget} />}

          <Button
            type="submit"
            className="h-12 w-full rounded-2xl text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "0 12px 30px -10px rgba(232,84,42,0.5)",
            }}
            disabled={loading || espera > 0 || !email.trim()}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : espera > 0 ? (
              `Espera ${espera} s`
            ) : (
              "Enviar enlace"
            )}
          </Button>
        </form>
      )}

      <div className="mt-6 text-center text-xs text-slate-500">
        <Link to="/login" className="font-semibold text-orange-600 hover:text-orange-700">
          Volver a iniciar sesión
        </Link>
      </div>
    </AuthShell>
  );
};

export default ResetPassword;
