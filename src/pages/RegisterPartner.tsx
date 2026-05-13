import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Mail, Lock, Building2, Phone, Tag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

interface Category {
  id: string;
  name: string;
  display_name: string;
}

// Categorie locali Pasify (hardcoded). Quando avremo i settings da admin
// potremo gestirle in DB; per ora bastano queste.
const PASIFY_CATEGORIES: Category[] = [
  { id: "discoteca", name: "discoteca", display_name: "Discoteca" },
  { id: "bar", name: "bar", display_name: "Bar / Pub" },
  { id: "club", name: "club", display_name: "Club" },
  { id: "sala", name: "sala", display_name: "Sala de conciertos" },
  { id: "festival", name: "festival", display_name: "Festival / Promotora" },
  { id: "rooftop", name: "rooftop", display_name: "Rooftop / Terraza" },
  { id: "beachclub", name: "beachclub", display_name: "Beach Club" },
  { id: "otro", name: "otro", display_name: "Otro" },
];

const RegisterPartner = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectAfter = (location.state as any)?.redirectAfter as string | undefined;
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [categories] = useState<Category[]>(PASIFY_CATEGORIES);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    businessName: "",
    businessAddress: "",
    businessCountry: localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY,
    businessCity: "",
    businessPhone: "",
    businessCategory: "",
  });

  const citiesForCountry = getCitiesForCountry(formData.businessCountry);

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
      if (authError) {
        if (authError.message.includes("already registered") || authError.status === 422) {
          throw new Error("Este email ya está registrado. Ve al login o usa otro email.");
        }
        throw authError;
      }

      // Garantisce una session valida: se signUp non l'ha già aperta (email
      // confirmation off), facciamo un signInWithPassword esplicito. Senza
      // session le INSERT successive (user_roles) verrebbero rifiutate da RLS
      // e l'utente finirebbe come "client" (fallback ProtectedRoute).
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });
        if (signInErr) throw signInErr;
      }

      if (authData.user) {
        // 1) Profile básico (datos de contacto / persona).
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            business_name: formData.businessName,
            business_address: formData.businessAddress,
            business_country: formData.businessCountry,
            business_city: formData.businessCity,
            business_phone: formData.businessPhone,
            business_category: formData.businessCategory,
            // Auto-approvazione: por ahora el locale entra inmediatamente;
            // admin puede "Rechazar" después si hace falta.
            account_status: "approved",
          })
          .eq("id", authData.user.id);
        if (profileError) throw profileError;

        // 2) Reclamar rol partner vía RPC canónica (claim_initial_role).
        //    Esta RPC (mig 20260513120000) es atómica y bloquea acumulación
        //    de roles. Si falla por "role ya asignado" (23505) lo tratamos
        //    como no-fatal (el usuario ya era partner).
        const { error: roleError } = await supabase.rpc("claim_initial_role", {
          _role: "partner",
        });
        if (roleError && !String(roleError.message).includes("already has a role")) {
          throw roleError;
        }

        // 3) Crear organization + brand + venue default (RPC en mig 0011).
        const { data: orgIdRaw, error: orgErr } = await supabase.rpc(
          "create_organization",
          {
            _name: formData.businessName,
            _country: formData.businessCountry,
            _slug: null,
          },
        );
        if (orgErr) throw orgErr;
        const orgId = orgIdRaw as string;

        // 4) Enriquecer organization con datos extra del form.
        await supabase
          .from("organizations")
          .update({
            billing_email: formData.email,
            contact_email: formData.email,
            contact_phone: formData.businessPhone,
            city: formData.businessCity,
            address: formData.businessAddress,
          })
          .eq("id", orgId);

        // 5) Actualizar brand+venue default con la categoría/ciudad/contacto.
        //    create_organization deja un brand y un venue 'principal' creados.
        const { data: brandRow } = await supabase
          .from("brands")
          .select("id")
          .eq("org_id", orgId)
          .limit(1)
          .maybeSingle();
        if (brandRow?.id) {
          await supabase
            .from("venues")
            .update({
              business_category: formData.businessCategory,
              city: formData.businessCity,
              address: formData.businessAddress,
              phone: formData.businessPhone,
              email: formData.email,
            })
            .eq("brand_id", brandRow.id);
        }

        // 6) Iniciar trial (RPC v2 en mig 20260513130000 — devuelve TABLE).
        //    No-fatal si falla (p.ej. trial deshabilitado en app_settings):
        //    el partner puede empezar trial manualmente desde PartnerChoosePlan.
        const { error: trialErr } = await supabase.rpc("start_partner_trial", {
          _org_id: orgId,
        });
        if (trialErr) {
          console.warn("[RegisterPartner] start_partner_trial falló:", trialErr.message);
        }

        toast({ title: "¡Cuenta creada!", description: "Bienvenido a Pasify." });
        window.location.assign(`${window.location.origin}/#/partner-dashboard`);
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
          Llena tu local <span style={serif} className="text-orange-200">cada noche</span>.
        </>
      }
      subline="Únete a Pasify y empieza a vender tickets para tus eventos. Sin papel, sin colas, sin fricción — cobras directo a tu cuenta Stripe."
      imageUrl="/partner-hero.jpg"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">Soy un local · Regístrate aquí</h2>
        <p className="mb-6 text-sm text-slate-500">
          Rellena los datos de tu negocio o regístrate con Google.
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
                placeholder="negocio@email.com"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* Business name */}
          <FieldRow>
            <Label className="text-xs font-medium text-slate-700">Nombre del negocio *</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                required
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* Categoria */}
          <FieldRow>
            <Label className="text-xs font-medium text-slate-700">Categoría *</Label>
            <div className="relative">
              <Tag className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Select
                value={formData.businessCategory}
                onValueChange={(value) => setFormData({ ...formData, businessCategory: value })}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white pl-10">
                  <SelectValue placeholder="Selecciona una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FieldRow>

          {/* Indirizzo */}
          <FieldRow>
            <Label className="text-xs font-medium text-slate-700">Dirección</Label>
            <Input
              className="h-11 rounded-xl border-slate-200 bg-white"
              value={formData.businessAddress}
              onChange={(e) => setFormData({ ...formData, businessAddress: e.target.value })}
            />
          </FieldRow>

          {/* Telefono */}
          <FieldRow>
            <Label className="text-xs font-medium text-slate-700">Teléfono del negocio</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="tel"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.businessPhone}
                onChange={(e) => setFormData({ ...formData, businessPhone: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* Paese + Città */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">{t("countries.selectCountry")} *</Label>
              <Select
                value={formData.businessCountry}
                onValueChange={(value) => setFormData({ ...formData, businessCountry: value, businessCity: "" })}
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
              <Select
                value={formData.businessCity}
                onValueChange={(value) => setFormData({ ...formData, businessCity: value })}
              >
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
                "Crear cuenta de local"
              )}
            </Button>
          </motion.div>

          <div className="space-y-1.5 pt-3 text-center text-xs text-slate-500">
            <div>
              ¿Solo quieres comprar tickets?{" "}
              <Link to="/register-client" className="font-semibold text-orange-600 hover:text-orange-700">
                Regístrate como cliente
              </Link>
            </div>
            <div>
              ¿Ya tienes cuenta?{" "}
              <Link to="/login" className="font-semibold text-orange-600 hover:text-orange-700">
                Inicia sesión
              </Link>
            </div>
          </div>
        </form>
      </motion.div>
    </AuthShell>
  );
};

const FieldRow = ({ children }: { children: React.ReactNode }) => (
  <div className="space-y-1.5">{children}</div>
);

export default RegisterPartner;
