import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Brain,
  Calendar,
  ChevronRight,
  Clock,
  Copy as CopyIcon,
  Eye,
  FlaskConical,
  Globe,
  Image as ImageIcon,
  Instagram,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Demo data
// =============================================================

type ChannelKind = "email" | "push" | "sms" | "whatsapp";

interface Campaign {
  id: string;
  name: string;
  channels: ChannelKind[];
  audience: string;
  recipients: number;
  status: "live" | "scheduled" | "draft" | "completed";
  scheduledAt: Date | null;
  sentAt: Date | null;
  openRate: number;
  clickRate: number;
  revenueCents: number;
  abTest: boolean;
}

const CAMPAIGNS: Campaign[] = [
  {
    id: "c-1",
    name: "Pre-onda Saturday Night",
    channels: ["email", "push"],
    audience: "Recurrentes Madrid",
    recipients: 842,
    status: "live",
    scheduledAt: null,
    sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    openRate: 0.62,
    clickRate: 0.28,
    revenueCents: 9420_00,
    abTest: true,
  },
  {
    id: "c-2",
    name: "Re-engagement inactivos 90d",
    channels: ["email", "whatsapp"],
    audience: "Inactivos · 90+ días",
    recipients: 1248,
    status: "scheduled",
    scheduledAt: new Date(Date.now() + 26 * 60 * 60 * 1000),
    sentAt: null,
    openRate: 0,
    clickRate: 0,
    revenueCents: 0,
    abTest: false,
  },
  {
    id: "c-3",
    name: "Cumpleaños del mes — 20% off",
    channels: ["email", "sms", "push"],
    audience: "Cumple en marzo",
    recipients: 84,
    status: "live",
    scheduledAt: null,
    sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    openRate: 0.78,
    clickRate: 0.41,
    revenueCents: 1240_00,
    abTest: false,
  },
  {
    id: "c-4",
    name: "Closing Party · invite VIPs",
    channels: ["whatsapp"],
    audience: "VIPs Pacha",
    recipients: 42,
    status: "completed",
    scheduledAt: null,
    sentAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    openRate: 0.95,
    clickRate: 0.71,
    revenueCents: 14600_00,
    abTest: false,
  },
  {
    id: "c-5",
    name: "Festival pase 3 días · Early bird",
    channels: ["email", "push"],
    audience: "Toda la base · Valencia",
    recipients: 2480,
    status: "draft",
    scheduledAt: null,
    sentAt: null,
    openRate: 0,
    clickRate: 0,
    revenueCents: 0,
    abTest: true,
  },
];

