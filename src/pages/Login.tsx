import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Mail, Lock, CircleAlert, MailWarning } from "lucide-react";
import { motion } from "framer-motion";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import AppleAuthButton from "@/components/auth/AppleAuthButton";
import { esCuentaDesactivada, esLimiteDePeticiones, mensajeErrorAuth, SUPPORT_EMAIL } from "@/components/auth/authErrors";
import { ESPERA_REENVIO_S, reenviarEmailDeConfirmacion, useCuentaAtras } from "@/components/auth/confirmacionEmail";
import { resolveInitialDashboard, signOutLocal } from "@/hooks/useAuth";
import { sanitizeNextPath, withNext } from "@/lib/redirect-url";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

/** Avisos con los que se llega al login desde fuera (main.tsx). */
const AVISOS: Record<string, string> = {
  google: "No hemos podido entrar con Google. Vuelve a intentarlo o entra con tu email.",
};

class CuentaDesactivadaError extends Error {}

/** Entrar con un email que aún no se ha confirmado («Confirm email» activado). */
const esEmailSinConfirmar = (err: unknown): boolean => {
  const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; message?: unknown };
  return e.code === "email_not_confirmed" || (typeof e.message === "string" && /email not confirmed/i.test(e.message));
};

/**
 * Cuenta creada sin confirmar el email: se dice y se deja pedir otro enlace
 * (el del alta caduca o se pierde en el spam).
 */
