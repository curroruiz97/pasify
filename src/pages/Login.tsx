import { useState } from "react";
import { useNavigate, Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Mail, Lock, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import AppleAuthButton from "@/components/auth/AppleAuthButton";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

// Limita le destinazioni post-login a path interni assoluti.
const sanitizeNextPath = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith("/")) return null;
    if (decoded.startsWith("//")) return null;
    return decoded;
  } catch {
    return null;
  }
};

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Check if we're adding a new account (don't sign out existing session)
  const isAddingAccount = location.state?.addingAccount === true;
  const prefilledEmail = location.state?.email || "";

  const [formData, setFormData] = useState({
    email: prefilledEmail,
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // NON fare mai signOut - signInWithPassword gestisce automaticamente il cambio sessione
      // signOut invalida TUTTI i refresh token, rompendo il multi-account

      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) throw error;

      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("business_category, business_name")
          .eq("id", data.user.id)
          .maybeSingle();

        // Get user role to redirect appropriately
        const { data: role, error: roleError } = await supabase
          .rpc('get_user_role', { _user_id: data.user.id });

        console.log("Role check via RPC:", { role }, "Error:", roleError);

        let effectiveRole = role as string | null;

        // Auto-promote a partner SOLO se il profilo ha già dati business
        // (niente default "client" — quello era un bug che marchiava partner
        // come student quando profile update era ancora in volo).
        if (!roleError && !role && (profile?.business_category || profile?.business_name)) {
          const { error: insertRoleError } = await supabase
            .from("user_roles")
            .insert({ user_id: data.user.id, role: "partner" });
          if (!insertRoleError) effectiveRole = "partner";
        }

        toast({
          title: t("auth.loginSuccess"),
          description: t("auth.welcome"),
        });

        // Routing per ruolo. Se non esiste alcun ruolo (es. utente creato
        // da dashboard) → default 'client' e poi alla dashboard cliente.
        if (effectiveRole === "admin") {
          navigate("/admin");
        } else if (effectiveRole === "partner") {
          navigate("/partner-dashboard");
        } else if (effectiveRole === "client") {
          navigate(nextPath ?? "/client-dashboard");
        } else {
          await supabase
            .from("user_roles")
            .insert({ user_id: data.user.id, role: "client" });
          navigate(nextPath ?? "/client-dashboard");
        }
      }
    } catch (error: any) {
      toast({
        title: t("errors.loginFailed"),
        description: error.message,
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
      {isAddingAccount && (
        <button
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300"
        >
          <ArrowLeft className="h-3 w-3" />
          Volver
        </button>
      )}

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
        <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">
          {isAddingAccount ? t("accountSwitcher.addAccount") : t("auth.loginTitle")}
        </h2>
        <p className="mb-8 text-sm text-slate-500">
          Introduce tus credenciales o inicia sesión con tu cuenta de Google.
        </p>

        {/* Google OAuth */}
        <GoogleAuthButton label="Continuar con Google" />
        <div className="h-3" />
        <AppleAuthButton label="Continuar con Apple" />

        {/* Divider */}
        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          <span>o con email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-slate-700">
              {t("auth.email")}
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                required
                placeholder="tu@email.com"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 focus-visible:ring-orange-500"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-medium text-slate-700">
              {t("auth.password")}
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10 focus-visible:ring-orange-500"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
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
              {t("auth.forgotPassword")}
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
                  {t("auth.loggingIn")}
                </>
              ) : (
                t("auth.login")
              )}
            </Button>
          </motion.div>

          <div className="space-y-1.5 pt-3 text-center text-xs text-slate-500">
            <div>
              ¿No tienes cuenta?{" "}
              <Link to="/register-client" className="font-semibold text-orange-600 hover:text-orange-700">
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