const CHANNEL_CONFIG: Record<ChannelKind, { label: string; color: string; icon: React.ReactNode }> = {
  email: { label: "Email", color: "#FF7A4D", icon: <Mail className="h-3.5 w-3.5" /> },
  push: { label: "Push", color: "#E8542A", icon: <Send className="h-3.5 w-3.5" /> },
  sms: { label: "SMS", color: "#E8B04C", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  whatsapp: { label: "WhatsApp", color: "#4DB87A", icon: <MessageSquare className="h-3.5 w-3.5" /> },
};

const STATUS_CFG: Record<Campaign["status"], { label: string; color: string }> = {
  live: { label: "En curso", color: "#4DB87A" },
  scheduled: { label: "Programado", color: "#E8B04C" },
  draft: { label: "Borrador", color: "#8A8275" },
  completed: { label: "Finalizado", color: "#5C544A" },
};

// =============================================================
// Marketing Engine main
// =============================================================

export const PartnerMarketing = () => {
  const [tab, setTab] = useState<"campaigns" | "studio" | "ads" | "automations">("campaigns");

  const totalRecipients = CAMPAIGNS.reduce((s, c) => s + c.recipients, 0);
  const totalRevenue = CAMPAIGNS.reduce((s, c) => s + c.revenueCents, 0);
  const avgOpen =
    CAMPAIGNS.filter((c) => c.openRate > 0).length > 0
      ? CAMPAIGNS.filter((c) => c.openRate > 0).reduce((s, c) => s + c.openRate, 0) /
        CAMPAIGNS.filter((c) => c.openRate > 0).length
      : 0;

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<Send className="h-4 w-4" />} color="#FF7A4D" eyebrow="Enviados últimos 30d" value={totalRecipients.toLocaleString("es-ES")} sub={`${CAMPAIGNS.length} campañas`} />
        <KpiTile icon={<Eye className="h-4 w-4" />} color="#E8542A" eyebrow="Open rate medio" value={`${(avgOpen * 100).toFixed(0)}%`} sub="vs 23% benchmark" />
        <KpiTile icon={<TrendingUp className="h-4 w-4" />} color="#4DB87A" eyebrow="Revenue atribuido" value={`${(totalRevenue / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`} sub="LTV directo" />
        <KpiTile icon={<Brain className="h-4 w-4" />} color="#E8B04C" eyebrow="A/B test activos" value={CAMPAIGNS.filter((c) => c.abTest).length.toString()} sub="IA optimiza" pulse />
      </section>

      {/* Tabs */}
      <div className="flex items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          <Tab active={tab === "campaigns"} onClick={() => setTab("campaigns")} icon={<Target className="h-4 w-4" />}>
            Campañas
          </Tab>
          <Tab active={tab === "studio"} onClick={() => setTab("studio")} icon={<Wand2 className="h-4 w-4" />}>
            Studio
          </Tab>
          <Tab active={tab === "automations"} onClick={() => setTab("automations")} icon={<Zap className="h-4 w-4" />}>
            Automatizaciones
          </Tab>
          <Tab active={tab === "ads"} onClick={() => setTab("ads")} icon={<Globe className="h-4 w-4" />}>
            Ads
          </Tab>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      {tab === "campaigns" && <CampaignsList />}
      {tab === "studio" && <CampaignStudio />}
      {tab === "automations" && <Automations />}
      {tab === "ads" && <AdsDashboard />}
    </div>
  );
};

const Tab = ({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative inline-flex shrink-0 items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition"
    style={{ color: active ? "#F4EEE2" : "#8A8275" }}
  >
    {icon}
    {children}
    <span
      aria-hidden="true"
      className="absolute inset-x-3 -bottom-px h-0.5 transition"
      style={{
        background: active
          ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)"
          : "transparent",
        boxShadow: active ? "0 0 12px rgba(232,84,42,0.65)" : "none",
      }}
    />
  </button>
);

// =============================================================
// Campaigns list
// =============================================================

const CampaignsList = () => (
  <section className="space-y-3">
    {CAMPAIGNS.map((c) => (
      <CampaignRow key={c.id} c={c} />
    ))}
  </section>
);

const CampaignRow = ({ c }: { c: Campaign }) => {
  const status = STATUS_CFG[c.status];
  return (
    <article
      className="rounded-2xl border border-border bg-card p-4 md:p-5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: `${status.color}22`,
                color: status.color,
                border: `1px solid ${status.color}44`,
              }}
            >
              {status.label}
            </span>
            {c.abTest && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.18em",
                  background: "rgba(232,176,76,0.18)",
                  color: "#E8B04C",
                }}
              >
                <FlaskConical className="h-2.5 w-2.5" />
                A/B test
              </span>
            )}
            {c.channels.map((ch) => {
              const cfg = CHANNEL_CONFIG[ch];
              return (
                <span
                  key={ch}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase"
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    background: `${cfg.color}22`,
                    color: cfg.color,
                  }}
                >
                  {cfg.icon}
                  {cfg.label}
                </span>
              );
            })}
          </div>
          <h4 className="mt-2 text-base font-semibold tracking-tight text-foreground md:text-lg">
            {c.name}
          </h4>
          <div
            className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
            style={mono}
          >
            <Target className="h-3 w-3" />
            {c.audience} · {c.recipients.toLocaleString("es-ES")} destinatarios
            {c.scheduledAt && (
              <>
                <span className="opacity-50">·</span>
                <Clock className="h-3 w-3" />
                {c.scheduledAt.toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}h
              </>
            )}
          </div>
        </div>

        <div className="grid w-full grid-cols-3 gap-x-4 text-right sm:w-auto md:flex md:items-center md:gap-6">
          <Stat label="Open" value={c.openRate > 0 ? `${(c.openRate * 100).toFixed(0)}%` : "—"} highlight={c.openRate > 0.5} />
          <Stat label="CTR" value={c.clickRate > 0 ? `${(c.clickRate * 100).toFixed(0)}%` : "—"} />
          <Stat label="Revenue" value={c.revenueCents > 0 ? `${(c.revenueCents / 100).toFixed(0)}€` : "—"} highlight={c.revenueCents > 0} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {c.status === "live" && (
            <Button size="sm" variant="outline">
              <Pause className="h-3.5 w-3.5" />
            </Button>
          )}
          {c.status === "draft" && (
            <Button size="sm">
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Enviar
            </Button>
          )}
          <Button size="sm" variant="ghost">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
};

