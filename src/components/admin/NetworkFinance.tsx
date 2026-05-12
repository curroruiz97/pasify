import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Building2,
  Coins,
  Download,
  Euro,
  FileText,
  Landmark,
  PieChart,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subMonths } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// Mock data
const buildMonthly = () => {
  const arr: Array<{ month: Date; gmv: number; takeRate: number; netRevenue: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const month = subMonths(new Date(), i);
    const gmv = 800_00 + Math.round(Math.sin(i * 0.5) * 200_00) + i * 38_00;
    const takeRate = 0.058 + Math.sin(i * 0.4) * 0.005;
    arr.push({ month, gmv, takeRate, netRevenue: Math.round(gmv * takeRate) });
  }
  return arr;
};

const SETTLEMENTS = [
  { id: "set-01", partner: "Pacha Ibiza", gmvCents: 184_523_00, commissionCents: 10_812_00, status: "ready", scheduledFor: new Date() },
  { id: "set-02", partner: "Razzmatazz", gmvCents: 76_840_00, commissionCents: 4_469_00, status: "ready", scheduledFor: new Date() },
  { id: "set-03", partner: "Sala Apolo", gmvCents: 52_180_00, commissionCents: 3_046_00, status: "ready", scheduledFor: new Date() },
  { id: "set-04", partner: "Teatro Kapital", gmvCents: 42_900_00, commissionCents: 2_524_00, status: "pending_kyc", scheduledFor: null },
  { id: "set-05", partner: "Beach Club Estrella", gmvCents: 38_120_00, commissionCents: 2_241_00, status: "ready", scheduledFor: new Date() },
  { id: "set-06", partner: "Medusa Festival", gmvCents: 18_400_00, commissionCents: 1_086_00, status: "hold", scheduledFor: null },
];

const COHORTS = [
  { month: "Hace 11m", new: 18, retained: [18, 14, 12, 11, 10, 9, 8, 7, 7, 6, 6, 6] },
  { month: "Hace 10m", new: 22, retained: [22, 18, 15, 13, 12, 11, 11, 10, 10, 10, 9] },
  { month: "Hace 9m", new: 16, retained: [16, 13, 11, 10, 9, 8, 8, 7, 7, 7] },
  { month: "Hace 8m", new: 19, retained: [19, 15, 13, 12, 11, 11, 10, 9, 9] },
  { month: "Hace 7m", new: 24, retained: [24, 20, 18, 16, 15, 14, 13, 12] },
  { month: "Hace 6m", new: 28, retained: [28, 23, 20, 19, 17, 16, 15] },
];

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  ready: { label: "Listo", color: "#4DB87A" },
  pending_kyc: { label: "KYC", color: "#E8B04C" },
  hold: { label: "Retenido", color: "#B8381A" },
};

