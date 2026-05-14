import { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff, Mail, Lock, User, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

// Limita le destinazioni post-register a path interni assoluti.
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

const RegisterClient = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    phone: "",
    country: localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY,
    city: "",
  });

  const citiesForCountry = getCitiesForCountry(formData.country);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast({ title: t("common.error"), description: t("errors.passwordMismatch"), variant: "destructive" });
      return;
    }
    if (formData.password.length < 6) {
      toast({ title: t("common.error"), description: t("errors.passwordTooShort"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
      });
      if (authError) throw authError;

      if (authData.user) {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            first_name: formData.firstName,
            last_name: formData.lastName,
            phone: formData.phone || null,
            country: formData.country,
            city: formData.city || null,
          })
          .eq("id", authData.user.id);
        if (profileError) throw profileError;

        // Reclamar rol client vía RPC canónica `claim_initial_role`
        // (mig 20260513120000). La RPC es atómica y bloquea acumulación
        // de roles; reemplaza el INSERT directo en user_roles que
        // dependía de RLS amplia. Errores "already has a role" se tratan
        // como no-fatales (igual que en RegisterPartner.tsx).
        const { error: roleError } = await supabase.rpc("claim_initial_role", {
          _role: "client",
        });
        if (roleError && !String(roleError.message).includes("already has a role")) {
          throw roleError;
        }

        let autoApproved = false;
        try {
          const { data, error: approveErr } = await supabase.rpc("auto_approve_if_allowed", { _role: "client" });
          if (approveErr) console.error("auto_approve_if_allowed error:", approveErr);
          autoApproved = data === true;
        } catch (e) {
          console.error("auto_approve_if_allowed exception:", e);
        }

        try {
          await supabase.functions.invoke("notify-new-registration", {
            body: {
              userEmail: formData.email,
              userType: "client",
              firstName: formData.firstName,
              lastName: formData.lastName,
            },
          });
        } catch (notifyError) {
          console.error("Errore invio notifica admin:", notifyError);
        }

        if (autoApproved) {
          toast({ title: t("auth.loginSuccess"), description: t("auth.welcome") });
          const targetPath = nextPath ?? "/client-dashboard";
          window.location.assign(`${window.location.origin}/#${targetPath}`);
          return;
        }

        await supabase.auth.signOut();
        toast({ title: t("auth.pendingApproval"), description: t("auth.pendingApprovalMessage"), duration: 10000 });
        if (nextPath) {
          navigate(`/login?next=${encodeURIComponent(nextPath)}`);
        } else {
          navigate("/login");
        }
      }
    } catch (error: any) {
      toast({ title: t("errors.signupFailed"), description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      headline={
        <>
          Vive la <span style={serif} className="text-orange-200">noche</span> con Pasify.
        </>
      }
      subline="Compra tickets para los mejores eventos, guarda tus QR en el monedero y entra al instante."
      imageUrl="/partner-hero.jpg"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">Crear cuenta</h2>
        <p className="mb-6 text-sm text-slate-500">
          Rellena tus datos o regístrate con Google en un clic.
        </p>

        <GoogleAuthButton label="Registrarme con Google" />

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          <span>o con email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Email */}
          <FieldRow>
            <Label htmlFor="email" className="text-xs font-medium text-slate-700">
              {t("auth.email")} *
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                required
                placeholder="tu@email.com"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* Nome + Cognome */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">{t("auth.firstName")} *</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  required
                  className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
            </FieldRow>
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">{t("auth.lastName")} *</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  required
                  className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </FieldRow>
          </div>

          {/* Telefono */}
          <FieldRow>
            <Label className="text-xs font-medium text-slate-700">{t("auth.phone")}</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="tel"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* País + Ciudad */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">{t("countries.selectCountry")} *</Label>
              <Select
                value={formData.country}
                onValueChange={(value) => setFormData({ ...formData, country: value, city: "" })}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.flag} {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">{t("profileEdit.city")} *</Label>
              <Select value={formData.city} onValueChange={(value) => setFormData({ ...formData, city: value })}>
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                  <SelectValue placeholder={t("citySelector.selectCity")} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {citiesForCountry.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>

          {/* Password */}
          <FieldRow>
            <Label htmlFor="password" className="text-xs font-medium text-slate-700">{t("auth.password")} *</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10"
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
          </FieldRow>

          {/* Confirm Password */}
          <FieldRow>
            <Label htmlFor="confirmPassword" className="text-xs font-medium text-slate-700">{t("auth.confirmPassword")} *</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </FieldRow>

          <motion.div whileTap={{ scale: 0.98 }} className="pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-2xl text-sm font-semibold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "0 12px 30px -10px rgba(232,84,42,0.5)",
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("auth.registering")}
                </>
              ) : (
                t("auth.signup")
              )}
            </Button>
          </motion.div>

          <div className="pt-2 text-center text-xs text-slate-500">
            <Link to="/register-partner" className="font-semibold text-orange-600 hover:text-orange-700">
              ¿Eres un local? Regístrate aquí
            </Link>
            <span className="mx-2 text-slate-300">·</span>
            <Link to="/login" className="font-semibold text-orange-600 hover:text-orange-700">
              {t("auth.hasAccount")} {t("auth.login")}
            </Link>
          </div>
        </form>
      </motion.div>
    </AuthShell>
  );
};

const FieldRow = ({ children }: { children: React.ReactNode }) => (
  <div className="space-y-1.5">{children}</div>
);

export default RegisterClient;
