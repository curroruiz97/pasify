import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import {
  Loader2,
  Check,
  Lock,
  ShieldCheck,
  Receipt,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Users,
  TrendingUp,
  Bell,
  ExternalLink,
  CalendarRange,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { openWebWithAuth } from "@/lib/openWebAuth";
import Wordmark from "@/components/Wordmark";

/* ============ DESIGN TOKENS ============ */
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
  ink: "#F4EEE2",
  ink2: "#C9BFA8",
  ink3: "#8A8275",
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

const PartnerSubscribe = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id);
    })();
  }, []);

  const partnerSub = usePartnerSubscription(userId);
  useEffect(() => {
    if (!userId || partnerSub.loading) return;
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
          mode: "subscription",
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
    { Icon: CalendarRange, label: "Publicación ilimitada de eventos con tiers de ticket" },
    { Icon: TrendingUp, label: "LiveWarRoom · ventas en tiempo real" },
    { Icon: Sparkles, label: "AutoPilot IA · marketing y pricing dinámico" },
    { Icon: Users, label: "Equipo multi-rol (Owner / RRPP / Door Staff)" },
    { Icon: ShieldCheck, label: "Stripe Connect verificado · payouts automáticos" },
    { Icon: RefreshCw, label: "Cancelación flexible mensual desde tu portal" },
  ];

  /* ============ NATIVE (App Store / Play) ============ */
  if (isNative) {
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
        return "Gracias por probar Pasify. Para seguir usando todas las funciones Partner, activa tu cuenta desde el navegador.";
      }
      if (partnerSub.hasRecord && !partnerSub.hasAccess) {
        return "Tu acceso a las funciones Partner se ha interrumpido. Reactívalo desde el portal web en pocos segundos.";
      }
      return "Gestiona tu cuenta Partner desde pasifyy.vercel.app. Te llevamos allí con la sesión ya iniciada.";
    })();

    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden px-6"
        style={{
          ...FONT_DISPLAY,
          background: CREAM_BG,
          color: "#1A1612",
        }}
      >
        {/* Grain + warm halos */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: GRAIN_SVG_LIGHT,
            mixBlendMode: "multiply",
            opacity: 0.42,
          }}
        />
        <div
          className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full"
          style={{ background: TOKEN.accent2, filter: "blur(140px)", opacity: 0.18 }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 right-0 h-[400px] w-[400px] rounded-full"
          style={{ background: TOKEN.warm, filter: "blur(120px)", opacity: 0.15 }}
        />

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login", { replace: true });
          }}
          className="absolute left-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 backdrop-blur"
          style={{
            top: "calc(20px + env(safe-area-inset-top, 0px))",
            ...FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#5C544A",
            borderColor: "rgba(38,33,28,0.16)",
            background: "rgba(255,255,255,0.7)",
          }}
        >
          <ArrowLeft className="h-3 w-3" />
          Volver
        </button>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border p-8"
          style={{
            borderColor: "rgba(38,33,28,0.10)",
            background:
              "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(247,243,236,0.92) 100%)",
            backdropFilter: "blur(8px)",
            boxShadow:
              "0 32px 70px -28px rgba(232,84,42,.25), 0 4px 12px -4px rgba(184,56,26,.08)",
          }}
        >
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
            <span className="inline-block h-px w-6" style={{ background: TOKEN.accent }} />
            01 / Acceso Partner
          </div>

          <div
            className="mb-5 grid h-12 w-12 place-items-center rounded-2xl"
            style={{
              background:
                partnerSub.status === "trialing" && (partnerSub.daysLeft ?? 1) <= 0
                  ? "linear-gradient(180deg, rgba(255,200,180,0.45), rgba(232,84,42,0.10))"
                  : "rgba(232,84,42,0.10)",
              color: TOKEN.accentDeep,
            }}
          >
            <ExternalLink className="h-6 w-6" />
          </div>

          <h1
            className="mb-3 tracking-[-0.025em]"
            style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.05, color: "#1A1612" }}
          >
            {nativeHeading}
          </h1>
          <p className="mb-7 text-[14px] leading-[1.55]" style={{ color: "#5C544A" }}>
            {nativeDescription}
          </p>

          <motion.button
            whileTap={{ scale: 0.985, y: 1 }}
            onClick={() => openWebWithAuth("/partner/manage")}
            className="pasify-cta group flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-medium text-white transition-all"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              textShadow: "0 1px 1px rgba(80,20,5,.22)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)",
            }}
          >
            <ExternalLink className="h-4 w-4" />
            <span>Abrir pasifyy.vercel.app</span>
            <ArrowRight className="pasify-arrow h-4 w-4" />
          </motion.button>

          <p
            className="mt-4 text-center leading-relaxed"
            style={{
              ...FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#8A8275",
            }}
          >
            Se abrirá el portal con tu sesión iniciada
          </p>
        </motion.div>

        <style>{`
          .pasify-arrow { display:inline-block; transition: transform .25s cubic-bezier(.4,0,.2,1) }
          .pasify-cta:hover .pasify-arrow { transform: translateX(3px) }
        `}</style>
      </div>
    );
  }

  /* ============ WEB ============ */
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
          opacity: 0.42,
        }}
      />

      {/* Warm halos */}
      <div
        className="pasify-anim pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full"
        style={{
          background: TOKEN.accent2,
          filter: "blur(150px)",
          opacity: 0.22,
          animation: "pasify-float 22s ease-in-out infinite",
        }}
      />
      <div
        className="pasify-anim pointer-events-none absolute -bottom-32 -right-20 h-[420px] w-[420px] rounded-full"
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
        <button
          onClick={() => navigate("/partner/manage")}
          className="rounded-full border px-4 py-2 transition hover:bg-white"
          style={{
            ...FONT_MONO,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#5C544A",
            borderColor: "rgba(38,33,28,0.16)",
            background: "rgba(255,255,255,0.6)",
            backdropFilter: "blur(10px)",
          }}
        >
          Ya soy Partner →
        </button>
      </header>

      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 pb-24 pt-2 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-8">
        {/* Left: hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
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
            <span className="inline-block h-px w-7" style={{ background: TOKEN.accent }} />
            01 / Partner Pasify
          </div>

          <h1
            className="mb-5 tracking-[-0.045em]"
            style={{
              fontSize: "clamp(40px, 5.6vw, 68px)",
              fontWeight: 600,
              lineHeight: 1.02,
              color: "#1A1612",
            }}
          >
            Conecta tu venue con{" "}
            <span className="pasify-underline">
              <span style={{ color: "#1A1612" }}>la audiencia</span>
            </span>{" "}
            <span style={{ ...FONT_SERIF, color: TOKEN.accent }}>nocturna</span> de España.
          </h1>

          <p
            className="mb-8 max-w-[44ch] text-[15.5px] leading-[1.6]"
            style={{ color: "#5C544A" }}
          >
            Pasify es el sistema operativo de tu negocio nocturno: ticketing, cashless, TPV,
            door vision y marketing IA. Todo bajo un mismo techo, sin integraciones frágiles.
          </p>

          {/* Editorial divider */}
          <div
            className="mb-7 flex items-center gap-3"
            style={{
              ...FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#8A8275",
            }}
          >
            <div className="h-px flex-1" style={{ background: "rgba(38,33,28,0.15)" }} />
            <span>* incluido en la suscripción *</span>
            <div className="h-px flex-1" style={{ background: "rgba(38,33,28,0.15)" }} />
          </div>

          {/* Inclusion list */}
          <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {features.map(({ Icon, label }) => (
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
            <Stat label="Soporte" value="24/7" />
            <Stat label="Sin compromiso" value="1 mes" />
            <Stat label="Seguro" value="GDPR" />
          </div>
        </motion.div>

        {/* Right: pricing card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="lg:sticky lg:top-10 lg:self-start"
        >
          <div
            className="relative overflow-hidden rounded-3xl border p-8 transition-all hover:-translate-y-[2px] md:p-10"
            style={{
              borderColor: "rgba(38,33,28,0.10)",
              background:
                "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(247,243,236,0.92) 100%)",
              backdropFilter: "blur(8px)",
              boxShadow:
                "0 32px 80px -28px rgba(232,84,42,.25), 0 4px 12px -4px rgba(184,56,26,.08)",
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{
                background:
                  "linear-gradient(to right, transparent, #E8542A, #B8381A, transparent)",
              }}
            />

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
              Plan Partner
            </div>
            <h2
              className="mb-2 tracking-[-0.02em]"
              style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.05, color: "#1A1612" }}
            >
              Suscripción mensual
            </h2>
            <p className="mb-6 text-[14px] leading-[1.5]" style={{ color: "#5C544A" }}>
              Empieza hoy. Cancela cuando quieras.
            </p>

            <div className="mb-6 flex items-end gap-1.5">
              <span
                style={{
                  ...FONT_MONO,
                  fontSize: 20,
                  color: "#8A8275",
                  marginBottom: 10,
                }}
              >
                €
              </span>
              <span
                style={{
                  fontSize: 64,
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
              {features.slice(0, 4).map(({ label }) => (
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

            {isNative ? (
              <div
                className="rounded-2xl border p-4"
                style={{
                  borderColor: "rgba(232,176,76,0.32)",
                  background: "rgba(255,237,200,0.32)",
                  color: "#7A5512",
                  ...FONT_MONO,
                  fontSize: 11,
                  letterSpacing: "0.04em",
                }}
              >
                <div className="mb-1.5 flex items-center gap-2 font-semibold uppercase">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Activa desde la web
                </div>
                <p className="leading-relaxed">
                  Por políticas de las tiendas de apps, el pago se realiza en el portal web.
                  Accede a <strong>pasifyy.vercel.app</strong> desde un navegador con tu cuenta para
                  suscribirte o gestionar tu suscripción.
                </p>
              </div>
            ) : (
              <motion.button
                whileTap={{ scale: 0.985, y: 1 }}
                onClick={handleSubscribe}
                disabled={loading}
                className="pasify-cta group/btn relative flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium text-white transition-all disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  letterSpacing: "-0.005em",
                  textShadow: "0 1px 1px rgba(80,20,5,.22)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)",
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Redirigiendo a Stripe…</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    <span>Suscribirme ahora</span>
                    <ArrowRight className="pasify-arrow h-4 w-4" />
                  </>
                )}
              </motion.button>
            )}

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
              <br />
              21% España · reverse charge UE · sin IVA fuera UE
            </p>
          </div>

          <div
            className="mt-5 flex items-center justify-center gap-2"
            style={{
              ...FONT_MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#5C544A",
            }}
          >
            <span>¿Ya tienes suscripción?</span>
            <button
              onClick={() => navigate("/partner/manage")}
              className="transition hover:opacity-70"
              style={{ color: TOKEN.accentDeep, fontWeight: 600 }}
            >
              Gestiónala →
            </button>
          </div>
        </motion.div>
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
        <span>Pasify · v0.1 · Partner subscription</span>
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

export default PartnerSubscribe;