export const NetworkFinance = () => {
  const [tab, setTab] = useState<"overview" | "settlements" | "cohorts">("overview");
  const monthly = useMemo(buildMonthly, []);
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const ytdGmv = monthly.reduce((s, m) => s + m.gmv, 0);
  const ytdNet = monthly.reduce((s, m) => s + m.netRevenue, 0);
  const mrrEstimate = Math.round(ytdNet / 12);
  const deltaGmvPct = prev ? ((last.gmv - prev.gmv) / prev.gmv) * 100 : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          Finanzas <span style={serif} className="text-orange-500">de la red</span>
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          GMV, take-rate, cohortes y settlements con cada partner.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiCardDelta
          icon={<Euro className="h-4 w-4" />}
          color="#FF7A4D"
          eyebrow="GMV mes"
          value={`${(last.gmv / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          deltaPct={deltaGmvPct}
        />
        <KpiCardDelta
          icon={<Coins className="h-4 w-4" />}
          color="#E8542A"
          eyebrow="Take-rate"
          value={`${(last.takeRate * 100).toFixed(1)}%`}
          deltaPct={0.3}
        />
        <KpiCardDelta
          icon={<TrendingUp className="h-4 w-4" />}
          color="#E8B04C"
          eyebrow="Net revenue"
          value={`${(last.netRevenue / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          deltaPct={deltaGmvPct + 1.4}
        />
        <KpiCardDelta
          icon={<Wallet className="h-4 w-4" />}
          color="#4DB87A"
          eyebrow="MRR est."
          value={`${(mrrEstimate / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
          deltaPct={8.2}
        />
      </section>

      <div className="flex items-end justify-between gap-4 border-b border-border">
        <div className="flex gap-1">
          <Tab active={tab === "overview"} onClick={() => setTab("overview")} icon={<PieChart className="h-4 w-4" />}>
            Resumen
          </Tab>
          <Tab active={tab === "settlements"} onClick={() => setTab("settlements")} icon={<Landmark className="h-4 w-4" />}>
            Settlements
          </Tab>
          <Tab active={tab === "cohorts"} onClick={() => setTab("cohorts")} icon={<TrendingUp className="h-4 w-4" />}>
            Cohortes
          </Tab>
        </div>
        <Button variant="outline" className="hidden sm:inline-flex">
          <Download className="mr-2 h-4 w-4" />
          Export Holded/SAGE
        </Button>
      </div>

      {tab === "overview" && <Overview monthly={monthly} ytdGmv={ytdGmv} ytdNet={ytdNet} />}
      {tab === "settlements" && <Settlements />}
      {tab === "cohorts" && <Cohorts />}
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
// Overview
// =============================================================

const Overview = ({
  monthly,
  ytdGmv,
  ytdNet,
}: {
  monthly: Array<{ month: Date; gmv: number; takeRate: number; netRevenue: number }>;
  ytdGmv: number;
  ytdNet: number;
}) => {
  const maxGmv = Math.max(...monthly.map((m) => m.gmv));
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
          className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full"
          style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
        />
        <header className="relative mb-5 flex items-start justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <TrendingUp className="h-3 w-3" />
              GMV últimos 12 meses
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {(ytdGmv / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€{" "}
              <span className="text-muted-foreground" style={serif}>
                YTD
              </span>
            </h3>
            <div
              className="mt-1 text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              Net revenue · {(ytdNet / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€
            </div>
          </div>
        </header>

        <div className="relative flex h-44 items-end gap-2 md:h-56">
          {monthly.map((m, i) => {
            const h = (m.gmv / maxGmv) * 100;
            return (
              <div key={i} className="flex flex-1 flex-col items-center">
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${Math.max(2, h)}%`,
                    background: `linear-gradient(180deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)`,
                    boxShadow: "0 0 12px rgba(232,84,42,0.5)",
                  }}
                />
                <div
                  className="mt-2 text-[9px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.12em" }}
                >
                  {format(m.month, "MMM", { locale: es })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

// =============================================================
// Settlements
// =============================================================

const Settlements = () => {
  const totalReady = SETTLEMENTS.filter((s) => s.status === "ready").reduce(
    (s, x) => s + x.commissionCents,
    0
  );
  return (
    <section className="space-y-3">
      <div
        className="rounded-2xl border border-border bg-card p-5"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Landmark className="h-3 w-3" />
              Ciclo · Esta semana
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {(totalReady / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€{" "}
              <span className="text-muted-foreground" style={serif}>
                a liquidar
              </span>
            </h3>
            <div
              className="mt-1 text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {SETTLEMENTS.filter((s) => s.status === "ready").length} payouts listos vía Stripe Connect
            </div>
          </div>
          <Button>
            <Receipt className="mr-2 h-4 w-4" />
            Procesar payouts
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {SETTLEMENTS.map((s) => {
          const cfg = STATUS_CFG[s.status];
          return (
            <article
              key={s.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center md:gap-4"
              style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
            >
              <div className="flex flex-1 items-center gap-3">
                <div
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                  style={{
                    background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)",
                  }}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {s.partner}
                  </div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.14em" }}
                  >
                    {s.id.toUpperCase()} ·{" "}
                    {s.scheduledFor ? format(s.scheduledFor, "d MMM", { locale: es }) : "Sin programar"}
                  </div>
                </div>
              </div>

              <div className="grid flex-shrink-0 grid-cols-2 gap-x-6 text-right md:flex md:items-center md:gap-6">
                <div>
                  <div
                    className="text-[9px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.14em" }}
                  >
                    GMV
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
                    {(s.gmvCents / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€
                  </div>
                </div>
                <div>
                  <div
                    className="text-[9px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.14em" }}
                  >
                    Comisión
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
                    {(s.commissionCents / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€
                  </div>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] uppercase md:ml-2"
                  style={{
                    ...mono,
                    letterSpacing: "0.18em",
                    background: `${cfg.color}22`,
                    color: cfg.color,
                  }}
                >
                  {cfg.label}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

// =============================================================
// Cohorts (retention triangle)
// =============================================================

const Cohorts = () => (
  <section
    className="rounded-2xl border border-border bg-card p-5 md:p-6"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
  >
    <div className="mb-4">
      <div
        className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.2em" }}
      >
        <TrendingUp className="h-3 w-3" />
        Cohortes de partners · Retención por mes
      </div>
      <h3 className="text-xl font-semibold tracking-tight text-foreground">
        Triángulo de retención
      </h3>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th
              className="px-2 py-2 text-left text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              Mes alta
            </th>
            <th
              className="px-2 py-2 text-left text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              Altas
            </th>
            {Array.from({ length: 12 }).map((_, i) => (
              <th
                key={i}
                className="px-1 py-2 text-center text-[9px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.14em" }}
              >
                M+{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COHORTS.map((c) => (
            <tr key={c.month} className="border-t border-border">
              <td className="px-2 py-2 text-foreground" style={mono}>
                {c.month}
              </td>
              <td className="px-2 py-2 font-bold text-foreground" style={mono}>
                {c.new}
              </td>
              {c.retained.map((r, i) => {
                const pct = r / c.new;
                return (
                  <td key={i} className="px-1 py-1">
                    <div
                      className="rounded text-center text-[10px] font-semibold"
                      style={{
                        ...mono,
                        background: `rgba(232,84,42,${0.1 + pct * 0.7})`,
                        color: pct > 0.4 ? "#fff" : "#F4EEE2",
                        padding: "6px 4px",
                      }}
                    >
                      {Math.round(pct * 100)}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div
      className="mt-4 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.2)" }} />
      Bajo
      <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.5)" }} />
      Medio
      <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.8)" }} />
      Alto
    </div>
  </section>
);

// =============================================================
// KPI Card with delta
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
        vs anterior
      </div>
    </div>
  );
};

export default NetworkFinance;
