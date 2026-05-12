import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Check,
  Gauge,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface PricingEvent {
  id: string;
  title: string;
  date_start: string;
  capacity: number;
  tickets_sold: number;
  basePriceCents: number;
  /** Activo: ¿la IA ajusta precio automáticamente? */
  dynamicActive: boolean;
  /** Precio actual (puede ser ajustado por IA) */
  currentPriceCents: number;
  /** Rango definido por el operador */
  minPriceCents: number;
  maxPriceCents: number;
  /** % vendido a lo largo del tiempo (puntos para curva) */
  history: Array<{ dayOffset: number; soldPct: number; priceCents: number }>;
  predictedFinalSold: number;
  optimalPriceCents: number;
  uplift: number; // 0-1 (revenue ganado vs precio fijo)
}

interface Props {
  events: Array<{
    id: string;
    title: string;
    date_start: string;
    capacity: number | null;
    tickets_sold: number;
    price_cents: number;
  }>;
}

const buildPricingEvent = (e: Props["events"][number]): PricingEvent => {
  const capacity = e.capacity ?? 800;
  const base = e.price_cents ?? 1500;
  const soldPct = capacity > 0 ? (e.tickets_sold / capacity) * 100 : 0;
  const seed = e.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const dynamicActive = seed % 3 !== 0;
  const optimal = Math.round(base * (1 + (seed % 7) * 0.025));
  const uplift = 0.05 + ((seed % 11) / 100);
  const current = dynamicActive ? optimal : base;

  // History 30 days
  const history: PricingEvent["history"] = Array.from({ length: 30 }).map((_, i) => {
    const day = i - 29;
    const pct = Math.min(100, Math.max(0, soldPct * (i / 29) * (1 + Math.sin(i * 0.4) * 0.1)));
    const priceVar = base + Math.sin(i * 0.5) * (base * 0.08);
    return { dayOffset: day, soldPct: pct, priceCents: Math.round(priceVar) };
  });

  return {
    id: e.id,
    title: e.title,
    date_start: e.date_start,
    capacity,
    tickets_sold: e.tickets_sold,
    basePriceCents: base,
    dynamicActive,
    currentPriceCents: current,
    minPriceCents: Math.round(base * 0.85),
    maxPriceCents: Math.round(base * 1.35),
    history,
    predictedFinalSold: Math.min(capacity, Math.round(e.tickets_sold + (capacity - e.tickets_sold) * 0.75)),
    optimalPriceCents: optimal,
    uplift,
  };
};

// =============================================================
// Main
// =============================================================

