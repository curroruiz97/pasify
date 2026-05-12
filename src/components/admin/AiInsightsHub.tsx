import { useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Calendar,
  Frown,
  Lightbulb,
  Meh,
  MessageSquare,
  Quote,
  Smile,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Mock insights data
// =============================================================

interface Anomaly {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  metric: string;
  delta: number;
  detectedAt: Date;
  affected: string;
}

const ANOMALIES: Anomaly[] = [
  {
    id: "an-1",
    severity: "critical",
    title: "Caída brusca de ventas — Razzmatazz",
    description:
      "Las ventas online han bajado un 68% en las últimas 4 horas frente al esperado. Posible problema técnico en Stripe Connect.",
    metric: "Ventas/h",
    delta: -68,
    detectedAt: new Date(Date.now() - 38 * 60 * 1000),
    affected: "Razzmatazz · 1 evento activo",
  },
  {
    id: "an-2",
    severity: "warning",
    title: "Pico anómalo de chargebacks",
    description:
      "Los chargebacks de Pacha Ibiza han pasado de 0.2% a 1.4% esta semana. Sospecha de patrón de fraude organizado.",
    metric: "Chargeback rate",
    delta: 600,
    detectedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    affected: "Pacha Ibiza",
  },
  {
    id: "an-3",
    severity: "warning",
    title: "Latencia API por encima de objetivo",
    description: "El p99 de /api/orders ha subido a 1.2s (SLA 800ms) durante 35 minutos.",
    metric: "p99 latencia",
    delta: 50,
    detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    affected: "Plataforma global",
  },
  {
    id: "an-4",
    severity: "info",
    title: "Crecimiento inesperado en TikTok",
    description:
      "El tráfico desde TikTok hacia evento Festival Medusa ha crecido +320% — investigar si replicar campaña.",
    metric: "Tráfico canal",
    delta: 320,
    detectedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    affected: "Medusa Festival",
  },
];

const SEV_CFG: Record<Anomaly["severity"], { label: string; color: string; icon: React.ReactNode }> = {
  critical: { label: "Crítico", color: "#B8381A", icon: <AlertCircle className="h-3.5 w-3.5" /> },
  warning: { label: "Aviso", color: "#E8B04C", icon: <Activity className="h-3.5 w-3.5" /> },
  info: { label: "Info", color: "#4DB87A", icon: <Lightbulb className="h-3.5 w-3.5" /> },
};

interface SentimentBucket {
  partner: string;
  positive: number;
  neutral: number;
  negative: number;
  nps: number;
  topQuotes: { text: string; sentiment: "positive" | "neutral" | "negative" }[];
}

const SENTIMENT: SentimentBucket[] = [
  {
    partner: "Pacha Ibiza",
    positive: 0.72,
    neutral: 0.18,
    negative: 0.1,
    nps: 64,
    topQuotes: [
      { text: "La mejor noche del verano. Resident DJ TOP.", sentiment: "positive" },
      { text: "Mucha cola en barra, pero buen ambiente.", sentiment: "neutral" },
      { text: "El precio de las bebidas es exagerado.", sentiment: "negative" },
    ],
  },
  {
    partner: "Razzmatazz",
    positive: 0.65,
    neutral: 0.22,
    negative: 0.13,
    nps: 48,
    topQuotes: [
      { text: "Sound system es brutal, sala 3 una pasada.", sentiment: "positive" },
      { text: "Demasiado lleno para mi gusto.", sentiment: "negative" },
    ],
  },
  {
    partner: "Sala Apolo",
    positive: 0.81,
    neutral: 0.13,
    negative: 0.06,
    nps: 72,
    topQuotes: [
      { text: "Programación impecable, line-up indie único.", sentiment: "positive" },
      { text: "Mejor venue para conciertos de Barcelona.", sentiment: "positive" },
    ],
  },
];

// =============================================================
// AI Insights Hub
// =============================================================

export const AiInsightsHub = () => {
  const [tab, setTab] = useState<"anomalies" | "postmortem" | "sentiment">("anomalies");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          AI <span style={serif} className="text-orange-500">Insights</span> Hub
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          La IA observa la red 24/7 y te trae anomalías, post-mortems generados y el pulso emocional de tus clientes.
        </p>
      </header>

      {/* Status banner */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(70px)" }}
        />
        <div className="relative flex items-start gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.6)",
            }}
          >
            <Brain className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="relative inline-flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                  style={{ background: "#4DB87A" }}
                />
                <span
                  className="relative inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ background: "#4DB87A" }}
                />
              </span>
              IA · Monitoreando
            </div>
            <h3 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
              {ANOMALIES.length} anomalías detectadas · {SENTIMENT.length} partners analizados
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Última pasada hace 2 minutos. Modelo recalibrado esta mañana con 142 eventos del histórico.
            </p>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-end gap-1 border-b border-border">
        <Tab active={tab === "anomalies"} onClick={() => setTab("anomalies")} icon={<AlertCircle className="h-4 w-4" />}>
          Anomalías
        </Tab>
        <Tab active={tab === "postmortem"} onClick={() => setTab("postmortem")} icon={<Sparkles className="h-4 w-4" />}>
          Post-mortems
        </Tab>
        <Tab active={tab === "sentiment"} onClick={() => setTab("sentiment")} icon={<MessageSquare className="h-4 w-4" />}>
          Sentiment
        </Tab>
      </div>

      {tab === "anomalies" && <AnomaliesView />}
      {tab === "postmortem" && <PostmortemView />}
      {tab === "sentiment" && <SentimentView />}
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
    className="group relative inline-flex items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition"
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
// Anomalies
// =============================================================

const AnomaliesView = () => (
  <section className="space-y-3">
    {ANOMALIES.map((a) => (
      <AnomalyCard key={a.id} a={a} />
    ))}
  </section>
);

const AnomalyCard = ({ a }: { a: Anomaly }) => {
  const cfg = SEV_CFG[a.severity];
  const up = a.delta >= 0;
  return (
    <article
      className="relative overflow-hidden rounded-2xl border bg-card p-5"
      style={{
        borderColor: `${cfg.color}40`,
        background: `linear-gradient(135deg, ${cfg.color}08 0%, transparent 100%)`,
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: `${cfg.color}22`,
                color: cfg.color,
              }}
            >
              {cfg.icon}
              {cfg.label}
            </span>
            <span
              className="text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {format(a.detectedAt, "d MMM · HH:mm", { locale: es })}
            </span>
          </div>
          <h4 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
            {a.title}
          </h4>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{a.description}</p>
          <div
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase"
            style={{ ...mono, letterSpacing: "0.16em", color: "#8A8275" }}
          >
            <Activity className="h-3 w-3" />
            {a.affected}
          </div>
        </div>

        <div className="text-right">
          <div
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            {a.metric}
          </div>
          <div
            className="mt-1 inline-flex items-center gap-0.5 text-2xl font-bold"
            style={{ ...mono, color: cfg.color }}
          >
            {up ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
            {up ? "+" : ""}
            {a.delta}%
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm">Investigar</Button>
        <Button size="sm" variant="outline">
          Marcar como vista
        </Button>
        <Button size="sm" variant="ghost">
          Silenciar 24h
        </Button>
      </div>
    </article>
  );
};

// =============================================================
// Post-mortem auto-generated
// =============================================================

const PostmortemView = () => {
  const event = {
    title: "Saturday Night · Resident DJs",
    venue: "Pacha Ibiza",
    date: subDays(new Date(), 2),
    sold: 612,
    capacity: 800,
    revenueCents: 91800_00,
    nps: 64,
  };

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-7"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
      />

      <header className="relative mb-5">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <Sparkles className="h-3 w-3" />
          Post-mortem generado · IA
        </div>
        <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
          {event.title}
        </h3>
        <div
          className="mt-1 inline-flex items-center gap-2 text-[12px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.16em" }}
        >
          <Calendar className="h-3 w-3" />
          {format(event.date, "EEEE d MMM", { locale: es })} · {event.venue}
        </div>
      </header>

      {/* TLDR */}
      <section
        className="relative rounded-2xl border border-orange-500/30 bg-orange-500/[0.08] p-5"
      >
        <div
          className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <Zap className="h-3 w-3" />
          TL;DR · escrito por la IA
        </div>
        <p className="text-base leading-relaxed text-foreground" style={serif}>
          “{event.title} cerró con <strong style={{ color: "#FF7A4D" }}>{event.sold} de {event.capacity}</strong> entradas vendidas (
          <strong style={{ color: "#FF7A4D" }}>76%</strong> de aforo) y{" "}
          <strong style={{ color: "#FF7A4D" }}>{(event.revenueCents / 100).toLocaleString("es-ES")}€</strong> de revenue,
          un <strong style={{ color: "#4DB87A" }}>+14% vs el sábado anterior</strong>. El pico de entrada fue a las{" "}
          <strong style={{ color: "#FF7A4D" }}>00:18h</strong>; el cuello de botella estuvo en la puerta 2 (escáner lento).
          Top RRPP: Carla con 38 entradas. El NPS llegó a {event.nps} — el comentario negativo más recurrente fue el precio de bebidas."
        </p>
      </section>

      {/* Highlights */}
      <section className="relative mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <HighlightCard
          icon={<ArrowUpRight className="h-4 w-4" />}
          color="#4DB87A"
          title="Lo que funcionó"
          items={[
            "+14% revenue vs sábado anterior",
            "RRPP top vendió 38 entradas",
            "Cierre Z sin discrepancias",
          ]}
        />
        <HighlightCard
          icon={<AlertCircle className="h-4 w-4" />}
          color="#E8B04C"
          title="Mejoras"
          items={[
            "Puerta 2 lenta (47% bajo media)",
            "Cola en barra principal 00:30h",
            "5 chargebacks abiertos",
          ]}
        />
        <HighlightCard
          icon={<Lightbulb className="h-4 w-4" />}
          color="#FF7A4D"
          title="Acciones IA"
          items={[
            "Subir precio +1.5€ en próximo sábado",
            "Reforzar puerta 2 con segundo escáner",
            "Email reactivación a 84 inactivos",
          ]}
        />
      </section>

      <footer className="relative mt-6 flex gap-2 border-t border-border pt-5">
        <Button>
          <Sparkles className="mr-2 h-4 w-4" />
          Aplicar acciones IA
        </Button>
        <Button variant="outline">Generar PDF</Button>
        <Button variant="ghost">Compartir con partner</Button>
      </footer>
    </article>
  );
};

