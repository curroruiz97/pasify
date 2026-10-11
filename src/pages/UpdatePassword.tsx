import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { borrarSesionDelDispositivo, isPasswordRecoverySession, olvidarRecuperacion } from "@/hooks/useAuth";
import { getSessionSnapshot, useCurrentUser } from "@/lib/cache/session";
import { withTimeout } from "@/lib/withTimeout";
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
import { Loader2, Eye, EyeOff, KeyRound, WifiOff } from "lucide-react";

/**
 * Contraseña nueva desde el enlace de recuperación del email.
 *
 * `updateUser({ password })` cambia la contraseña de la sesión abierta sin
 * pedir la actual, así que aquí solo se permite en una sesión de
 * recuperación:
 *  - la del enlace nuevo, `#/update-password?token_hash=…&type=recovery`
 *    (plantilla de email con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`):
 *    `verifyOtp` la crea aquí.
 *  - la del enlace antiguo: sus tokens (en la URL con `type=recovery`, o los
 *    que main.tsx aparta en sessionStorage antes de que HashRouter pise el
 *    hash) pasan por `setSession`.
 *  - o una para la que auth-js haya emitido PASSWORD_RECOVERY en esta carga
 *    (isPasswordRecoverySession).
 * `type=recovery` en la URL sin token no vale: eso lo escribe cualquiera.
 * Con una sesión normal se manda a Ajustes, donde se pide la contraseña actual.
 * En modo puerta ni siquiera se llega aquí (DoorLockGuard en App.tsx).
 *
 * El enlace NO abre ninguna sesión al cargar la página. Quien reenvíe a una
 * víctima la URL de su propio enlace la dejaría dentro de la cuenta del
 * atacante (login CSRF), así que primero sale una tarjeta «Enlace de
 * recuperación» y la sesión solo se establece al pulsar «Continuar»:
 *  - Con los tokens antiguos se enseña el email del payload del JWT. Es solo
 *    para mostrar (sin red ni comprobar la firma: un enlace manipulado puede
 *    decir lo que quiera); nada se decide con él.
 *  - Si hay otra sesión abierta se avisa de que se cerrará, y se cierra (solo
 *    en este dispositivo) justo antes de abrir la del enlace: en un ordenador
 *    compartido con la cuenta A dentro, el enlace de B cambia la contraseña de
 *    B, nunca la de A.
 *  - Con la sesión ya establecida, el formulario dice de qué cuenta es (el
 *    email que devuelve el servidor) y deja salir con «No soy yo».
 *
 * Al cambiar la contraseña se cierran las demás sesiones de la cuenta (otros
 * dispositivos), después la de este dispositivo, y se va a /login con el aviso.
 * Si el usuario sale sin terminar, se cierra en este dispositivo la sesión que
 * abrió el enlace. Aquí NO se usa signOutLocal (useAuth): marca el cierre como
 * voluntario y borra los borradores del usuario.
 *
 * Un enlace caducado o ya usado lleva a /reset-password con el aviso. Desde la
 * app el enlace abre la web: al terminar se pide volver a la app e iniciar
 * sesión (aviso de /login).
 */

type Modo = "comprobando" | "confirmar" | "recuperacion" | "ajustes" | "sin-red";

interface TokensDelEnlace {
  accessToken: string;
  refreshToken: string;
}

/** Lo que trae el enlace del email: el enlace nuevo (`token_hash`) o el antiguo (tokens). */
type Enlace = { tipo: "token_hash"; tokenHash: string } | ({ tipo: "tokens" } & TokensDelEnlace);

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

/** Fuera los tokens que main.tsx apartó en sessionStorage (los lea alguien o no). */
function descartarTokensApartados(): void {
  try {
    sessionStorage.removeItem("recovery_access_token");
    sessionStorage.removeItem("recovery_refresh_token");
  } catch {
    /* sin sessionStorage: no hay nada apartado */
  }
}

/**
 * Los que main.tsx apartó al abrir el enlace del email en esta pestaña (solo
 * de recuperación: prueban que es el dueño del correo). Se consumen.
 */
function tokensApartados(): TokensDelEnlace | null {
  try {
    const accessToken = sessionStorage.getItem("recovery_access_token");
    const refreshToken = sessionStorage.getItem("recovery_refresh_token") ?? "";
    descartarTokensApartados();
    return accessToken ? { accessToken, refreshToken } : null;
  } catch {
    return null;
  }
}

/** Fuera los tokens de la barra de direcciones (y del historial). Se conserva history.state: HashRouter lleva ahí su índice. */
const limpiarUrl = () =>
  window.history.replaceState(window.history.state, "", `${window.location.pathname}#/update-password`);

