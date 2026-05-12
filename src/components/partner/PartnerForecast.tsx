import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Calendar,
  CheckCircle2,
  CloudRain,
  Music,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface ForecastEvent {
  id: string;
  title: string;
  date_start: string;
  capacity: number | null;
  tickets_sold: number;
  price_cents: number;
}

interface ForecastResult {
  eventId: string;
  predictedSold: number;
  ciLow: number;
  ciHigh: number;
  occupancyPct: number;
  predictedRevenueCents: number;
  confidence: "low" | "medium" | "high";
  factors: Array<{
    label: string;
    impact: number; // -1 to +1
    note: string;
  }>;
}

interface Props {
  events: ForecastEvent[];
}

/**
 * PartnerForecast — predicción de venta para próximos eventos.
 * Modelo mock: combina histórico, día de la semana, headliner mock,
 * y "tendencia red". Devuelve intervalos de confianza + factores explicables.
 */
export const PartnerForecast = ({ events }: Props) => {
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter((e) => new Date(e.date_start).getTime() > now)
      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
      .slice(0, 6);
  }, [events]);

  const forecasts = useMemo(() => upcoming.map(forecastFor), [upcoming]);

  if (upcoming.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground"
      >
        Publica un evento futuro para activar el forecast con IA.
      </div>
    );
  }

  const totalPredicted = forecasts.reduce((s, f) => s + f.predictedSold, 0);
  const totalRevenue = forecasts.reduce((s, f) => s + f.predictedRevenueCents, 0);
  const avgConfidence = forecasts.filter((f) => f.confidence === "high").length / forecasts.length;

  return (
    <div className="space-y-6">
      {/* Hero — model summary */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full"
          style={{ background: "rgba(232,84,42,0.24)", filter: "blur(80px)" }}
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(232,84,42,0.6)",
              }}
            >
              <Brain className="h-6 w-6" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                Forecast · IA
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Vas a vender <span style={serif} className="text-orange-500">{totalPredicted.toLocaleString("es-ES")}</span> entradas
              </h2>
              <div
                className="mt-1 text-[12px] text-muted-foreground"
                style={mono}
              >
                Próximos {upcoming.length} eventos · {(totalRevenue / 100).toFixed(0)}€ proyectados ·{" "}
                {Math.round(avgConfidence * 100)}% alta confianza
              </div>
            </div>
          </div>
        </div>

        {/* Model meta */}
        <div className="relative mt-5 grid grid-cols-3 gap-3">
          <ModelStat label="Histórico" value="142 eventos" />
          <ModelStat label="MAPE" value="11.4%" />
          <ModelStat label="Última recalibración" value="Hoy 06:00" />
        </div>
      </section>

      {/* Forecast cards */}
      <section className="space-y-4">
        {forecasts.map((f, i) => (
          <ForecastCard key={f.eventId} forecast={f} event={upcoming[i]} />
        ))}
      </section>
    </div>
  );
};

const ModelStat = ({ label, value }: { label: string; value: string }) => (
  <div
    className="rounded-xl border border-border p-2.5"
    style={{ background: "rgba(255,255,255,0.04)" }}
  >
    <div
      className="text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
      {value}
    </div>
  </div>
);

