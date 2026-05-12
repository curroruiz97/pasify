import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import {
  Gift,
  ArrowRight,
  Loader2,
  Lock,
  ExternalLink,
  ShieldCheck,
  Receipt,
  RefreshCw,
  TrendingUp,
  Sparkles,
  Bell,
  Users,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { openWebWithAuth } from "@/lib/openWebAuth";
import logo from "@/assets/logo.webp";

const HERO_IMG = "/partner-hero.jpg";

// Inline serif per accenti (corrisponde alla landing)
const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const PartnerChoosePlan = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [trialEnabled, setTrialEnabled] = useState<boolean>(true);
  const [trialDays, setTrialDays] = useState<number>(15);
  const [startingTrial, setStartingTrial] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    (async () => {
      try {
        const [{ data: enabled }, { data: days }] = await Promise.all([
          supabase.rpc("get_app_setting_bool", { _key: "partner_trial_enabled" }),
          supabase.rpc("get_app_setting_int", { _key: "partner_trial_days" }),
        ]);
        if (typeof enabled === "boolean") setTrialEnabled(enabled);
        if (typeof days === "number" && days > 0) setTrialDays(days);
      } catch (err) {
        console.error("Error cargando configuración trial:", err);
      }
    })();
  }, []);

  const handleStartTrial = async () => {
    setStartingTrial(true);
    try {
      const { data, error } = await supabase.rpc("start_partner_trial");
      if (error) throw error;
      const ends = data ? new Date(data as string) : null;
      toast({
        title: `¡Tu prueba de ${trialDays} días ha comenzado!`,
        description: ends
          ? `Acceso completo hasta el ${ends.toLocaleDateString("es-ES")}.`
          : "Ya puedes usar todas las funcionalidades Partner.",
      });
      // Refresh della sessione così il prossimo check DB legge il record appena creato.
      await supabase.auth.refreshSession();
      navigate("/partner-dashboard", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo iniciar la prueba";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setStartingTrial(false);
    }
  };

  const handlePayNow = async () => {
    if (isNative) {
      toast({
        title: "Activa tu suscripción desde la web",
        description: "Accede a studentslife.app con tu cuenta para completar el pago.",
      });
      return;
    }
    setStartingCheckout(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sesión expirada", description: "Vuelve a iniciar sesión.", variant: "destructive" });
        navigate("/login");
        return;
      }
      const checkoutFn = import.meta.env.VITE_STRIPE_TEST_MODE === "true"
        ? "stripe-create-checkout-test"
        : "stripe-create-checkout";
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${checkoutFn}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale: "es",
          successUrl: `${window.location.origin}/#/partner/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/#/partner/choose-plan`,
        }),
      });
      const raw = await resp.text();
      if (!resp.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.error || parsed?.message || parsed?.code || raw;
        } catch (_) { /* noop */ }
        console.error("checkout HTTP", resp.status, raw);
        throw new Error(`${resp.status}: ${detail}`);
      }
      const data = JSON.parse(raw);
      if (!data?.url) throw new Error("Respuesta inesperada del servidor");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar el pago";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setStartingCheckout(false);
    }
  };

  const trialPerks = [
    { Icon: TrendingUp, label: "Listado destacado en la plataforma" },
    { Icon: Sparkles, label: "Gestión completa de eventos y promociones" },
    { Icon: Bell, label: "Notificaciones push a estudiantes" },
    { Icon: Users, label: "Sin tarjeta, sin compromiso" },
  ];

  const paidPerks = [
    { Icon: ShieldCheck, label: "Todas las funciones desde el día 1" },
    { Icon: Receipt, label: "Factura fiscal con IVA" },
    { Icon: RefreshCw, label: "Cancela cuando quieras" },
    { Icon: Bell, label: "Soporte prioritario por WhatsApp" },
  ];

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}
    >
      {/* Header stile landing */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <img src={logo} alt="StudentsLife" className="h-9 w-9 rounded-xl" style={{ filter: "drop-shadow(0 4px 10px rgba(14,165,233,0.25))" }} />
          <span className="text-[15px] font-bold tracking-tight">
            Student<span style={{ ...serif, color: "#0ea5e9", fontSize: 18, margin: "0 1px" }}>&apos;s</span>Life
          </span>
        </button>
        <span className="hidden rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 backdrop-blur md:inline-flex">
          Partner onboarding
        </span>
      </header>

      {/* Background glows (match landing) */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-sky-200/40 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] translate-x-1/4 rounded-full bg-cyan-100/40 blur-[120px]" />

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pb-24 pt-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-16">
        {/* Sinistra — hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#0ea5e9" }} />
            Bienvenido, Partner
          </span>

          <h1 className="mb-5 text-4xl font-bold leading-[1.02] tracking-tight md:text-[56px]">
            Empieza <br />
            <span style={serif} className="text-sky-600">como mejor</span> te convenga.
          </h1>

          <p className="mb-8 max-w-md text-[15px] leading-relaxed text-slate-600">
            Prueba StudentsLife gratis durante <strong>{trialDays} días</strong> o activa tu
            suscripción y empieza con todas las funciones desde el primer minuto.
            Tú eliges.
          </p>

          <div className="relative overflow-hidden rounded-[28px] shadow-[0_40px_80px_-30px_rgba(14,165,233,0.35)]">
            <img
              src={HERO_IMG}
              alt="Comercio local con estudiantes"
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between p-6 text-white">
              <div>
                <div className="text-3xl font-bold leading-none">1.200+</div>
                <div className="mt-1 text-xs uppercase tracking-wider opacity-80">estudiantes activos</div>
              </div>
              <div className="rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-medium backdrop-blur-sm">
                Ya disponible en Valladolid
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { v: `${trialDays}d`, l: "Prueba gratis" },
              { v: "24/7", l: "Soporte" },
              { v: "100%", l: "Seguro" },
            ].map((s) => (
              <div
                key={s.l}
                className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-3 text-center backdrop-blur"
              >
                <div className="text-lg font-bold text-sky-600">{s.v}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Destra — pricing cards */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-8 lg:self-start">
          {/* Card TRIAL — stile "recommended" senza verde, navy accent */}
          {trialEnabled && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="relative overflow-hidden rounded-[28px] border border-slate-900/5 bg-white p-8 shadow-[0_40px_80px_-30px_rgba(14,165,233,0.35)]"
            >
              {/* Decorative corner accent */}
              <div
                className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-60"
                style={{ background: "radial-gradient(closest-side, rgba(14,165,233,0.22), transparent 70%)" }}
              />

              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <Gift className="h-5 w-5" />
                </div>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                  Elección popular
                </span>
              </div>

              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-600">
                Prueba sin compromiso
              </div>
              <h2 className="mb-1 text-3xl font-bold tracking-tight">
                <span style={serif} className="text-sky-600">{trialDays}</span> días gratis
              </h2>
              <p className="mb-6 text-sm text-slate-500">
                Acceso completo. Sin tarjeta de crédito.
              </p>

              <ul className="mb-8 space-y-3">
                {trialPerks.map(({ label }) => (
                  <li key={label} className="flex items-start gap-3 text-[14px] text-slate-700">
                    <span className="mt-[3px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              <Button
                size="lg"
                onClick={handleStartTrial}
                disabled={startingTrial}
                className="h-14 w-full rounded-2xl bg-slate-900 px-8 text-base font-semibold text-white transition-all hover:bg-slate-800"
              >
                {startingTrial ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Empezar mi prueba"
                )}
              </Button>
              <p className="mt-3 text-center text-[11px] text-slate-400">
                Activa la suscripción antes de que termine para mantener el acceso.
              </p>
            </motion.div>
          )}

          {/* Card PAGAR (nascosta completamente in app nativa per compliance) */}
          {isNative ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 p-8 backdrop-blur"
            >
              <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <ExternalLink className="h-5 w-5" />
              </div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-600">
                Gestión completa
              </div>
              <h2 className="mb-1 text-2xl font-bold tracking-tight">Activar en el navegador</h2>
              <p className="mb-6 text-sm text-slate-500">
                Gestiona tu cuenta completa desde el portal web en tu navegador.
              </p>
              <Button
                size="lg"
                onClick={() => openWebWithAuth("/partner/manage")}
                className="h-14 w-full rounded-2xl px-8 text-base font-semibold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                  boxShadow: "0 15px 40px -10px rgba(14,165,233,0.5)",
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir en el navegador
              </Button>
              <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
                Se abrirá studentslife.app con tu sesión iniciada. Puedes continuar desde el navegador sin volver a ingresar credenciales.
              </p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 p-8 backdrop-blur"
            >
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500" />

              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                  <Lock className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-slate-200 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Plan mensual
                </span>
              </div>

              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-600">
                Suscripción Partner
              </div>
              <h2 className="mb-1 text-3xl font-bold tracking-tight">Activa ahora</h2>
              <p className="mb-5 text-sm text-slate-500">Todas las funciones, desde el día 1.</p>

              <div className="mb-6 flex items-end gap-1.5">
                <span className="text-xl text-slate-400">€</span>
                <span className="text-5xl font-bold leading-none tracking-tight">29,99</span>
                <span className="mb-1 text-sm text-slate-500">
                  <span style={serif}>/</span> mes + IVA
                </span>
              </div>

              <ul className="mb-7 space-y-3">
                {paidPerks.map(({ label }) => (
                  <li key={label} className="flex items-start gap-3 text-[14px] text-slate-700">
                    <span className="mt-[3px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              <Button
                size="lg"
                onClick={handlePayNow}
                disabled={startingCheckout}
                className="group h-13 w-full rounded-2xl text-base font-semibold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                  boxShadow: "0 15px 40px -10px rgba(14,165,233,0.5)",
                }}
              >
                {startingCheckout ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Pagar ahora
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-500">
                <div className="flex flex-col items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-sky-500" />
                  <span>Pago seguro</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-sky-500" />
                  <span>Factura PDF</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <RefreshCw className="h-4 w-4 text-sky-500" />
                  <span>Cancela</span>
                </div>
              </div>
            </motion.div>
          )}

          {!trialEnabled && (
            <p className="text-center text-xs text-slate-500">
              La prueba gratuita está desactivada por el administrador.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartnerChoosePlan;
