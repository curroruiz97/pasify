import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  Crown,
  Download,
  Euro,
  Flag,
  ScanLine,
  Star,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, subDays } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

type Range = "7d" | "30d" | "90d" | "ytd";

const RANGE_LABEL: Record<Range, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  ytd: "Este año",
};

// =============================================================
// Mock data series
// =============================================================

const buildSeries = (days: number) => {
  const today = new Date();
  const seed = (i: number) =>
    Math.max(0, Math.round(80 + Math.sin(i * 0.42) * 25 + (i % 7 === 0 ? 40 : 0) + (i / days) * 20));
  return Array.from({ length: days }).map((_, i) => {
    const d = subDays(today, days - 1 - i);
    const sold = seed(i);
    return {
      date: d,
      sold,
      revenueCents: sold * 1500,
    };
  });
};

// =============================================================
// Main
// =============================================================

export const PartnerReports = () => {
  const [range, setRange] = useState<Range>("30d");
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 180;
  const series = useMemo(() => buildSeries(days), [days]);

  const total = series.reduce(
    (a, p) => ({ sold: a.sold + p.sold, rev: a.rev + p.revenueCents }),
    { sold: 0, rev: 0 }
  );
  const prevTotal = useMemo(() => {
    const prev = buildSeries(days);
    return prev.reduce(
      (a, p) => ({ sold: a.sold + Math.round(p.sold * 0.86), rev: a.rev + Math.round(p.revenueCents * 0.86) }),
      { sold: 0, rev: 0 }
    );
  }, [days]);

  const deltaSold = total.sold - prevTotal.sold;
  const deltaSoldPct = prevTotal.sold > 0 ? (deltaSold / prevTotal.sold) * 100 : 0;
  const deltaRev = total.rev - prevTotal.rev;
  const deltaRevPct = prevTotal.rev > 0 ? (deltaRev / prevTotal.rev) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <BarChart3 className="h-3 w-3" />
            Reports
          </div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
            {RANGE_LABEL[range]}
          </h2>
        </div>
        <div className="flex gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="h-10 w-40 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 días</SelectItem>
              <SelectItem value="30d">30 días</SelectItem>
              <SelectItem value="90d">90 días</SelectItem>
              <SelectItem value="ytd">Año</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </header>

      {/* KPI grid with deltas */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiCardDelta
          icon={<Ticket className="h-4 w-4" />}
          color="#FF7A4D"
          eyebrow="Entradas vendidas"
          value={total.sold.toString()}
          deltaPct={deltaSoldPct}
        />
        <KpiCardDelta
          icon={<Euro className="h-4 w-4" />}
          color="#E8542A"
          eyebrow="Recaudado"
          value={`${(total.rev / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          deltaPct={deltaRevPct}
        />
        <KpiCardDelta
          icon={<Users className="h-4 w-4" />}
          color="#4DB87A"
          eyebrow="Clientes únicos"
          value={Math.round(total.sold * 0.72).toString()}
          deltaPct={9.2}
        />
        <KpiCardDelta
          icon={<ScanLine className="h-4 w-4" />}
          color="#E8B04C"
          eyebrow="Tasa entrada"
          value="92%"
          deltaPct={2.1}
        />
      </section>

      {/* Revenue chart */}
      <RevenueChart series={series} />

      {/* Two columns: top RRPP + Hours heatmap */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TopRrppCard />
        <HoursHeatmap />
      </div>

      {/* Channels + retention */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChannelsCard />
        <RetentionCard />
      </div>
    </div>
  );
};

// =============================================================
// KPI with delta
// =============================================================

const KpiCardDelta = ({
  icon,
  color,
  eyebrow,
  value,
  deltaPct,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  deltaPct: number;
}) => {
  const up = deltaPct >= 0;
  return (
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
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            ...mono,
            letterSpacing: "0.08em",
            color: up ? "#4DB87A" : "#B8381A",
            background: up ? "rgba(77,184,122,0.12)" : "rgba(184,56,26,0.12)",
          }}
        >
          {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {up ? "+" : ""}
          {deltaPct.toFixed(1)}%
        </span>
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
        vs período anterior
      </div>
    </div>
  );
};

// =============================================================
// Revenue chart (svg sparkline + bars)
// =============================================================

const RevenueChart = ({
  series,
}: {
  series: Array<{ date: Date; sold: number; revenueCents: number }>;
}) => {
  const maxRev = Math.max(1, ...series.map((p) => p.revenueCents));
  const peakIdx = series.findIndex((p) => p.revenueCents === maxRev);
  const peak = series[peakIdx];

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
      />

      <header className="relative mb-5 flex items-start justify-between gap-3">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <TrendingUp className="h-3 w-3" />
            Evolución diaria
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Recaudado por día
          </h3>
        </div>
        {peak && (
          <div className="rounded-2xl border border-orange-500/40 bg-orange-500/[0.08] px-4 py-2.5 text-right">
            <div
              className="text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              Pico
            </div>
            <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
              {(peak.revenueCents / 100).toFixed(0)}€
            </div>
            <div className="text-[10px] text-muted-foreground" style={mono}>
              {format(peak.date, "d MMM", { locale: es })}
            </div>
          </div>
        )}
      </header>

      <div className="relative flex h-44 items-end gap-1 md:h-56">
        {series.map((p, i) => {
          const h = (p.revenueCents / maxRev) * 100;
          const isPeak = i === peakIdx;
          return (
            <div
              key={i}
              className="group/bar relative flex-1 rounded-t-sm transition-all"
              style={{
                height: `${Math.max(2, h)}%`,
                background: isPeak
                  ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)"
                  : `rgba(232,84,42,${0.35 + (i / series.length) * 0.45})`,
                boxShadow: isPeak ? "0 0 12px rgba(232,84,42,0.7)" : undefined,
              }}
              title={`${format(p.date, "d MMM", { locale: es })} · ${(p.revenueCents / 100).toFixed(0)}€`}
            />
          );
        })}
      </div>

      <div
        className="relative mt-3 flex justify-between text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.16em" }}
      >
        <span>{format(series[0].date, "d MMM", { locale: es })}</span>
        <span>{format(series[Math.floor(series.length / 2)].date, "d MMM", { locale: es })}</span>
        <span>{format(series[series.length - 1].date, "d MMM", { locale: es })}</span>
      </div>
    </section>
  );
};

// =============================================================
// Top RRPP
// =============================================================

const TopRrppCard = () => {
  const top = [
    { name: "Carla Sánchez", sold: 38, revenueCents: 57000, color: "#FF7A4D" },
    { name: "Diego Reyes", sold: 27, revenueCents: 40500, color: "#E8542A" },
    { name: "Lucía García", sold: 19, revenueCents: 28500, color: "#B8381A" },
    { name: "Pablo López", sold: 14, revenueCents: 21000, color: "#E8B04C" },
    { name: "Alba Martínez", sold: 11, revenueCents: 16500, color: "#4DB87A" },
  ];
  const maxSold = Math.max(...top.map((t) => t.sold));
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="mb-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Trophy className="h-3 w-3" />
          Top RRPP
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Ranking del período
        </h3>
      </div>

      <div className="space-y-3">
        {top.map((t, i) => {
          const w = (t.sold / maxSold) * 100;
          return (
            <div key={t.name}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white"
                    style={{
                      ...mono,
                      background: i < 3
                        ? "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)"
                        : "rgba(255,255,255,0.06)",
                      color: i < 3 ? "#fff" : "#8A8275",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium text-foreground">{t.name}</span>
                </div>
                <span className="text-sm font-bold text-foreground" style={mono}>
                  {t.sold} · {(t.revenueCents / 100).toFixed(0)}€
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${t.color}88 0%, ${t.color} 100%)`,
                    boxShadow: `0 0 8px ${t.color}66`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// =============================================================
// Hours heatmap
// =============================================================

const HoursHeatmap = () => {
  // Generate 7 days × 24 hours data biased to nightlife (22h–4h peak)
  const data = useMemo(() => {
    const rows: number[][] = [];
    for (let d = 0; d < 7; d++) {
      const row: number[] = [];
      for (let h = 0; h < 24; h++) {
        const peak = h >= 22 || h <= 4 ? 0.85 + Math.sin(d + h * 0.3) * 0.15 : 0.15 + Math.sin(d + h * 0.5) * 0.1;
        const weekend = d >= 4 ? 1.2 : 0.8;
        row.push(Math.max(0, Math.min(1, peak * weekend)));
      }
      rows.push(row);
    }
    return rows;
  }, []);

  const days = ["L", "M", "X", "J", "V", "S", "D"];
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="mb-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Activity className="h-3 w-3" />
          Cuándo entra la gente
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Heatmap horario × día
        </h3>
      </div>

      <div className="flex gap-1.5">
        <div className="flex flex-col justify-around text-[10px] text-muted-foreground" style={mono}>
          {days.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="flex-1">
          {data.map((row, di) => (
            <div key={di} className="mb-0.5 flex gap-0.5">
              {row.map((v, hi) => (
                <div
                  key={hi}
                  className="flex-1 rounded-sm"
                  style={{
                    height: 14,
                    background: `rgba(232,84,42,${0.05 + v * 0.7})`,
                  }}
                  title={`${days[di]} · ${hi}h · ${Math.round(v * 100)}%`}
                />
              ))}
            </div>
          ))}
          <div
            className="mt-2 flex justify-between text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            <span>00h</span>
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
        </div>
      </div>
    </section>
  );
};

// =============================================================
// Channels card
// =============================================================

const ChannelsCard = () => {
  const channels = [
    { name: "Web", pct: 47, color: "#FF7A4D" },
    { name: "RRPP", pct: 26, color: "#E8542A" },
    { name: "Taquilla", pct: 14, color: "#E8B04C" },
    { name: "Instagram", pct: 8, color: "#B8381A" },
    { name: "Otros", pct: 5, color: "#5C544A" },
  ];
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="mb-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Flag className="h-3 w-3" />
          Canales
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Origen del ticket
        </h3>
      </div>

      {/* Donut svg */}
      <div className="flex items-center gap-5">
        <Donut channels={channels} />
        <ul className="flex-1 space-y-2">
          {channels.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: c.color }}
                />
                {c.name}
              </span>
              <span className="text-sm font-bold text-foreground" style={mono}>
                {c.pct}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

const Donut = ({ channels }: { channels: Array<{ name: string; pct: number; color: string }> }) => {
  const total = channels.reduce((s, c) => s + c.pct, 0);
  const radius = 50;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" />
      {channels.map((c) => {
        const len = (c.pct / total) * circ;
        const dash = `${len} ${circ - len}`;
        const dashOffset = -offset;
        offset += len;
        return (
          <circle
            key={c.name}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={c.color}
            strokeWidth="14"
            strokeDasharray={dash}
            strokeDashoffset={dashOffset}
          />
        );
      })}
    </svg>
  );
};

// =============================================================
// Retention
// =============================================================

const RetentionCard = () => {
  const cohorts = [
    { label: "Compraron 1 vez", pct: 100, color: "#5C544A" },
    { label: "Volvieron 2ª", pct: 47, color: "#E8B04C" },
    { label: "Volvieron 3ª+", pct: 28, color: "#E8542A" },
    { label: "VIP (8+)", pct: 9, color: "#FF7A4D" },
  ];
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="mb-4">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <Crown className="h-3 w-3" />
          Retención
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Embudo de fidelidad
        </h3>
      </div>
      <ul className="space-y-3">
        {cohorts.map((c) => (
          <li key={c.label}>
            <div
              className="mb-1 flex items-center justify-between text-sm"
              style={{ color: c.color }}
            >
              <span style={{ color: "#F4EEE2" }}>{c.label}</span>
              <span className="font-bold" style={mono}>
                {c.pct}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${c.pct}%`,
                  background: `linear-gradient(90deg, ${c.color}88 0%, ${c.color} 100%)`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default PartnerReports;
