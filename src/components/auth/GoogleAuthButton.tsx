import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface GoogleAuthButtonProps {
  label?: string;
  /** Override del redirect URL dopo OAuth (solo web). Default: origin corrente. */
  redirectTo?: string;
  className?: string;
}

const WEB_CLIENT_ID =
  "892613837659-jtggfc6ufrhqrob0hsubm95q0an1koec.apps.googleusercontent.com";

const IOS_CLIENT_ID =
  "899901016052-5ltqfpu3qa3a9k9lu140n42s6lgqt476.apps.googleusercontent.com";

let googleAuthInitialized = false;

/**
 * Bottone OAuth Google.
 *   - Web: usa supabase.auth.signInWithOAuth (redirect flow)
 *   - iOS/Android (Capacitor): usa il plugin capacitor-google-auth per il
 *     dialog nativo → id_token → supabase.auth.signInWithIdToken.
 */
export const GoogleAuthButton = ({ label = "Continuar con Google", redirectTo, className }: GoogleAuthButtonProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const isNative = Capacitor.isNativePlatform();
  // En iOS no se ofrece acceso con Google. El plugin nativo arrastra al binario
  // GoogleSignIn 6.2.4, GTMAppAuth 1.3.1 y GTMSessionFetcher 2.3.0, versiones sin
  // manifiesto de privacidad; Apple las rechaza desde 2024 con ITMS-91061 y el
  // plugin fija esa version en su podspec, asi que no hay actualizacion posible.
  // El pod esta fuera del Podfile de iOS y aqui se corta el boton, de modo que el
  // plugin no llega a invocarse nunca. En iPhone quedan Sign in with Apple y el
  // acceso por email. Android y web siguen exactamente igual.
  const isIOS = Capacitor.getPlatform() === "ios";

  // Inizializzazione plugin (solo native, una volta sola)
  useEffect(() => {
    if (isIOS || !isNative || googleAuthInitialized) return;
    try {
      GoogleAuth.initialize({
        clientId: Capacitor.getPlatform() === "ios" ? IOS_CLIENT_ID : WEB_CLIENT_ID,
        scopes: ["profile", "email"],
        grantOfflineAccess: Capacitor.getPlatform() !== "ios",
      });
      googleAuthInitialized = true;
    } catch (err) {
      console.error("GoogleAuth.initialize error:", err);
    }
  }, [isNative, isIOS]);

  const handleClick = async () => {
    setLoading(true);
    try {
      if (isNative) {
        // Native flow — dialog Google nativo
        const result = await GoogleAuth.signIn();
        const idToken = result?.authentication?.idToken;
        if (!idToken) throw new Error("No id_token from Google native");

        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: idToken,
        });
        if (error) throw error;
      } else {
        // Web flow — redirect a Google, poi callback
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: redirectTo || `${window.location.origin}/`,
          },
        });
        if (error) throw error;
      }
    } catch (err) {
      // El plugin nativo devuelve errores crudos de Google Play Services
      // ("Something went wrong", "12501", el temido "10" = DEVELOPER_ERROR
      // cuando la huella SHA-1 del certificado no está registrada en el cliente
      // OAuth de Android). Volcarlos tal cual en un toast rojo deja al usuario
      // —o al revisor de Play— delante de un mensaje incomprensible en la
      // primera pantalla de la app. Traducimos a algo accionable y dejamos el
      // detalle técnico en consola y en Sentry.
      console.error("Google auth error:", err);

      const raw = err instanceof Error ? err.message : String(err ?? "");
      const cancelado = /12501|canceled|cancelled|popup_closed/i.test(raw);
      const description = cancelado
        ? "Has cancelado el acceso con Google."
        : "No hemos podido conectar con Google. Puedes entrar con tu email y contraseña mientras tanto.";

      toast({
        title: cancelado ? "Acceso cancelado" : "Google no disponible",
        description,
        variant: cancelado ? "default" : "destructive",
      });
      setLoading(false);
    }
  };

  if (isIOS) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        className ||
        "group flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
      }
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <GoogleIcon className="h-5 w-5" />
      )}
      <span className="text-sm">{label}</span>
    </button>
  );
};

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

export default GoogleAuthButton;
