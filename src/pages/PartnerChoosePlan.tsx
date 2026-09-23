import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  Rocket,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Wordmark from "@/components/Wordmark";

/**
 * PartnerChoosePlan — alta del plan del local.
 *
 * Pasify ya no tiene planes de pago para locales (se retiró Premium y la
 * prueba gratuita): todos los locales usan el plan gratuito y Pasify cobra
 * una comisión por entrada vendida. Aquí no se muestra ningún precio, en
 * ninguna plataforma. PartnerGate manda a esta pantalla a cualquier local
 * sin plan activo; "Empezar gratis" llama a `claim_partner_free_plan`
 * (crea la organización si falta y deja el plan gratuito activo, idempotente)
 * y entra al panel.
 */

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
  ink: "#1A1612",
  ink2: "#5C544A",
  ink3: "#8A8275",
  line2: "rgba(26,22,18,0.18)",
  cardBg: "#FBF7EE",
  accent: "#E8542A",
  success: "#4DB87A",
};

const CREAM_BG = [
  "radial-gradient(55% 75% at 18% 22%, #FBE4D3 0%, transparent 60%)",
  "radial-gradient(45% 70% at 85% 30%, #FFE9C8 0%, transparent 60%)",
  "radial-gradient(50% 50% at 70% 92%, #F4DDC8 0%, transparent 60%)",
  "linear-gradient(180deg,#F7F3EC 0%, #F4EEE2 100%)",
].join(", ");

const GRAIN_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.30 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const FEATURES = [
  "Crea y publica tus eventos",
  "Tipos de entrada con precio y cupo",
  "Escáner QR para validar en la puerta",
  "Asistentes y check-ins en tiempo real",
  "Métricas de ventas de tus eventos",
  "Chat con el equipo de Pasify",
];

const PartnerChoosePlan = () => {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (claiming) return;
    setClaiming(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("claim_partner_free_plan");
      if (rpcError) throw rpcError;
      await supabase.auth.refreshSession();
      navigate("/partner-dashboard", { replace: true });
    } catch (err: unknown) {
      console.error("claim_partner_free_plan:", err);
      setError(
        "No hemos podido activar tu cuenta. Revisa tu conexión y vuelve a intentarlo."
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    navigate("/login", { replace: true });
  };

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-x-hidden"
      style={{ ...FONT_DISPLAY, background: CREAM_BG, color: TOKEN.ink }}
    >
      <style>{`
        .pasify-arrow { display:inline-block; transition: transform .25s cubic-bezier(.4,0,.2,1); }
        .pasify-cta:hover .pasify-arrow { transform: translateX(3px); }
        @media (prefers-reduced-motion: reduce) { .pasify-arrow { transition: none !important; } }
      `}</style>

      {/* Grain overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: GRAIN_SVG, mixBlendMode: "multiply", opacity: 0.55 }}
      />

      {/* Header */}
      <header
        className="relative z-10 flex items-center justify-between px-6 md:px-12"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
      >
        <Wordmark height={28} />
        <button
          type="button"
          onClick={handleLogout}
          className="text-[12px] font-medium underline-offset-4 hover:underline"
          style={{ color: TOKEN.ink2 }}
        >
          Cerrar sesión
        </button>
      </header>

      <main className="relative z-10 flex flex-1 items-center px-6 py-8 md:px-12">
        <div className="mx-auto w-full max-w-xl">
          <div
            className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
            style={{ ...FONT_MONO, letterSpacing: "0.22em", color: TOKEN.accent }}
          >
            <span className="inline-block h-px w-5" style={{ background: TOKEN.accent }} />
            Tu cuenta de local
          </div>
          <h1
            className="text-[clamp(30px,6vw,48px)] font-bold leading-[1.05] tracking-tight"
            style={{ color: TOKEN.ink }}
          >
            Empieza{" "}
            <span style={FONT_SERIF} className="text-[1.05em]">
              gratis
            </span>
            .
          </h1>
          <p
            className="mt-3 text-[14.5px] leading-relaxed md:text-[15.5px]"
            style={{ color: TOKEN.ink2 }}
          >
            Pasify es gratis para locales: sin cuotas. Solo se aplica una comisión por
            entrada vendida.
          </p>

          <article
            className="mt-6 rounded-[28px] border p-5 md:p-7"
            style={{
              background: TOKEN.cardBg,
              borderColor: TOKEN.line2,
              boxShadow: "0 22px 50px -28px rgba(26,22,18,0.18)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="grid h-11 w-11 place-items-center rounded-xl"
                style={{ background: "rgba(26,22,18,0.08)", color: TOKEN.ink }}
              >
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div
                  className="text-[10px] uppercase"
                  style={{ ...FONT_MONO, letterSpacing: "0.22em", color: TOKEN.ink3 }}
                >
                  Incluido
                </div>
                <h2 className="text-xl font-bold tracking-tight md:text-2xl">Todo el panel del local</h2>
              </div>
            </div>

            <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-[13px] leading-snug"
                  style={{ color: TOKEN.ink2 }}
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TOKEN.success }} />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-3 rounded-2xl border p-3"
                style={{ borderColor: "rgba(232,84,42,0.35)", background: "rgba(232,84,42,0.08)" }}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TOKEN.accent }} />
                <div className="min-w-0 flex-1 text-[13px] leading-snug" style={{ color: TOKEN.ink }}>
                  {error}
                </div>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={claiming}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold disabled:opacity-60"
                  style={{ borderColor: TOKEN.line2, color: TOKEN.ink }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reintentar
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleStart}
              disabled={claiming}
              className="pasify-cta mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: TOKEN.ink,
                color: "#F7F3EC",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 30px -12px rgba(26,22,18,0.55)",
              }}
            >
              {claiming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Activando…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  Empezar gratis
                  <ArrowRight className="pasify-arrow h-4 w-4" />
                </>
              )}
            </button>
            <p
              className="mt-2 text-center text-[10.5px] uppercase"
              style={{ ...FONT_MONO, letterSpacing: "0.18em", color: TOKEN.ink3 }}
            >
              Entras al panel al momento
            </p>
          </article>
        </div>
      </main>
    </div>
  );
};

export default PartnerChoosePlan;
