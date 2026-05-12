import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Sparkles,
  Activity,
  CircleDashed,
  Power,
  Pause,
  Play,
  ShieldAlert,
  AlertTriangle,
  Check,
  X,
  TrendingUp,
  TrendingDown,
  Megaphone,
  Tag,
  MessageSquare,
  RefreshCw,
  Eye,
  ChevronRight,
  CircleDot,
  Wand2,
  Clock,
  ArrowUpRight,
  Settings2,
  Brain,
  Zap,
  Mail,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

/* ============================================================
   PartnerAutoPilot — Fase 6
   Agente IA autónomo que opera el local 24/7 dentro de las
   políticas que el partner configura. Toggle global de pausa,
   stream live de acciones, cola de aprobaciones humanas, ROI.
   ============================================================ */

type AgentStatus = "active" | "paused" | "intervention";

type ActionKind =
  | "pricing"
  | "marketing"
  | "refund"
  | "support"
  | "stock"
  | "schedule";

interface AgentAction {
  id: string;
  ts: number;
  kind: ActionKind;
  title: string;
  detail: string;
  impactEur?: number;
  needsApproval?: boolean;
  autoApprovedReason?: string;
  policyScope: string;
}

const KIND_META: Record<ActionKind, { label: string; color: string; icon: React.ReactNode }> = {
  pricing:   { label: "Pricing",    color: "#FF7A4D", icon: <Tag className="h-3.5 w-3.5" /> },
  marketing: { label: "Marketing",  color: "#8B5CF6", icon: <Megaphone className="h-3.5 w-3.5" /> },
  refund:    { label: "Reembolsos", color: "#E8B04C", icon: <Receipt className="h-3.5 w-3.5" /> },
  support:   { label: "Soporte",    color: "#3B82F6", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  stock:     { label: "Stock",      color: "#4DB87A", icon: <RefreshCw className="h-3.5 w-3.5" /> },
  schedule:  { label: "Schedule",   color: "#EC4899", icon: <Clock className="h-3.5 w-3.5" /> },
};

const SEED_ACTIONS: AgentAction[] = [
  {
    id: "a1",
    ts: Date.now() - 1000 * 60 * 4,
    kind: "pricing",
    title: "+12% precio early-bird Friday",
    detail: "Velocidad de venta 38% sobre baseline · subida progresiva detectada",
    impactEur: 412,
    autoApprovedReason: "dentro de banda +0/+15%",
    policyScope: "Friday Sessions · Sala A",
  },
  {
    id: "a2",
    ts: Date.now() - 1000 * 60 * 9,
    kind: "marketing",
    title: "Campaña Meta retargeting lanzada",
    detail: "Cohort 'abrió email · no compró' · presupuesto €40 · esperado 12 ventas",
    impactEur: 280,
    autoApprovedReason: "presupuesto ≤ €50",
    policyScope: "Friday Sessions",
  },
  {
    id: "a3",
    ts: Date.now() - 1000 * 60 * 17,
    kind: "support",
    title: "Respondidos 14 tickets WhatsApp",
    detail: "Tiempo medio 38s · escalados 2 a humano (consultas legales)",
    autoApprovedReason: "categorías OK",
    policyScope: "Atención cliente",
  },
  {
    id: "a4",
    ts: Date.now() - 1000 * 60 * 24,
    kind: "refund",
    title: "Reembolso solicitado · €38",
    detail: "Cliente compró 2 entradas · no puede asistir · 5 días antes del evento",
    impactEur: -38,
    needsApproval: true,
    policyScope: "Política refund T-7d",
  },
  {
    id: "a5",
    ts: Date.now() - 1000 * 60 * 41,
    kind: "schedule",
    title: "Sugerencia DJ slot · cambio horario",
    detail: "Histórico: DJ B convierte +22% si toca 01:00-02:30 vs 23:30-01:00",
    needsApproval: true,
    policyScope: "Schedule curation",
  },
  {
    id: "a6",
    ts: Date.now() - 1000 * 60 * 58,
    kind: "stock",
    title: "Lista 200 entradas más nivel 'Late'",
    detail: "Aforo Friday cargado al 78% · lanza siguiente nivel a €22",
    impactEur: 1320,
    autoApprovedReason: "estructura tarifa estándar",
    policyScope: "Pricing nights",
  },
];

interface PolicyToggle {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  meta?: string;
}

type PolicyGroup = {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  toggles: PolicyToggle[];
};

const INITIAL_POLICIES: PolicyGroup[] = [
  {
    id: "pricing",
    title: "Pricing dinámico",
    icon: <Tag className="h-4 w-4" />,
    color: "#FF7A4D",
    toggles: [
      { id: "p1", label: "Subir precio early-bird automáticamente", description: "Dentro de banda configurada en el módulo Pricing IA.", enabled: true, meta: "+0 / +15%" },
      { id: "p2", label: "Bajar precio si venta < baseline", description: "Activa rebaja escalonada cuando la velocidad cae 30% bajo expected.", enabled: false, meta: "−5 / −20%" },
      { id: "p3", label: "Lanzar siguiente nivel automáticamente", description: "Pasar a 'Late release' al alcanzar 75% de aforo del nivel anterior.", enabled: true, meta: "umbral 75%" },
    ],
  },
  {
    id: "marketing",
    title: "Marketing & growth",
    icon: <Megaphone className="h-4 w-4" />,
    color: "#8B5CF6",
    toggles: [
      { id: "m1", label: "Campañas Meta retargeting", description: "Auto-creación de retargeting con presupuesto cap.", enabled: true, meta: "≤ €50/día" },
      { id: "m2", label: "Email + push de recuperación", description: "Carritos abandonados, eventos guardados sin comprar.", enabled: true, meta: "1 toque / 48h" },
      { id: "m3", label: "Sugerencia de DJ slot/horarios", description: "Propone cambios de schedule basados en históricos.", enabled: false, meta: "requiere aprobación" },
    ],
  },
  {
    id: "support",
    title: "Customer service",
    icon: <MessageSquare className="h-4 w-4" />,
    color: "#3B82F6",
    toggles: [
      { id: "s1", label: "Responder WhatsApp/email", description: "Auto-respuesta a categorías 'horarios, dress code, transporte, lost & found'.", enabled: true, meta: "5 categorías" },
      { id: "s2", label: "Escalar a humano si dudoso", description: "Tickets con baja confianza o categorías sensibles van a la cola humana.", enabled: true, meta: "umbral conf. 0.78" },
      { id: "s3", label: "Sugerir reservados VIP a clientes high-LTV", description: "Concierge proactivo para clientes top 5% por gasto.", enabled: false, meta: "LTV > €600" },
    ],
  },
  {
    id: "refunds",
    title: "Reembolsos & disputas",
    icon: <Receipt className="h-4 w-4" />,
    color: "#E8B04C",
    toggles: [
      { id: "r1", label: "Auto-aprobar refunds T-7d", description: "Reembolsos automáticos si la solicitud llega 7+ días antes del evento.", enabled: true, meta: "100% antes T-7d" },
      { id: "r2", label: "Auto-rechazar duplicados", description: "Rechaza la 2ª solicitud sobre el mismo ticket.", enabled: true },
      { id: "r3", label: "Generar voucher si no procede refund", description: "Convierte el rechazo en crédito interno del 70%.", enabled: false, meta: "crédito 70%" },
    ],
  },
];

export const PartnerAutoPilot = () => {
  const [status, setStatus] = useState<AgentStatus>("active");
  const [actions, setActions] = useState<AgentAction[]>(SEED_ACTIONS);
  const [policies, setPolicies] = useState<PolicyGroup[]>(INITIAL_POLICIES);
  const [tab, setTab] = useState<"overview" | "stream" | "policies" | "approvals" | "roi">("overview");
  const [confidenceThreshold, setConfidenceThreshold] = useState(78);

  /* simulated live stream */
  const counterRef = useRef(7);
  useEffect(() => {
    if (status !== "active") return;
    const tickIds = [
      { kind: "pricing" as ActionKind,   title: "−8% Sunday afternoon · poca venta", detail: "Sunday matinee va 22% bajo baseline · rebaja temporal", impactEur: -90, autoApprovedReason: "banda −5/−20%", policyScope: "Sunday Matinee" },
      { kind: "support" as ActionKind,   title: "5 tickets WhatsApp resueltos",   detail: "Dress code, horarios, transporte · 0 escalados", autoApprovedReason: "alta confianza", policyScope: "Atención cliente" },
      { kind: "marketing" as ActionKind, title: "Push notif 'queda 10%' enviado",  detail: "Audiencia: guardaron evento · 4.2K opens estimados", impactEur: 380, autoApprovedReason: "automatización estándar", policyScope: "Friday Sessions" },
      { kind: "stock" as ActionKind,     title: "Nivel 'Late' activado", detail: "Aforo 76% · activa €24/entrada", impactEur: 720, autoApprovedReason: "estructura tarifa", policyScope: "Pricing nights" },
      { kind: "schedule" as ActionKind,  title: "Sugerencia: mover headliner +30min", detail: "Predicción: +14% conversión bar entre 02:00-03:00", needsApproval: true, policyScope: "Schedule curation" },
    ];
    const id = setInterval(() => {
      const idx = counterRef.current % tickIds.length;
      const t = tickIds[idx];
      counterRef.current++;
      setActions((prev) => [
        {
          id: `live-${counterRef.current}`,
          ts: Date.now(),
          ...t,
        },
        ...prev,
      ].slice(0, 28));
    }, 9000);
    return () => clearInterval(id);
  }, [status]);

  const togglePolicy = (groupId: string, toggleId: string) => {
    setPolicies((prev) =>
      prev.map((g) =>
        g.id !== groupId
          ? g
          : {
              ...g,
              toggles: g.toggles.map((t) => (t.id === toggleId ? { ...t, enabled: !t.enabled } : t)),
            }
      )
    );
  };

  const approve = (id: string) => setActions((prev) => prev.map((a) => (a.id === id ? { ...a, needsApproval: false, autoApprovedReason: "aprobado por humano" } : a)));
  const reject = (id: string) => setActions((prev) => prev.filter((a) => a.id !== id));

  const pending = actions.filter((a) => a.needsApproval);
  const enabledPoliciesCount = policies.flatMap((g) => g.toggles).filter((t) => t.enabled).length;
  const totalPoliciesCount = policies.flatMap((g) => g.toggles).length;

  /* derived ROI metrics */
  const last24hImpact = actions
    .filter((a) => Date.now() - a.ts < 1000 * 60 * 60 * 24 && typeof a.impactEur === "number")
    .reduce((s, a) => s + (a.impactEur ?? 0), 0);
  const decisionsLast24h = actions.filter((a) => Date.now() - a.ts < 1000 * 60 * 60 * 24).length;
  const autoApprovedRate = useMemo(() => {
    const auto = actions.filter((a) => !a.needsApproval).length;
    return actions.length === 0 ? 0 : Math.round((auto / actions.length) * 100);
  }, [actions]);

  return (
    <div className="space-y-6">
      {/* ========== HERO ========== */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(80px)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full"
          style={{ background: "rgba(139,92,246,0.18)", filter: "blur(80px)" }}
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 12px 30px -10px rgba(232,84,42,0.7)",
              }}
            >
              <Bot className="h-7 w-7" />
              {status === "active" && (
                <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500" />
                </span>
              )}
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                AutoPilot · Fase 6
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Tu local funciona <span style={serif} className="text-orange-500">solo</span>.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
                Pasify pilota pricing, marketing, soporte y reembolsos dentro de las políticas que tú defines. Tú firmas las decisiones grandes; el agente ejecuta las pequeñas.
              </p>
              <div
                className="mt-3 inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"
                style={mono}
              >
                <StatusChip status={status} />
                <span>· {decisionsLast24h} decisiones / 24h</span>
                <span>· {autoApprovedRate}% auto-aprobadas</span>
                <span>· {pending.length} pendientes de ti</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 md:items-end">
            {status === "active" ? (
              <Button variant="outline" onClick={() => setStatus("paused")}>
                <Pause className="mr-2 h-4 w-4" />
                Pausar agente
              </Button>
            ) : (
              <Button
                onClick={() => setStatus("active")}
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  color: "#fff",
                  border: 0,
                  boxShadow: "0 8px 20px -6px rgba(232,84,42,0.55)",
                }}
              >
                <Play className="mr-2 h-4 w-4" />
                Reanudar agente
              </Button>
            )}
            <button
              onClick={() => setStatus("intervention")}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-[11px] uppercase transition hover:border-red-500/40 hover:text-red-500"
              style={{ ...mono, letterSpacing: "0.16em", borderColor: "rgba(255,255,255,0.08)" }}
            >
              <Power className="h-3.5 w-3.5" />
              Modo intervención
            </button>
          </div>
        </div>
      </section>

      {/* ========== TABS ========== */}
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        role="tablist"
      >
        <TabBtn active={tab === "overview"}  onClick={() => setTab("overview")}  icon={<Activity className="h-3.5 w-3.5" />}  label="Resumen" />
        <TabBtn active={tab === "stream"}    onClick={() => setTab("stream")}    icon={<CircleDot className="h-3.5 w-3.5" />} label="Stream live" count={actions.length} />
        <TabBtn active={tab === "policies"}  onClick={() => setTab("policies")}  icon={<Settings2 className="h-3.5 w-3.5" />} label="Políticas" count={`${enabledPoliciesCount}/${totalPoliciesCount}`} />
        <TabBtn active={tab === "approvals"} onClick={() => setTab("approvals")} icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Aprobaciones" count={pending.length} highlight={pending.length > 0} />
        <TabBtn active={tab === "roi"}       onClick={() => setTab("roi")}       icon={<TrendingUp className="h-3.5 w-3.5" />} label="ROI" />
      </div>

      {/* ========== OVERVIEW ========== */}
      {tab === "overview" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <KpiTile
            className="lg:col-span-3"
            label="ROI 24h"
            value={`${last24hImpact >= 0 ? "+" : ""}${last24hImpact.toLocaleString("es-ES")} €`}
            sub="impacto neto agente"
            tone={last24hImpact >= 0 ? "positive" : "negative"}
            icon={last24hImpact >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          />
          <KpiTile
            className="lg:col-span-3"
            label="Decisiones 24h"
            value={decisionsLast24h.toString()}
            sub="acciones del agente"
            icon={<Brain className="h-4 w-4" />}
          />
          <KpiTile
            className="lg:col-span-3"
            label="Auto-aprobadas"
            value={`${autoApprovedRate}%`}
            sub="dentro de tus políticas"
            icon={<Check className="h-4 w-4" />}
            tone="info"
          />
          <KpiTile
            className="lg:col-span-3"
            label="Te esperan"
            value={pending.length.toString()}
            sub={pending.length > 0 ? "revisa la cola" : "todo al día"}
            icon={<ShieldAlert className="h-4 w-4" />}
            tone={pending.length > 0 ? "warning" : "neutral"}
          />

          {/* What the agent has been doing — categorized */}
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-7">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                  <Wand2 className="h-3 w-3" /> Reparto por área
                </div>
                <h3 className="text-base font-semibold">Donde el agente trabaja por ti</h3>
              </div>
              <button
                onClick={() => setTab("stream")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Ver stream <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {(Object.keys(KIND_META) as ActionKind[]).map((kind) => {
                const total = actions.filter((a) => a.kind === kind).length;
                const max = Math.max(...(Object.keys(KIND_META) as ActionKind[]).map((k) => actions.filter((a) => a.kind === k).length), 1);
                const pct = Math.round((total / max) * 100);
                const meta = KIND_META[kind];
                return (
                  <div key={kind} className="flex items-center gap-3">
                    <div className="flex w-32 items-center gap-2">
                      <span
                        className="grid h-6 w-6 place-items-center rounded-md"
                        style={{ background: `${meta.color}1A`, color: meta.color }}
                      >
                        {meta.icon}
                      </span>
                      <span className="text-[12px] text-foreground/90">{meta.label}</span>
                    </div>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}55 100%)` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[11px] text-muted-foreground" style={mono}>
                      {total}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pending approvals shortcut */}
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-amber-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                  <ShieldAlert className="h-3 w-3" /> Cola humana
                </div>
                <h3 className="text-base font-semibold">Decisiones que te tocan</h3>
              </div>
              {pending.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase"
                  style={{ ...mono, letterSpacing: "0.18em", borderColor: "rgba(232,176,76,0.45)", color: "#E8B04C", background: "rgba(232,176,76,0.08)" }}
                >
                  <CircleDashed className="h-2.5 w-2.5" />
                  {pending.length} esperando
                </span>
              )}
            </div>
            {pending.length === 0 ? (
              <div
                className="rounded-xl border border-dashed p-6 text-center text-[12px] text-muted-foreground"
                style={{ borderColor: "rgba(255,255,255,0.08)" }}
              >
                <Check className="mx-auto mb-2 h-5 w-5 text-emerald-500" />
                Todo está al día — el agente está dentro de tus políticas.
              </div>
            ) : (
              <div className="space-y-2">
                {pending.slice(0, 3).map((a) => (
                  <PendingRow key={a.id} action={a} onApprove={() => approve(a.id)} onReject={() => reject(a.id)} compact />
                ))}
                <button
                  onClick={() => setTab("approvals")}
                  className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border py-2 text-[11px] uppercase transition hover:text-foreground"
                  style={{ ...mono, letterSpacing: "0.16em", borderColor: "rgba(255,255,255,0.08)", color: "#8A8275" }}
                >
                  Ver todas <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ========== STREAM ========== */}
      {tab === "stream" && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                <Activity className="h-3 w-3" /> Stream live
              </div>
              <h3 className="text-base font-semibold">Cada decisión, en orden</h3>
            </div>
            <span
              className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                borderColor: status === "active" ? "rgba(77,184,122,0.45)" : "rgba(255,255,255,0.10)",
                color: status === "active" ? "#4DB87A" : "#8A8275",
                background: status === "active" ? "rgba(77,184,122,0.08)" : "transparent",
              }}
            >
              <span className="relative inline-flex h-1.5 w-1.5">
                {status === "active" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${status === "active" ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              </span>
              {status === "active" ? "Live" : "Pausado"}
            </span>
          </div>

          <div className="space-y-2">
            {actions.map((a) => (
              <StreamRow key={a.id} action={a} onApprove={() => approve(a.id)} onReject={() => reject(a.id)} />
            ))}
          </div>
        </section>
      )}

      {/* ========== POLICIES ========== */}
      {tab === "policies" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                  <Settings2 className="h-3 w-3" /> Confianza mínima
                </div>
                <h3 className="text-base font-semibold">Umbral global para auto-ejecución</h3>
                <p className="mt-1 max-w-[60ch] text-[12px] text-muted-foreground">
                  Por debajo de este umbral el agente nunca actúa solo — escala a tu cola humana.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={50}
                  max={95}
                  value={confidenceThreshold}
                  onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                  className="w-40 accent-orange-500"
                />
                <div
                  className="rounded-md border px-3 py-1.5"
                  style={{ ...mono, borderColor: "rgba(255,255,255,0.08)" }}
                >
                  <span className="text-lg font-semibold text-orange-500">{confidenceThreshold}</span>
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.18em" }}>conf.</span>
                </div>
              </div>
            </div>
          </div>

          {policies.map((g) => (
            <div key={g.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <div
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{ background: `${g.color}1A`, color: g.color }}
                >
                  {g.icon}
                </div>
                <div>
                  <h3 className="text-base font-semibold">{g.title}</h3>
                  <div className="text-[11px] text-muted-foreground" style={mono}>
                    {g.toggles.filter((t) => t.enabled).length} de {g.toggles.length} activos
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {g.toggles.map((t) => (
                  <PolicyRow key={t.id} toggle={t} color={g.color} onToggle={() => togglePolicy(g.id, t.id)} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ========== APPROVALS ========== */}
      {tab === "approvals" && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-amber-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                <ShieldAlert className="h-3 w-3" /> Human-in-the-loop
              </div>
              <h3 className="text-base font-semibold">Cola de aprobaciones</h3>
              <p className="mt-1 max-w-[60ch] text-[12px] text-muted-foreground">
                El agente para aquí cuando algo cae fuera de tus políticas o cuando la confianza es baja.
              </p>
            </div>
            <span
              className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.18em", borderColor: "rgba(232,176,76,0.45)", color: "#E8B04C", background: "rgba(232,176,76,0.08)" }}
            >
              {pending.length} esperando
            </span>
          </div>

          {pending.length === 0 ? (
            <div
              className="rounded-xl border border-dashed p-10 text-center"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <Check className="mx-auto mb-3 h-7 w-7 text-emerald-500" />
              <div className="text-sm font-medium">Cola vacía</div>
              <div className="mt-1 text-[12px] text-muted-foreground">El agente está al día con tus políticas.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((a) => (
                <PendingRow key={a.id} action={a} onApprove={() => approve(a.id)} onReject={() => reject(a.id)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ========== ROI ========== */}
      {tab === "roi" && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiTile
              label="Impacto 7d"
              value={`+${(last24hImpact * 7).toLocaleString("es-ES")} €`}
              sub="proyección semanal"
              tone="positive"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KpiTile
              label="Horas humanas ahorradas"
              value="42 h"
              sub="vs gestión manual"
              icon={<Clock className="h-4 w-4" />}
              tone="info"
            />
            <KpiTile
              label="Coste agente"
              value="—"
              sub="incluido en tu plan"
              icon={<Zap className="h-4 w-4" />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                <Mail className="h-3 w-3" /> Reporte semanal
              </div>
              <h3 className="mb-1 text-base font-semibold">Resumen ejecutivo · cada lunes 09:00</h3>
              <p className="text-[12px] text-muted-foreground">
                Email automático con cada decisión del agente, ROI estimado, y qué políticas conviene ajustar para la semana siguiente.
              </p>
              <Button variant="outline" size="sm" className="mt-4">
                <Eye className="mr-2 h-4 w-4" />
                Ver último reporte
              </Button>
            </div>

            <div
              className="rounded-2xl border p-5"
              style={{
                background: "linear-gradient(135deg, rgba(77,184,122,0.10) 0%, rgba(77,184,122,0.02) 100%)",
                borderColor: "rgba(77,184,122,0.32)",
              }}
            >
              <div className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.22em", color: "#4DB87A" }}>
                <AlertTriangle className="h-3 w-3" /> Política sugerida
              </div>
              <h3 className="mb-1 text-base font-semibold">Subir banda pricing a +20%</h3>
              <p className="text-[12px] text-muted-foreground">
                Las últimas 6 subidas dentro de banda +0/+15% se agotaron en menos de 24h. Ampliando la banda a +20% podrías capturar ~€1.4k adicionales por evento sin afectar conversión.
              </p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" style={{ background: "#4DB87A", color: "#fff", border: 0 }}>
                  <Check className="mr-2 h-4 w-4" /> Aplicar
                </Button>
                <Button size="sm" variant="outline">
                  Ver evidencia
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

const StatusChip = ({ status }: { status: AgentStatus }) => {
  const cfg = {
    active:       { label: "Operando solo", color: "#4DB87A", bg: "rgba(77,184,122,0.10)", border: "rgba(77,184,122,0.40)" },
    paused:       { label: "Pausado",       color: "#8A8275", bg: "rgba(138,130,117,0.10)", border: "rgba(138,130,117,0.40)" },
    intervention: { label: "Intervención manual", color: "#FF7A4D", bg: "rgba(232,84,42,0.10)", border: "rgba(232,84,42,0.40)" },
  }[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {status === "active" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: cfg.color }} />
      </span>
      {cfg.label}
    </span>
  );
};

const TabBtn = ({
  active, onClick, icon, label, count, highlight,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number | string;
  highlight?: boolean;
}) => (
  <button
    onClick={onClick}
    role="tab"
    className={`group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition ${
      active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
    }`}
    style={active ? { boxShadow: "0 1px 0 rgba(232,84,42,0.4) inset, 0 -2px 0 rgba(232,84,42,0.7) inset" } : undefined}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && (
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px]"
        style={{
          ...mono,
          background: highlight ? "rgba(232,176,76,0.18)" : "rgba(255,255,255,0.06)",
          color: highlight ? "#E8B04C" : "#8A8275",
        }}
      >
        {count}
      </span>
    )}
  </button>
);

const KpiTile = ({
  label, value, sub, icon, tone = "neutral", className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "info" | "warning";
  className?: string;
}) => {
  const toneCfg = {
    neutral:  { color: "#F4EEE2", halo: "rgba(255,255,255,0.04)" },
    positive: { color: "#4DB87A", halo: "rgba(77,184,122,0.18)" },
    negative: { color: "#FF7A4D", halo: "rgba(232,84,42,0.18)" },
    info:     { color: "#A78BFA", halo: "rgba(167,139,250,0.18)" },
    warning:  { color: "#E8B04C", halo: "rgba(232,176,76,0.18)" },
  }[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 ${className}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full"
        style={{ background: toneCfg.halo, filter: "blur(40px)" }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            {label}
          </div>
          <div className="text-[26px] font-semibold leading-none tracking-tight" style={{ color: toneCfg.color }}>{value}</div>
          {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
        </div>
        {icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: toneCfg.halo, color: toneCfg.color }}>
            {icon}
          </span>
        )}
      </div>
    </div>
  );
};

const StreamRow = ({ action, onApprove, onReject }: { action: AgentAction; onApprove: () => void; onReject: () => void }) => {
  const meta = KIND_META[action.kind];
  const ago = formatAgo(action.ts);
  const positive = (action.impactEur ?? 0) > 0;
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3 transition md:flex-row md:items-center"
      style={{ borderColor: action.needsApproval ? "rgba(232,176,76,0.32)" : "rgba(255,255,255,0.06)", background: action.needsApproval ? "rgba(232,176,76,0.04)" : "transparent" }}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ background: `${meta.color}1A`, color: meta.color }}
      >
        {meta.icon}
      </span>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{action.title}</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
            style={{ ...mono, letterSpacing: "0.16em", background: `${meta.color}1A`, color: meta.color }}
          >
            {meta.label}
          </span>
          {action.needsApproval && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{ ...mono, letterSpacing: "0.16em", color: "#E8B04C", background: "rgba(232,176,76,0.12)" }}
            >
              Aprobación pendiente
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{action.detail}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground" style={mono}>
          <span>{ago}</span>
          <span>· {action.policyScope}</span>
          {action.autoApprovedReason && <span>· auto · {action.autoApprovedReason}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 md:flex-col md:items-end">
        {typeof action.impactEur === "number" && (
          <span
            className="rounded-md px-2 py-0.5 text-[12px]"
            style={{
              ...mono,
              color: positive ? "#4DB87A" : "#FF7A4D",
              background: positive ? "rgba(77,184,122,0.10)" : "rgba(232,84,42,0.10)",
            }}
          >
            {positive ? "+" : ""}
            {action.impactEur.toLocaleString("es-ES")} €
          </span>
        )}
        {action.needsApproval && (
          <div className="flex gap-1.5">
            <button
              onClick={onApprove}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition hover:border-emerald-500/40 hover:text-emerald-500"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "#8A8275" }}
              aria-label="Aprobar"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onReject}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border transition hover:border-red-500/40 hover:text-red-500"
              style={{ borderColor: "rgba(255,255,255,0.08)", color: "#8A8275" }}
              aria-label="Rechazar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const PendingRow = ({
  action, onApprove, onReject, compact = false,
}: {
  action: AgentAction;
  onApprove: () => void;
  onReject: () => void;
  compact?: boolean;
}) => {
  const meta = KIND_META[action.kind];
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-3"
      style={{ borderColor: "rgba(232,176,76,0.28)", background: "rgba(232,176,76,0.05)" }}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{ background: `${meta.color}1A`, color: meta.color }}
      >
        {meta.icon}
      </span>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{action.title}</span>
          {!compact && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{ ...mono, letterSpacing: "0.16em", background: `${meta.color}1A`, color: meta.color }}
            >
              {meta.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{action.detail}</div>
        <div className="mt-1 text-[10px] text-muted-foreground" style={mono}>
          {action.policyScope} · {formatAgo(action.ts)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={onApprove}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition"
          style={{ background: "#4DB87A", color: "#fff", border: 0 }}
        >
          <Check className="h-3 w-3" />
          Aprobar
        </button>
        <button
          onClick={onReject}
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <X className="h-3 w-3" />
          Rechazar
        </button>
      </div>
    </div>
  );
};

const PolicyRow = ({
  toggle, color, onToggle,
}: {
  toggle: PolicyToggle;
  color: string;
  onToggle: () => void;
}) => (
  <div
    className="flex items-start justify-between gap-3 rounded-xl border p-3 transition"
    style={{ borderColor: toggle.enabled ? `${color}33` : "rgba(255,255,255,0.06)", background: toggle.enabled ? `${color}08` : "transparent" }}
  >
    <div className="flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{toggle.label}</span>
        {toggle.meta && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px]"
            style={{ ...mono, background: "rgba(255,255,255,0.04)", color: "#8A8275" }}
          >
            {toggle.meta}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11.5px] text-muted-foreground">{toggle.description}</div>
    </div>
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={toggle.enabled}
      className="relative h-6 w-11 rounded-full border transition"
      style={{
        background: toggle.enabled ? color : "rgba(255,255,255,0.04)",
        borderColor: toggle.enabled ? color : "rgba(255,255,255,0.08)",
      }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
        style={{
          left: toggle.enabled ? "calc(100% - 22px)" : "2px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  </div>
);

const formatAgo = (ts: number) => {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `hace ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `hace ${diffD}d`;
};

export default PartnerAutoPilot;
