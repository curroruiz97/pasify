import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Mail,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  KeyRound,
  Lock,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";
import Wordmark from "@/components/Wordmark";

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
  bg2: "#13100E",
  ink: "#F4EEE2",
  ink2: "#C9BFA8",
  ink3: "#8A8275",
  cream: "#F7F3EC",
  cream2: "#F4EEE2",
  line: "#26211C",
  line2: "#332C25",
  accent: "#E8542A",
  accent2: "#FF7A4D",
  accentDeep: "#B8381A",
  warm: "#E8B04C",
  success: "#4DB87A",
};

const GRAIN_SVG_DARK =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";
const GRAIN_SVG_LIGHT =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.32 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const CREAM_BG = [
  "radial-gradient(60% 80% at 18% 20%, #FBE4D3 0%, transparent 60%)",
  "radial-gradient(45% 70% at 85% 30%, #FFE9C8 0%, transparent 60%)",
  "radial-gradient(50% 50% at 70% 90%, #F4DDC8 0%, transparent 60%)",
  "linear-gradient(180deg,#F7F3EC 0%, #F4EEE2 100%)",
].join(", ");

const ResetPassword = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  const expiresIn = useMemo(() => {
    if (!sentAt) return null;
    const elapsedSec = Math.floor((now - sentAt) / 1000);
    const remaining = Math.max(0, 60 * 60 - elapsedSec);
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    return `${String(h).padStart(2, "0")} : ${String(m).padStart(2, "0")} : ${String(s).padStart(2, "0")}`;
  }, [sentAt, now]);

  const sendLink = async () => {
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/#/update-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });
      if (error) throw error;
      setSent(true);
      setSentAt(Date.now());
      setResendCooldown(30);
      toast({
        title: "Enlace enviado",
        description: "Revisa tu bandeja de entrada para recuperar el acceso.",
      });
    } catch (error: any) {
      toast({
        title: "No se pudo enviar",
        description: error?.message || "Intenta de nuevo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;
    await sendLink();
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || loading) return;
    await sendLink();
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{
        ...FONT_DISPLAY,
        background: TOKEN.bg,
        color: TOKEN.ink,
      }}
    >
      <style>{`
        @keyframes pasify-float { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(28px,-22px) scale(1.04) } 66% { transform: translate(-22px,30px) scale(.97) } }
        @keyframes pasify-pulse { 0% { box-shadow: 0 0 0 0 rgba(232,84,42,.55) } 70% { box-shadow: 0 0 0 12px rgba(232,84,42,0) } 100% { box-shadow: 0 0 0 0 rgba(232,84,42,0) } }
        @keyframes pasify-card-float { 0%,100% { transform: rotate(-2.5deg) translateY(0) } 50% { transform: rotate(-1.8deg) translateY(-10px) } }
        @keyframes pasify-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        @keyframes pasify-slide-in { from { transform: scaleX(0) skewY(-1.5deg) } to { transform: scaleX(1) skewY(-1.5deg) } }
        .pasify-arrow { display:inline-block; transition: transform .25s cubic-bezier(.4,0,.2,1) }
        .pasify-cta:hover .pasify-arrow { transform: translateX(3px) }
        .pasify-underline { position: relative; display: inline-block; }
        .pasify-underline::after { content: ""; position: absolute; left: -2%; right: -2%; bottom: 0.08em; height: 0.22em; background: ${TOKEN.accent}; z-index: -1; transform: scaleX(1) skewY(-1.5deg); transform-origin: left; animation: pasify-slide-in 1s .4s cubic-bezier(.7,0,.3,1) backwards; }
        @media (prefers-reduced-motion: reduce) {
          .pasify-anim { animation: none !important; transition: none !important; }
        }
      `}</style>

      <div className="flex min-h-screen flex-col md:flex-row">
        {/* ============ LEFT — DARK BRAND PANEL ============ */}
        <aside
          className="relative flex flex-col justify-between overflow-hidden p-6 md:min-h-screen md:w-1/2 md:p-12"
          style={{
            background: "linear-gradient(160deg, #1A0F08 0%, #2A1610 45%, #3D1F12 100%)",
            minHeight: "44vh",
          }}
        >
          {/* Floating accent blobs */}
          <div
            className="pasify-anim pointer-events-none absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full"
            style={{
              background: TOKEN.accent,
              filter: "blur(110px)",
              opacity: 0.45,
              animation: "pasify-float 18s ease-in-out infinite",
            }}
          />
          <div
            className="pasify-anim pointer-events-none absolute bottom-[-160px] right-[-120px] h-[380px] w-[380px] rounded-full"
            style={{
              background: "#7A2A0F",
              filter: "blur(120px)",
              opacity: 0.55,
              animation: "pasify-float 22s -6s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 hidden md:block"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(244,238,226,.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(244,238,226,.04) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
              WebkitMaskImage:
                "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)",
              maskImage:
                "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)",
            }}
          />
          {/* Grain overlay */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: GRAIN_SVG_DARK,
              mixBlendMode: "overlay",
              opacity: 0.45,
            }}
          />

          {/* Mobile gradient fade-out to cream */}
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-20 md:hidden"
            style={{
              background: `linear-gradient(to bottom, transparent, ${TOKEN.cream})`,
            }}
          />

          {/* Logo + eyebrow row */}
          <div className="relative z-10 flex items-center justify-between" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <button
              onClick={() => (window.location.href = "/")}
              className="inline-flex items-center transition hover:opacity-80"
              aria-label="Pasify"
            >
              <Wordmark className="h-9 md:h-11" />
            </button>

            {/* Status meta — pulse dot */}
            <div
              className="hidden items-center gap-2 rounded-full border px-3 py-1.5 md:inline-flex"
              style={{
                ...FONT_MONO,
                fontSize: 10.5,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: TOKEN.ink2,
                borderColor: TOKEN.line2,
                background: "rgba(244,238,226,.03)",
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
              Phase 01 · acceso seguro
            </div>
          </div>

          {/* Hero content */}
          <div className="relative z-10 my-10 max-w-xl md:my-0">
            <div
              className="mb-6 inline-flex items-center gap-3 rounded-full border px-3.5 py-1.5"
              style={{
                ...FONT_MONO,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: TOKEN.ink2,
                borderColor: TOKEN.line2,
                background: "rgba(232,84,42,.08)",
              }}
            >
              <KeyRound size={12} style={{ color: TOKEN.accent }} />
              Recuperación de cuenta
            </div>

            <h1
              className="leading-[0.95] tracking-[-0.045em] text-white"
              style={{
                fontSize: "clamp(40px, 6.2vw, 76px)",
                fontWeight: 600,
              }}
            >
              ¿Olvidaste tu{" "}
              <span className="pasify-underline">
                <span style={{ color: TOKEN.ink }}>contraseña</span>
              </span>
              ?
              <br />
              <span style={FONT_SERIF}>Tranquilo</span>,{" "}
              <span style={{ color: TOKEN.accent2 }}>te abrimos paso</span>.
            </h1>

            <p
              className="mt-6 max-w-[36ch] text-base leading-[1.55] md:mt-8 md:text-lg"
              style={{ color: TOKEN.ink2 }}
            >
              Te enviamos un enlace firmado a tu email para crear una contraseña nueva. Caduca en 60 minutos y solo funciona una vez — así nadie más puede usarlo.
            </p>

            {/* Trust row */}
            <div
              className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t pt-6"
              style={{ borderColor: TOKEN.line }}
            >
              <Stat label="Cifrado" value="TLS 1.3" />
              <Stat label="Válido" value="60 min" />
              <Stat label="Un solo uso" value="1×" />
            </div>
          </div>

          {/* Security ticket card — floating */}
          <div className="relative z-10 hidden md:block">
            <SecurityCard email={email || "tu@email.com"} />
          </div>

          {/* Bottom trust line */}
          <div
            className="relative z-10 mt-6 hidden items-center justify-between md:flex"
            style={{
              ...FONT_MONO,
              fontSize: 10.5,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: TOKEN.ink3,
            }}
          >
            <span>Pasify · España · 2026</span>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={12} style={{ color: TOKEN.success }} />
              GDPR · ISO 27001
            </span>
          </div>
        </aside>

        {/* ============ RIGHT — CREAM FORM PANEL ============ */}
        <main
          className="relative flex flex-1 flex-col"
          style={{
            background: CREAM_BG,
            color: "#1A1612",
          }}
        >
          {/* Grain overlay on cream */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: GRAIN_SVG_LIGHT,
              mixBlendMode: "multiply",
              opacity: 0.5,
            }}
          />

          {/* Subtle warm halo */}
          <div
            className="pointer-events-none absolute -right-32 top-1/3 h-[420px] w-[420px] rounded-full"
            style={{
              background: TOKEN.accent2,
              filter: "blur(140px)",
              opacity: 0.18,
            }}
          />

          <div className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 md:p-12">
            <div className="w-full max-w-[460px]">
              {!sent ? (
                <FormState
                  email={email}
                  setEmail={setEmail}
                  loading={loading}
                  onSubmit={handleSubmit}
                />
              ) : (
                <SuccessState
                  email={email}
                  expiresIn={expiresIn}
                  resendCooldown={resendCooldown}
                  loading={loading}
                  onResend={handleResend}
                  onChangeEmail={() => {
                    setSent(false);
                    setSentAt(null);
                  }}
                />
              )}
            </div>
          </div>

          {/* Footer strip */}
          <div
            className="relative z-10 flex items-center justify-between border-t px-5 py-4 md:px-12"
            style={{
              borderColor: "rgba(38,33,28,0.12)",
              ...FONT_MONO,
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#5C544A",
            }}
          >
            <span>Pasify · v0.1 · Acceso protegido</span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={11} style={{ color: TOKEN.accentDeep }} />
              Hecho con cuidado en España
            </span>
          </div>
        </main>
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
        color: TOKEN.ink,
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
        color: TOKEN.ink3,
      }}
    >
      {label}
    </div>
  </div>
);

