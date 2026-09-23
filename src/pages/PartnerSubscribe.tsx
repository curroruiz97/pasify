import { useNavigate } from "react-router-dom";
import { ArrowRight, BadgeCheck } from "lucide-react";
import Wordmark from "@/components/Wordmark";

/**
 * Pantalla informativa para las rutas del antiguo plan de pago de locales
 * (/partner/subscribe, /partner/manage, /partner/success y /partner/cancel).
 *
 * Premium y la prueba gratuita se retiraron: todos los locales tienen el plan
 * gratuito y Pasify cobra una comisión por entrada vendida. Las rutas se
 * conservan porque hay enlaces guardados, correos antiguos y retornos de
 * Stripe que apuntan a ellas. Aquí no hay ninguna llamada a Stripe ni ningún
 * precio, en ninguna plataforma.
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

const CREAM_BG = [
  "radial-gradient(60% 80% at 18% 20%, #FBE4D3 0%, transparent 60%)",
  "radial-gradient(45% 70% at 85% 30%, #FFE9C8 0%, transparent 60%)",
  "radial-gradient(50% 50% at 70% 90%, #F4DDC8 0%, transparent 60%)",
  "linear-gradient(180deg,#F7F3EC 0%, #F4EEE2 100%)",
].join(", ");

const PartnerSubscribe = () => {
  const navigate = useNavigate();

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 py-10"
      style={{
        ...FONT_DISPLAY,
        background: CREAM_BG,
        color: "#1A1612",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 40px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 40px)",
      }}
    >
      <div className="mb-8">
        <Wordmark height={30} />
      </div>

      <div
        className="w-full max-w-md rounded-3xl border p-8"
        style={{
          borderColor: "rgba(38,33,28,0.10)",
          background: "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(247,243,236,0.92) 100%)",
          boxShadow: "0 32px 70px -28px rgba(232,84,42,.25), 0 4px 12px -4px rgba(184,56,26,.08)",
        }}
      >
        <div
          className="mb-5 grid h-12 w-12 place-items-center rounded-2xl"
          style={{ background: "rgba(77,184,122,0.14)", color: "#2F8A57" }}
        >
          <BadgeCheck className="h-6 w-6" />
        </div>

        <div
          className="mb-2 inline-flex items-center gap-2 text-[10.5px] uppercase"
          style={{ ...FONT_MONO, letterSpacing: "0.2em", color: "#B8381A" }}
        >
          <span className="inline-block h-px w-6" style={{ background: "#E8542A" }} />
          Plan del local
        </div>

        <h1 className="mb-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">
          Tu plan es <span style={{ ...FONT_SERIF, color: "#E8542A" }}>gratuito</span>
        </h1>
        <p className="text-[14.5px] leading-[1.6]" style={{ color: "#5C544A" }}>
          Pasify ya no tiene planes de pago para locales. Tu plan es gratuito: sin cuotas.
          Solo se aplica una comisión por entrada vendida.
        </p>

        <button
          type="button"
          onClick={() => navigate("/partner-dashboard", { replace: true })}
          className="group mt-7 flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[14.5px] font-medium text-white transition"
          style={{
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,.45), inset 0 -1px 0 rgba(80,20,5,.22), 0 6px 16px -4px rgba(232,84,42,.5)",
          }}
        >
          Ir al panel
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
};

export default PartnerSubscribe;
