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
  CalendarRange,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { openWebWithAuth } from "@/lib/openWebAuth";
import Wordmark from "@/components/Wordmark";

/* ============ DESIGN TOKENS — Pasify cream theme ============ */
const FONT_SERIF: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic",
  fontWeight: 400,
};
const FONT_MONO: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
};
const FONT_DISPLAY: React.CSSProperties = {
  fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
};

const TOKEN = {
  bg: "#0B0908",
  ink: "#F4EEE2",
  ink2: "#C9BFA8",
  ink3: "#8A8275",
  cream: "#F7F3EC",
  line: "#26211C",
  line2: "#332C25",
  accent: "#E8542A",
  accent2: "#FF7A4D",
  accentDeep: "#B8381A",
  warm: "#E8B04C",
  success: "#4DB87A",
};

const GRAIN_SVG_LIGHT =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.32 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const CREAM_BG = [
  "radial-gradient(60% 80% at 18% 20%, #FBE4D3 0%, transparent 60%)",
  "radial-gradient(45% 70% at 85% 30%, #FFE9C8 0%, transparent 60%)",
  "radial-gradient(50% 50% at 70% 90%, #F4DDC8 0%, transparent 60%)",
  "linear-gradient(180deg,#F7F3EC 0%, #F4EEE2 100%)",
].join(", ");

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
          ? `Acceso completo a Pasify hasta el ${ends.toLocaleDateString("es-ES")}.`
          : "Ya puedes usar todas las funcionalidades Partner.",
      });
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
        description: "Accede a pasifyy.vercel.app con tu cuenta para completar el pago.",
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
      // Siempre `stripe-create-checkout` — test vs live se distingue en el
      // server por STRIPE_SECRET_KEY.
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-checkout`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locale: "es",
          mode: "subscription",
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
    { Icon: TrendingUp, label: "Dashboard completo de eventos, tickets y aforo" },
    { Icon: Sparkles, label: "Stripe Connect listo para cobrar" },
    { Icon: Bell, label: "Push notifications a tu audiencia" },
    { Icon: Users, label: "Sin tarjeta, sin compromiso" },
  ];

  const paidPerks = [
    { Icon: ShieldCheck, label: "Todas las funciones desde el día 1" },
    { Icon: Receipt, label: "Factura fiscal con IVA · invoice PDF mensual" },
    { Icon: RefreshCw, label: "Cancela cuando quieras desde tu portal" },
    { Icon: Bell, label: "Soporte prioritario en menos de 1h" },
  ];

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{
        ...FONT_DISPLAY,
        background: CREAM_BG,
        color: "#1A1612",
      }}
    >
      <style>{`
        @keyframes pasify-float { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(28px,-22px) scale(1.04) } 66% { transform: translate(-22px,30px) scale(.97) } }
        @keyframes pasify-pulse { 0% { box-shadow: 0 0 0 0 rgba(232,84,42,.55) } 70% { box-shadow: 0 0 0 12px rgba(232,84,42,0) } 100% { box-shadow: 0 0 0 0 rgba(232,84,42,0) } }
        @keyframes pasify-slide-in { from { transform: scaleX(0) skewY(-1.5deg) } to { transform: scaleX(1) skewY(-1.5deg) } }
        .pasify-arrow { display:inline-block; transition: transform .25s cubic-bezier(.4,0,.2,1) }
        .pasify-cta:hover .pasify-arrow { transform: translateX(3px) }
        .pasify-underline { position: relative; display: inline-block; }
        .pasify-underline::after { content: ""; position: absolute; left: -2%; right: -2%; bottom: 0.08em; height: 0.22em; background: ${TOKEN.accent}; z-index: -1; transform: scaleX(1) skewY(-1.5deg); transform-origin: left; animation: pasify-slide-in 1s .35s cubic-bezier(.7,0,.3,1) backwards; }
        @media (prefers-reduced-motion: reduce) { .pasify-anim { animation: none !important; transition: none !important; } }
      `}</style>

      {/* Grain overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: GRAIN_SVG_LIGHT,
          mixBlendMode: "multiply",
          opacity: 0.45,
        }}
      />

      {/* Warm halos */}
      <div
        className="pasify-anim pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full"
        style={{
          background: TOKEN.accent2,
          filter: "blur(140px)",
          opacity: 0.22,
          animation: "pasify-float 22s ease-in-out infinite",
        }}
      />
      <div
        className="pasify-anim pointer-events-none absolute -bottom-40 -right-20 h-[420px] w-[420px] rounded-full"
        style={{
          background: TOKEN.warm,
          filter: "blur(120px)",
          opacity: 0.18,
          animation: "pasify-float 26s -8s ease-in-out infinite",
        }}
      />

      {/* Header */}
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center transition hover:opacity-80"
          aria-label="Pasify"
        >
          <Wordmark className="h-9 md:h-10" />
        </button>

        <div
          className="hidden items-center gap-2 rounded-full border px-3 py-1.5 md:inline-flex"
          style={{
            ...FONT_MONO,
            fontSize: 10.5,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#5C544A",
            borderColor: "rgba(38,33,28,0.16)",
            background: "rgba(255,255,255,0.6)",
            backdropFilter: "blur(10px)",
          }}
        >
          <span
            className="pasify-anim relative inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: TOKEN.accent,
              animation: "pasify-pulse 2.4s infinite",
            }}
          />
          Partner · onboarding
        </div>
      </header>

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pb-24 pt-2 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-8">
        {/* ============ LEFT — hero ============ */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          {/* Eyebrow numerado */}
          <div
            className="mb-5 inline-flex items-center gap-3"
            style={{
              ...FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: TOKEN.accentDeep,
            }}
          >
            <span
              className="inline-block h-px w-7"
              style={{ background: TOKEN.accent }}
            />
            01 / Bienvenido, Partner
          </div>

          <h1
            className="mb-6 tracking-[-0.045em]"
            style={{
              fontSize: "clamp(42px, 6vw, 72px)",
              fontWeight: 600,
              lineHeight: 1.02,
              color: "#1A1612",
            }}
          >
            Empieza{" "}
            <span className="pasify-underline">
              <span style={{ color: "#1A1612" }}>como mejor</span>
            </span>
            <br />
            te <span style={{ ...FONT_SERIF, color: TOKEN.accent }}>convenga</span>.
          </h1>

          <p
            className="mb-8 max-w-[40ch] text-[15.5px] leading-[1.6]"
            style={{ color: "#5C544A" }}
          >
            Prueba Pasify gratis durante <strong style={{ color: "#1A1612" }}>{trialDays} días</strong> o activa
            tu suscripción con todas las funciones desde el primer minuto. Tú eliges, sin letra pequeña.
          </p>

          {/* Editorial divider */}
          <div
            className="mb-8 flex items-center gap-3"
            style={{
              ...FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#8A8275",
            }}
          >
            <div className="h-px flex-1" style={{ background: "rgba(38,33,28,0.15)" }} />
            <span>* lo que necesitas, ya incluido *</span>
            <div className="h-px flex-1" style={{ background: "rgba(38,33,28,0.15)" }} />
          </div>

          {/* Inclusión list — editorial */}
          <div className="mb-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {[
              { Icon: CalendarRange, label: "Publicación de eventos · ilimitados" },
              { Icon: TrendingUp, label: "Ventas en tiempo real · LiveWarRoom" },
              { Icon: Sparkles, label: "Marketing IA · audiencias listas" },
              { Icon: ShieldCheck, label: "Stripe Connect verificado · payouts" },
            ].map(({ Icon, label }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-2xl border px-4 py-3 transition"
                style={{
                  borderColor: "rgba(38,33,28,0.12)",
                  background: "rgba(255,255,255,0.55)",
                  backdropFilter: "blur(6px)",
                }}
              >
                <span
                  className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(255,122,77,0.18), rgba(232,84,42,0.06))",
                    color: TOKEN.accentDeep,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span
                  className="text-[13.5px] leading-[1.45]"
                  style={{ color: "#1A1612", fontWeight: 500 }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Trust row */}
          <div
            className="grid max-w-md grid-cols-3 gap-4 border-t pt-6"
            style={{ borderColor: "rgba(38,33,28,0.12)" }}
          >
            <Stat label="Prueba gratis" value={`${trialDays}d`} />
            <Stat label="Soporte" value="24/7" />
            <Stat label="Seguro" value="GDPR" />
          </div>
        </motion.div>

        {/* ============ RIGHT — pricing cards ============ */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-8 lg:self-start">
          {/* Card TRIAL */}
          {trialEnabled && (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="group relative overflow-hidden rounded-3xl border p-8 transition-all hover:-translate-y-[2px]"
              style={{
                borderColor: "rgba(38,33,28,0.10)",
                background:
                  "linear-gradient(160deg, rgba(26,22,18,0.97) 0%, rgba(20,16,12,1) 100%)",
                boxShadow:
                  "0 32px 70px -28px rgba(232,84,42,.35), 0 4px 12px -4px rgba(0,0,0,.4)",
                color: TOKEN.ink,
              }}
            >
              {/* Warm corner accent */}
              <div
                className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-70"
                style={{
                  background:
                    "radial-gradient(closest-side, rgba(232,84,42,0.32), transparent 70%)",
                }}
              />
              {/* Grain on dark */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.14 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                  mixBlendMode: "overlay",
                  opacity: 0.45,
                  borderRadius: 24,
                }}
              />

              <div className="relative">
                <div className="mb-6 flex items-start justify-between gap-3">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-2xl"
                    style={{
                      background:
                        "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,.45), 0 6px 16px -4px rgba(232,84,42,.55)",
                    }}
                  >
                    <Gift className="h-5 w-5 text-white" />
                  </div>
                  <span
                    className="rounded-full border px-3 py-1"
                    style={{
                      ...FONT_MONO,
                      fontSize: 9.5,
                      letterSpacing: "0.22em",
                      textTransform: "uppercase",
                      color: TOKEN.ink2,
                      borderColor: TOKEN.line2,
                      background: "rgba(232,84,42,0.10)",
                    }}
                  >
                    Elección popular
                  </span>
                </div>

                <div
                  className="mb-2"
                  style={{
                    ...FONT_MONO,
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: TOKEN.accent2,
                  }}
                >
                  Prueba sin compromiso
                </div>
                <h2
                  className="mb-2 tracking-[-0.02em]"
                  style={{
                    fontSize: 36,
                    fontWeight: 600,
                    lineHeight: 1.02,
                    color: TOKEN.ink,
                  }}
                >
                  <span style={{ ...FONT_SERIF, color: TOKEN.accent2 }}>{trialDays}</span> días gratis
                </h2>
                <p
                  className="mb-7 text-[14px] leading-[1.5]"
                  style={{ color: TOKEN.ink2 }}
                >
                  Acceso completo a Pasify. Sin tarjeta de crédito.
                </p>

                <ul className="mb-8 space-y-3">
                  {trialPerks.map(({ label }) => (
                    <li
                      key={label}
                      className="flex items-start gap-3 text-[13.5px]"
                      style={{ color: TOKEN.ink }}
                    >
                      <span
                        className="mt-[3px] grid h-4 w-4 flex-shrink-0 place-items-center rounded-full"
                        style={{
                          background: TOKEN.accent,
                          boxShadow: "0 4px 10px -2px rgba(232,84,42,.5)",
                        }}
                      >
                        <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                      </span>
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>

                <motion.button
                  whileTap={{ scale: 0.985, y: 1 }}
                  onClick={handleStartTrial}
                  disabled={startingTrial}
                  className="pasify-cta group/btn relative flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-medium text-white transition-all disabled:opacity-60"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    letterSpacing: "-0.005em",
                    textShadow: "0 1px 1px rgba(80,20,5,.22)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)",
                  }}
                >
                  {startingTrial ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Activando tu prueba…</span>
                    </>
                  ) : (
                    <>
                      <span>Empezar mi prueba</span>
                      <ArrowRight className="pasify-arrow h-4 w-4" />
                    </>
                  )}
                </motion.button>

                <p
                  className="mt-4 text-center"
                  style={{
                    ...FONT_MONO,
                    fontSize: 10,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: TOKEN.ink3,
                  }}
                >
                  Activa la suscripción antes del fin para mantener el acceso
                </p>
              </div>
            </motion.div>
          )}

          {/* Card PAGAR — light */}
          {isNative ? (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="relative overflow-hidden rounded-3xl border p-8 transition-all hover:-translate-y-[2px]"
              style={{
                borderColor: "rgba(38,33,28,0.10)",
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(247,243,236,0.92) 100%)",
                backdropFilter: "blur(8px)",
                boxShadow:
                  "0 22px 50px -18px rgba(232,84,42,.18), 0 4px 12px -4px rgba(184,56,26,.06)",
              }}
            >
              <div
                className="mb-6 grid h-11 w-11 place-items-center rounded-2xl"
                style={{
                  background: "rgba(232,84,42,0.10)",
                  color: TOKEN.accentDeep,
                }}
              >
                <ExternalLink className="h-5 w-5" />
              </div>
              <div
                className="mb-2"
                style={{
                  ...FONT_MONO,
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: TOKEN.accentDeep,
                }}
              >
                Gestión completa
              </div>
              <h2
                className="mb-2 tracking-[-0.02em]"
                style={{
                  fontSize: 26,
                  fontWeight: 600,
                  lineHeight: 1.05,
                  color: "#1A1612",
                }}
              >
                Activar en el navegador
              </h2>
              <p className="mb-6 text-[14px] leading-[1.5]" style={{ color: "#5C544A" }}>
                Gestiona tu cuenta Pasify completa desde el portal web en tu navegador.
              </p>
              <motion.button
                whileTap={{ scale: 0.985 }}
                onClick={() => openWebWithAuth("/partner/manage")}
                className="pasify-cta group/btn flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-medium text-white transition-all"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.45), 0 12px 28px -8px rgba(232,84,42,.5)",
                }}
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                Abrir pasifyy.vercel.app
                <ArrowRight className="pasify-arrow h-4 w-4" />
              </motion.button>
              <p
                className="mt-4 text-center leading-relaxed"
                style={{
                  ...FONT_MONO,
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: TOKEN.ink3,
                }}
              >
                Te llevamos al portal con sesión iniciada
              </p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="relative overflow-hidden rounded-3xl border p-8 transition-all hover:-translate-y-[2px]"
              style={{
                borderColor: "rgba(38,33,28,0.10)",
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(247,243,236,0.92) 100%)",
                backdropFilter: "blur(8px)",
                boxShadow:
                  "0 22px 50px -18px rgba(232,84,42,.18), 0 4px 12px -4px rgba(184,56,26,.06)",
              }}
            >
              {/* Top accent line */}
              <div
                className="absolute inset-x-0 top-0 h-[3px]"
                style={{
                  background:
                    "linear-gradient(to right, transparent, #E8542A, #B8381A, transparent)",
                }}
              />

              <div className="mb-6 flex items-start justify-between gap-3">
                <div
                  className="grid h-11 w-11 place-items-center rounded-2xl"
                  style={{
                    background: "rgba(232,84,42,0.10)",
                    color: TOKEN.accentDeep,
                  }}
                >
                  <Lock className="h-5 w-5" />
                </div>
                <span
                  className="rounded-full border px-3 py-1"
                  style={{
                    ...FONT_MONO,
                    fontSize: 9.5,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "#5C544A",
                    borderColor: "rgba(38,33,28,0.16)",
                    background: "rgba(255,255,255,0.6)",
                  }}
                >
                  Plan mensual
                </span>
              </div>

              <div
                className="mb-2"
                style={{
                  ...FONT_MONO,
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: TOKEN.accentDeep,
                }}
              >
                Suscripción Partner
              </div>
              <h2
                className="mb-2 tracking-[-0.02em]"
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  lineHeight: 1.02,
                  color: "#1A1612",
                }}
              >
                Activa ahora
              </h2>
              <p className="mb-5 text-[14px] leading-[1.5]" style={{ color: "#5C544A" }}>
                Todas las funciones de Pasify, desde el día 1.
              </p>

              <div className="mb-6 flex items-end gap-1.5">
                <span
                  style={{
                    ...FONT_MONO,
                    fontSize: 18,
                    color: "#8A8275",
                    marginBottom: 8,
                  }}
                >
                  €
                </span>
                <span
                  style={{
                    fontSize: 56,
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                    color: "#1A1612",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  29,99
                </span>
                <span
                  className="mb-2"
                  style={{
                    ...FONT_MONO,
                    fontSize: 12,
                    letterSpacing: "0.04em",
                    color: "#5C544A",
                  }}
                >
                  <span style={FONT_SERIF}>/</span> mes + IVA
                </span>
              </div>

              <ul className="mb-7 space-y-3">
                {paidPerks.map(({ label }) => (
                  <li
                    key={label}
                    className="flex items-start gap-3 text-[13.5px]"
                    style={{ color: "#1A1612" }}
                  >
                    <span
                      className="mt-[3px] grid h-4 w-4 flex-shrink-0 place-items-center rounded-full"
                      style={{
                        background: "rgba(232,84,42,0.14)",
                        color: TOKEN.accentDeep,
                      }}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>

              <motion.button
                whileTap={{ scale: 0.985, y: 1 }}
                onClick={handlePayNow}
                disabled={startingCheckout}
                className="pasify-cta group/btn relative flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-medium text-white transition-all disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  letterSpacing: "-0.005em",
                  textShadow: "0 1px 1px rgba(80,20,5,.22)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)",
                }}
              >
                {startingCheckout ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Redirigiendo a Stripe…</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>Pagar ahora</span>
                    <ArrowRight className="pasify-arrow h-4 w-4" />
                  </>
                )}
              </motion.button>

              {/* Trust row inside card */}
              <div
                className="mt-6 grid grid-cols-3 gap-3 border-t pt-5"
                style={{ borderColor: "rgba(38,33,28,0.12)" }}
              >
                <TrustChip Icon={ShieldCheck} label="Pago seguro" />
                <TrustChip Icon={Receipt} label="Factura PDF" />
                <TrustChip Icon={RefreshCw} label="Cancela" />
              </div>

              <p
                className="mt-5 text-center leading-[1.55]"
                style={{
                  ...FONT_MONO,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: "#8A8275",
                }}
              >
                Pago procesado por Stripe · IVA aplicado según país
              </p>
            </motion.div>
          )}

          {!trialEnabled && (
            <p
              className="text-center"
              style={{
                ...FONT_MONO,
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#8A8275",
              }}
            >
              La prueba gratuita está desactivada por el administrador
            </p>
          )}
        </div>
      </div>

      {/* Footer strip */}
      <div
        className="relative z-10 mt-2 flex items-center justify-between border-t px-6 py-4 md:px-12"
        style={{
          borderColor: "rgba(38,33,28,0.12)",
          ...FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#5C544A",
        }}
      >
        <span>Pasify · v0.1 · Partner onboarding</span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={11} style={{ color: TOKEN.accentDeep }} />
          Hecho con cuidado en España
        </span>
      </div>
    </div>
  );
};

/* ---------- Subcomponents ---------- */

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        ...FONT_MONO,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        color: "#1A1612",
      }}
    >
      {value}
    </div>
    <div
      className="mt-1"
      style={{
        ...FONT_MONO,
        fontSize: 9.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "#8A8275",
      }}
    >
      {label}
    </div>
  </div>
);

const TrustChip = ({ Icon, label }: { Icon: typeof ShieldCheck; label: string }) => (
  <div className="flex flex-col items-center gap-1.5">
    <Icon className="h-4 w-4" style={{ color: TOKEN.accentDeep }} />
    <span
      style={{
        ...FONT_MONO,
        fontSize: 9.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "#5C544A",
      }}
    >
      {label}
    </span>
  </div>
);

export default PartnerChoosePlan;
