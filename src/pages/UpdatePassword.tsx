import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isPasswordRecoverySession } from "@/hooks/useAuth";
import { getSessionSnapshot } from "@/lib/cache/session";
import { withTimeout } from "@/lib/withTimeout";
import { isNativeApp } from "@/lib/platform";
import {
  MENSAJE_PASSWORD_CORTA,
  MIN_PASSWORD_LENGTH,
  esErrorDeRed,
  mensajeErrorAuth,
} from "@/components/auth/authErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, CheckCircle, KeyRound, WifiOff } from "lucide-react";

/**
 * Contraseña nueva desde el enlace de recuperación del email.
 *
 * `updateUser({ password })` cambia la contraseña de la sesión abierta sin
 * pedir la actual, así que aquí solo se permite en una sesión de
 * recuperación:
 *  - la del enlace nuevo, `#/update-password?token_hash=…&type=recovery`
 *    (plantilla de email con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`):
 *    `verifyOtp` la crea aquí. Antes se cierra en este dispositivo la sesión
 *    que hubiera abierta: en un ordenador compartido con la cuenta A dentro,
 *    el enlace de B cambia la contraseña de B, nunca la de A.
 *  - la del enlace antiguo: sus tokens (en la URL con `type=recovery`, o los
 *    que main.tsx aparta en sessionStorage antes de que HashRouter pise el
 *    hash) sustituyen a la sesión que hubiera abierta.
 *  - o una para la que auth-js haya emitido PASSWORD_RECOVERY en esta carga
 *    (isPasswordRecoverySession).
 * `type=recovery` en la URL sin token no vale: eso lo escribe cualquiera.
 * Con una sesión normal se manda a Ajustes, donde se pide la contraseña actual.
 * En modo puerta ni siquiera se llega aquí (DoorLockGuard en App.tsx).
 *
 * Un enlace caducado o ya usado lleva a /reset-password con el aviso. Desde la
 * app el enlace abre la web: al terminar se pide volver a la app e iniciar
 * sesión.
 */

type Modo = "comprobando" | "recuperacion" | "ajustes" | "sin-red";

interface TokensDelEnlace {
  accessToken: string;
  refreshToken: string;
}

const CIERRE_PREVIO_MS = 4_000;

/** Trozos de la URL donde puede venir el enlace: `?…`, `#…`, `#/ruta?…`, `#/ruta#…`. */
const trozosDeLaUrl = () => [window.location.search, ...window.location.hash.split(/[?#]/)];

/** `token_hash` del enlace nuevo, solo con `type=recovery`. */
function tokenHashEnLaUrl(): string | null {
  for (const trozo of trozosDeLaUrl()) {
    const params = new URLSearchParams(trozo.replace(/^\?/, ""));
    const tokenHash = params.get("token_hash");
    if (tokenHash && params.get("type") === "recovery") return tokenHash;
  }
  return null;
}

/**
 * Tokens de un enlace de recuperación antiguo en la URL: `?access_token=…`,
 * `#access_token=…`, `#/update-password?access_token=…` o
 * `#/update-password#access_token=…` (GoTrue añade su fragmento al
 * redirectTo, que ya lleva el # de HashRouter). Solo con `type=recovery`.
 */
function tokensEnLaUrl(): TokensDelEnlace | null {
  for (const trozo of trozosDeLaUrl()) {
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

/** Fuera los tokens de la barra de direcciones (y del historial). Se conserva history.state: HashRouter lleva ahí su índice. */
const limpiarUrl = () =>
  window.history.replaceState(window.history.state, "", `${window.location.pathname}#/update-password`);

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
  // El token_hash sirve una sola vez y sale de la URL al leerlo: aquí queda
  // para "Reintentar" si no había red.
  const tokenHashRef = useRef<string | null>(null);
  const vivoRef = useRef(true);

  const enlaceNoValido = useCallback(() => {
    navigate("/reset-password?enlace=caducado", { replace: true });
  }, [navigate]);

  const verificarEnlace = useCallback(
    async (tokenHash: string) => {
      setModo("comprobando");
      // Otra sesión abierta en este dispositivo: se cierra antes, solo aquí.
      if (getSessionSnapshot().userId) {
        await withTimeout(supabase.auth.signOut({ scope: "local" }), CIERRE_PREVIO_MS, "auth.signOut(recuperación)").catch(
          (err) => console.warn("[UpdatePassword] no se pudo cerrar la sesión anterior:", err),
        );
      }
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (!vivoRef.current) return;
      if (error || !data.session) {
        if (error && esErrorDeRed(error)) {
          setModo("sin-red");
          return;
        }
        console.error("verifyOtp(recovery):", error);
        enlaceNoValido();
        return;
      }
      tokenHashRef.current = null;
      setUsuarioRecuperacion(data.session.user.id);
      setModo("recuperacion");
    },
    [enlaceNoValido],
  );

  useEffect(() => {
    vivoRef.current = true;

    const comprobar = async () => {
      const tokenHash = tokenHashEnLaUrl();
      if (tokenHash) {
        limpiarUrl();
        tokenHashRef.current = tokenHash;
        await verificarEnlace(tokenHash);
        return;
      }

      const tokens = tokensApartados() ?? tokensEnLaUrl();
      if (tokens) {
        // La sesión del enlace sustituye a la abierta (si la hay).
        const { data, error } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (!vivoRef.current) return;
        if (error || !data.session) {
          console.error("Error setting session:", error);
          enlaceNoValido();
          return;
        }
        limpiarUrl();
        setUsuarioRecuperacion(data.session.user.id);
        setModo("recuperacion");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!vivoRef.current) return;
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
      if (vivoRef.current) navigate("/reset-password", { replace: true });
    });
    return () => {
      vivoRef.current = false;
    };
  }, [navigate, verificarEnlace, enlaceNoValido]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (password !== confirmPassword) {
      toast({
        title: "Revisa la contraseña",
        description: "Las contraseñas no coinciden.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Revisa la contraseña",
        description: MENSAJE_PASSWORD_CORTA,
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
    } catch (error) {
      toast({
        title: "No hemos podido cambiar la contraseña",
        description: mensajeErrorAuth(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <div className="w-full max-w-md ios-card p-6 space-y-5 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Contraseña cambiada</h1>
          <p className="text-muted-foreground">Ya puedes entrar con tu nueva contraseña.</p>
          {!isNativeApp() && (
            <p className="text-muted-foreground">
              Si usas la app de Pasify, vuelve a la app e inicia sesión con la contraseña nueva.
            </p>
          )}
          <Button className="w-full ios-button h-12" onClick={() => navigate("/", { replace: true })}>
            Ir a Pasify
          </Button>
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

  if (modo === "sin-red") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <WifiOff className="w-12 h-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Sin conexión</h1>
          <p className="text-muted-foreground">
            No hemos podido comprobar el enlace. Revisa tu conexión y vuelve a intentarlo.
          </p>
          <Button
            className="w-full ios-button h-12"
            onClick={() => {
              const tokenHash = tokenHashRef.current;
              if (tokenHash) void verificarEnlace(tokenHash);
              else enlaceNoValido();
            }}
          >
            Reintentar
          </Button>
        </div>
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
                autoComplete="new-password"
                className="ios-input pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
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
                autoComplete="new-password"
                className="ios-input pr-10"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
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
                Guardando…
              </>
            ) : (
              "Guardar contraseña"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default UpdatePassword;