const ForecastCard = ({
  forecast,
  event,
}: {
  forecast: ForecastResult;
  event: ForecastEvent;
}) => {
  const date = new Date(event.date_start);
  const capacity = event.capacity ?? 800;
  const ciRangePct = ((forecast.ciHigh - forecast.ciLow) / capacity) * 100;
  const confidenceCfg =
    forecast.confidence === "high"
      ? { color: "#4DB87A", label: "Alta confianza" }
      : forecast.confidence === "medium"
      ? { color: "#E8B04C", label: "Confianza media" }
      : { color: "#B8381A", label: "Baja confianza" };

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
        style={{ background: "rgba(232,84,42,0.14)", filter: "blur(70px)" }}
      />

      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Calendar className="h-3 w-3" />
            {format(date, "EEEE d MMM · HH:mm", { locale: es })}h
          </div>
          <h3 className="truncate text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {event.title}
          </h3>
          <div
            className="mt-1 text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            Aforo {capacity} · Precio {(event.price_cents / 100).toFixed(0)}€
          </div>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] uppercase"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: `${confidenceCfg.color}22`,
            color: confidenceCfg.color,
            border: `1px solid ${confidenceCfg.color}55`,
          }}
        >
          <Target className="h-3 w-3" />
          {confidenceCfg.label}
        </span>
      </header>

      {/* Prediction */}
      <div className="relative mt-5 grid grid-cols-3 gap-3">
        <Prediction
          eyebrow="Predicción"
          value={forecast.predictedSold.toString()}
          sub={`${forecast.occupancyPct}% aforo`}
          color="#FF7A4D"
          highlight
        />
        <Prediction
          eyebrow="Rango (90% CI)"
          value={`${forecast.ciLow}–${forecast.ciHigh}`}
          sub={`±${Math.round(ciRangePct)}% aforo`}
          color="#E8B04C"
        />
        <Prediction
          eyebrow="Revenue est."
          value={`${(forecast.predictedRevenueCents / 100).toFixed(0)}€`}
          sub="Ticket × predicción"
          color="#4DB87A"
        />
      </div>

      {/* Confidence bar (sold + predicted) */}
      <div className="relative mt-5">
        <div
          className="mb-1.5 flex items-center justify-between text-[10px] uppercase"
          style={{ ...mono, letterSpacing: "0.16em", color: "#8A8275" }}
        >
          <span>
            Vendido <span className="text-foreground">{event.tickets_sold}</span> ·{" "}
            Predicho <span className="text-foreground">{forecast.predictedSold}</span>
          </span>
          <span>{capacity} aforo</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {/* Sold (real) */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${(event.tickets_sold / capacity) * 100}%`,
              background:
                "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)",
              boxShadow: "0 0 12px rgba(232,84,42,0.5)",
            }}
          />
          {/* CI range */}
          <div
            className="absolute inset-y-0"
            style={{
              left: `${(forecast.ciLow / capacity) * 100}%`,
              width: `${((forecast.ciHigh - forecast.ciLow) / capacity) * 100}%`,
              background: "rgba(232,176,76,0.28)",
              border: "1px dashed rgba(232,176,76,0.6)",
            }}
          />
          {/* Prediction tick */}
          <div
            className="absolute top-0 h-full w-0.5"
            style={{
              left: `${(forecast.predictedSold / capacity) * 100}%`,
              background: "#FF7A4D",
              boxShadow: "0 0 10px rgba(255,122,77,0.9)",
            }}
          />
        </div>
      </div>

      {/* Factors */}
      <div className="relative mt-5">
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Zap className="h-3 w-3" />
          Factores que influyen
        </div>
        <ul className="space-y-2">
          {forecast.factors.map((f) => (
            <FactorRow key={f.label} factor={f} />
          ))}
        </ul>
      </div>
    </article>
  );
};

const Prediction = ({
  eyebrow,
  value,
  sub,
  color,
  highlight,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  color: string;
  highlight?: boolean;
}) => (
  <div
    className="rounded-2xl border p-3 md:p-4"
    style={{
      background: highlight ? `${color}12` : "rgba(255,255,255,0.02)",
      borderColor: highlight ? `${color}55` : "rgba(244,238,226,0.08)",
    }}
  >
    <div
      className="text-[9px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color: highlight ? color : "#8A8275" }}
    >
      {eyebrow}
    </div>
    <div
      className="mt-1 text-xl font-bold tracking-tight md:text-2xl"
      style={{ ...mono, color: highlight ? "#F4EEE2" : "#F4EEE2" }}
    >
      {value}
    </div>
    <div
      className="mt-0.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.16em", color: "#8A8275" }}
    >
      {sub}
    </div>
  </div>
);

const FactorRow = ({
  factor,
}: {
  factor: { label: string; impact: number; note: string };
}) => {
  const positive = factor.impact >= 0;
  const color = positive ? "#4DB87A" : "#B8381A";
  const pctWidth = Math.min(100, Math.abs(factor.impact) * 100);
  return (
    <li className="flex items-center gap-3">
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
        style={{ background: `${color}22`, color }}
      >
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <CloudRain className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground">{factor.label}</span>
          <span className="font-bold" style={{ ...mono, color }}>
            {positive ? "+" : ""}
            {Math.round(factor.impact * 100)}%
          </span>
        </div>
        <div
          className="mt-0.5 text-[11px] text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.04em" }}
        >
          {factor.note}
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pctWidth}%`,
              background: `linear-gradient(90deg, ${color}66 0%, ${color} 100%)`,
            }}
          />
        </div>
      </div>
    </li>
  );
};