const HighlightCard = ({
  icon,
  color,
  title,
  items,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  items: string[];
}) => (
  <div
    className="rounded-2xl border p-4"
    style={{
      background: `${color}08`,
      borderColor: `${color}40`,
    }}
  >
    <div
      className="inline-flex items-center gap-1.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.2em", color }}
    >
      {icon}
      {title}
    </div>
    <ul className="mt-3 space-y-1.5 text-sm text-foreground/85">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-1.5">
          <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {t}
        </li>
      ))}
    </ul>
  </div>
);

// =============================================================
// Sentiment view
// =============================================================

const SentimentView = () => (
  <section className="space-y-4">
    {SENTIMENT.map((s) => (
      <SentimentCard key={s.partner} bucket={s} />
    ))}
  </section>
);

const SentimentCard = ({ bucket }: { bucket: SentimentBucket }) => (
  <article
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
  >
    <header className="flex items-start justify-between gap-3">
      <div>
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <MessageSquare className="h-3 w-3" />
          Sentiment · IA
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
          {bucket.partner}
        </h3>
      </div>
      <div className="text-right">
        <div
          className="text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          NPS
        </div>
        <div
          className="mt-0.5 text-3xl font-bold"
          style={{
            ...mono,
            color: bucket.nps >= 50 ? "#4DB87A" : bucket.nps >= 20 ? "#E8B04C" : "#B8381A",
          }}
        >
          {bucket.nps}
        </div>
      </div>
    </header>

    {/* Sentiment bar */}
    <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full">
      <div
        style={{
          width: `${bucket.positive * 100}%`,
          background: "linear-gradient(90deg, #4DB87A 0%, #2D7A4F 100%)",
        }}
      />
      <div
        style={{
          width: `${bucket.neutral * 100}%`,
          background: "rgba(232,176,76,0.6)",
        }}
      />
      <div
        style={{
          width: `${bucket.negative * 100}%`,
          background: "linear-gradient(90deg, #B8381A 0%, #6F1F08 100%)",
        }}
      />
    </div>
    <div
      className="mt-2 flex items-center justify-between text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      <span className="inline-flex items-center gap-1" style={{ color: "#4DB87A" }}>
        <Smile className="h-3 w-3" />
        {Math.round(bucket.positive * 100)}% positivo
      </span>
      <span className="inline-flex items-center gap-1">
        <Meh className="h-3 w-3" />
        {Math.round(bucket.neutral * 100)}% neutro
      </span>
      <span className="inline-flex items-center gap-1" style={{ color: "#B8381A" }}>
        <Frown className="h-3 w-3" />
        {Math.round(bucket.negative * 100)}% negativo
      </span>
    </div>

    {/* Top quotes */}
    <div className="mt-5 space-y-2 border-t border-border pt-4">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.2em" }}
      >
        Citas relevantes
      </div>
      {bucket.topQuotes.map((q, i) => {
        const color =
          q.sentiment === "positive" ? "#4DB87A" : q.sentiment === "negative" ? "#B8381A" : "#E8B04C";
        return (
          <div key={i} className="flex items-start gap-2.5">
            <Quote className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color }} />
            <p className="text-sm leading-relaxed text-foreground/85" style={serif}>
              "{q.text}"
            </p>
          </div>
        );
      })}
    </div>
  </article>
);

export default AiInsightsHub;