/**
 * Lee el enlace de la URL y de sessionStorage, y lo saca de ambos sitios: de
 * aquí en adelante solo vive en memoria hasta que el usuario pulsa «Continuar».
 * Solo se llama una vez por visita (lo que lee, lo borra).
 */
function leerEnlace(): Enlace | null {
  const tokenHash = tokenHashEnLaUrl();
  // También con token_hash se vacía lo apartado: no puede quedarse esperando a otro enlace.
  const tokens = tokensApartados() ?? tokensEnLaUrl();
  if (tokenHash || tokens) limpiarUrl();
  if (tokenHash) return { tipo: "token_hash", tokenHash };
  if (tokens) return { tipo: "tokens", ...tokens };
  return null;
}

/**
 * Email del payload de un JWT (base64url, UTF-8). SOLO para enseñarlo antes de
 * pulsar «Continuar»: sin red y sin comprobar la firma, así que nunca se
 * decide nada con él. null si no se puede leer o no parece un email.
 */
function emailDelToken(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const binario = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    const texto = new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
    const email = (JSON.parse(texto) as { email?: unknown } | null)?.email;
    if (typeof email !== "string" || email.length === 0 || email.length > 254) return null;
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || [...email].some(esCaracterQueDisfraza)) return null;
    return email;
  } catch {
    return null;
  }
}

/** Caracteres de control o de dirección de texto: con ellos se puede disfrazar lo que se enseña. */
function esCaracterQueDisfraza(c: string): boolean {
  const n = c.charCodeAt(0);
  return (
    n < 32 ||
    (n >= 127 && n <= 159) ||
    n === 0x200e ||
    n === 0x200f ||
    (n >= 0x202a && n <= 0x202e) ||
    (n >= 0x2066 && n <= 0x2069)
  );
}

/** signOut local con límite de tiempo. true si se cerró. Nunca lanza. */
async function cerrarLocal(label: string): Promise<boolean> {
  try {
    const { error } = await withTimeout(supabase.auth.signOut({ scope: "local" }), CIERRE_PREVIO_MS, label);
    if (error) console.warn(`[UpdatePassword] ${label}:`, error);
    return !error;
  } catch (err) {
    console.warn(`[UpdatePassword] ${label}:`, err);
    return false;
  }
}

/**
 * Cierra la sesión de este dispositivo (la del enlace de recuperación). Si no
 * se puede avisar al servidor (sin red) auth-js la deja abierta: se borra la
 * guardada y se repite, y sin sesión guardada solo anuncia SIGNED_OUT. Nunca lanza.
 */
async function cerrarSesionDeEsteDispositivo(): Promise<void> {
  if (await cerrarLocal("auth.signOut(recuperación)")) return;
  await borrarSesionDelDispositivo();
  await cerrarLocal("auth.signOut(recuperación, sin sesión guardada)");
}

const Pantalla = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center p-4">
    {children}
  </div>
);

