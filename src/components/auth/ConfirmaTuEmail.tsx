import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/platform";
import { esLimiteDePeticiones, mensajeErrorAuth } from "@/components/auth/authErrors";
import {
  ESPERA_REENVIO_S,
  reenviarEmailDeConfirmacion,
  useCuentaAtras,
} from "@/components/auth/confirmacionEmail";

interface ConfirmaTuEmailProps {
  /** Email con el que se ha dado de alta. */
  email: string;
  /** Iniciar sesión (con `?next=` si lo hay). */
  loginHref: string;
  /** Volver al formulario para usar otro email. */
  onCambiarEmail?: () => void;
  /**
   * La cuenta se ha confirmado en otra pestaña de este navegador y aquí ya
   * hay sesión (auth-js la comparte entre pestañas): seguir sin pasar por el login.
   */
  onConfirmada?: () => void;
}

/**
 * Alta hecha con «Confirm email» activado: signUp no abre sesión hasta que se
 * abre el enlace del email. Se dice así, se deja reenviar el email pasado un
 * minuto y se lleva al login.
 *
 * GoTrue contesta igual si el email ya tenía cuenta (no manda nada, para no
 * revelar qué emails existen): por eso se recuerda que, si ya tenía cuenta,
 * inicie sesión o recupere la contraseña.
 */
export const ConfirmaTuEmail = ({ email, loginHref, onCambiarEmail, onConfirmada }: ConfirmaTuEmailProps) => {
  const [espera, empezarEspera] = useCuentaAtras(ESPERA_REENVIO_S);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const onConfirmadaRef = useRef(onConfirmada);

  useEffect(() => {
    onConfirmadaRef.current = onConfirmada;
  }, [onConfirmada]);

  useEffect(() => {
    const destino = email.trim().toLowerCase();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session?.user.email) return;
      if (session.user.email.toLowerCase() !== destino) return;
      // Fuera del callback de auth-js (su lock).
      setTimeout(() => onConfirmadaRef.current?.(), 0);
    });
    return () => subscription.unsubscribe();
  }, [email]);

  const reenviar = async () => {
    if (enviando || espera > 0) return;
    setEnviando(true);
    setAviso(null);
    try {
      const { error } = await reenviarEmailDeConfirmacion(email);
      if (error) throw error;
      setAviso({ tipo: "ok", texto: "Te lo hemos vuelto a enviar. Puede tardar un par de minutos." });
      empezarEspera(ESPERA_REENVIO_S);
    } catch (err) {
      console.error("resend(signup):", err);
      setAviso({ tipo: "error", texto: mensajeErrorAuth(err) });
      if (esLimiteDePeticiones(err)) empezarEspera(ESPERA_REENVIO_S);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-bold tracking-tight text-slate-900">Revisa tu correo para confirmar tu cuenta</h2>

      <div role="status" className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
        <div className="space-y-1.5 text-sm text-slate-600">
          <p className="font-medium text-slate-900">
            Te hemos enviado un enlace a <span className="break-all">{email}</span>.
          </p>
          <p>Ábrelo para activar tu cuenta y después inicia sesión. Mira también en la carpeta de spam.</p>
          {isNativeApp() && (
            <p>El enlace se abre en el navegador. Cuando confirmes, vuelve a la app e inicia sesión.</p>
          )}
          <p className="text-xs text-slate-500">
            Si ya tenías una cuenta con este email, no te llegará nada: inicia sesión o recupera tu contraseña.
          </p>
        </div>
      </div>

      {aviso && (
        <p role={aviso.tipo === "error" ? "alert" : "status"} className={`text-sm ${aviso.tipo === "error" ? "text-red-600" : "text-slate-600"}`}>
          {aviso.texto}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full rounded-2xl"
        disabled={enviando || espera > 0}
        onClick={() => void reenviar()}
      >
        {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {espera > 0 ? `Reenviar el email en ${espera} s` : "Reenviar el email"}
      </Button>

      <Button asChild className="h-11 w-full rounded-2xl text-sm font-semibold text-white" style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)" }}>
        <Link to={loginHref}>Ir a iniciar sesión</Link>
      </Button>

      {onCambiarEmail && (
        <button
          type="button"
          className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
          onClick={onCambiarEmail}
        >
          Usar otro email
        </button>
      )}
    </div>
  );
};

export default ConfirmaTuEmail;