const Stat = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div>
    <div
      className="text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div
      className="mt-0.5 text-sm font-bold"
      style={{ ...mono, color: highlight ? "#4DB87A" : "#F4EEE2" }}
    >
      {value}
    </div>
  </div>
);

// =============================================================
// Campaign Studio (drag-and-drop flow + IA copy gen)
// =============================================================

const CampaignStudio = () => {
  const [subject, setSubject] = useState("Tu sábado en {{venueName}} te espera");
  const [body, setBody] = useState(
    "Hola {{firstName}},\n\nEste sábado tenemos un cartel que no querrás perderte. Resident DJs hasta el cierre, mesas VIP con bottle de cortesía y puerta abierta hasta las 03h.\n\nLas entradas vuelan — quedan menos de 200 disponibles."
  );
  const [iaGenerating, setIaGenerating] = useState(false);

  const generate = () => {
    setIaGenerating(true);
    setTimeout(() => {
      setSubject("⚡ Quedan 187 entradas para tu sábado");
      setBody(
        "Hola {{firstName}},\n\nVi que llevas 2 sábados sin venir 👀 — no sería casualidad que justo esta semana cerremos con uno de los line-ups más fuertes del trimestre. Mesa VIP gratis si entras antes de las 23:30 con este enlace.\n\nNos vemos en {{venueName}}."
      );
      setIaGenerating(false);
    }, 1200);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
      {/* Editor */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Wand2 className="h-3 w-3" />
              Editor visual
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              Composer
            </h3>
          </div>
          <Button onClick={generate} disabled={iaGenerating} variant="outline">
            <Sparkles className="mr-2 h-4 w-4" />
            {iaGenerating ? "Generando…" : "Generar con IA"}
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Asunto</Label>
            <Input
              className="mt-1.5 h-11 rounded-xl"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <div
              className="mt-1 flex justify-between text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              <span className={subject.length > 50 ? "text-amber-400" : "text-muted-foreground"}>
                {subject.length} / 50 chars (ideal)
              </span>
              <span className="text-emerald-500">Score 8.7/10</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Cuerpo</Label>
            <textarea
              className="mt-1.5 min-h-[200px] w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition focus:border-orange-500/60"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div
              className="mt-1 flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              <Sparkles className="h-3 w-3 text-orange-500" />
              Personalización: {body.split("{{").length - 1} tokens
            </div>
          </div>

          {/* AI send-time optimization */}
          <div
            className="rounded-2xl border p-4"
            style={{
              background: "linear-gradient(135deg, rgba(232,176,76,0.08) 0%, rgba(232,176,76,0.02) 100%)",
              borderColor: "rgba(232,176,76,0.3)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                style={{
                  background: "linear-gradient(180deg, #E8B04C 0%, #A6781D 100%)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
                }}
              >
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[10px] uppercase"
                  style={{ ...mono, letterSpacing: "0.2em", color: "#E8B04C" }}
                >
                  Send-time IA
                </div>
                <div className="mt-0.5 text-sm font-semibold text-foreground">
                  Tu audiencia abre más a las <span style={mono}>19:14h</span> los jueves
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Programar para entonces aumenta el open rate un +18% en histórico.
                </p>
              </div>
              <Button size="sm" variant="outline">
                Activar
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Preview */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Eye className="h-3 w-3" />
            Preview
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            Cómo se ve en el inbox
          </h3>
        </div>

        <div
          className="overflow-hidden rounded-2xl border border-border bg-background/40"
          style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
        >
          <div
            className="border-b border-border p-4"
            style={{
              background: "linear-gradient(135deg, rgba(232,84,42,0.1) 0%, rgba(184,56,26,0.02) 100%)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
                style={{
                  background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                Pa
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{subject}</div>
                <div
                  className="text-[11px] text-muted-foreground"
                  style={mono}
                >
                  Pacha Ibiza · hace 2 min
                </div>
              </div>
            </div>
          </div>

          <div className="whitespace-pre-wrap p-4 text-sm leading-relaxed text-foreground/85">
            {body}
          </div>

          <div className="border-t border-border p-4">
            <button
              type="button"
              className="w-full rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
              }}
            >
              Coger mi entrada →
            </button>
          </div>
        </div>

        {/* Spam score */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <ScoreTile label="Score asunto" value="8.7" color="#4DB87A" />
          <ScoreTile label="Spam risk" value="Bajo" color="#4DB87A" />
          <ScoreTile label="Lectura mobile" value="OK" color="#4DB87A" />
        </div>
      </section>
    </div>
  );
};

const ScoreTile = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div
    className="rounded-xl border p-2.5"
    style={{
      background: `${color}11`,
      borderColor: `${color}44`,
    }}
  >
    <div
      className="text-[9px] uppercase"
      style={{ ...mono, letterSpacing: "0.16em", color }}
    >
      {label}
    </div>
    <div className="mt-0.5 text-sm font-bold" style={{ ...mono, color: "#F4EEE2" }}>
      {value}
    </div>
  </div>
);

// =============================================================
// Automations (visual flow builder mock)
// =============================================================

const AUTOMATIONS = [
  {
    id: "auto-1",
    name: "Bienvenida nuevos clientes",
    description: "Email + push cuando alguien compra su 1ª entrada",
    steps: 4,
    active: true,
    runsThisMonth: 184,
  },
  {
    id: "auto-2",
    name: "Re-engagement 30d",
    description: "Si no compras en 30 días, oferta -15%",
    steps: 6,
    active: true,
    runsThisMonth: 92,
  },
  {
    id: "auto-3",
    name: "Cumpleaños",
    description: "Felicitación + perk especial 7 días antes",
    steps: 3,
    active: true,
    runsThisMonth: 48,
  },
  {
    id: "auto-4",
    name: "Carrito abandonado",
    description: "Si añadiste entrada y no compraste en 24h",
    steps: 5,
    active: false,
    runsThisMonth: 0,
  },
];

const Automations = () => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div
        className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.2em" }}
      >
        <Zap className="h-3 w-3" />
        Flows activos · {AUTOMATIONS.filter((a) => a.active).length} de {AUTOMATIONS.length}
      </div>
      <Button size="sm">
        <Plus className="mr-2 h-3.5 w-3.5" />
        Nueva automatización
      </Button>
    </div>

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {AUTOMATIONS.map((a) => (
        <article
          key={a.id}
          className="relative overflow-hidden rounded-2xl border border-border bg-card p-5"
          style={{
            boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
            opacity: a.active ? 1 : 0.7,
          }}
        >
          <header className="flex items-start justify-between">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
              style={{
                background: a.active
                  ? "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)"
                  : "rgba(255,255,255,0.06)",
                boxShadow: a.active ? "inset 0 1px 0 rgba(255,255,255,0.25)" : "none",
                color: a.active ? "#fff" : "#8A8275",
              }}
            >
              <Zap className="h-4 w-4" />
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: a.active ? "rgba(77,184,122,0.18)" : "rgba(140,140,140,0.12)",
                color: a.active ? "#4DB87A" : "#8A8275",
              }}
            >
              {a.active ? "Activo" : "Pausado"}
            </span>
          </header>

          <h4 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
            {a.name}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>

          <div className="mt-4 flex items-center gap-3">
            <div
              className="inline-flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              <Wand2 className="h-3 w-3" />
              {a.steps} pasos
            </div>
            <div
              className="inline-flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              <TrendingUp className="h-3 w-3" />
              {a.runsThisMonth} runs este mes
            </div>
          </div>

          {/* Visual flow preview */}
          <div className="mt-4 flex items-center gap-1">
            {Array.from({ length: a.steps }).map((_, i) => (
              <div key={i} className="flex flex-1 items-center">
                <div
                  className="flex h-7 flex-1 items-center justify-center rounded-md text-[10px]"
                  style={{
                    ...mono,
                    background: a.active
                      ? `linear-gradient(90deg, rgba(77,184,122,${0.18 + i * 0.05}) 0%, rgba(77,184,122,${0.28 + i * 0.05}) 100%)`
                      : "rgba(255,255,255,0.04)",
                    color: a.active ? "#4DB87A" : "#8A8275",
                    letterSpacing: "0.12em",
                  }}
                >
                  {i === 0 ? "✉" : i === a.steps - 1 ? "🎯" : "→"}
                </div>
                {i < a.steps - 1 && <span className="mx-0.5 text-muted-foreground">·</span>}
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  </div>
);

// =============================================================
// Ads dashboard (Meta/TikTok/Google integrated)
// =============================================================

const ADS_PLATFORMS = [
  { id: "meta", label: "Meta (FB+IG)", color: "#1877F2", spend: 480, sales: 28, cpa: 17.1 },
  { id: "tiktok", label: "TikTok Ads", color: "#000000", spend: 320, sales: 19, cpa: 16.8 },
  { id: "google", label: "Google Ads", color: "#4285F4", spend: 240, sales: 14, cpa: 17.1 },
];

const AdsDashboard = () => {
  const totalSpend = ADS_PLATFORMS.reduce((s, p) => s + p.spend, 0);
  const totalSales = ADS_PLATFORMS.reduce((s, p) => s + p.sales, 0);
  const blendedCpa = totalSales > 0 ? totalSpend / totalSales : 0;

  return (
    <div className="space-y-6">
      <section
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
          style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
        />

        <header className="relative flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Globe className="h-3 w-3" />
              Ads · Esta semana
            </div>
            <h3 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {totalSpend.toFixed(0)}€{" "}
              <span className="text-muted-foreground" style={serif}>
                de inversión
              </span>
            </h3>
            <div
              className="mt-1 text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {totalSales} ventas · {blendedCpa.toFixed(2)}€ CPA blended
            </div>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva campaña ad
          </Button>
        </header>

        <div className="relative mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {ADS_PLATFORMS.map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-border p-4"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div
                className="inline-flex items-center gap-1.5 text-[10px] uppercase"
                style={{ ...mono, letterSpacing: "0.18em", color: p.color === "#000000" ? "#F4EEE2" : p.color }}
              >
                <Globe className="h-3 w-3" />
                {p.label}
              </div>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <div className="text-2xl font-bold text-foreground" style={mono}>
                    {p.spend}€
                  </div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    {p.sales} ventas · {p.cpa}€ CPA
                  </div>
                </div>
                <span
                  className="inline-flex items-center gap-0.5 text-[10px]"
                  style={{ ...mono, color: "#4DB87A" }}
                >
                  <ArrowUpRight className="h-3 w-3" />
                  Top
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-2xl border p-5"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.6)",
            }}
          >
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Sparkles className="h-3 w-3" />
              IA · Recomendación
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Reasigna 80€ de Google → TikTok
            </h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              TikTok tiene un CPA un 12% mejor y la audiencia 18-25 está infrarrepresentada en
              tu mix actual. Cambiarías ~5 ventas extras / semana sin subir presupuesto.
            </p>
            <Button className="mt-3" size="sm">
              Aplicar reasignación
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

// =============================================================
// Shared KPI tile
// =============================================================

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
  pulse,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
  pulse?: boolean;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
      style={{ background: `${color}26`, filter: "blur(28px)" }}
    />
    <div className="relative flex items-center justify-between">
      <div
        className="inline-flex items-center gap-1.5 text-[10px] uppercase"
        style={{ ...mono, letterSpacing: "0.18em", color }}
      >
        {icon}
        {eyebrow}
      </div>
      {pulse && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
            style={{ background: color }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
          />
        </span>
      )}
    </div>
    <div
      className="relative mt-3 text-2xl font-bold tracking-tight text-foreground md:text-3xl"
      style={mono}
    >
      {value}
    </div>
    <div
      className="relative mt-1 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.14em" }}
    >
      {sub}
    </div>
  </div>
);

export default PartnerMarketing;