const SecurityCard = ({ email }: { email: string }) => (
  <div
    className="pasify-anim relative w-full max-w-[340px] overflow-hidden rounded-2xl border"
    style={{
      borderColor: TOKEN.line2,
      background: "linear-gradient(180deg,#1A1612 0%,#0F0D0B 100%)",
      transform: "rotate(-2.5deg)",
      boxShadow:
        "0 40px 80px -30px rgba(232,84,42,.35), 0 30px 60px -30px rgba(0,0,0,.6)",
      animation: "pasify-card-float 6s ease-in-out infinite",
    }}
  >
    {/* Top accent strip */}
    <div
      className="px-5 py-3"
      style={{
        background: "linear-gradient(135deg, rgba(232,84,42,.18), rgba(184,56,26,.05))",
        borderBottom: `1px solid ${TOKEN.line}`,
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2"
          style={{
            ...FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKEN.accent2,
          }}
        >
          <Lock size={11} />
          Enlace firmado · HMAC
        </div>
        <div
          style={{
            ...FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: TOKEN.ink3,
          }}
        >
          /reset-flow
        </div>
      </div>
    </div>

    {/* Body */}
    <div className="px-5 py-5">
      <div
        style={{
          ...FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: TOKEN.ink3,
        }}
      >
        Destinatario
      </div>
      <div
        className="mt-1 truncate"
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: TOKEN.ink,
          letterSpacing: "-0.01em",
        }}
      >
        {email}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniMeta label="Algoritmo" value="SHA-256" />
        <MiniMeta label="TTL" value="60 min" />
      </div>

      <div
        className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5"
        style={{
          borderColor: "rgba(77,184,122,.25)",
          background: "rgba(77,184,122,.06)",
          ...FONT_MONO,
          fontSize: 10.5,
          letterSpacing: "0.06em",
          color: TOKEN.success,
        }}
      >
        <CheckCircle2 size={13} />
        Conexión cifrada extremo a extremo
      </div>
    </div>

    {/* Bottom dashed strip — ticket vibe */}
    <div
      className="flex items-center justify-between px-5 py-3"
      style={{
        borderTop: `1px dashed ${TOKEN.line2}`,
        background: "rgba(0,0,0,.25)",
      }}
    >
      <span
        style={{
          ...FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: TOKEN.ink3,
        }}
      >
        Token único
      </span>
      <span
        style={{
          ...FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.1em",
          color: TOKEN.accent2,
        }}
      >
        a7f3·••••·9c2e
      </span>
    </div>
  </div>
);

