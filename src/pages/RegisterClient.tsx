import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, EyeOff, Mail, Lock, User, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import AuthShell from "@/components/auth/AuthShell";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import AppleAuthButton from "@/components/auth/AppleAuthButton";
import { MENSAJE_PASSWORD_CORTA, MIN_PASSWORD_LENGTH, mensajeErrorAuth } from "@/components/auth/authErrors";
import { guardarReferidoPendiente } from "@/components/auth/referidos";
import { redirectToApp, sanitizeNextPath, withNext } from "@/lib/redirect-url";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const leerPaisGuardado = () => {
  try {
    return localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
};

/**
 * Alta de cliente.
 *
 *  - `?next=`: tras crear la cuenta (con email, Google o Apple) se vuelve ahí
 *    (p. ej. al evento desde el que se pulsó "Comprar").
 *  - `?ref=`: código de "Trae un amigo". Se guarda al abrir la página y App
 *    lo canjea en cuanto hay una cuenta recién creada con sesión
 *    (components/auth/referidos.ts). Si falla, el alta sigue igual.
 */
const RegisterClient = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const ref = searchParams.get("ref");
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
    country: leerPaisGuardado(),
    city: "",
  });

  useEffect(() => {
    guardarReferidoPendiente(ref);
  }, [ref]);

  const citiesForCountry = getCitiesForCountry(formData.country);

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
      // `initial_role` viaja en los metadatos del usuario. El trigger
      // `zz_on_auth_user_created_role` lo lee y asigna el rol EN EL SERVIDOR,
      // al crear la cuenta. Antes el rol se reclamaba desde aqui, con el token
      // recien emitido, y si esa llamada fallaba la cuenta quedaba creada pero
      // SIN ROL: el usuario entraba a una pantalla en blanco porque la app no
      // sabe a que panel llevarle. Paso dos veces seguidas en produccion.
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: formData.password,
        options: { data: { initial_role: "client" } },
      });
      if (authError) throw authError;

      if (authData.user) {
        // Garantizar sesion: si signUp no la abrio, entramos explicitamente.
        if (!authData.session) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email,
            password: formData.password,
          });
          if (signInErr) throw signInErr;
        }

        // A partir de aqui NADA es fatal. La cuenta ya existe y ya tiene rol.
        // Que falle guardar el telefono o avisar a un administrador no puede
        // dejar al usuario plantado en el formulario de registro.
        try {
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
          if (profileError) console.error("profiles update:", profileError);
        } catch (e) {
          console.error("profiles update exception:", e);
        }

        // Red de seguridad por si el trigger no estuviera desplegado: solo si
        // de verdad no hay rol. Reclamarlo con rol ya asignado daba un 409 en
        // cada alta.
        try {
          const { data: roles, error: rolesError } = await supabase.rpc("get_user_roles", {
            _user_id: authData.user.id,
          });
          if (!rolesError && ((roles as string[] | null) ?? []).length === 0) {
            const { error: roleError } = await supabase.rpc("claim_initial_role", { _role: "client" });
            if (roleError) console.error("claim_initial_role:", roleError);
          }
        } catch (e) {
          console.error("claim_initial_role exception:", e);
        }

        try {
          await supabase.rpc("auto_approve_if_allowed", { _role: "client" });
        } catch (e) {
          console.error("auto_approve_if_allowed exception:", e);
        }

        try {
          await supabase.functions.invoke("notify-new-registration", {
            body: {
              userEmail: email,
              userType: "client",
              firstName: formData.firstName,
              lastName: formData.lastName,
            },
          });
        } catch (notifyError) {
          console.error("notify-new-registration:", notifyError);
        }

        toast({ title: "¡Cuenta creada!", description: "Bienvenido a Pasify." });
        // Recarga completa: la invitación (`?ref=`) se canjea al arrancar con la sesión nueva.
        redirectToApp(nextPath ?? "/client-dashboard");
        return;
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
        <p className="mb-6 text-sm text-slate-500">Tus entradas, siempre a mano en el móvil.</p>

        {/* Google (web y Android) y Apple (solo iOS): cada botón decide si se pinta. */}
        <GoogleAuthButton label="Registrarme con Google" next={nextPath} />
        <div className="h-3" />
        <AppleAuthButton label="Registrarme con Apple" next={nextPath} />

        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          <span>o con email</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

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
                placeholder="tu@email.com"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* Nombre + apellidos */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow>
              <Label htmlFor="firstName" className="text-xs font-medium text-slate-700">Nombre *</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="firstName"
                  required
                  autoComplete="given-name"
                  className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
            </FieldRow>
            <FieldRow>
              <Label htmlFor="lastName" className="text-xs font-medium text-slate-700">Apellidos *</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="lastName"
                  required
                  autoComplete="family-name"
                  className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </FieldRow>
          </div>

          {/* Teléfono */}
          <FieldRow>
            <Label htmlFor="phone" className="text-xs font-medium text-slate-700">Teléfono</Label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                className="h-11 rounded-xl border-slate-200 bg-white pl-10"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </FieldRow>

          {/* País + Ciudad */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow>
              <Label className="text-xs font-medium text-slate-700">País *</Label>
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
              <Label className="text-xs font-medium text-slate-700">Ciudad *</Label>
              <Select value={formData.city} onValueChange={(value) => setFormData({ ...formData, city: value })}>
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

          {/* Contraseña */}
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

          {/* Repetir contraseña */}
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
                  Creando tu cuenta…
                </>
              ) : (
                "Crear cuenta"
              )}
            </Button>
          </motion.div>

          <div className="pt-2 text-center text-xs text-slate-500">
            <Link to="/register-partner" className="font-semibold text-orange-600 hover:text-orange-700">
              ¿Eres un local? Regístrate aquí
            </Link>
            <span className="mx-2 text-slate-300">·</span>
            <Link to={withNext("/login", nextPath)} className="font-semibold text-orange-600 hover:text-orange-700">
              ¿Ya tienes cuenta? Inicia sesión
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
