import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import {
  Loader2,
  ExternalLink,
  CreditCard,
  Pencil,
  Ban,
  ArrowLeft,
  Lock,
  ArrowRight,
  Sparkles,
  Clock,
  ShieldCheck,
  RefreshCw,
  Receipt,
  Gift,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { openWebWithAuth } from "@/lib/openWebAuth";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import logo from "@/assets/logo.webp";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

const revealVariants = {
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { delay: i * 0.18, duration: 0.55 },
  }),
  hidden: { filter: "blur(10px)", y: -18, opacity: 0 },
};

const gridVariants = {
  visible: (i: number) => ({
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { delay: 0.6 + i * 0.08, duration: 0.45 },
  }),
  hidden: { filter: "blur(8px)", y: 14, opacity: 0 },
};

const PartnerManage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const pageRef = useRef<HTMLDivElement>(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login", { state: { redirectAfter: "/partner/manage" } });
      }
    })();
  }, [navigate]);

  // El hook resuelve internamente la org del caller vía useOrganization.
  const sub = usePartnerSubscription();

  const openPortal = async () => {
    setOpeningPortal(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Error", description: "Sesión expirada.", variant: "destructive" });
        return;
      }
      const portalFn = import.meta.env.VITE_STRIPE_TEST_MODE === "true"
        ? "stripe-create-portal-test"
        : "stripe-create-portal";
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${portalFn}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ returnUrl: `${window.location.origin}/#/partner/manage` }),
      });
      const raw = await resp.text();
      if (!resp.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.error || parsed?.message || raw;
        } catch (_) { /* noop */ }
        throw new Error(`${resp.status}: ${detail}`);
      }
      const data = JSON.parse(raw);
      if (!data?.url) throw new Error("Respuesta inesperada");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al acceder al portal";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setOpeningPortal(false);
    }
  };

  const openCheckout = async () => {
    if (isNative) {
      toast({
        title: "Activa desde la web",
        description: "Accede a pasifyy.vercel.app desde un navegador.",
      });
      return;
    }
    setOpeningCheckout(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Error", description: "Sesión expirada.", variant: "destructive" });
        return;
      }
      // Siempre stripe-create-checkout. Test vs live discrimina el server.
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
          successUrl: `${window.location.origin}/#/partner/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/#/partner/manage`,
        }),
      });
      const raw = await resp.text();
      if (!resp.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.error || parsed?.message || raw;
        } catch (_) { /* noop */ }
        throw new Error(`${resp.status}: ${detail}`);
      }
      const data = JSON.parse(raw);
      if (!data?.url) throw new Error("Respuesta inesperada");
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar el pago";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setOpeningCheckout(false);
    }
  };

  const getStatusMeta = () => {
    if (sub.loading) return null;
    if (sub.isAdminGranted) {
      return {
        label: "Acceso gratuito",
        sub: sub.adminGrantedUntil
          ? `Hasta el ${sub.adminGrantedUntil.toLocaleDateString("es-ES")}`
          : "Concedido por admin · ilimitado",
        dotColor: "#8b5cf6",
        cta: "grant",
      };
    }
    if (sub.status === "active") {
      return {
        label: "Suscripción activa",
        sub: sub.currentPeriodEnd
          ? `Se renueva el ${sub.currentPeriodEnd.toLocaleDateString("es-ES")}`
          : isNative
            ? "Todas las funciones disponibles"
            : "Pago mensual €29,99 + IVA",
        dotColor: "#10b981",
        cta: "portal",
      };
    }
    if (sub.isTrial) {
      return {
        label: "Prueba gratuita",
        sub: sub.daysLeft !== null && sub.daysLeft > 0
          ? `${sub.daysLeft} ${sub.daysLeft === 1 ? "día restante" : "días restantes"}`
          : "Último día",
        dotColor: "#0ea5e9",
        cta: "checkout",
      };
    }
    if (!sub.hasAccess) {
      return {
        label: "Sin acceso",
        sub: "Activa tu suscripción para continuar",
        dotColor: "#f43f5e",
        cta: "checkout",
      };
    }
    return null;
  };

  const meta = getStatusMeta();

  const quickActions = [
    { Icon: Receipt, title: "Facturas", desc: "Descarga todas tus facturas en PDF" },
    { Icon: CreditCard, title: "Método de pago", desc: "Actualiza tu tarjeta o datos bancarios" },
    { Icon: Pencil, title: "Datos de facturación", desc: "Cambia NIF, dirección o razón social" },
    { Icon: Ban, title: "Cancelar suscripción", desc: "Desde el portal Stripe al final del periodo" },
  ];

  return (
    <div
      ref={pageRef}
      className="relative min-h-screen overflow-hidden"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}
    >
      {/* Radial gradient background stile pricing-section */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(125% 125% at 50% 90%, #ffffff 40%, #0ea5e9 100%)",
          opacity: 0.22,
        }}
      />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-sky-200/40 blur-[140px]" />

      {/* Header */}
      <header className="relative z-20 mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <img
            src={logo}
            alt="StudentsLife"
            className="h-9 w-9 rounded-xl"
            style={{ filter: "drop-shadow(0 4px 10px rgba(14,165,233,0.25))" }}
          />
          <span className="text-[15px] font-bold tracking-tight">
            Student<span style={{ ...serif, color: "#0ea5e9", fontSize: 18, margin: "0 1px" }}>&apos;s</span>Life
          </span>
        </button>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3.5 py-2 text-xs font-medium text-slate-600 backdrop-blur transition hover:bg-white hover:text-sky-600"
        >
          <ArrowLeft className="h-3 w-3" />
          Volver
        </button>
      </header>

      <div className="relative z-10 mx-auto max-w-3xl px-6 pb-16 pt-6">
        {/* Eyebrow + title con animazioni */}
        <div className="mb-10 text-center">
          <TimelineContent
            as="div"
            animationNum={0}
            timelineRef={pageRef}
            customVariants={revealVariants}
            className="mb-4 flex items-center justify-center"
          >
            <Sparkles className="mr-2 h-4 w-4 fill-sky-500 text-sky-500" />
            <span className="font-medium uppercase tracking-[0.14em] text-[11px] text-sky-600">
              Portal Partner
            </span>
          </TimelineContent>

          <h1 className="mb-4 text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 md:text-5xl">
            <VerticalCutReveal
              splitBy="words"
              staggerDuration={0.14}
              staggerFrom="first"
              reverse
              containerClassName="justify-center"
              transition={{ type: "spring", stiffness: 250, damping: 40, delay: 0.3 }}
            >
              Gestiona tu cuenta
            </VerticalCutReveal>
          </h1>

          <TimelineContent
            as="p"
            animationNum={1}
            timelineRef={pageRef}
            customVariants={revealVariants}
            className="mx-auto max-w-md text-base leading-relaxed text-slate-600"
          >
            Controla el estado de tu suscripción, tus facturas y tu perfil desde un único lugar.
          </TimelineContent>
        </div>

        {/* Status card */}
        <TimelineContent
          as="div"
          animationNum={2}
          timelineRef={pageRef}
          customVariants={revealVariants}
          className="relative mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white p-8 shadow-[0_30px_80px_-30px_rgba(14,165,233,0.35)]"
        >
          <div
            className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-60"
            style={{ background: "radial-gradient(closest-side, rgba(14,165,233,0.22), transparent 70%)" }}
          />

          {sub.loading || !meta ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
            </div>
          ) : (
            <>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-600">
                Estado actual
              </div>
              <div className="mb-4 flex items-center gap-3">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{
                    background: meta.dotColor,
                    boxShadow: `0 0 14px ${meta.dotColor}70`,
                  }}
                />
                <h2 className="text-3xl font-bold tracking-tight">{meta.label}</h2>
              </div>
              <p className="mb-6 flex items-center gap-2 text-sm text-slate-600">
                <Clock className="h-4 w-4 text-slate-400" />
                {meta.sub}
              </p>

              {isNative && (meta.cta === "checkout" || meta.cta === "portal") && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => openWebWithAuth("/partner/manage")}
                  className="group flex h-14 w-full items-center justify-center gap-2 rounded-full border-4 border-sky-600 bg-gradient-to-t from-sky-600 via-sky-500 to-sky-600 text-base font-semibold text-white shadow-sm shadow-sky-600 transition-all hover:shadow-lg"
                >
                  <ExternalLink className="h-4 w-4" />
                  Gestionar en el navegador
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </motion.button>
              )}

              {!isNative && meta.cta === "checkout" && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={openCheckout}
                  disabled={openingCheckout}
                  className="group flex h-14 w-full items-center justify-center gap-2 rounded-full border-4 border-sky-600 bg-gradient-to-t from-sky-600 via-sky-500 to-sky-600 text-base font-semibold text-white shadow-sm shadow-sky-600 transition-all hover:shadow-lg disabled:opacity-60"
                >
                  {openingCheckout ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      Activar suscripción — €29,99 / mes + IVA
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </motion.button>
              )}

              {!isNative && meta.cta === "portal" && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={openPortal}
                  disabled={openingPortal}
                  className="group flex h-14 w-full items-center justify-center gap-2 rounded-full border-4 border-sky-600 bg-gradient-to-t from-sky-600 via-sky-500 to-sky-600 text-base font-semibold text-white shadow-sm shadow-sky-600 transition-all hover:shadow-lg disabled:opacity-60"
                >
                  {openingPortal ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" />
                      Portal de facturación Stripe
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </motion.button>
              )}

              {meta.cta === "grant" && (
                <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <Gift className="h-4 w-4" />
                    Acceso gratuito activo
                  </div>
                  <p className="text-xs leading-relaxed">
                    Tu cuenta tiene acceso gratuito concedido por el equipo de StudentsLife.
                  </p>
                </div>
              )}
            </>
          )}
        </TimelineContent>

        {/* Quick actions grid con timeline stagger */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {quickActions.map(({ Icon, title, desc }, i) => {
            const disabled = meta?.cta !== "portal";
            return (
              <TimelineContent
                key={title}
                as="button"
                animationNum={i}
                timelineRef={pageRef}
                customVariants={gridVariants}
                onClick={() => {
                  if (disabled) return;
                  if (isNative) openWebWithAuth("/partner/manage");
                  else openPortal();
                }}
                className={`group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 text-left backdrop-blur transition ${
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
                }`}
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 shadow-sm shadow-sky-500/30">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{title}</div>
                    {!disabled && (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{desc}</div>
                </div>
              </TimelineContent>
            );
          })}
        </div>

        {/* Trust bar */}
        <TimelineContent
          as="div"
          animationNum={4}
          timelineRef={pageRef}
          customVariants={revealVariants}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-slate-500"
        >
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-sky-500" />
            Pago seguro
          </div>
          <div className="flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5 text-sky-500" />
            Facturación automática con IVA
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5 text-sky-500" />
            Cancela cuando quieras
          </div>
        </TimelineContent>
      </div>
    </div>
  );
};

export default PartnerManage;
