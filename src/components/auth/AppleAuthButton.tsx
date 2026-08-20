import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AppleAuthButtonProps {
  label?: string;
  className?: string;
}

/**
 * Sign in with Apple — OBLIGATORIO en iOS por la guía 4.8 de App Review:
 * si ofreces login social de terceros (Google), tienes que ofrecer también
 * una alternativa que limite la recogida de datos y permita ocultar el email.
 *
 * Solo se renderiza en iOS nativo: en web y Android no hay flujo montado
 * (haría falta Service ID + clave privada en Apple Developer).
 *
 * Nonce: Apple espera el nonce YA HASHEADO en la petición y lo devuelve tal
 * cual dentro del id_token. Supabase espera el nonce EN CRUDO y lo hashea por
 * su cuenta para compararlos. De ahí que mandemos uno a cada sitio.
 */
async function makeNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

export const AppleAuthButton = ({ label = "Continuar con Apple", className }: AppleAuthButtonProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  if (Capacitor.getPlatform() !== "ios") return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      const { raw, hashed } = await makeNonce();

      const result = await SignInWithApple.authorize({
        clientId: "es.pasify.app",
        redirectURI: "",
        scopes: "email name",
        nonce: hashed,
      });

      const idToken = result?.response?.identityToken;
      if (!idToken) throw new Error("Apple no devolvió identityToken");

      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: idToken,
        nonce: raw,
      });
      if (error) throw error;
    } catch (err) {
      console.error("Apple auth error:", err);

      const rawMsg = err instanceof Error ? err.message : String(err ?? "");
      // 1001 = ASAuthorizationError.canceled (el usuario cerró la hoja)
      const cancelado = /1001|cancel/i.test(rawMsg);

      toast({
        title: cancelado ? "Acceso cancelado" : "Apple no disponible",
        description: cancelado
          ? "Has cancelado el acceso con Apple."
          : "No hemos podido conectar con Apple. Puedes entrar con tu email y contraseña mientras tanto.",
        variant: cancelado ? "default" : "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        className ||
        "group flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-black bg-black font-medium text-white transition hover:bg-neutral-900 disabled:opacity-60"
      }
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <AppleIcon className="h-5 w-5" />
      )}
      <span className="text-sm">{label}</span>
    </button>
  );
};

const AppleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.85.99-2.24 1.76-3.4 1.67-.14-1.1.4-2.26 1.08-3.02.77-.88 2.13-1.55 3.24-1.6.07.31.21.62.21.93zM20.9 17.05c-.55 1.27-.82 1.84-1.53 2.97-.99 1.57-2.39 3.53-4.12 3.55-1.54.01-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.02-3.06-1.79-4.05-3.36C.34 15.83-.16 10.7 1.86 7.9c1.19-1.68 3.07-2.66 4.83-2.66 1.8 0 2.93 1 4.42 1 1.44 0 2.32-1 4.4-1 1.57 0 3.24.86 4.42 2.34-3.89 2.13-3.26 7.68 1.0 9.47z" />
  </svg>
);

export default AppleAuthButton;