export const PartnerDynamicPricing = ({ events }: Props) => {
  const upcoming = useMemo(
    () =>
      events
        .filter((e) => new Date(e.date_start).getTime() > Date.now())
        .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
        .slice(0, 6),
    [events]
  );
  const pricingEvents = useMemo(() => upcoming.map(buildPricingEvent), [upcoming]);
  const [selectedId, setSelectedId] = useState<string | null>(pricingEvents[0]?.id ?? null);
  const selected = pricingEvents.find((e) => e.id === selectedId) ?? pricingEvents[0] ?? null;

  if (pricingEvents.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground"
      >
        Publica un evento futuro para activar el motor de pricing dinámico.
      </div>
    );
  }

  // Network stats
  const activeCount = pricingEvents.filter((e) => e.dynamicActive).length;
  const avgUplift =
    pricingEvents.length > 0
      ? pricingEvents.reduce((s, e) => s + e.uplift, 0) / pricingEvents.length
      : 0;
  const totalUpliftCents = pricingEvents.reduce(
    (s, e) => s + (e.dynamicActive ? e.tickets_sold * e.basePriceCents * e.uplift : 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(80px)" }}
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(232,84,42,0.6)",
              }}
            >
              <Gauge className="h-6 w-6" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                Dynamic pricing · IA
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Subiendo el revenue <span style={serif} className="text-orange-500">+{(avgUplift * 100).toFixed(1)}%</span> de media
              </h2>
              <div
                className="mt-1 text-[12px] text-muted-foreground"
                style={mono}
              >
                {activeCount} de {pricingEvents.length} eventos con IA activa ·{" "}
                {(totalUpliftCents / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€ extra estimados
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Layout split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.5fr]">
        {/* Events list */}
        <div className="space-y-2">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Target className="h-3 w-3" />
            Eventos próximos
          </div>
          {pricingEvents.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              className="block w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5"
              style={{
                background: e.id === selectedId ? "rgba(232,84,42,0.06)" : "rgba(255,255,255,0.02)",
                borderColor: e.id === selectedId ? "rgba(232,84,42,0.5)" : "rgba(244,238,226,0.1)",
                boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{e.title}</div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    {format(new Date(e.date_start), "EEE d MMM", { locale: es })} ·{" "}
                    {Math.round((e.tickets_sold / e.capacity) * 100)}% aforo
                  </div>
                </div>
                {e.dynamicActive ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                    style={{
                      ...mono,
                      letterSpacing: "0.16em",
                      background: "rgba(77,184,122,0.18)",
                      color: "#4DB87A",
                    }}
                  >
                    <span className="relative inline-flex h-1 w-1">
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                        style={{ background: "#4DB87A" }}
                      />
                      <span
                        className="relative inline-flex h-1 w-1 rounded-full"
                        style={{ background: "#4DB87A" }}
                      />
                    </span>
                    IA activa
                  </span>
                ) : (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                    style={{
                      ...mono,
                      letterSpacing: "0.16em",
                      background: "rgba(140,140,140,0.12)",
                      color: "#8A8275",
                    }}
                  >
                    Manual
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-base font-bold text-foreground" style={mono}>
                  {(e.currentPriceCents / 100).toFixed(2)}€
                </span>
                {e.dynamicActive && e.currentPriceCents !== e.basePriceCents && (
                  <span
                    className="inline-flex items-center text-[10px]"
                    style={{ ...mono, color: e.currentPriceCents > e.basePriceCents ? "#4DB87A" : "#E8B04C" }}
                  >
                    {e.currentPriceCents > e.basePriceCents ? <ArrowUpRight className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {e.currentPriceCents > e.basePriceCents ? "+" : ""}
                    {(((e.currentPriceCents - e.basePriceCents) / e.basePriceCents) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel */}
        {selected && <PricingDetail event={selected} />}
      </div>
    </div>
  );
};

// =============================================================
// Pricing detail panel
// =============================================================

const PricingDetail = ({ event }: { event: PricingEvent }) => {
  const [active, setActive] = useState(event.dynamicActive);
  const currentVsBase = ((event.currentPriceCents - event.basePriceCents) / event.basePriceCents) * 100;
  const expectedRevenueCents = event.predictedFinalSold * event.currentPriceCents;
  const baseRevenueCents = event.predictedFinalSold * event.basePriceCents;
  const upliftEur = (expectedRevenueCents - baseRevenueCents) / 100;

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
        style={{ background: "rgba(232,84,42,0.14)", filter: "blur(80px)" }}
      />

      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Brain className="h-3 w-3" />
            Pricing IA · {event.title}
          </div>
          <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
            Precio óptimo <span style={serif} className="text-orange-500">{(event.optimalPriceCents / 100).toFixed(2)}€</span>
          </h3>
          <div
            className="mt-1 text-[12px] text-muted-foreground"
            style={mono}
          >
            Base {(event.basePriceCents / 100).toFixed(2)}€ · Banda {(event.minPriceCents / 100).toFixed(0)}€-{(event.maxPriceCents / 100).toFixed(0)}€
          </div>
        </div>
        <Button
          variant={active ? "default" : "outline"}
          onClick={() => setActive((v) => !v)}
        >
          {active ? (
            <>
              <Pause className="mr-2 h-4 w-4" />
              Pausar IA
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Activar IA
            </>
          )}
        </Button>
      </header>

      {/* Price stats */}
      <section className="relative mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <PriceTile eyebrow="Actual" value={`${(event.currentPriceCents / 100).toFixed(2)}€`} highlight />
        <PriceTile eyebrow="Base" value={`${(event.basePriceCents / 100).toFixed(2)}€`} />
        <PriceTile eyebrow="Delta" value={`${currentVsBase >= 0 ? "+" : ""}${currentVsBase.toFixed(1)}%`} accent={currentVsBase >= 0 ? "#4DB87A" : "#E8B04C"} />
        <PriceTile eyebrow="Revenue extra" value={`+${upliftEur.toFixed(0)}€`} accent="#4DB87A" />
      </section>

      {/* Price band visual */}
      <section className="relative mt-5">
        <div
          className="mb-2 flex items-center justify-between text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.16em" }}
        >
          <span>
            Mín · <span className="text-foreground">{(event.minPriceCents / 100).toFixed(0)}€</span>
          </span>
          <span>Base · {(event.basePriceCents / 100).toFixed(0)}€</span>
          <span>
            Máx · <span className="text-foreground">{(event.maxPriceCents / 100).toFixed(0)}€</span>
          </span>
        </div>
        <div className="relative h-4 w-full overflow-hidden rounded-full bg-white/[0.05]">
          {/* Allowed band */}
          <div
            className="absolute inset-y-0"
            style={{
              left: `${((event.minPriceCents - event.minPriceCents) / (event.maxPriceCents - event.minPriceCents)) * 100}%`,
              right: 0,
              background:
                "linear-gradient(90deg, rgba(232,84,42,0.15) 0%, rgba(232,84,42,0.35) 100%)",
            }}
          />
          {/* Base price marker */}
          <div
            className="absolute top-0 h-full w-0.5"
            style={{
              left: `${((event.basePriceCents - event.minPriceCents) / (event.maxPriceCents - event.minPriceCents)) * 100}%`,
              background: "rgba(244,238,226,0.5)",
            }}
          />
          {/* Optimal recommended */}
          <div
            className="absolute top-0 h-full w-1"
            style={{
              left: `${((event.optimalPriceCents - event.minPriceCents) / (event.maxPriceCents - event.minPriceCents)) * 100}%`,
              background: "#4DB87A",
              boxShadow: "0 0 12px rgba(77,184,122,0.7)",
            }}
          />
          {/* Current price (large dot) */}
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{
              left: `${((event.currentPriceCents - event.minPriceCents) / (event.maxPriceCents - event.minPriceCents)) * 100}%`,
              background: "#FF7A4D",
              borderColor: "#fff",
              boxShadow: "0 0 16px rgba(232,84,42,0.8)",
            }}
          />
        </div>
        <div
          className="mt-2 flex items-center gap-3 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.16em" }}
        >
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#FF7A4D" }} />
            Actual
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-1" style={{ background: "#4DB87A" }} />
            Óptimo IA
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-0.5" style={{ background: "rgba(244,238,226,0.5)" }} />
            Base
          </span>
        </div>
      </section>

      {/* Elasticity curve mock */}
      <section className="relative mt-6">
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <TrendingUp className="h-3 w-3" />
          Elasticidad precio × demanda
        </div>
        <ElasticityChart event={event} />
      </section>

      {/* Rules */}
      <section className="relative mt-6">
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Settings className="h-3 w-3" />
          Reglas activas
        </div>
        <ul className="space-y-2">
          <Rule icon={<Zap className="h-3.5 w-3.5" />} color="#FF7A4D" text="Subir +5% cada vez que se vendan 100 entradas" active />
          <Rule icon={<TrendingDown className="h-3.5 w-3.5" />} color="#E8B04C" text="Bajar -10% si <60% vendido a 48h del evento" active />
          <Rule icon={<AlertTriangle className="h-3.5 w-3.5" />} color="#B8381A" text="Nunca bajar del precio base original" active />
          <Rule icon={<Target className="h-3.5 w-3.5" />} color="#4DB87A" text="Subir +15% en últimas 24h si quedan <15% entradas" active />
        </ul>
        <Button variant="outline" size="sm" className="mt-4">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Añadir regla
        </Button>
      </section>
    </article>
  );
};

const PriceTile = ({
  eyebrow,
  value,
  highlight,
  accent,
}: {
  eyebrow: string;
  value: string;
  highlight?: boolean;
  accent?: string;
}) => (
  <div
    className="rounded-2xl border p-3 md:p-4"
    style={{
      background: highlight ? "rgba(232,84,42,0.08)" : "rgba(255,255,255,0.02)",
      borderColor: highlight ? "rgba(232,84,42,0.45)" : "rgba(244,238,226,0.08)",
    }}
  >
    <div
      className="text-[9px] uppercase"
      style={{
        ...mono,
        letterSpacing: "0.18em",
        color: highlight ? "#FF7A4D" : accent ?? "#8A8275",
      }}
    >
      {eyebrow}
    </div>
    <div
      className="mt-1 text-xl font-bold tracking-tight md:text-2xl"
      style={{ ...mono, color: accent ?? "#F4EEE2" }}
    >
      {value}
    </div>
  </div>
);

const Rule = ({
  icon,
  color,
  text,
  active,
}: {
  icon: React.ReactNode;
  color: string;
  text: string;
  active: boolean;
}) => (
  <li
    className="flex items-center gap-3 rounded-xl border border-border p-3"
    style={{ background: "rgba(255,255,255,0.02)" }}
  >
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${color}22`, color }}>
      {icon}
    </div>
    <span className="flex-1 text-sm text-foreground">{text}</span>
    {active && (
      <span
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] uppercase"
        style={{
          ...mono,
          letterSpacing: "0.16em",
          background: "rgba(77,184,122,0.18)",
          color: "#4DB87A",
        }}
      >
        <Check className="h-2.5 w-2.5" />
        Activa
      </span>
    )}
  </li>
);

// =============================================================
// Elasticity chart (svg)
// =============================================================

const ElasticityChart = ({ event }: { event: PricingEvent }) => {
  // Simulate elasticity: price low → demand high, price high → demand low
  const points = Array.from({ length: 20 }).map((_, i) => {
    const priceFrac = i / 19;
    const priceCents = event.minPriceCents + priceFrac * (event.maxPriceCents - event.minPriceCents);
    // Demand curve: sigmoid-like decay
    const demand = 1 / (1 + Math.exp((priceFrac - 0.55) * 6));
    const expectedRev = demand * event.capacity * priceCents;
    return { priceCents, demand, expectedRev };
  });
  const maxRev = Math.max(...points.map((p) => p.expectedRev));
  const optimalIdx = points.findIndex((p) => p.expectedRev === maxRev);

  return (
    <div className="relative rounded-2xl border border-border bg-background/30 p-4">
      <svg viewBox="0 0 400 180" className="h-auto w-full">
        {/* Grid */}
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1="0"
            x2="400"
            y1={45 * i + 5}
            y2={45 * i + 5}
            stroke="rgba(244,238,226,0.05)"
          />
        ))}

        {/* Revenue curve */}
        <path
          d={points
            .map((p, i) => {
              const x = (i / (points.length - 1)) * 380 + 10;
              const y = 170 - (p.expectedRev / maxRev) * 150;
              return i === 0 ? `M ${x},${y}` : `L ${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="#FF7A4D"
          strokeWidth="3"
        />

        {/* Area under */}
        <path
          d={
            points
              .map((p, i) => {
                const x = (i / (points.length - 1)) * 380 + 10;
                const y = 170 - (p.expectedRev / maxRev) * 150;
                return i === 0 ? `M ${x},${y}` : `L ${x},${y}`;
              })
              .join(" ") + ` L 390,170 L 10,170 Z`
          }
          fill="url(#elasticGradient)"
          opacity="0.3"
        />
        <defs>
          <linearGradient id="elasticGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF7A4D" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#FF7A4D" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Optimal marker */}
        <line
          x1={(optimalIdx / (points.length - 1)) * 380 + 10}
          y1="20"
          x2={(optimalIdx / (points.length - 1)) * 380 + 10}
          y2="170"
          stroke="#4DB87A"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <circle
          cx={(optimalIdx / (points.length - 1)) * 380 + 10}
          cy={170 - (points[optimalIdx].expectedRev / maxRev) * 150}
          r="6"
          fill="#4DB87A"
          stroke="#fff"
          strokeWidth="2"
        />
        <text
          x={(optimalIdx / (points.length - 1)) * 380 + 10}
          y="15"
          textAnchor="middle"
          fill="#4DB87A"
          fontSize="9"
          fontFamily="monospace"
          letterSpacing="2"
        >
          ÓPTIMO
        </text>

        {/* X axis labels */}
        <text x="10" y="180" fill="rgba(244,238,226,0.5)" fontSize="9" fontFamily="monospace" letterSpacing="2">
          {(event.minPriceCents / 100).toFixed(0)}€
        </text>
        <text x="390" y="180" textAnchor="end" fill="rgba(244,238,226,0.5)" fontSize="9" fontFamily="monospace" letterSpacing="2">
          {(event.maxPriceCents / 100).toFixed(0)}€
        </text>
      </svg>
      <p
        className="mt-2 text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.16em" }}
      >
        Curva: Revenue total esperado por precio · Pico marca el sweet spot
      </p>
    </div>
  );
};

export default PartnerDynamicPricing;