const UpdatePassword = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  // Sesión que ya hay abierta en este dispositivo, para avisar de que se cerrará.
  const usuarioActual = useCurrentUser();
  const [modo, setModo] = useState<Modo>("comprobando");
  // Email que enseña la tarjeta (payload del JWT del enlace antiguo): solo para mostrar.
  const [emailEnlace, setEmailEnlace] = useState<string | null>(null);
  // Cuenta de la sesión de recuperación ya establecida: lo que dice el servidor.
  const [emailRecuperacion, setEmailRecuperacion] = useState<string | null>(null);
  // Usuario de la sesión de recuperación: al guardar se comprueba que sigue siendo el mismo.
  const [usuarioRecuperacion, setUsuarioRecuperacion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // El enlace sale de la URL al leerlo y vive aquí hasta «Continuar» (y, si no
  // había red, para «Reintentar»). undefined = aún sin leer.
  const enlaceRef = useRef<Enlace | null | undefined>(undefined);
  const comprobadoRef = useRef(false);
  const vivoRef = useRef(true);
  const continuandoRef = useRef(false);
  // Usuario de la sesión que abrió el enlace (la que se cierra si se abandona).
  const sesionRecuperacionRef = useRef<string | null>(null);
  // Contraseña cambiada: salir de la pantalla ya no es abandonar.
  const terminadoRef = useRef(false);

  const enlaceNoValido = useCallback(() => {
    navigate("/reset-password?enlace=caducado", { replace: true });
  }, [navigate]);

  /**
   * Abandonar sin terminar («No soy yo», atrás, otro enlace…): fuera la
   * sesión que abrió el enlace de este dispositivo y fuera lo que quedara de
   * la recuperación. Solo se cierra si la sesión guardada sigue siendo la del
   * enlace (otra pestaña pudo cambiarla y esa no es de aquí); si no se puede
   * comprobar, se cierra: es la que acaba de abrir el enlace.
   */
  const cerrarSesionDeRecuperacion = useCallback(async () => {
    const id = sesionRecuperacionRef.current;
    sesionRecuperacionRef.current = null;
    olvidarRecuperacion();
    descartarTokensApartados();
    if (!id) return;
    let esLaDelEnlace = true;
    try {
      const {
        data: { session },
      } = await withTimeout(supabase.auth.getSession(), CIERRE_PREVIO_MS, "auth.getSession(recuperación)");
      esLaDelEnlace = session?.user.id === id;
    } catch (err) {
      console.warn("[UpdatePassword] no se pudo comprobar la sesión de recuperación:", err);
    }
    if (esLaDelEnlace) await cerrarSesionDeEsteDispositivo();
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
      if (!terminadoRef.current) void cerrarSesionDeRecuperacion();
    };
  }, [cerrarSesionDeRecuperacion]);

  /**
   * «Continuar»: aquí, y no antes, se abre la sesión del enlace. Primero se
   * cierra, solo en este dispositivo, la que hubiera abierta.
   */
  const continuar = useCallback(async () => {
    const enlace = enlaceRef.current;
    if (!enlace || continuandoRef.current) return;
    continuandoRef.current = true;
    setModo("comprobando");
    try {
      if (getSessionSnapshot().userId) {
        await withTimeout(supabase.auth.signOut({ scope: "local" }), CIERRE_PREVIO_MS, "auth.signOut(recuperación)").catch(
          (err) => console.warn("[UpdatePassword] no se pudo cerrar la sesión anterior:", err),
        );
      }

      const { data, error } =
        enlace.tipo === "token_hash"
          ? await supabase.auth.verifyOtp({ token_hash: enlace.tokenHash, type: "recovery" })
          : await supabase.auth.setSession({ access_token: enlace.accessToken, refresh_token: enlace.refreshToken });

      if (!vivoRef.current) {
        // Salió de la pantalla mientras se comprobaba: la sesión recién abierta no se queda.
        if (data.session) void cerrarSesionDeEsteDispositivo();
        return;
      }
      if (error || !data.session) {
        if (error && esErrorDeRed(error)) {
          setModo("sin-red");
          return;
        }
        console.error("enlace de recuperación:", error);
        enlaceNoValido();
        return;
      }

      enlaceRef.current = null;
      sesionRecuperacionRef.current = data.session.user.id;
      setUsuarioRecuperacion(data.session.user.id);
      setEmailRecuperacion(data.session.user.email ?? null);
      setModo("recuperacion");
    } catch (err) {
      console.error("[UpdatePassword] enlace de recuperación fallido:", err);
      if (!vivoRef.current) return;
      if (esErrorDeRed(err)) setModo("sin-red");
      else enlaceNoValido();
    } finally {
      continuandoRef.current = false;
    }
  }, [enlaceNoValido]);

  useEffect(() => {
    // Una sola vez por visita: el enlace se lee y se borra de la URL.
    if (comprobadoRef.current) return;
    comprobadoRef.current = true;

    const comprobar = async () => {
      enlaceRef.current = leerEnlace();
      const enlace = enlaceRef.current;
      if (enlace) {
        // Sin red y sin tocar la sesión: hasta «Continuar» no pasa nada.
        if (enlace.tipo === "tokens") setEmailEnlace(emailDelToken(enlace.accessToken));
        setModo("confirmar");
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
        sesionRecuperacionRef.current = session.user.id;
        setUsuarioRecuperacion(session.user.id);
        setEmailRecuperacion(session.user.email ?? null);
        setModo("recuperacion");
      } else {
        setModo("ajustes");
      }
    };

    comprobar().catch((err) => {
      console.error("[UpdatePassword] comprobación de sesión fallida:", err);
      if (vivoRef.current) navigate("/reset-password", { replace: true });
    });
  }, [navigate]);

  const cancelar = () => {
    enlaceRef.current = null;
    navigate("/", { replace: true });
  };

  const noSoyYo = async () => {
    if (loading) return;
    setModo("comprobando");
    await cerrarSesionDeRecuperacion();
    navigate("/login", { replace: true });
  };

  /**
   * Contraseña cambiada: se cierran las demás sesiones de la cuenta (otros
   * dispositivos), después la de este y se entra de nuevo con la nueva. Un
   * fallo al cerrar no deshace nada: la contraseña ya está cambiada.
   */
  const terminar = async () => {
    terminadoRef.current = true;
    sesionRecuperacionRef.current = null;
    olvidarRecuperacion();
    descartarTokensApartados();
    try {
      try {
        const { error } = await withTimeout(
          supabase.auth.signOut({ scope: "others" }),
          CIERRE_PREVIO_MS,
          "auth.signOut(otras sesiones)",
        );
        if (error) console.warn("[UpdatePassword] no se pudieron cerrar las demás sesiones:", error);
      } catch (err) {
        console.warn("[UpdatePassword] no se pudieron cerrar las demás sesiones:", err);
      }
      await cerrarSesionDeEsteDispositivo();
    } finally {
      navigate("/login?aviso=contrasena", { replace: true });
    }
  };

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

    let cambiada = false;
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
      cambiada = true;
    } catch (error) {
      toast({
        title: "No hemos podido cambiar la contraseña",
        description: mensajeErrorAuth(error),
        variant: "destructive",
      });
    } finally {
      // Cambiada: el botón sigue ocupado mientras se cierran las sesiones.
      if (!cambiada) setLoading(false);
    }

    // A partir de aquí nada puede salir como «no hemos podido cambiarla».
    if (cambiada) await terminar();
  };

  if (modo === "comprobando") {
    return (
      <Pantalla>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </Pantalla>
    );
  }

  if (modo === "confirmar") {
    return (
      <Pantalla>
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <KeyRound className="w-12 h-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Enlace de recuperación</h1>
          <div className="space-y-3 text-muted-foreground">
            {emailEnlace ? (
              <p>
                Vas a cambiar la contraseña de{" "}
                <strong className="break-words font-semibold text-foreground">{emailEnlace}</strong>.
              </p>
            ) : (
              <p>Vas a poner una contraseña nueva en la cuenta a la que enviamos este enlace.</p>
            )}
            {usuarioActual && (
              <p role="status">
                {usuarioActual.email ? (
                  <>
                    Se cerrará la sesión de{" "}
                    <strong className="break-words font-semibold text-foreground">{usuarioActual.email}</strong> en este
                    dispositivo.
                  </>
                ) : (
                  "Se cerrará la sesión que tienes abierta en este dispositivo."
                )}
              </p>
            )}
            <p className="text-sm">Continúa solo si has pedido tú este cambio.</p>
          </div>
          <div className="space-y-2">
            <Button className="w-full ios-button h-12" onClick={() => void continuar()}>
              Continuar
            </Button>
            <button
              type="button"
              onClick={cancelar}
              className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Pantalla>
    );
  }

  if (modo === "sin-red") {
    return (
      <Pantalla>
        <div className="w-full max-w-md ios-card p-6 space-y-6 text-center">
          <WifiOff className="w-12 h-12 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Sin conexión</h1>
          <p className="text-muted-foreground">
            No hemos podido comprobar el enlace. Revisa tu conexión y vuelve a intentarlo.
          </p>
          <Button
            className="w-full ios-button h-12"
            onClick={() => {
              if (enlaceRef.current) void continuar();
              else enlaceNoValido();
            }}
          >
            Reintentar
          </Button>
        </div>
      </Pantalla>
    );
  }

  if (modo === "ajustes") {
    return (
      <Pantalla>
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
      </Pantalla>
    );
  }

  // El enlace decía una cuenta y el servidor ha abierto otra: solo se avisa.
  const otraCuenta =
    !!emailEnlace && !!emailRecuperacion && emailEnlace.toLowerCase() !== emailRecuperacion.toLowerCase();

  return (
    <Pantalla>
      <div className="w-full max-w-md ios-card p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary">Pasify</h1>
          <p className="text-muted-foreground mt-2">Establece tu nueva contraseña</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {emailRecuperacion ? (
              <>
                Cambiarás la contraseña de{" "}
                <strong className="break-words font-semibold text-foreground">{emailRecuperacion}</strong>.
              </>
            ) : (
              "Cambiarás la contraseña de esta cuenta."
            )}{" "}
            <button
              type="button"
              onClick={() => void noSoyYo()}
              className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              No soy yo
            </button>
          </p>
          {otraCuenta && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              El enlace decía que era para <span className="break-words font-semibold">{emailEnlace}</span>, no para esta
              cuenta. Si no la reconoces, pulsa «No soy yo».
            </p>
          )}
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
    </Pantalla>
  );
};

export default UpdatePassword;