const AvisoEmailSinConfirmar = ({ email }: { email: string }) => {
  const [espera, empezarEspera] = useCuentaAtras(0);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const reenviar = async () => {
    if (enviando || espera > 0) return;
    setEnviando(true);
    setAviso(null);
    try {
      const { error } = await reenviarEmailDeConfirmacion(email);
      if (error) throw error;
      setAviso(`Te hemos enviado otro enlace a ${email}. Ábrelo y vuelve a entrar.`);
      empezarEspera(ESPERA_REENVIO_S);
    } catch (err) {
      console.error("resend(signup):", err);
      setAviso(mensajeErrorAuth(err));
      if (esLimiteDePeticiones(err)) empezarEspera(ESPERA_REENVIO_S);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      role="alert"
      className="mb-5 space-y-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-800"
    >
      <div className="flex items-start gap-2">
        <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Todavía no has confirmado tu email. Abre el enlace que te enviamos al registrarte (mira también en spam).
        </span>
      </div>
      {aviso && <p className="pl-6">{aviso}</p>}
      <button
        type="button"
        onClick={() => void reenviar()}
        disabled={enviando || espera > 0}
        className="ml-6 font-semibold text-orange-700 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
      >
        {enviando ? "Enviando…" : espera > 0 ? `Reenviar el enlace en ${espera} s` : "Reenviar el enlace"}
      </button>
    </div>
  );
};

/**
 * Adónde ir tras entrar con email. Las cuentas antiguas sin rol lo reclaman
 * aquí (local si el perfil tiene datos de negocio; si no, cliente). Una
 * cuenta desactivada (p. ej. un local al que el admin ha retirado el acceso)
 * no puede reclamar nada: se cierra la sesión y se dice por qué, en vez de
 * tragarse el error y acabar en una pantalla negra.
 */
async function destinoTrasEntrar(userId: string): Promise<string> {
  const { data: rolesData, error: rolesError } = await supabase.rpc("get_user_roles", { _user_id: userId });
  // Sin poder leer los roles (red): que decida RootRoute, que sabe reintentar.
  if (rolesError) return "/";
  const roles = ((rolesData as string[] | null) ?? []).filter((r) => typeof r === "string");
  if (roles.length > 0) return resolveInitialDashboard(roles);

  const { data: perfil } = await supabase
    .from("profiles")
    .select("business_category, business_name")
    .eq("id", userId)
    .maybeSingle();
  const rol = perfil?.business_category || perfil?.business_name ? "partner" : "client";
  const { error: claimError } = await supabase.rpc("claim_initial_role", { _role: rol });
  if (claimError) {
    if (esCuentaDesactivada(claimError)) throw new CuentaDesactivadaError();
    console.error("claim_initial_role:", claimError);
    return "/";
  }
  return rol === "partner" ? "/partner-dashboard" : "/client-dashboard";
}

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const aviso = AVISOS[searchParams.get("aviso") ?? ""] ?? null;
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Email de una cuenta que aún no ha confirmado su correo.
  const [sinConfirmar, setSinConfirmar] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setSinConfirmar(null);

    try {
      // NON fare mai signOut - signInWithPassword gestisce automaticamente il cambio sessione
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      });
      if (error) throw error;
      if (!data.user) return;

      const destino = await destinoTrasEntrar(data.user.id);
      toast({ title: "Has iniciado sesión", description: "Bienvenido a Pasify." });
      // `next` manda (vuelta al evento tras "Comprar"); si no, el panel del rol.
      navigate(nextPath ?? destino, { replace: true });
    } catch (error) {
      if (error instanceof CuentaDesactivadaError) {
        await signOutLocal();
        toast({
          title: "Esta cuenta está desactivada",
          description: `No puede entrar en Pasify. Si crees que es un error, escríbenos a ${SUPPORT_EMAIL}.`,
          variant: "destructive",
        });
        return;
      }
      if (esEmailSinConfirmar(error)) {
        setSinConfirmar(formData.email.trim());
        return;
      }
      toast({
        title: "No has podido entrar",
        description: mensajeErrorAuth(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headline={
        <>
          Bienvenido <span style={serif} className="text-orange-200">de vuelta</span>.
        </>
      }
      subline="Tickets, eventos y locales en un solo lugar. Accede con tu cuenta para seguir viviendo la noche con Pasify."
      imageUrl="/partner-hero.jpg"
    >
      {/* Guideline 5.1.1(v) — Apple exige que las funciones que NO requieren
          cuenta (explorar eventos, ver info de locales) sean accesibles sin
          registrarse/iniciar sesión. En nativo, `/` redirige siempre a
          `/login` (ver RootRoute en App.tsx), así que este es el único punto
          de entrada de la app sin sesión: debe ofrecer una salida clara hacia
          contenido público. `/calendar` y `/p/:id` ya funcionan sin sesión
          (solo esconden acciones "account-based" como Participar/favoritos),
          simplemente no había ningún enlace visible hacia ellos. */}
      <button
        type="button"
        onClick={() => navigate("/calendar")}
        className="mb-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white/60 px-3 py-2.5 text-xs font-medium text-slate-600 transition hover:border-orange-300 hover:text-orange-700"
      >
        Explorar eventos sin cuenta
      </button>

      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">Inicia sesión</h2>
        <p className="mb-8 text-sm text-slate-500">Accede a tus entradas y a tu panel.</p>

        {aviso && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-800"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{aviso}</span>
          </div>
        )}

        {sinConfirmar && <AvisoEmailSinConfirmar key={sinConfirmar} email={sinConfirmar} />}

        {/* Google (web y Android) y Apple (solo iOS): cada botón decide si se pinta. */}
        <GoogleAuthButton label="Continuar con Google" next={nextPath} />
        <div className="h-3" />
        <AppleAuthButton label="Continuar con Apple" next={nextPath} />

        {/* Divider */}
        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          <span>o con email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-medium text-slate-700">
              Contraseña
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10 focus-visible:ring-orange-500"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <Link
              to="/reset-password"
              className="text-xs font-medium text-orange-600 transition hover:text-orange-700"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          <motion.div whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              className="h-12 w-full rounded-2xl text-sm font-semibold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "0 12px 30px -10px rgba(232,84,42,0.5)",
              }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                "Iniciar sesión"
              )}
            </Button>
          </motion.div>

          <div className="space-y-1.5 pt-3 text-center text-xs text-slate-500">
            <div>
              ¿No tienes cuenta?{" "}
              {/* Con `next`: tras crear la cuenta se vuelve al evento. */}
              <Link
                to={withNext("/register-client", nextPath)}
                className="font-semibold text-orange-600 hover:text-orange-700"
              >
                Regístrate como cliente
              </Link>
            </div>
            <div>
              ¿Eres un local?{" "}
              <Link to="/register-partner" className="font-semibold text-orange-600 hover:text-orange-700">
                Regístrate aquí
              </Link>
            </div>
          </div>
        </form>
      </motion.div>
    </AuthShell>
  );
};

export default Login;