const MiniMeta = ({ label, value }: { label: string; value: string }) => (
  <div
    className="rounded-lg border px-3 py-2"
    style={{ borderColor: TOKEN.line2, background: "rgba(244,238,226,.02)" }}
  >
    <div
      style={{
        ...FONT_MONO,
        fontSize: 9.5,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: TOKEN.ink3,
      }}
    >
      {label}
    </div>
    <div
      className="mt-0.5"
      style={{
        ...FONT_MONO,
        fontSize: 13,
        fontWeight: 500,
        color: TOKEN.ink,
        letterSpacing: "-0.01em",
      }}
    >
      {value}
    </div>
  </div>
);

const FormState = ({
  email,
  setEmail,
  loading,
  onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) => (
  <motion.div
    initial={{ y: 18, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
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
      01 / Recuperar acceso
    </div>

    <h2
      className="mb-3 tracking-[-0.03em]"
      style={{
        fontSize: "clamp(34px, 4.2vw, 46px)",
        fontWeight: 600,
        lineHeight: 1.02,
        color: "#1A1612",
      }}
    >
      Recupera tu{" "}
      <span style={{ ...FONT_SERIF, color: TOKEN.accent }}>cuenta</span>.
    </h2>
    <p
      className="mb-9 max-w-[40ch] text-[15px] leading-[1.55]"
      style={{ color: "#5C544A" }}
    >
      Introduce el email asociado a tu cuenta de Pasify. Te enviamos un enlace seguro para crear una contraseña nueva en segundos.
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
      <div
        className="h-px flex-1"
        style={{ background: "rgba(38,33,28,0.15)" }}
      />
      <span>* envío firmado *</span>
      <div
        className="h-px flex-1"
        style={{ background: "rgba(38,33,28,0.15)" }}
      />
    </div>

    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="email"
          className="mb-2 block"
          style={{
            ...FONT_MONO,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#3D3327",
            fontWeight: 500,
          }}
        >
          Email asociado
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "#8A8275" }}
          />
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[52px] w-full rounded-2xl border bg-white pl-11 pr-4 text-[15px] outline-none transition-all"
            style={{
              borderColor: "rgba(38,33,28,0.16)",
              color: "#1A1612",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.4), 0 1px 2px rgba(38,33,28,.04)",
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = TOKEN.accent;
              e.currentTarget.style.boxShadow = `0 0 0 4px rgba(232,84,42,.15), inset 0 1px 0 rgba(255,255,255,.4)`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "rgba(38,33,28,0.16)";
              e.currentTarget.style.boxShadow =
                "inset 0 1px 0 rgba(255,255,255,.4), 0 1px 2px rgba(38,33,28,.04)";
            }}
          />
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.985, y: 1 }}
        type="submit"
        disabled={loading}
        className="pasify-cta group relative flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium text-white transition-all disabled:opacity-60"
        style={{
          background:
            "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
          letterSpacing: "-0.005em",
          textShadow: "0 1px 1px rgba(80,20,5,.22)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)",
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.filter = "brightness(1.05)";
            e.currentTarget.style.boxShadow =
              "inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(80,20,5,.25), 0 10px 22px -4px rgba(232,84,42,.6), 0 22px 44px -10px rgba(184,56,26,.55)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "";
          e.currentTarget.style.filter = "";
          e.currentTarget.style.boxShadow =
            "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5), 0 14px 32px -10px rgba(184,56,26,.5)";
        }}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Enviando enlace seguro…</span>
          </>
        ) : (
          <>
            <span>Enviar enlace de recuperación</span>
            <ArrowRight className="pasify-arrow h-4 w-4" />
          </>
        )}
      </motion.button>

      {/* Editorial bullets — soft trust */}
      <ul
        className="mt-6 space-y-2.5"
        style={{
          ...FONT_MONO,
          fontSize: 11,
          letterSpacing: "0.06em",
          color: "#5C544A",
        }}
      >
        <TrustLine>El enlace caduca en <strong style={{ color: "#1A1612" }}>60 minutos</strong></TrustLine>
        <TrustLine>Solo funciona una vez · uso único</TrustLine>
        <TrustLine>No revelamos si el email existe — siempre verás éxito</TrustLine>
      </ul>
    </form>

    {/* Editorial divider */}
    <hr
      className="my-8 border-0"
      style={{
        height: 1,
        background:
          "linear-gradient(to right, transparent, rgba(38,33,28,0.15), transparent)",
      }}
    />

    <div className="flex items-center justify-between">
      <Link
        to="/login"
        className="group inline-flex items-center gap-1.5 transition-colors"
        style={{
          ...FONT_MONO,
          fontSize: 11.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#5C544A",
        }}
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        Volver al login
      </Link>
      <Link
        to="/register-client"
        className="transition-colors"
        style={{
          ...FONT_MONO,
          fontSize: 11.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: TOKEN.accentDeep,
        }}
      >
        Crear cuenta →
      </Link>
    </div>
  </motion.div>
);

