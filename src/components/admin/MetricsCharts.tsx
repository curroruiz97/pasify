import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
  ComposedChart,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  Users,
  QrCode,
  Calendar,
  CreditCard,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { optimizedImage } from "@/lib/image";

/**
 * Pannello grafici admin native (no servizi esterni).
 * Funzionalità:
 *   - Period selector: 1/3/7/10/15/30/90/180/365 giorni
 *   - Tab filter: Registros / Engagement / Top eventos / Suscripciones
 *   - Cards collapsabili (toggle freccia)
 *   - Top eventos con immagine evento
 */

interface TimeseriesRow {
  day: string;
  new_users: number;
  new_partners: number;
  new_clients: number;
  qr_scans: number;
  event_participations: number;
}

interface FunnelRow {
  status: string;
  count: number;
}

interface TopEventRow {
  event_id: string;
  title: string;
  partner_id: string;
  partner_name: string;
  participants: number;
  start_date: string;
  end_date: string;
  image_url: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  trialing: "#0ea5e9",
  active: "#10b981",
  past_due: "#f59e0b",
  canceled: "#94a3b8",
  unpaid: "#ef4444",
  incomplete: "#a78bfa",
  incomplete_expired: "#64748b",
};

const PERIODS: { label: string; days: number; tickFmt: string }[] = [
  { label: "1d", days: 1, tickFmt: "HH:mm" },
  { label: "3d", days: 3, tickFmt: "d MMM" },
  { label: "7d", days: 7, tickFmt: "d MMM" },
  { label: "10d", days: 10, tickFmt: "d MMM" },
  { label: "15d", days: 15, tickFmt: "d MMM" },
  { label: "30d", days: 30, tickFmt: "d MMM" },
  { label: "3m", days: 90, tickFmt: "d MMM" },
  { label: "6m", days: 180, tickFmt: "MMM yy" },
  { label: "1a", days: 365, tickFmt: "MMM yy" },
];

type ViewKey = "all" | "registros" | "engagement" | "top" | "subs";
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "registros", label: "Registros" },
  { key: "engagement", label: "Engagement" },
  { key: "top", label: "Top eventos" },
  { key: "subs", label: "Suscripciones" },
];

