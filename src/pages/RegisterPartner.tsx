import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff, Mail, Lock, Building2, Phone, Tag } from "lucide-react";
import { motion } from "framer-motion";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import AuthShell from "@/components/auth/AuthShell";
import { MENSAJE_PASSWORD_CORTA, MIN_PASSWORD_LENGTH, mensajeErrorAuth } from "@/components/auth/authErrors";
import { redirectToApp } from "@/lib/redirect-url";

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

const leerPaisGuardado = () => {
  try {
    return localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
};

/**
 * Alta de local, solo con email. Sin Google ni Apple (build 10): con ellos la
 * cuenta nacía como cliente (el trigger de alta no sabe que viene de "Soy un
 * local") y no había forma de pasarla a local. La conversión de cliente a
 * local llega en la Ola 3.
 */
const RegisterPartner = () => {
  const { toast } = useToast();
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
    businessCountry: leerPaisGuardado(),
    businessCity: "",
    businessPhone: "",
    businessCategory: "",
  });

  const citiesForCountry = getCitiesForCountry(formData.businessCountry);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (formData.password !== formData.confirmPassword) {
      toast({ title: "Revisa la contraseña", description: "Las contraseñas no coinciden.", variant: "destructive" });
      return;
    }
    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      toast({ title: "Revisa la contraseña", description: MENSAJE_PASSWORD_CORTA, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const email = formData.email.trim();
      // Ver RegisterClient: el rol se asigna en el servidor a partir de estos
      // metadatos (trigger zz_on_auth_user_created_role). Sin este dato el
      // trigger asignaria 'client' por defecto y el local no llegaria a su panel.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: formData.password,
        options: { data: { initial_role: "partner" } },
      });
      if (authError) throw authError;

      // Garantisce una session valida: se signUp non l'ha già aperta (email
      // confirmation off), facciamo un signInWithPassword esplicito. Senza
      // session le INSERT successive (user_roles) verrebbero rifiutate da RLS
      // e l'utente finirebbe come "client" (fallback ProtectedRoute).
      if (!authData.session) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password: formData.password,
        });
        if (signInErr) throw signInErr;
      }

      if (authData.user) {
        // 1) Profile básico (datos de contacto / persona). El estado de la
        //    cuenta (account_status) lo fija el servidor, no el cliente.
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            business_name: formData.businessName,
            business_address: formData.businessAddress,
            business_country: formData.businessCountry,
            business_city: formData.businessCity,
            business_phone: formData.businessPhone,
            business_category: formData.businessCategory,
          })
          .eq("id", authData.user.id);
        if (profileError) throw profileError;

        // 2) Rol de local: lo asigna el trigger de alta a partir de
        //    `initial_role`. claim_initial_role solo como red de seguridad, si
        //    de verdad no hay rol: reclamarlo con el rol ya asignado responde
        //    409 (23505) y llenaba los logs con uno por cada alta.
        const { data: roles, error: rolesError } = await supabase.rpc("get_user_roles", {
          _user_id: authData.user.id,
        });
        if (!rolesError && ((roles as string[] | null) ?? []).length === 0) {
          const { error: roleError } = await supabase.rpc("claim_initial_role", { _role: "partner" });
          if (roleError) throw roleError;
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
            billing_email: email,
            contact_email: email,
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
              email,
            })
            .eq("brand_id", brandRow.id);
        }

        // 6) Plan gratuito (ya no hay prueba ni planes de pago). No-fatal:
        //    si falla, PartnerGate lo manda a PartnerChoosePlan, que vuelve
        //    a llamar a la misma RPC (es idempotente).
        const { error: planErr } = await supabase.rpc("claim_partner_free_plan");
        if (planErr) {
          console.warn("[RegisterPartner] claim_partner_free_plan falló:", planErr.message);
        }

        toast({ title: "¡Cuenta creada!", description: "Bienvenido a Pasify." });
        redirectToApp("/partner-dashboard");
      }
    } catch (error) {
      toast({ title: "No hemos podido crear la cuenta", description: mensajeErrorAuth(error), variant: "destructive" });
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
      subline="Únete a Pasify y empieza a vender tickets para tus eventos. Sin papel, sin colas, sin fricción: Pasify cobra las entradas por ti y te liquida lo vendido."
      imageUrl="/partner-hero.jpg"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">Soy un local · Regístrate aquí</h2>
        <p className="mb-6 text-sm text-slate-500">Rellena los datos de tu negocio para crear la cuenta de tu local.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Email */}
          <FieldRow>
            <Label htmlFor="email" className="text-xs font-medium text-slate-700">
              Email *
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
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
              <Label className="text-xs font-medium text-slate-700">País *</Label>
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
              <Label className="text-xs font-medium text-slate-700">Ciudad *</Label>
              <Select
                value={formData.businessCity}
                onValueChange={(value) => setFormData({ ...formData, businessCity: value })}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                  <SelectValue placeholder="Selecciona una ciudad" />
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
            <Label htmlFor="password" className="text-xs font-medium text-slate-700">Contraseña *</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10"
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
          </FieldRow>

          {/* Confirm Password */}
          <FieldRow>
            <Label htmlFor="confirmPassword" className="text-xs font-medium text-slate-700">Repite la contraseña *</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="••••••••"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 pr-10"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
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
                  Creando la cuenta…
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