const TrustLine = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-start gap-2.5">
    <span
      className="mt-[7px] inline-block h-1 w-1 flex-shrink-0 rounded-full"
      style={{ background: TOKEN.accent }}
    />
    <span>{children}</span>
  </li>
);

const SuccessState = ({
  email,
  expiresIn,
  resendCooldown,
  loading,
  onResend,
  onChangeEmail,
}: {
  email: string;
  expiresIn: string | null;
  resendCooldown: number;
  loading: boolean;
  onResend: () => void;
  onChangeEmail: () => void;
}) => (
  <motion.div
    initial={{ y: 14, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
  >
    {/* Success eyebrow with pulse */}
    <div
      className="mb-5 inline-flex items-center gap-3 rounded-full border px-3.5 py-1.5"
      style={{
        ...FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "#1F6A3F",
        borderColor: "rgba(77,184,122,.32)",
        background: "rgba(77,184,122,.10)",
      }}
    >
      <span className="relative inline-flex h-2 w-2">
        <span
          className="pasify-anim absolute inline-flex h-full w-full rounded-full"
          style={{
            background: TOKEN.success,
            opacity: 0.5,
            animation: "pasify-pulse 2.4s infinite",
          }}
        />
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ background: TOKEN.success }}
        />
      </span>
      02 / Enlace enviado
    </div>

    <h2
      className="mb-3 tracking-[-0.03em]"
      style={{
        fontSize: "clamp(34px, 4.2vw, 46px)",
        fontWeight: 600,
        lineHeight: 1.02,
        color: "#1A1612",
      }}
    >
      Revisa tu{" "}
      <span style={{ ...FONT_SERIF, color: TOKEN.accent }}>bandeja</span>.
    </h2>
    <p
      className="mb-8 max-w-[42ch] text-[15px] leading-[1.55]"
      style={{ color: "#5C544A" }}
    >
      Hemos enviado un enlace firmado a{" "}
      <span style={{ color: "#1A1612", fontWeight: 600 }}>{email}</span>. Ábrelo en este mismo dispositivo y elige una contraseña nueva.
    </p>

    {/* Premium confirmation card */}
    <div
      className="relative overflow-hidden rounded-2xl border"
      style={{
        borderColor: "rgba(232,84,42,0.18)",
        background:
          "linear-gradient(160deg, rgba(255,237,224,0.94) 0%, rgba(255,255,255,0.92) 100%)",
        boxShadow:
          "0 22px 50px -18px rgba(232,84,42,.22), 0 4px 12px -4px rgba(184,56,26,.08)",
      }}
    >
      {/* Top status row */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,.08) 0%, transparent 100%)",
          borderBottom: "1px solid rgba(232,84,42,0.10)",
        }}
      >
        <div
          className="inline-flex items-center gap-2"
          style={{
            ...FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKEN.accentDeep,
          }}
        >
          <Mail size={11} />
          Email entregado
        </div>
        <div
          style={{
            ...FONT_MONO,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "#8A8275",
          }}
        >
          /smtp · ok
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-start gap-4">
          <div
            className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl"
            style={{
              background:
                "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,.45), 0 6px 16px -4px rgba(232,84,42,.55)",
            }}
          >
            <CheckCircle2 className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#1A1612",
                letterSpacing: "-0.01em",
              }}
            >
              Enlace firmado y enviado
            </div>
            <p
              className="mt-1 text-sm leading-[1.55]"
              style={{ color: "#5C544A" }}
            >
              Si no lo ves en 1–2 minutos, revisa spam o promociones. El enlace es de un solo uso.
            </p>
          </div>
        </div>

        {/* Countdown */}
        <div
          className="mt-5 grid grid-cols-[auto_1fr] items-center gap-4 rounded-xl border px-4 py-3"
          style={{
            borderColor: "rgba(232,84,42,0.15)",
            background: "rgba(255,255,255,0.55)",
          }}
        >
          <div
            style={{
              ...FONT_MONO,
              fontSize: 9.5,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#8A8275",
              lineHeight: 1.3,
            }}
          >
            Caduca
            <br />
            en
          </div>
          <div
            className="text-right"
            style={{
              ...FONT_MONO,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "#1A1612",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {expiresIn ?? "01 : 00 : 00"}
          </div>
        </div>
      </div>
    </div>

    {/* Actions */}
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={onResend}
        disabled={resendCooldown > 0 || loading}
        className="pasify-cta group inline-flex h-12 items-center justify-center gap-2 rounded-full border text-[13px] font-medium transition-all disabled:opacity-50"
        style={{
          ...FONT_MONO,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          borderColor: "rgba(38,33,28,0.18)",
          background: "rgba(255,255,255,0.6)",
          color: "#1A1612",
          backdropFilter: "blur(8px)",
        }}
        onMouseEnter={(e) => {
          if (resendCooldown <= 0 && !loading) {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.borderColor = "rgba(232,84,42,0.4)";
            e.currentTarget.style.background = "rgba(232,84,42,0.06)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "";
          e.currentTarget.style.borderColor = "rgba(38,33,28,0.18)";
          e.currentTarget.style.background = "rgba(255,255,255,0.6)";
        }}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 transition-transform group-hover:-rotate-180" style={{ transitionDuration: "500ms" }} />
        )}
        {resendCooldown > 0
          ? `Reenviar (${resendCooldown}s)`
          : "Reenviar enlace"}
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={onChangeEmail}
        className="pasify-cta inline-flex h-12 items-center justify-center gap-2 rounded-full text-[13px] font-medium transition-all"
        style={{
          ...FONT_MONO,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          background: "transparent",
          color: "#5C544A",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#1A1612";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#5C544A";
        }}
      >
        Cambiar email
        <ArrowRight className="pasify-arrow h-3.5 w-3.5" />
      </motion.button>
    </div>

    <hr
      className="my-7 border-0"
      style={{
        height: 1,
        background:
          "linear-gradient(to right, transparent, rgba(38,33,28,0.15), transparent)",
      }}
    />

    <Link
      to="/login"
      className="group inline-flex items-center gap-1.5 transition-colors"
      style={{
        ...FONT_MONO,
        fontSize: 11.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "#5C544A",
      }}
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
      Volver al login
    </Link>
  </motion.div>
);

export default ResetPassword;
