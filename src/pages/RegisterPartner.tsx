import { useCallback, useState } from "react";
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
import ConfirmaTuEmail from "@/components/auth/ConfirmaTuEmail";
import TurnstileWidget from "@/components/auth/TurnstileWidget";
import { CaptchaError, useCaptcha } from "@/components/auth/captcha";
import { urlTrasConfirmarEmail } from "@/components/auth/confirmacionEmail";
import { metadatosAltaLocal, prepararCuentaDeLocal } from "@/components/auth/alta";
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
 * cuenta nace como cliente (el trigger de alta no sabe que viene de "Soy un
 * local"); una cuenta de cliente nueva puede pasar a local desde Ajustes.
 *
 * El rol y los datos del negocio viajan en los metadatos de signUp: el
 * servidor da el rol (zz_on_auth_user_created_role) y copia los datos al
 * perfil al crear el usuario, haya sesión o no. Después:
 *   - Sin «Confirm email»: signUp abre sesión y aquí mismo se crean la
 *     organización y el plan (complete_partner_signup) y se entra al panel.
 *   - Con «Confirm email»: no hay sesión hasta abrir el enlace del email. Se
 *     pide que lo revise; al entrar, PartnerGate crea la organización con esos
 *     mismos datos.
 * Solo en la web y con VITE_TURNSTILE_SITE_KEY, antes hay captcha.
 */
const RegisterPartner = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [categories] = useState<Category[]>(PASIFY_CATEGORIES);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Email del alta que espera confirmación (sin sesión todavía).
  const [pendienteDeConfirmar, setPendienteDeConfirmar] = useState<string | null>(null);
  const captcha = useCaptcha("signup");
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

  // Confirmada en otra pestaña: con la sesión, al panel (PartnerGate termina el alta).
  const alConfirmar = useCallback(() => redirectToApp("/partner-dashboard"), []);

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
      await captcha.verificar();

      const email = formData.email.trim();
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: formData.password,
        options: {
          // Sin initial_role el trigger asignaría 'client' y el local no llegaría a su panel.
          data: metadatosAltaLocal(formData),
          emailRedirectTo: urlTrasConfirmarEmail(),
        },
      });
      if (authError) throw authError;

      // «Confirm email» activado: sin sesión hasta que abra el enlace.
      if (!authData.session || !authData.user) {
        setPendienteDeConfirmar(email);
        return;
      }

      // Con sesión (sin confirmación). El perfil ya lo rellena el trigger de
      // alta; se repite aquí por si el servidor aún no lo tiene.
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
      if (profileError) console.warn("[RegisterPartner] perfil:", profileError.message);

      // Rol de local: lo asigna el trigger de alta a partir de `initial_role`.
      // claim_initial_role solo como red de seguridad, si de verdad no hay rol:
      // reclamarlo con el rol ya asignado responde 409 (23505).
      const { data: roles, error: rolesError } = await supabase.rpc("get_user_roles", {
        _user_id: authData.user.id,
      });
      if (!rolesError && ((roles as string[] | null) ?? []).length === 0) {
        const { error: roleError } = await supabase.rpc("claim_initial_role", { _role: "partner" });
        if (roleError) throw roleError;
      }

      // Organización (con el nombre y los datos del negocio) y plan gratuito.
      // No es fatal: si falla, PartnerGate lo vuelve a intentar al entrar.
      const planError = await prepararCuentaDeLocal({
        nombre: formData.businessName,
        pais: formData.businessCountry,
      });
      if (planError) console.warn("[RegisterPartner] complete_partner_signup:", planError.message);

      toast({ title: "¡Cuenta creada!", description: "Bienvenido a Pasify." });
      redirectToApp("/partner-dashboard");
    } catch (error) {
      toast({
        title: "No hemos podido crear la cuenta",
        description: error instanceof CaptchaError ? error.message : mensajeErrorAuth(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (pendienteDeConfirmar) {
    return (
      <AuthShell
        headline={
          <>
            Llena tu local <span style={serif} className="text-orange-200">cada noche</span>.
          </>
        }
        subline="Solo falta confirmar tu email. Después entra con tu contraseña y completa los datos de tu local."
        imageUrl="/partner-hero.jpg"
      >
        <ConfirmaTuEmail
          email={pendienteDeConfirmar}
          loginHref="/login"
          onCambiarEmail={() => setPendienteDeConfirmar(null)}
          onConfirmada={alConfirmar}
        />
      </AuthShell>
    );
  }

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
            <Label htmlFor="businessName" className="text-xs font-medium text-slate-700">Nombre del negocio *</Label>
            <div className="relative">
              <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="businessName"
                required
                autoComplete="organization"
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

          {captcha.activo && <TurnstileWidget {...captcha.widget} />}

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
