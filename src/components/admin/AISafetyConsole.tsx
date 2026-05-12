import { useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldAlert,
  Sparkles,
  Bot,
  Activity,
  AlertOctagon,
  Search,
  Power,
  Pause,
  Play,
  Check,
  X,
  Eye,
  Building2,
  Gauge,
  Brain,
  ScanFace,
  Tag,
  Megaphone,
  MessageSquare,
  Receipt,
  CircleDot,
  AlertTriangle,
  FileText,
  ChevronRight,
  Clock,
  TrendingDown,
  Wand2,
  ListFilter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

/* ============================================================
   AISafetyConsole — Fase 6
   Oversight cross-tenant de TODA la IA que Pasify opera para
   sus partners. Kill-switches, anomaly feed, model perf,
   audit trail. El equipo Pasify mira aquí cuando algo huele mal.
   ============================================================ */

type Capability = "autopilot" | "pricing" | "doorvision" | "concierge" | "marketing" | "forecast";

interface CapabilityRow {
  id: Capability;
  label: string;
  icon: React.ReactNode;
  color: string;
  tenantsTotal: number;
  tenantsActive: number;
  decisions24h: number;
  precision: number; // 0-1
  latencyMs: number;
  errorRate: number; // 0-1
  killed: boolean;
}

const CAPABILITIES: CapabilityRow[] = [
  { id: "autopilot",  label: "AutoPilot",        icon: <Bot className="h-4 w-4" />,        color: "#FF7A4D", tenantsTotal: 184, tenantsActive: 142, decisions24h: 9_842, precision: 0.94, latencyMs: 240, errorRate: 0.006, killed: false },
  { id: "pricing",    label: "Pricing IA",       icon: <Tag className="h-4 w-4" />,        color: "#E8B04C", tenantsTotal: 184, tenantsActive: 168, decisions24h: 3_412, precision: 0.91, latencyMs: 90,  errorRate: 0.004, killed: false },
  { id: "doorvision", label: "Door Vision",      icon: <ScanFace className="h-4 w-4" />,   color: "#A78BFA", tenantsTotal: 48,  tenantsActive: 41,  decisions24h: 14_220, precision: 0.97, latencyMs: 38,  errorRate: 0.012, killed: false },
  { id: "concierge",  label: "Concierge cliente",icon: <MessageSquare className="h-4 w-4" />, color: "#3B82F6", tenantsTotal: 184, tenantsActive: 158, decisions24h: 6_180, precision: 0.88, latencyMs: 410, errorRate: 0.009, killed: false },
  { id: "marketing",  label: "Marketing auto",   icon: <Megaphone className="h-4 w-4" />,  color: "#EC4899", tenantsTotal: 184, tenantsActive: 132, decisions24h: 712,   precision: 0.92, latencyMs: 1_120, errorRate: 0.002, killed: false },
  { id: "forecast",   label: "Forecast IA",      icon: <Brain className="h-4 w-4" />,      color: "#4DB87A", tenantsTotal: 184, tenantsActive: 184, decisions24h: 184,   precision: 0.89, latencyMs: 8_400, errorRate: 0.001, killed: false },
];

type AnomalySeverity = "low" | "medium" | "high" | "critical";

interface Anomaly {
  id: string;
  ts: number;
  capability: Capability;
  tenantId: string;
  tenantName: string;
  severity: AnomalySeverity;
  title: string;
  detail: string;
  resolved?: boolean;
}

const SEED_ANOMALIES: Anomaly[] = [
  {
    id: "an1",
    ts: Date.now() - 1000 * 60 * 7,
    capability: "pricing",
    tenantId: "t-1834",
    tenantName: "Sala Apolo",
    severity: "high",
    title: "Subida +24% fuera de banda configurada",
    detail: "Banda partner: +0/+15%. El modelo intentó +24% en Friday Sessions. Detenido por guardrail, no ejecutado.",
  },
  {
    id: "an2",
    ts: Date.now() - 1000 * 60 * 22,
    capability: "concierge",
    tenantId: "t-2901",
    tenantName: "Razzmatazz",
    severity: "medium",
    title: "Confianza media cae a 0.61 (umbral 0.78)",
    detail: "Modelo concierge ES está enrutando 38% más mensajes a humano que ayer. Posible drift por nueva campaña.",
  },
  {
    id: "an3",
    ts: Date.now() - 1000 * 60 * 41,
    capability: "doorvision",
    tenantId: "t-1199",
    tenantName: "Pacha Ibiza",
    severity: "critical",
    title: "Falso positivo identificación menor",
    detail: "Cliente reportó haber sido rechazado siendo mayor de edad. Imagen revisada — modelo tenía baja confianza (0.51).",
  },
  {
    id: "an4",
    ts: Date.now() - 1000 * 60 * 65,
    capability: "marketing",
    tenantId: "t-1502",
    tenantName: "Costa Group",
    severity: "low",
    title: "Coste por campaña +18% vs baseline",
    detail: "Modelo de bidding está pagando más por click que la mediana del segmento. Bajo umbral de alerta.",
  },
  {
    id: "an5",
    ts: Date.now() - 1000 * 60 * 90,
    capability: "autopilot",
    tenantId: "t-1834",
    tenantName: "Sala Apolo",
    severity: "medium",
    title: "Bucle de approval-rejection detectado",
    detail: "Agente repropone misma decisión 4 veces tras rechazo del humano. Posible loop — sugerencia: ajustar política.",
  },
];

interface AuditEntry {
  id: string;
  ts: number;
  capability: Capability;
  tenantName: string;
  action: string;
  result: "ok" | "blocked" | "escalated";
  modelVersion: string;
}

const SEED_AUDIT: AuditEntry[] = [
  { id: "au1", ts: Date.now() - 1000 * 30,  capability: "doorvision", tenantName: "Pacha Ibiza",     action: "Verificación facial · acceso permitido",    result: "ok",        modelVersion: "dv-3.2.1" },
  { id: "au2", ts: Date.now() - 1000 * 90,  capability: "concierge",  tenantName: "Razzmatazz",      action: "WhatsApp · respuesta sobre dress code",     result: "ok",        modelVersion: "cc-1.9.4" },
  { id: "au3", ts: Date.now() - 1000 * 120, capability: "pricing",    tenantName: "Sala Apolo",      action: "Subida +24% en Friday Sessions",             result: "blocked",   modelVersion: "pp-2.3.0" },
  { id: "au4", ts: Date.now() - 1000 * 180, capability: "autopilot",  tenantName: "Medusa Events",   action: "Reembolso €38 · cliente T-5d",               result: "escalated", modelVersion: "ap-0.8.2" },
  { id: "au5", ts: Date.now() - 1000 * 220, capability: "marketing",  tenantName: "Costa Group",     action: "Campaña Meta retargeting · €40",             result: "ok",        modelVersion: "mk-1.2.7" },
  { id: "au6", ts: Date.now() - 1000 * 280, capability: "forecast",   tenantName: "Sala Apolo",      action: "Predicción aforo Friday · 1840 asistentes",  result: "ok",        modelVersion: "fc-2.1.0" },
];

export const AISafetyConsole = () => {
  const [tab, setTab] = useState<"overview" | "capabilities" | "anomalies" | "audit">("overview");
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>(CAPABILITIES);
  const [anomalies, setAnomalies] = useState<Anomaly[]>(SEED_ANOMALIES);
  const [audit, setAudit] = useState<AuditEntry[]>(SEED_AUDIT);
  const [auditQ, setAuditQ] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | AnomalySeverity>("all");

  /* simulate live audit entries */
  const auditCounterRef = useRef(7);
  useEffect(() => {
    const tickActions: { cap: Capability; tenantName: string; action: string; result: "ok" | "blocked" | "escalated"; v: string }[] = [
      { cap: "doorvision", tenantName: "Pacha Ibiza",   action: "Verificación facial · permitido",  result: "ok", v: "dv-3.2.1" },
      { cap: "concierge",  tenantName: "Sala Apolo",    action: "Email · respuesta sobre horarios", result: "ok", v: "cc-1.9.4" },
      { cap: "pricing",    tenantName: "Razzmatazz",    action: "Subida +8% Sunday matinee",        result: "ok", v: "pp-2.3.0" },
      { cap: "autopilot",  tenantName: "Costa Group",   action: "Push 'queda 10%' enviado",         result: "ok", v: "ap-0.8.2" },
      { cap: "forecast",   tenantName: "Medusa Events", action: "Predicción demanda Friday",         result: "ok", v: "fc-2.1.0" },
      { cap: "marketing",  tenantName: "Pacha Ibiza",   action: "Bid pausado · coste alto",         result: "blocked", v: "mk-1.2.7" },
    ];
    const id = setInterval(() => {
      const idx = auditCounterRef.current % tickActions.length;
      auditCounterRef.current++;
      const t = tickActions[idx];
      setAudit((prev) => [{ id: `live-${auditCounterRef.current}`, ts: Date.now(), capability: t.cap, tenantName: t.tenantName, action: t.action, result: t.result, modelVersion: t.v }, ...prev].slice(0, 60));
    }, 6500);
    return () => clearInterval(id);
  }, []);

  const toggleKill = (id: Capability) =>
    setCapabilities((prev) => prev.map((c) => (c.id === id ? { ...c, killed: !c.killed } : c)));

  const resolveAnomaly = (id: string) =>
    setAnomalies((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));

  const totals = useMemo(() => {
    const decisions = capabilities.reduce((s, c) => s + c.decisions24h, 0);
    const activeTenants = Math.max(...capabilities.map((c) => c.tenantsActive));
    const avgPrecision = Math.round(
      (capabilities.reduce((s, c) => s + c.precision, 0) / capabilities.length) * 100
    );
    const killed = capabilities.filter((c) => c.killed).length;
    return { decisions, activeTenants, avgPrecision, killed };
  }, [capabilities]);

  const open = anomalies.filter((a) => !a.resolved);
  const critical = open.filter((a) => a.severity === "critical").length;
  const high = open.filter((a) => a.severity === "high").length;

  const filteredAnomalies = open.filter((a) => severityFilter === "all" || a.severity === severityFilter);
  const filteredAudit = audit.filter((e) => {
    if (!auditQ.trim()) return true;
    const q = auditQ.trim().toLowerCase();
    return (
      e.tenantName.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.modelVersion.toLowerCase().includes(q) ||
      e.capability.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <header className="flex flex-col gap-1">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
          <Sparkles className="h-3 w-3" /> Trust · Fase 6
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Safety Console</h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Toda la IA que Pasify ejecuta para los partners — visible, auditable, parable. Una mirada cross-tenant para detectar drift, sesgos o bucles antes de que escalen.
        </p>
      </header>

      {/* ========== HERO ========== */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,176,76,0.10) 0%, rgba(232,84,42,0.08) 50%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,176,76,0.35)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,176,76,0.22)", filter: "blur(80px)" }}
        />
        <div className="relative grid grid-cols-1 gap-5 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7 flex items-start gap-4">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 12px 30px -10px rgba(232,84,42,0.7)",
              }}
            >
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                Cada decisión IA <span style={serif} className="text-orange-500">visible</span>.
              </h2>
              <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
                Modelos, versiones, latencia, precisión y errores — para todas las capabilities, en todos los tenants. Kill-switch global por capability si algo se desmadra.
              </p>
            </div>
          </div>
          <div className="md:col-span-5 grid grid-cols-2 gap-3">
            <BigStat label="Decisiones 24h" value={totals.decisions.toLocaleString("es-ES")} sub="todas las capabilities" tone="neutral" />
            <BigStat label="Precisión media" value={`${totals.avgPrecision}%`} sub="ponderada" tone="positive" />
            <BigStat label="Anomalías abiertas" value={open.length.toString()} sub={`${critical} críticas · ${high} altas`} tone={critical > 0 ? "negative" : open.length > 0 ? "warning" : "positive"} />
            <BigStat label="Kill-switches activos" value={totals.killed.toString()} sub={totals.killed > 0 ? "capabilities detenidas" : "todo operando"} tone={totals.killed > 0 ? "negative" : "neutral"} />
          </div>
        </div>
      </section>

      {/* TABS */}
      <div
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        role="tablist"
      >
        <TabBtn active={tab === "overview"}     onClick={() => setTab("overview")}     icon={<Activity className="h-3.5 w-3.5" />}   label="Resumen" />
        <TabBtn active={tab === "capabilities"} onClick={() => setTab("capabilities")} icon={<Wand2 className="h-3.5 w-3.5" />}      label="Capabilities" count={capabilities.length} />
        <TabBtn active={tab === "anomalies"}    onClick={() => setTab("anomalies")}    icon={<AlertOctagon className="h-3.5 w-3.5" />} label="Anomalías" count={open.length} highlight={critical > 0} />
        <TabBtn active={tab === "audit"}        onClick={() => setTab("audit")}        icon={<FileText className="h-3.5 w-3.5" />}   label="Audit trail" count={audit.length} />
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Capability health top 6 */}
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                  <Activity className="h-3 w-3" /> Health por capability
                </div>
                <h3 className="text-base font-semibold">Estado en tiempo real</h3>
              </div>
              <button
                onClick={() => setTab("capabilities")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Detalle <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2">
              {capabilities.map((c) => {
                const precPct = Math.round(c.precision * 100);
                return (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: c.killed ? "rgba(232,84,42,0.40)" : "rgba(255,255,255,0.06)", background: c.killed ? "rgba(232,84,42,0.05)" : "transparent" }}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${c.color}1A`, color: c.color }}>
                      {c.icon}
                    </span>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium">{c.label}</span>
                        {c.killed && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] uppercase" style={{ ...mono, letterSpacing: "0.16em", color: "#FF7A4D", background: "rgba(232,84,42,0.10)" }}>
                            kill-switch
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground" style={mono}>
                        {c.tenantsActive}/{c.tenantsTotal} tenants · {c.decisions24h.toLocaleString("es-ES")} decisiones / 24h · {c.latencyMs}ms · err {(c.errorRate * 100).toFixed(2)}%
                      </div>
                    </div>
                    <div className="hidden w-44 md:block">
                      <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${precPct}%`, background: `linear-gradient(90deg, ${c.color} 0%, ${c.color}55 100%)` }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground" style={mono}>
                        <span>precision</span>
                        <span style={{ color: c.color }}>{precPct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Anomaly inbox preview */}
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-4">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-amber-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                  <AlertOctagon className="h-3 w-3" /> Anomalías recientes
                </div>
                <h3 className="text-base font-semibold">Lo que pide ojos</h3>
              </div>
              {open.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase"
                  style={{ ...mono, letterSpacing: "0.18em", borderColor: critical > 0 ? "rgba(232,84,42,0.45)" : "rgba(232,176,76,0.45)", color: critical > 0 ? "#FF7A4D" : "#E8B04C", background: critical > 0 ? "rgba(232,84,42,0.06)" : "rgba(232,176,76,0.06)" }}
                >
                  {open.length} abiertas
                </span>
              )}
            </div>
            {open.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-[12px] text-muted-foreground" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <Check className="mx-auto mb-2 h-5 w-5 text-emerald-500" />
                Sin anomalías abiertas — todos los modelos dentro de tolerancia.
              </div>
            ) : (
              <div className="space-y-2">
                {open.slice(0, 4).map((a) => (
                  <AnomalyRow key={a.id} anomaly={a} onResolve={() => resolveAnomaly(a.id)} compact />
                ))}
                <button
                  onClick={() => setTab("anomalies")}
                  className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border py-2 text-[11px] uppercase transition hover:text-foreground"
                  style={{ ...mono, letterSpacing: "0.16em", borderColor: "rgba(255,255,255,0.08)", color: "#8A8275" }}
                >
                  Ver todas <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Live audit ticker */}
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-12">
            <div className="mb-3 flex items-center justify-between">
              <div className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
                <CircleDot className="h-3 w-3" /> Audit live
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.18em", borderColor: "rgba(77,184,122,0.45)", color: "#4DB87A", background: "rgba(77,184,122,0.08)" }}>
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                streaming
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {audit.slice(0, 6).map((e) => (
                <AuditCompactRow key={e.id} entry={e} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CAPABILITIES */}
      {tab === "capabilities" && (
        <section className="space-y-3">
          {capabilities.map((c) => (
            <CapabilityCard key={c.id} cap={c} onToggleKill={() => toggleKill(c.id)} />
          ))}
        </section>
      )}

      {/* ANOMALIES */}
      {tab === "anomalies" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" style={mono}>
                <ListFilter className="h-3.5 w-3.5" /> Severidad
              </span>
              {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverityFilter(s)}
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase transition ${severityFilter === s ? "" : "hover:text-foreground"}`}
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    background: severityFilter === s ? SEVERITY_CFG[s === "all" ? "low" : s].bg : "transparent",
                    color: severityFilter === s ? SEVERITY_CFG[s === "all" ? "low" : s].color : "#8A8275",
                    borderColor: severityFilter === s ? SEVERITY_CFG[s === "all" ? "low" : s].border : "rgba(255,255,255,0.08)",
                  }}
                >
                  {s === "all" ? "Todas" : SEVERITY_CFG[s].label}
                </button>
              ))}
            </div>
          </div>

          {filteredAnomalies.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <Check className="mx-auto mb-3 h-7 w-7 text-emerald-500" />
              <div className="text-sm font-medium">Sin anomalías en este filtro</div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAnomalies.map((a) => (
                <AnomalyRow key={a.id} anomaly={a} onResolve={() => resolveAnomaly(a.id)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* AUDIT */}
      {tab === "audit" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={auditQ}
                onChange={(e) => setAuditQ(e.target.value)}
                placeholder="Buscar por tenant, acción, capability o versión de modelo…"
                className="h-11 rounded-xl pl-10"
              />
            </div>
            <div className="mt-3 inline-flex items-center gap-3 text-[11px] text-muted-foreground" style={mono}>
              <span>{filteredAudit.length.toLocaleString("es-ES")} entradas</span>
              <span>·</span>
              <span>cada decisión IA queda registrada</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="hidden grid-cols-[110px_140px_1fr_120px_110px_90px] gap-3 border-b px-4 py-2 text-[10px] uppercase text-muted-foreground md:grid" style={{ ...mono, letterSpacing: "0.18em", borderColor: "rgba(255,255,255,0.06)" }}>
              <span>Hora</span>
              <span>Tenant</span>
              <span>Acción</span>
              <span>Capability</span>
              <span>Modelo</span>
              <span className="text-right">Resultado</span>
            </div>
            <div>
              {filteredAudit.slice(0, 40).map((e) => (
                <AuditFullRow key={e.id} entry={e} />
              ))}
              {filteredAudit.length > 40 && (
                <div className="border-t px-4 py-3 text-center text-[11px] text-muted-foreground" style={{ ...mono, borderColor: "rgba(255,255,255,0.06)" }}>
                  + {(filteredAudit.length - 40).toLocaleString("es-ES")} entradas más · usa el buscador para filtrar
                </div>
              )}
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

const SEVERITY_CFG: Record<AnomalySeverity, { label: string; color: string; bg: string; border: string }> = {
  low:      { label: "Baja",     color: "#8A8275", bg: "rgba(138,130,117,0.10)", border: "rgba(138,130,117,0.40)" },
  medium:   { label: "Media",    color: "#E8B04C", bg: "rgba(232,176,76,0.10)",  border: "rgba(232,176,76,0.45)" },
  high:     { label: "Alta",     color: "#FF7A4D", bg: "rgba(232,84,42,0.10)",   border: "rgba(232,84,42,0.45)" },
  critical: { label: "Crítica",  color: "#EF4444", bg: "rgba(239,68,68,0.10)",   border: "rgba(239,68,68,0.50)" },
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
    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition ${active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    style={active ? { boxShadow: "0 1px 0 rgba(232,84,42,0.4) inset, 0 -2px 0 rgba(232,84,42,0.7) inset" } : undefined}
  >
    {icon}
    <span>{label}</span>
    {count !== undefined && (
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px]"
        style={{
          ...mono,
          background: highlight ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.06)",
          color: highlight ? "#EF4444" : "#8A8275",
        }}
      >
        {count}
      </span>
    )}
  </button>
);

const BigStat = ({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "neutral" | "positive" | "negative" | "warning";
}) => {
  const cfg = {
    neutral:  { color: "#F4EEE2", halo: "rgba(255,255,255,0.04)" },
    positive: { color: "#4DB87A", halo: "rgba(77,184,122,0.18)" },
    negative: { color: "#EF4444", halo: "rgba(239,68,68,0.18)" },
    warning:  { color: "#E8B04C", halo: "rgba(232,176,76,0.18)" },
  }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card/60 p-3 backdrop-blur">
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full" style={{ background: cfg.halo, filter: "blur(28px)" }} />
      <div className="relative">
        <div className="mb-0.5 text-[9.5px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.2em" }}>
          {label}
        </div>
        <div className="text-xl font-semibold tracking-tight" style={{ color: cfg.color }}>{value}</div>
        {sub && <div className="mt-0.5 text-[10.5px] text-muted-foreground" style={mono}>{sub}</div>}
      </div>
    </div>
  );
};

const CapabilityCard = ({ cap, onToggleKill }: { cap: CapabilityRow; onToggleKill: () => void }) => {
  const precPct = Math.round(cap.precision * 100);
  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: cap.killed ? "rgba(239,68,68,0.40)" : "rgba(255,255,255,0.06)",
        background: cap.killed ? "rgba(239,68,68,0.04)" : "hsl(var(--card))",
      }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: `${cap.color}1A`, color: cap.color }}>
            {cap.icon}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{cap.label}</h3>
              {cap.killed ? (
                <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.16em", color: "#EF4444", borderColor: "rgba(239,68,68,0.45)", background: "rgba(239,68,68,0.08)" }}>
                  detenido
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.16em", color: "#4DB87A", borderColor: "rgba(77,184,122,0.40)", background: "rgba(77,184,122,0.06)" }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  operando
                </span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              <span style={mono}>{cap.tenantsActive}</span> de {cap.tenantsTotal} tenants tienen esta capability activa.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniMetric label="Decisiones 24h" value={cap.decisions24h.toLocaleString("es-ES")} />
          <MiniMetric label="Precisión" value={`${precPct}%`} accent={cap.color} />
          <MiniMetric label="Latencia p95" value={`${cap.latencyMs}ms`} />
          <MiniMetric label="Error rate" value={`${(cap.errorRate * 100).toFixed(2)}%`} accent={cap.errorRate > 0.01 ? "#E8B04C" : undefined} />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t pt-4 md:flex-row md:items-center md:justify-between" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="text-[11.5px] text-muted-foreground">
          {cap.killed
            ? "Capability detenida globalmente. Ningún tenant la está ejecutando ahora mismo."
            : "Si detectas drift, sesgos o un incidente grave, puedes parar esta capability en TODOS los tenants con un click."}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Eye className="mr-2 h-3.5 w-3.5" />
            Auditoría
          </Button>
          <button
            onClick={onToggleKill}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[11px] uppercase transition"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              color: cap.killed ? "#4DB87A" : "#EF4444",
              borderColor: cap.killed ? "rgba(77,184,122,0.40)" : "rgba(239,68,68,0.40)",
              background: cap.killed ? "rgba(77,184,122,0.06)" : "rgba(239,68,68,0.06)",
            }}
          >
            {cap.killed ? <Play className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            {cap.killed ? "Reanudar" : "Kill-switch"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MiniMetric = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="rounded-lg border p-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
    <div className="text-[9.5px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.2em" }}>{label}</div>
    <div className="text-[15px] font-semibold tracking-tight" style={{ color: accent ?? "#F4EEE2", ...mono }}>
      {value}
    </div>
  </div>
);

const AnomalyRow = ({ anomaly, onResolve, compact = false }: { anomaly: Anomaly; onResolve: () => void; compact?: boolean }) => {
  const sev = SEVERITY_CFG[anomaly.severity];
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-3"
      style={{ borderColor: sev.border, background: sev.bg }}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: sev.color + "20", color: sev.color }}>
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">{anomaly.title}</span>
          <span className="rounded-full px-1.5 py-0.5 text-[9px] uppercase" style={{ ...mono, letterSpacing: "0.16em", background: sev.color + "1A", color: sev.color }}>
            {sev.label}
          </span>
          {!compact && (
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]" style={{ ...mono, borderColor: "rgba(255,255,255,0.08)", color: "#8A8275" }}>
              <Building2 className="h-3 w-3" />
              {anomaly.tenantName}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">{anomaly.detail}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground" style={mono}>
          <span>{formatAgo(anomaly.ts)}</span>
          {compact && <span>· {anomaly.tenantName}</span>}
          <span>· capability:{anomaly.capability}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={onResolve}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium"
          style={{ background: "#4DB87A", color: "#fff", border: 0 }}
        >
          <Check className="h-3 w-3" />
          Resolver
        </button>
      </div>
    </div>
  );
};

const RESULT_CFG: Record<"ok" | "blocked" | "escalated", { color: string; bg: string; label: string }> = {
  ok:        { color: "#4DB87A", bg: "rgba(77,184,122,0.08)", label: "ok" },
  blocked:   { color: "#EF4444", bg: "rgba(239,68,68,0.08)",  label: "bloqueado" },
  escalated: { color: "#E8B04C", bg: "rgba(232,176,76,0.10)", label: "escalado" },
};

const AuditCompactRow = ({ entry }: { entry: AuditEntry }) => {
  const cap = CAPABILITIES.find((c) => c.id === entry.capability);
  const r = RESULT_CFG[entry.result];
  return (
    <div className="flex items-center gap-3 rounded-xl border p-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      {cap && (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md" style={{ background: `${cap.color}1A`, color: cap.color }}>
          {cap.icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px]">{entry.action}</div>
        <div className="truncate text-[10px] text-muted-foreground" style={mono}>
          {entry.tenantName} · {entry.modelVersion} · {formatAgo(entry.ts)}
        </div>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px] uppercase"
        style={{ ...mono, letterSpacing: "0.16em", color: r.color, background: r.bg }}
      >
        {r.label}
      </span>
    </div>
  );
};

const AuditFullRow = ({ entry }: { entry: AuditEntry }) => {
  const cap = CAPABILITIES.find((c) => c.id === entry.capability);
  const r = RESULT_CFG[entry.result];
  return (
    <div className="grid grid-cols-1 gap-2 border-b px-4 py-3 last:border-0 md:grid-cols-[110px_140px_1fr_120px_110px_90px] md:items-center md:gap-3" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
      <span className="text-[11px] text-muted-foreground" style={mono}>{formatAgo(entry.ts)}</span>
      <span className="inline-flex items-center gap-1.5 text-[12px]">
        <Building2 className="h-3 w-3 text-muted-foreground" />
        {entry.tenantName}
      </span>
      <span className="text-[12.5px]">{entry.action}</span>
      <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: cap?.color ?? "#8A8275" }}>
        {cap?.icon}
        <span className="opacity-90">{cap?.label}</span>
      </span>
      <span className="text-[11px] text-muted-foreground" style={mono}>{entry.modelVersion}</span>
      <span
        className="justify-self-start rounded-full px-2 py-0.5 text-[9.5px] uppercase md:justify-self-end"
        style={{ ...mono, letterSpacing: "0.16em", color: r.color, background: r.bg }}
      >
        {r.label}
      </span>
    </div>
  );
};

const formatAgo = (ts: number) => {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `hace ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  return `hace ${Math.floor(diffH / 24)}d`;
};

export default AISafetyConsole;
