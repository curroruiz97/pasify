import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isPasswordRecoverySession } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, CheckCircle, KeyRound } from "lucide-react";

/**
 * Contraseña nueva desde el enlace de recuperación del email.
 *
 * `updateUser({ password })` cambia la contraseña de la sesión abierta sin
 * pedir la actual, así que aquí solo se permite en una sesión de
 * recuperación:
 *  - la del propio enlace: sus tokens (en la URL con `type=recovery`, o los
 *    que main.tsx aparta en sessionStorage antes de que HashRouter pise el
 *    hash) sustituyen a la sesión que hubiera abierta. En un ordenador
 *    compartido con la cuenta A dentro, el enlace de B cambia la contraseña de
 *    B, nunca la de A.
 *  - o una para la que auth-js haya emitido PASSWORD_RECOVERY en esta carga
 *    (isPasswordRecoverySession).
 * `type=recovery` en la URL sin tokens no vale: eso lo escribe cualquiera.
 * Con una sesión normal se manda a Ajustes, donde se pide la contraseña actual.
 * En modo puerta ni siquiera se llega aquí (DoorLockGuard en App.tsx).
 */

type Modo = "comprobando" | "recuperacion" | "ajustes";

interface TokensDelEnlace {
  accessToken: string;
  refreshToken: string;
}

/**
 * Tokens de un enlace de recuperación en la URL: `?access_token=…`,
 * `#access_token=…`, `#/update-password?access_token=…` o
 * `#/update-password#access_token=…` (GoTrue añade su fragmento al
 * redirectTo, que ya lleva el # de HashRouter). Solo con `type=recovery`.
 */
function tokensEnLaUrl(): TokensDelEnlace | null {
  const trozos = [window.location.search, ...window.location.hash.split(/[?#]/)];
  for (const trozo of trozos) {
    const params = new URLSearchParams(trozo.replace(/^\?/, ""));
    const accessToken = params.get("access_token");
    if (accessToken && params.get("type") === "recovery") {
      return { accessToken, refreshToken: params.get("refresh_token") ?? "" };
    }
  }
  return null;
}

/**
 * Los que main.tsx apartó al abrir el enlace del email en esta pestaña (de
 * recuperación o de acceso: prueban igual que es el dueño del correo). Se
 * consumen.
 */
function tokensApartados(): TokensDelEnlace | null {
  try {
    const accessToken = sessionStorage.getItem("recovery_access_token");
    const refreshToken = sessionStorage.getItem("recovery_refresh_token") ?? "";
    sessionStorage.removeItem("recovery_access_token");
    sessionStorage.removeItem("recovery_refresh_token");
    return accessToken ? { accessToken, refreshToken } : null;
  } catch {
    return null;
  }
}

const UpdatePassword = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [modo, setModo] = useState<Modo>("comprobando");
  // Usuario de la sesión de recuperación: al guardar se comprueba que sigue siendo el mismo.
  const [usuarioRecuperacion, setUsuarioRecuperacion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let vivo = true;

    const comprobar = async () => {
      const tokens = tokensApartados() ?? tokensEnLaUrl();

      if (tokens) {
        // La sesión del enlace sustituye a la abierta (si la hay).
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (!vivo) return;
        if (error || !data.session) {
          console.error("Error setting session:", error);
          toast({
            title: "Error de sesión",
            description: "El enlace ha expirado o es inválido. Solicita uno nuevo.",
            variant: "destructive",
          });
          navigate("/reset-password", { replace: true });
          return;
        }
        // Fuera los tokens de la barra de direcciones (y del historial). Se
        // conserva history.state: es donde HashRouter lleva su índice.
        window.history.replaceState(window.history.state, "", `${window.location.pathname}#/update-password`);
        setUsuarioRecuperacion(data.session.user.id);
        setModo("recuperacion");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!vivo) return;
      if (!session) {
        navigate("/reset-password", { replace: true });
        return;
      }
      if (isPasswordRecoverySession(session.user.id)) {
        setUsuarioRecuperacion(session.user.id);
        setModo("recuperacion");
      } else {
        setModo("ajustes");
      }
    };

    comprobar().catch((err) => {
      console.error("[UpdatePassword] comprobación de sesión fallida:", err);
      if (vivo) navigate("/reset-password", { replace: true });
    });
    return () => {
      vivo = false;
    };
  }, [navigate, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // La sesión puede haber cambiado desde que se abrió el enlace (otra
      // pestaña): solo se cambia la contraseña de la cuenta del enlace.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || !usuarioRecuperacion || session.user.id !== usuarioRecuperacion) {
        setModo("ajustes");
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      setSuccess(true);
      toast({
        title: "¡Contraseña actualizada!",
        description: "Tu contraseña ha sido cambiada exitosamente",
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo actualizar la contraseña",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">¡Contraseña Actualizada!</h1>
          <p className="text-muted-foreground">
            Tu contraseña ha sido cambiada exitosamente. Serás redirigido al login...
          </p>
        </div>
      </div>
    );
  }

  if (modo === "comprobando") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (modo === "ajustes") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <KeyRound className="w-12 h-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Para cambiar tu contraseña, ve a Ajustes</h1>
          <p className="text-muted-foreground">
            Aquí solo se pone una contraseña nueva desde el enlace que te enviamos por email. Con la
            sesión abierta, cámbiala en Ajustes › Cambiar contraseña: te pediremos la actual.
          </p>
          <Button className="w-full ios-button h-12" onClick={() => navigate("/", { replace: true })}>
            Ir a mi cuenta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
      <div className="w-full max-w-md ios-card p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary">Pasify</h1>
          <p className="text-muted-foreground mt-2">Establece tu nueva contraseña</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                className="ios-input pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                className="ios-input pr-10"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full ios-button h-12"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Actualizando...
              </>
            ) : (
              "Actualizar contraseña"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default UpdatePassword;