// =============================================================
// Mock forecast model
// =============================================================

const forecastFor = (event: ForecastEvent): ForecastResult => {
  const date = new Date(event.date_start);
  const day = date.getDay();
  const isWeekend = day === 5 || day === 6;
  const isThursday = day === 4;
  const isSunday = day === 0;
  const capacity = event.capacity ?? 800;
  const sold = event.tickets_sold ?? 0;
  const daysToEvent = Math.max(1, (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  // Base prediction = current trajectory + day-of-week multiplier
  let dayMultiplier = 1;
  if (isWeekend) dayMultiplier = 1.55;
  else if (isThursday) dayMultiplier = 1.2;
  else if (isSunday) dayMultiplier = 0.55;

  // Estimate based on days remaining
  const tracjectoryRate = daysToEvent > 0.5 ? Math.min(1, 0.92) : 1;
  const baselineProj = Math.min(
    capacity,
    Math.round(sold + (capacity - sold) * tracjectoryRate * dayMultiplier * 0.78)
  );

  const noise = Math.round(capacity * 0.08);
  const ciLow = Math.max(sold, baselineProj - noise);
  const ciHigh = Math.min(capacity, baselineProj + noise);
  const occupancy = (baselineProj / capacity) * 100;

  // Confidence based on history depth (mock — random but deterministic)
  const seed = event.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const confidence: ForecastResult["confidence"] =
    seed % 3 === 0 ? "high" : seed % 3 === 1 ? "medium" : "high";

  // Factors
  const factors: ForecastResult["factors"] = [];
  if (isWeekend) {
    factors.push({
      label: "Sábado / Fin de semana",
      impact: 0.45,
      note: "Tu histórico vende un +45% los sábados frente a la media.",
    });
  } else if (isThursday) {
    factors.push({
      label: "Jueves universitario",
      impact: 0.18,
      note: "Buen rendimiento en tu zona pero por debajo del sábado.",
    });
  } else if (isSunday) {
    factors.push({
      label: "Domingo",
      impact: -0.32,
      note: "Día de baja demanda — considera promo o cambio de fecha.",
    });
  }

  factors.push({
    label: "Tendencia red (últimas 4 sem.)",
    impact: 0.12,
    note: "La red sube un 12% vs trimestre anterior en eventos similares.",
  });

  if (daysToEvent > 10) {
    factors.push({
      label: "Demasiada antelación",
      impact: -0.08,
      note: "85% de tus ventas pasan en los últimos 10 días.",
    });
  } else if (daysToEvent < 3) {
    factors.push({
      label: "Última semana",
      impact: 0.22,
      note: "Tu pico de ventas suele ocurrir 48h antes del evento.",
    });
  }

  if (seed % 5 === 0) {
    factors.push({
      label: "Headliner sin tracción confirmada",
      impact: -0.14,
      note: "No detectamos picos en redes para el artista anunciado.",
    });
  } else {
    factors.push({
      label: "Engagement social en alza",
      impact: 0.21,
      note: "+34% menciones del local en Instagram los últimos 7 días.",
    });
  }

  return {
    eventId: event.id,
    predictedSold: baselineProj,
    ciLow,
    ciHigh,
    occupancyPct: Math.round(occupancy),
    predictedRevenueCents: baselineProj * event.price_cents,
    confidence,
    factors,
  };
};

export default PartnerForecast;
