import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import {
  ArrowRight,
  Check,
  CreditCard,
  Loader2,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import Wordmark from "@/components/Wordmark";

/**
 * PartnerChoosePlan — selector de plan en una sola pantalla.
 *
 * Cambios vs. versión anterior:
 *  - 2 planes claros: Gratuita (sin Stripe) y Premium (con Stripe).
 *  - Free → llama RPC `claim_partner_free_plan` y navega a dashboard.
 *    Crea org placeholder si hace falta (la migración 0040 hace UPSERT en
 *    `partner_subscriptions` con `plan_code='free'`, `status='active'`).
 *  - Premium → checkout Stripe (mismo flow que antes).
 *  - Layout cream Pasify pero con `max-h: 100dvh` y `overflow:hidden`:
 *    cabe entero en la pantalla sin scroll.
 *  - Ancho generoso (max-w 7xl), 2 columnas en desktop, stack en mobile.
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
  line: "rgba(26,22,18,0.10)",
  line2: "rgba(26,22,18,0.18)",
  cardBgFree: "#FBF7EE",
  cardBgPremium: "#1A0F08",
  accent: "#E8542A",
  accent2: "#FF7A4D",
  accentDeep: "#B8381A",
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

const PartnerChoosePlan = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();

  const [claimingFree, setClaimingFree] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);

  // ---------------- Handlers ----------------
  const handleClaimFree = async () => {
    if (claimingFree || startingCheckout) return;
    setClaimingFree(true);
    try {
      const { data, error } = await supabase.rpc("claim_partner_free_plan");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("Respuesta vacía del servidor");

      toast({
        title: "Plan gratuito activado",
        description: "Acceso completo a Pasify. Cuando quieras, pasa a Premium.",
      });
      await supabase.auth.refreshSession();
      navigate("/partner-dashboard", { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo activar el plan gratuito";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setClaimingFree(false);
    }
  };

  const handleGoPremium = async () => {
    if (claimingFree || startingCheckout) return;
    if (isNative) {
      toast({
        title: "Activa Premium desde la web",
        description: "Accede a pasifyy.vercel.app con tu cuenta para completar el pago.",
      });
      return;
    }
    setStartingCheckout(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Sesión expirada",
          description: "Vuelve a iniciar sesión.",
          variant: "destructive",
        });
        navigate("/login");
        return;
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-create-checkout`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
        } catch (_) {
          /* noop */
        }
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const features = [
    "Eventos ilimitados",
    "Tickets, aforo y check-in",
    "Asistentes en tiempo real",
    "QR escáner integrado",
    "Reports + exportación CSV",
    "Stripe Connect listo",
  ];

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        ...FONT_DISPLAY,
        background: CREAM_BG,
        color: TOKEN.ink,
        minHeight: "100dvh",
        maxHeight: "100dvh",
        height: "100dvh",
      }}
    >
      <style>{`
        @keyframes pasify-pulse { 0% { box-shadow: 0 0 0 0 rgba(232,84,42,.55) } 70% { box-shadow: 0 0 0 12px rgba(232,84,42,0) } 100% { box-shadow: 0 0 0 0 rgba(232,84,42,0) } }
        .pasify-arrow { display:inline-block; transition: transform .25s cubic-bezier(.4,0,.2,1); }
        .pasify-cta:hover .pasify-arrow { transform: translateX(3px); }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      {/* Grain overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: GRAIN_SVG, mixBlendMode: "multiply", opacity: 0.55 }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-5 md:px-12 md:pt-7">
        <div className="flex items-center gap-3">
          <Wordmark height={28} />
          <span
            className="hidden rounded-full border px-2.5 py-0.5 text-[10px] uppercase sm:inline-flex"
            style={{
              ...FONT_MONO,
              letterSpacing: "0.22em",
              color: TOKEN.accent,
              borderColor: "rgba(232,84,42,0.4)",
              background: "rgba(232,84,42,0.08)",
            }}
          >
            · Partner · Onboarding
          </span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-[12px] font-medium underline-offset-4 hover:underline"
          style={{ color: TOKEN.ink2 }}
        >
          Cerrar sesión
        </button>
      </header>

      {/* Main content — fills available height between header and footer */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-6 py-5 md:px-12 md:py-7">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
          {/* Title section — compact */}
          <div className="mb-4 max-w-3xl md:mb-6">
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...FONT_MONO, letterSpacing: "0.22em", color: TOKEN.accent }}
            >
              <span className="inline-block h-px w-5" style={{ background: TOKEN.accent }} />
              Elige tu plan
            </div>
            <h1
              className="text-[clamp(28px,4.5vw,52px)] font-bold leading-[1.05] tracking-tight"
              style={{ color: TOKEN.ink }}
            >
              Empieza{" "}
              <span style={FONT_SERIF} className="text-[1.05em]">
                gratis
              </span>
              , crece cuando quieras.
            </h1>
            <p
              className="mt-2 max-w-2xl text-[13.5px] leading-relaxed md:text-[15px]"
              style={{ color: TOKEN.ink2 }}
            >
              Activa tu cuenta y entra al dashboard al instante. El plan gratuito ya incluye
              todas las funciones del producto. Cuando vendas a escala, pasa a Premium en 1 click.
            </p>
          </div>

          {/* Plan cards — fill remaining space */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
            {/* ============ FREE ============ */}
            <article
              className="relative flex min-h-0 flex-col overflow-hidden rounded-[28px] border p-5 md:p-7"
              style={{
                background: TOKEN.cardBgFree,
                borderColor: TOKEN.line2,
                boxShadow: "0 22px 50px -28px rgba(26,22,18,0.18)",
              }}
            >
              <header className="flex items-center justify-between gap-3">
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
                      Plan
                    </div>
                    <h2 className="text-xl font-bold tracking-tight md:text-2xl">
                      Cuenta gratuita
                    </h2>
                  </div>
                </div>
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] uppercase"
                  style={{
                    ...FONT_MONO,
                    letterSpacing: "0.18em",
                    borderColor: "rgba(77,184,122,0.45)",
                    background: "rgba(77,184,122,0.10)",
                    color: TOKEN.success,
                  }}
                >
                  Sin tarjeta
                </span>
              </header>

              {/* Price */}
              <div className="mt-4 flex items-end gap-2">
                <span
                  className="text-[clamp(40px,6vw,64px)] font-bold leading-none tracking-tight"
                  style={{ color: TOKEN.ink }}
                >
                  0€
                </span>
                <span
                  className="pb-2 text-[12px]"
                  style={{ ...FONT_MONO, color: TOKEN.ink3 }}
                >
                  /siempre
                </span>
              </div>
              <p className="mt-1 text-[12.5px]" style={{ color: TOKEN.ink2 }}>
                Acceso inmediato al dashboard. Sin compromiso, sin caducidad.
              </p>

              {/* Features */}
              <ul className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {features.map((f) => (
                  <li
                    key={`free-${f}`}
                    className="flex items-start gap-2 text-[13px] leading-snug"
                    style={{ color: TOKEN.ink2 }}
                  >
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{ color: TOKEN.success }}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                type="button"
                onClick={handleClaimFree}
                disabled={claimingFree || startingCheckout}
                className="pasify-cta mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: TOKEN.ink,
                  color: "#F7F3EC",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 30px -12px rgba(26,22,18,0.55)",
                }}
              >
                {claimingFree ? (
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
                Entra al dashboard al instante
              </p>
            </article>

            {/* ============ PREMIUM ============ */}
            <article
              className="relative flex min-h-0 flex-col overflow-hidden rounded-[28px] p-5 md:p-7"
              style={{
                background:
                  "linear-gradient(140deg, #2A150A 0%, #1A0F08 55%, #0E0805 100%)",
                color: "#F7F3EC",
                boxShadow:
                  "0 22px 50px -22px rgba(232,84,42,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
              }}
            >
              {/* Decorative glow */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
                style={{ background: "rgba(232,84,42,0.22)", filter: "blur(80px)" }}
              />

              <header className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-xl"
                    style={{
                      background:
                        "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      color: "#fff",
                      boxShadow: "0 6px 16px -6px rgba(232,84,42,0.55)",
                    }}
                  >
                    <Star className="h-5 w-5" />
                  </div>
                  <div>
                    <div
                      className="text-[10px] uppercase"
                      style={{
                        ...FONT_MONO,
                        letterSpacing: "0.22em",
                        color: "rgba(247,243,236,0.6)",
                      }}
                    >
                      Plan
                    </div>
                    <h2 className="text-xl font-bold tracking-tight md:text-2xl">
                      Partner Premium
                    </h2>
                  </div>
                </div>
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] uppercase"
                  style={{
                    ...FONT_MONO,
                    letterSpacing: "0.18em",
                    borderColor: "rgba(232,84,42,0.45)",
                    background: "rgba(232,84,42,0.18)",
                    color: "#FFC9B0",
                  }}
                >
                  Elección popular
                </span>
              </header>

              {/* Price */}
              <div className="relative mt-4 flex items-end gap-2">
                <span
                  className="text-[clamp(40px,6vw,64px)] font-bold leading-none tracking-tight"
                  style={{ color: "#fff" }}
                >
                  29,99€
                </span>
                <span
                  className="pb-2 text-[12px]"
                  style={{ ...FONT_MONO, color: "rgba(247,243,236,0.55)" }}
                >
                  /mes + IVA
                </span>
              </div>
              <p
                className="relative mt-1 text-[12.5px]"
                style={{ color: "rgba(247,243,236,0.7)" }}
              >
                Factura fiscal, soporte prioritario y todas las funcionalidades
                Premium futuras incluidas.
              </p>

              {/* Features */}
              <ul className="relative mt-4 grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {features.map((f) => (
                  <li
                    key={`prem-${f}`}
                    className="flex items-start gap-2 text-[13px] leading-snug"
                    style={{ color: "rgba(247,243,236,0.85)" }}
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFC9B0]" />
                    <span>{f}</span>
                  </li>
                ))}
                <li
                  className="flex items-start gap-2 text-[13px] leading-snug sm:col-span-2"
                  style={{ color: "rgba(247,243,236,0.85)" }}
                >
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFC9B0]" />
                  <span>Soporte prioritario · facturación fiscal · cancela cuando quieras</span>
                </li>
              </ul>

              {/* CTA */}
              <button
                type="button"
                onClick={handleGoPremium}
                disabled={claimingFree || startingCheckout || isNative}
                className="pasify-cta relative mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  color: "#fff",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                }}
              >
                {startingCheckout ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Abriendo Stripe…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Activar Premium
                    <ArrowRight className="pasify-arrow h-4 w-4" />
                  </>
                )}
              </button>
              <p
                className="relative mt-2 text-center text-[10.5px] uppercase"
                style={{
                  ...FONT_MONO,
                  letterSpacing: "0.18em",
                  color: "rgba(247,243,236,0.55)",
                }}
              >
                Pago seguro vía Stripe · cancela cuando quieras
              </p>
            </article>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-6 pb-5 md:px-12 md:pb-6">
        <div
          className="inline-flex items-center gap-3 text-[10.5px] uppercase"
          style={{ ...FONT_MONO, letterSpacing: "0.18em", color: TOKEN.ink3 }}
        >
          <Zap className="h-3 w-3" style={{ color: TOKEN.accent }} />
          Acceso inmediato
          <span className="opacity-40">·</span>
          GDPR / Stripe verified
          <span className="opacity-40">·</span>
          Soporte ES &lt; 5 min
        </div>
        <span
          className="text-[10.5px] uppercase"
          style={{ ...FONT_MONO, letterSpacing: "0.18em", color: TOKEN.ink3 }}
        >
          Puedes cambiar de plan en cualquier momento desde Configuración
        </span>
      </footer>
    </div>
  );
};

export default PartnerChoosePlan;