export const MetricsCharts = () => {
  const [periodIdx, setPeriodIdx] = useState(5); // default 30d
  const [view, setView] = useState<ViewKey>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const period = PERIODS[periodIdx];

  // Strategia "single source of truth": fetch UNA volta dei 365 giorni
  // massimi e slice client-side per il periodo selezionato.
  // Vantaggi:
  //   - I numeri NON cambiano cambiando periodo (nessuna nuova query in mezzo)
  //   - Switch istantaneo (no loading)
  //   - Meno load DB
  const { data: timeseriesAll, isLoading: tsLoading } = useQuery({
    queryKey: ["admin-metrics-timeseries", "max"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_metrics_timeseries", { _days: 365 });
      if (error) throw error;
      return (data || []) as TimeseriesRow[];
    },
    staleTime: 5 * 60_000,
  });

  // Slice ai soli ultimi N giorni richiesti dal periodo selezionato.
  const timeseries = (timeseriesAll || []).slice(-period.days);

  const { data: funnel, isLoading: funnelLoading } = useQuery({
    queryKey: ["admin-subscription-funnel"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_subscription_funnel");
      if (error) throw error;
      return (data || []) as FunnelRow[];
    },
    staleTime: 5 * 60_000,
  });

  // Revenue chart: aggregate paying subscriptions per month (last 12).
  // - Bar: new paying subs that started in that month.
  // - Line: cumulative MRR snapshot at end-of-month (€).
  // Source of truth = partner_subscriptions JOIN subscription_plans;
  // admin RLS allows full read. Post Fase 3: ya no leemos `granted_by_admin`
  // ni `monthly_amount_cents` (no existen). Derivamos:
  //   - !!admin_granted_until && futuro → admin grant (excluido del MRR)
  //   - amount cents → subscription_plans.monthly_price_cents por plan_code
  const { data: revenueRows, isLoading: revenueLoading } = useQuery({
    queryKey: ["admin-revenue-monthly"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_subscriptions")
        .select("created_at, status, plan_code, admin_granted_until, stripe_subscription_id, cancel_at_period_end");
      if (error) throw error;
      const rows = data ?? [];
      // Resolve plan price via subscription_plans
      const codes = [...new Set(rows.map((r) => r.plan_code).filter(Boolean) as string[])];
      const priceByCode = new Map<string, number>();
      if (codes.length > 0) {
        const { data: plans } = await supabase
          .from("subscription_plans")
          .select("code, monthly_price_cents")
          .in("code", codes);
        for (const p of plans ?? []) {
          if (p.code && typeof p.monthly_price_cents === "number") {
            priceByCode.set(p.code, p.monthly_price_cents);
          }
        }
      }
      const now = Date.now();
      return rows.map((r) => ({
        ...r,
        granted_by_admin:
          !!r.admin_granted_until && new Date(r.admin_granted_until).getTime() > now,
        monthly_amount_cents: r.plan_code ? (priceByCode.get(r.plan_code) ?? null) : null,
      }));
    },
    staleTime: 5 * 60_000,
  });

  type RevenuePoint = { month: string; label: string; newPayments: number; mrrEur: number };
  const revenue: RevenuePoint[] = (() => {
    if (!revenueRows) return [];
    const PAYING = new Set(["active", "past_due", "trialing"]);
    const isPaying = (s: { status: string; granted_by_admin: boolean; stripe_subscription_id: string | null }) =>
      !!s.stripe_subscription_id && !s.granted_by_admin && PAYING.has(s.status);

    // Build last 12 month buckets.
    const now = new Date();
    const buckets: RevenuePoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        month: key,
        label: format(d, "LLL yy", { locale: es }),
        newPayments: 0,
        mrrEur: 0,
      });
    }

    // New paying subs per month (by created_at).
    for (const r of revenueRows) {
      if (!r.created_at) continue;
      if (!isPaying(r as any)) continue;
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = buckets.find((b) => b.month === key);
      if (bucket) bucket.newPayments += 1;
    }

    // Cumulative MRR snapshot at end of each month: any sub created on or
    // before the bucket's last day, still paying today, contributes its
    // monthly_amount_cents (fallback 2999 €/100).
    for (const b of buckets) {
      const [y, m] = b.month.split("-").map(Number);
      const endOfMonth = new Date(y, m, 0, 23, 59, 59).getTime();
      let centsTotal = 0;
      for (const r of revenueRows) {
        if (!r.created_at) continue;
        if (!isPaying(r as any)) continue;
        if (new Date(r.created_at).getTime() > endOfMonth) continue;
        centsTotal += r.monthly_amount_cents ?? 2999;
      }
      b.mrrEur = Math.round((centsTotal / 100) * 100) / 100;
    }
    return buckets;
  })();

  // Stesso approccio per top events: 365 giorni una volta, slice client.
  // Filtriamo gli eventi col start_date dentro la finestra periodo.
  const { data: topEventsAll, isLoading: topLoading } = useQuery({
    queryKey: ["admin-top-events", "max"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_top_events", { _limit: 50, _days: 365 });
      if (error) throw error;
      return (data || []) as TopEventRow[];
    },
    staleTime: 5 * 60_000,
  });

  const periodStart = Date.now() - period.days * 24 * 60 * 60 * 1000;
  const topEvents = (topEventsAll || [])
    .filter((e) => new Date(e.start_date).getTime() >= periodStart)
    .slice(0, 5);

  // Totals computati sui SOLI giorni visibili → coerenti col grafico.
  const totals = timeseries.reduce(
    (acc, d) => ({
      users: acc.users + d.new_users,
      scans: acc.scans + d.qr_scans,
      participations: acc.participations + d.event_participations,
    }),
    { users: 0, scans: 0, participations: 0 },
  );

  const showRegistros = view === "all" || view === "registros";
  const showEngagement = view === "all" || view === "engagement";
  const showTop = view === "all" || view === "top";
  const showSubs = view === "all" || view === "subs";

  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const tickFormatter = (d: string) => {
    try {
      return format(parseISO(d), period.tickFmt, { locale: es });
    } catch {
      return d;
    }
  };

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PERIODS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => setPeriodIdx(i)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              i === periodIdx
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* View filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              view === v.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      {tsLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <KPI
            icon={Users}
            label="Nuevos usuarios"
            value={totals.users}
            color="text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400"
            subtitle={`${period.label}`}
          />
          <KPI
            icon={Calendar}
            label="Participaciones"
            value={totals.participations}
            color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400"
            subtitle={`${period.label}`}
          />
          <KPI
            icon={QrCode}
            label="QR escaneados"
            value={totals.scans}
            color="text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400"
            subtitle={`${period.label}`}
          />
        </div>
      )}

      {/* Registros */}
      {showRegistros && (
        <ChartCard
          title={`Nuevos registros (${period.label})`}
          icon={TrendingUp}
          collapsed={collapsed.reg}
          onToggle={() => toggle("reg")}
        >
          {tsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timeseries || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="day"
                  tickFormatter={tickFormatter}
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelFormatter={(d) => format(parseISO(d as string), "d MMM yyyy", { locale: es })}
                />
                <Line type="monotone" dataKey="new_partners" stroke="#a855f7" strokeWidth={2} dot={false} name="Socios" />
                <Line type="monotone" dataKey="new_clients" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Estudiantes" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      {/* Engagement */}
      {showEngagement && (
        <ChartCard
          title={`Engagement (${period.label})`}
          icon={Calendar}
          collapsed={collapsed.eng}
          onToggle={() => toggle("eng")}
        >
          {tsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={timeseries || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="day"
                  tickFormatter={tickFormatter}
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelFormatter={(d) => format(parseISO(d as string), "d MMM yyyy", { locale: es })}
                />
                <Line type="monotone" dataKey="event_participations" stroke="#10b981" strokeWidth={2} dot={false} name="Participaciones" />
                <Line type="monotone" dataKey="qr_scans" stroke="#f59e0b" strokeWidth={2} dot={false} name="QR escaneados" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      {/* Revenue (paying subscriptions) — bar = new paying subs / month,
         line = MRR cumulative at end-of-month (€). */}
      {showSubs && (
        <ChartCard
          title="Ingresos mensuales"
          icon={CreditCard}
          collapsed={collapsed.subs}
          onToggle={() => toggle("subs")}
        >
          {revenueLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : revenue.every((p) => p.newPayments === 0 && p.mrrEur === 0) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aún no hay pagos registrados.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart
                data={revenue}
                margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  allowDecimals={false}
                  width={32}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={48}
                  tickFormatter={(v) => `€${v}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "MRR (€)") return [`€${Number(value).toFixed(2)}`, name];
                    return [value, name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar
                  yAxisId="left"
                  dataKey="newPayments"
                  name="Nuevos pagos"
                  fill="#8b5cf6"
                  radius={[6, 6, 0, 0]}
                  barSize={18}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="mrrEur"
                  name="MRR (€)"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#10b981" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      {/* Subscriptions funnel by status */}
      {showSubs && (
        <ChartCard
          title="Suscripciones partner"
          icon={CreditCard}
          collapsed={collapsed.subs}
          onToggle={() => toggle("subs")}
        >
          {funnelLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={funnel || []} layout="vertical" margin={{ top: 5, right: 20, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <YAxis type="category" dataKey="status" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={80} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {(funnel || []).map((row) => (
                    <Cell key={row.status} fill={STATUS_COLORS[row.status] || "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      )}

      {/* Top events */}
      {showTop && (
        <ChartCard
          title={`Top eventos (${period.label})`}
          icon={TrendingUp}
          collapsed={collapsed.top}
          onToggle={() => toggle("top")}
        >
          {topLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !topEvents || topEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin eventos en {period.label}
            </p>
          ) : (
            <ul className="space-y-2">
              {topEvents.map((e, i) => (
                <li
                  key={e.event_id}
                  className="flex items-center gap-3 rounded-xl border bg-background/50 p-2"
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold tabular-nums text-primary">
                    {i + 1}
                  </span>
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-primary/10">
                    {e.image_url ? (
                      <img
                        src={optimizedImage(e.image_url, "thumb")}
                        alt={e.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Calendar className="h-5 w-5 text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{e.partner_name}</p>
                  </div>
                  <div className="flex flex-col items-end pr-1">
                    <span className="text-base font-bold tabular-nums text-primary">
                      {e.participants}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      part.
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      )}
    </div>
  );
};

const KPI = ({
  icon: Icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  subtitle: string;
}) => (
  <div className="rounded-2xl border bg-card p-3">
    <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
      <Icon className="h-4 w-4" />
    </div>
    <p className="text-2xl font-bold tabular-nums leading-none">{value.toLocaleString()}</p>
    <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </p>
    <p className="text-[10px] text-muted-foreground/70">{subtitle}</p>
  </div>
);

const ChartCard = ({
  title,
  icon: Icon,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  icon: typeof Users;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border bg-card p-4 shadow-sm">
    <button
      onClick={onToggle}
      className="mb-3 flex w-full items-center justify-between gap-2 text-left"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {collapsed ? (
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
    {!collapsed && children}
  </div>
);
