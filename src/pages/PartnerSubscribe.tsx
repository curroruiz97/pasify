import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { Loader2, Check, Lock, ShieldCheck, Receipt, RefreshCw, ArrowRight, Sparkles, Users, TrendingUp, Bell, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { openWebWithAuth } from "@/lib/openWebAuth";
import logo from "@/assets/logo.webp";

const HERO_IMG = "/partner-hero.jpg";

const PartnerSubscribe = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const isNative = Capacitor.isNativePlatform();

  // Carico il user id per gatewaying
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id);
    })();
  }, []);

  // Nuovo partner senza record → redirect a choose-plan (per scegliere trial o pago).
  // Qui atterrano solo chi deve rinnovare (record esistente).
  const partnerSub = usePartnerSubscription(userId);
  useEffect(() => {
    if (!userId || partnerSub.loading) return;
    // Se sta già accedendo (trial valido, active, admin grant), non ha senso stare qui.
    if (partnerSub.hasAccess) {
      navigate("/partner-dashboard", { replace: true });
      return;
    }
    if (!partnerSub.hasRecord) {
      navigate("/partner/choose-plan", { replace: true });
    }
  }, [userId, partnerSub.loading, partnerSub.hasAccess, partnerSub.hasRecord, navigate]);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Regístrate primero",
          description: "Crea tu cuenta Partner y procede al pago en un paso.",
        });
        navigate("/register-partner", { state: { redirectAfter: "/partner/subscribe" } });
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
          locale: i18n.language || "es",
          successUrl: `${window.location.origin}/#/partner/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/#/partner/cancel`,
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
      setLoading(false);
    }
  };

  const features = [
    { Icon: TrendingUp, label: "Listado destacado en la plataforma" },
    { Icon: Sparkles, label: "Gestión completa de eventos y promociones" },
    { Icon: Bell, label: "Notificaciones push a estudiantes" },
    { Icon: Users, label: "Análisis y estadísticas detalladas" },
    { Icon: ShieldCheck, label: "Soporte prioritario por WhatsApp" },
    { Icon: RefreshCw, label: "Cancelación flexible mensual" },
  ];

  // App nativa iOS/Android: per compliance App Store e Google Play non mostriamo
  // prezzi né bottoni di pagamento. Solo una schermata informativa contestuale
  // che rimanda al portale web (con auto-login via /auth/bridge).
  if (isNative) {
    // Messaggio contestuale basato sullo stato della sub
    const nativeHeading = (() => {
      if (partnerSub.status === "trialing" && partnerSub.daysLeft !== null && partnerSub.daysLeft <= 0) {
        return "Tu prueba gratuita ha terminado";
      }
      if (partnerSub.hasRecord && !partnerSub.hasAccess) {
        return "Tu cuenta Partner está inactiva";
      }
      return "Activa tu cuenta Partner";
    })();

    const nativeDescription = (() => {
      if (partnerSub.status === "trialing" && partnerSub.daysLeft !== null && partnerSub.daysLeft <= 0) {
        return "Gracias por probar StudentsLife. Para seguir usando todas las funciones Partner, activa tu cuenta desde el navegador.";
      }
      if (partnerSub.hasRecord && !partnerSub.hasAccess) {
        return "Tu acceso a las funciones Partner se ha interrumpido. Reactívalo desde el portal web.";
      }
      return "Gestiona tu cuenta Partner desde studentslife.app. Te llevamos allí con la sesión ya iniciada.";
    })();

    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden px-6"
        style={{ fontFamily: "'Inter', system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}
      >
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-sky-200/40 blur-[140px]" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-[400px] w-[400px] rounded-full bg-cyan-100/40 blur-[120px]" />

        <div className="absolute top-5 left-5" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/login", { replace: true });
            }}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 backdrop-blur"
          >
            <ArrowRight className="h-3 w-3 rotate-180" />
            Volver
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-7 shadow-[0_30px_80px_-30px_rgba(14,165,233,0.35)]"
        >
          {/* Icona contestuale: regalo se trial scaduto, else link */}
          <div
            className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              background: partnerSub.status === "trialing" && (partnerSub.daysLeft ?? 1) <= 0
                ? "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)"
                : "#f0f9ff",
              color: partnerSub.status === "trialing" && (partnerSub.daysLeft ?? 1) <= 0 ? "#e11d48" : "#0ea5e9",
            }}
          >
            <ExternalLink className="h-6 w-6" />
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">{nativeHeading}</h1>
          <p className="mb-6 text-sm leading-relaxed text-slate-600">
            {nativeDescription}
          </p>
          <Button
            size="lg"
            onClick={() => openWebWithAuth("/partner/manage")}
            className="group h-12 w-full rounded-2xl text-base font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
              boxShadow: "0 15px 40px -10px rgba(14,165,233,0.5)",
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Abrir en el navegador
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
            Se abrirá studentslife.app con tu sesión ya iniciada. No tendrás que volver a introducir credenciales.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-sky-50 via-white to-blue-50 text-slate-900">
      {/* Top nav */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <button onClick={() => navigate("/")} className="flex items-center gap-3">
          <img src={logo} alt="StudentsLife" className="h-10 w-10 rounded-xl shadow-md" />
          <span className="text-lg font-bold tracking-tight">StudentsLife</span>
        </button>
        <button
          onClick={() => navigate("/partner/manage")}
          className="rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-xs font-medium text-slate-600 backdrop-blur transition hover:bg-white hover:text-blue-600"
        >
          Ya soy Partner
        </button>
      </header>

      {/* Soft blue glows */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-blue-300/30 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-sky-300/20 blur-[100px]" />

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 pb-20 pt-8 lg:grid-cols-2 lg:gap-16 lg:pt-16">
        {/* Left: hero image + headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Partner StudentsLife
          </span>
          <h1 className="mb-5 text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl">
            Conecta tu negocio con{" "}
            <span className="bg-gradient-to-r from-blue-600 to-sky-500 bg-clip-text text-transparent">
              miles de estudiantes
            </span>
          </h1>
          <p className="mb-8 max-w-md text-base leading-relaxed text-slate-600">
            Únete a la comunidad líder en España. Ofrece descuentos, eventos
            y promociones a estudiantes universitarios activos cada día.
          </p>

          <div className="relative overflow-hidden rounded-3xl shadow-[0_30px_60px_-15px_rgba(59,130,246,0.3)]">
            <img
              src={HERO_IMG}
              alt="Estudiantes universitarios"
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 via-transparent to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
              <div className="flex items-baseline gap-3">
                <div className="text-3xl font-bold">1.000+</div>
                <div className="text-sm opacity-90">estudiantes activos</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            {[
              { v: "24/7", l: "Soporte" },
              { v: "1 mes", l: "Sin compromiso" },
              { v: "100%", l: "Seguro" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-slate-200 bg-white/70 p-3 backdrop-blur">
                <div className="text-base font-bold text-blue-600">{s.v}</div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">{s.l}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: pricing card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="lg:sticky lg:top-10 lg:self-start"
        >
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/80 p-8 shadow-[0_30px_80px_-20px_rgba(59,130,246,0.25)] backdrop-blur-xl md:p-10">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-blue-500" />

            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-600">
              Plan Partner
            </div>
            <h2 className="mb-1 text-2xl font-bold tracking-tight">Suscripción mensual</h2>
            <p className="mb-6 text-sm text-slate-500">
              Empieza hoy. Cancela cuando quieras.
            </p>

            <div className="mb-6 flex items-end gap-2">
              <span className="text-2xl text-slate-400">€</span>
              <span className="text-6xl font-bold leading-none text-slate-900">29,99</span>
              <span className="mb-2 text-sm text-slate-500">/ mes + IVA</span>
            </div>

            <ul className="mb-8 space-y-3">
              {features.map(({ Icon, label }) => (
                <li key={label} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>

            {isNative ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <ExternalLink className="h-4 w-4" />
                  Activa desde la web
                </div>
                <p className="text-xs leading-relaxed">
                  Por políticas de las tiendas de apps, el pago se realiza en el portal web. Accede a <strong>studentslife.app</strong> desde un navegador con tu cuenta para suscribirte o gestionar tu suscripción.
                </p>
              </div>
            ) : (
              <Button
                size="lg"
                onClick={handleSubscribe}
                disabled={loading}
                className="group h-14 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-sky-500 text-base font-semibold shadow-[0_15px_40px_-10px_rgba(59,130,246,0.5)] transition-all hover:from-blue-700 hover:to-sky-600 hover:shadow-[0_20px_50px_-10px_rgba(59,130,246,0.6)]"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Suscribirme ahora
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </Button>
            )}

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-200 pt-5 text-center text-[11px] text-slate-500">
              <div className="flex flex-col items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                <span>Pago seguro</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <Receipt className="h-4 w-4 text-blue-500" />
                <span>Factura PDF</span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-blue-500" />
                <span>Cancela cuando quieras</span>
              </div>
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">
              Pago procesado de forma segura por <strong>Stripe</strong>.
              IVA aplicada según país (21% para residentes en España; reverse charge para empresas UE; no IVA fuera UE).
            </p>
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>¿Ya tienes una suscripción?</span>
            <button
              onClick={() => navigate("/partner/manage")}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              Gestiónala aquí
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default PartnerSubscribe;
