import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { RotateCcw, Home, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.webp";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const PartnerCancel = () => {
  const navigate = useNavigate();

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}
    >
      {/* Background glows (match landing) */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-sky-200/40 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-32 right-0 h-[500px] w-[500px] translate-x-1/4 rounded-full bg-cyan-100/40 blur-[120px]" />

      {/* Header minimal */}
      <div className="absolute top-6 left-1/2 z-10 -translate-x-1/2">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <img
            src={logo}
            alt="Pasify"
            className="h-9 w-9 rounded-xl"
            style={{ filter: "drop-shadow(0 4px 10px rgba(14,165,233,0.25))" }}
          />
          <span className="text-[15px] font-bold tracking-tight">
            Student<span style={{ ...serif, color: "#0ea5e9", fontSize: 18, margin: "0 1px" }}>&apos;s</span>Life
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
          className="pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full opacity-60"
          style={{ background: "radial-gradient(closest-side, rgba(14,165,233,0.25), transparent 70%)" }}
        />

        {/* Eyebrow */}
        <div className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
            <ShieldCheck className="h-3 w-3 text-sky-500" />
            Ningún cargo realizado
          </span>
        </div>

        {/* Icon */}
        <motion.div
          initial={{ scale: 0, rotate: 30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 180, damping: 14 }}
          className="relative mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
            boxShadow: "0 20px 50px -10px rgba(14,165,233,0.35)",
          }}
        >
          <RotateCcw className="relative h-9 w-9 text-sky-600" strokeWidth={2.5} />
        </motion.div>

        <h1 className="mb-3 text-[34px] font-bold leading-[1.05] tracking-tight">
          Pago <span style={serif} className="text-sky-600">cancelado</span>
        </h1>

        <p className="mx-auto mb-8 max-w-sm text-[14px] leading-relaxed text-slate-600">
          Sin problema. No se ha procesado el pago y no te hemos cargado nada.
          Puedes intentarlo de nuevo cuando quieras.
        </p>

        <div className="space-y-3">
          <Button
            size="lg"
            onClick={() => navigate("/partner/subscribe")}
            className="group h-12 w-full rounded-2xl text-base font-semibold text-white transition-all"
            style={{
              background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
              boxShadow: "0 15px 40px -10px rgba(14,165,233,0.5)",
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reintentar
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate("/")}
            className="h-12 w-full rounded-2xl border-slate-200 bg-white text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
          >
            <Home className="mr-2 h-4 w-4" />
            Volver al inicio
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default PartnerCancel;
