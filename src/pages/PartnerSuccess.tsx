import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { ArrowRight, Mail, FileText, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import logo from "@/assets/logo.webp";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const PartnerSuccess = () => {
  const navigate = useNavigate();
  // Hook centralizado: lee partner_subscriptions por org_id (post Fase 3).
  // Le pedimos refetch repetidamente hasta que el webhook stripe-webhook
  // marque la subscription como active/trialing. Si en 8s no llega, fallback
  // a dashboard — PartnerGate hará el redirect correcto si todavía no.
  const partnerSub = usePartnerSubscription();

  useEffect(() => {
    // Confetti de bienvenida (Pasify terracota).
    const duration = 900;
    const end = Date.now() + duration;
    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ["#E8542A", "#FF7A4D", "#B8381A", "#FBE4D3"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ["#E8542A", "#FF7A4D", "#B8381A", "#FBE4D3"],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }, []);

  // Polling de hasAccess vía refetch del hook. El webhook stripe-webhook
  // (edge function en producción) actualiza partner_subscriptions cuando
  // recibe `checkout.session.completed`. No llamamos sync-session-test
  // (función legacy/test) — el webhook canónico es suficiente.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) navigate("/login", { replace: true });
        return;
      }

      for (let i = 0; i < 10 && !cancelled; i++) {
        await partnerSub.refetch();
        if (partnerSub.hasAccess) {
          if (!cancelled) navigate("/partner-dashboard", { replace: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }

      // Fallback: manda a la dashboard — PartnerGate gestionará el redirect
      // si todavía no hay acceso (a /partner/choose-plan).
      if (!cancelled) navigate("/partner-dashboard", { replace: true });
    };

    const t = setTimeout(run, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}
    >
      {/* Background glows in linea con la landing */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-sky-200/40 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-32 right-0 h-[500px] w-[500px] translate-x-1/4 rounded-full bg-cyan-100/40 blur-[120px]" />

      {/* Header minimal */}
      <div className="absolute top-6 left-1/2 z-10 -translate-x-1/2">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <img
            src={logo}
            alt="Pasify"
            className="h-9 w-9 rounded-xl"
            style={{ filter: "drop-shadow(0 4px 10px rgba(232,84,42,0.25))" }}
          />
          <span className="text-[15px] font-bold tracking-tight">
            Pa<span style={{ ...serif, color: "#E8542A", fontSize: 18, margin: "0 1px" }}>si</span>fy
          </span>
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-[32px] border border-slate-200 bg-white p-10 text-center shadow-[0_40px_100px_-30px_rgba(14,165,233,0.4)]"
      >
        {/* Decorative corner glow */}
        <div
          className="pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full opacity-70"
          style={{ background: "radial-gradient(closest-side, rgba(14,165,233,0.3), transparent 70%)" }}
        />

        {/* Eyebrow */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
            <Sparkles className="h-3 w-3 text-sky-500" />
            Pago completado
          </span>
        </div>

        {/* Check icon */}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 180, damping: 14 }}
          className="relative mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
            boxShadow: "0 20px 50px -10px rgba(14,165,233,0.5)",
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.25), transparent)",
            }}
          />
          <Check className="relative h-10 w-10 text-white" strokeWidth={3} />
        </motion.div>

        {/* Title */}
        <h1 className="mb-3 text-[36px] font-bold leading-[1.05] tracking-tight">
          Suscripción{" "}
          <span style={serif} className="text-sky-600">activada</span>
        </h1>

        <p className="mx-auto mb-8 max-w-sm text-[14px] leading-relaxed text-slate-600">
          Bienvenido a Pasify Partner. Te hemos enviado un email con la
          confirmación y tu primera factura. Ya puedes empezar a gestionar tu
          negocio.
        </p>

        {/* Info cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 text-left">
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-900">Email enviado</div>
              <div className="text-[11px] text-slate-500">Confirmación + acceso</div>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-900">Factura PDF</div>
              <div className="text-[11px] text-slate-500">Adjunta al email</div>
            </div>
          </div>
        </div>

        {/* CTA primary */}
        <Button
          size="lg"
          onClick={() => navigate("/partner-dashboard")}
          className="group h-12 w-full rounded-2xl text-base font-semibold text-white transition-all"
          style={{
            background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
            boxShadow: "0 15px 40px -10px rgba(14,165,233,0.5)",
          }}
        >
          Ir al panel
          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>

        <button
          onClick={() => navigate("/partner/manage")}
          className="mt-5 text-[12px] text-slate-500 underline-offset-4 hover:text-sky-600 hover:underline"
        >
          Gestionar suscripción
        </button>
      </motion.div>
    </div>
  );
};

export default PartnerSuccess;
