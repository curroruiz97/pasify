import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  Euro,
  Loader2,
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
import { format, subDays, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";

/**
 * PartnerReports — métricas y BI del partner con datos reales.
 *
 * Antes este componente era 100% mock (`buildSeries()` local). Ahora
 * todas las cifras provienen de queries SQL contra `tickets` filtradas
 * por `partner_id = auth.uid()` y por rango de fechas.
 *
 * Si el partner no tiene ventas todavía, mostramos empty state honesto
 * con CTA "Crea tu primer evento" en lugar de cifras mock que engañan.
 *
 * Métricas mostradas (todas reales):
 *   - KPIs: entradas vendidas, recaudado, clientes únicos, tasa entrada
 *   - Serie diaria de ventas + ingresos
 *   - Top eventos por recaudación
 *   - Heatmap día/hora de compras
 *
 * Top RRPP, channels y retention quedan documentados como roadmap en
 * `docs/HARDENING-PENDING.md` porque requieren columnas extra en
 * `tickets` (rrpp_id, source) y/o joins con buyer_user_id.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

type Range = "7d" | "30d" | "90d" | "ytd";

const RANGE_LABEL: Record<Range, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  ytd: "Este año",
};

interface TicketRow {
  id: string;
  event_id: string;
  status: string;
  amount_paid_cents: number;
  paid_at: string | null;
  used_at: string | null;
  buyer_user_id: string | null;
  buyer_email: string | null;
}

interface EventRow {
  id: string;
  title: string;
}

const rangeToDays = (range: Range): number => {
  switch (range) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    case "ytd": {
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return Math.ceil((now.getTime() - yearStart.getTime()) / 86_400_000);
    }
  }
};

export const PartnerReports = () => {
  const { toast } = useToast();
  const [range, setRange] = useState<Range>("30d");
  const days = rangeToDays(range);

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [prevTickets, setPrevTickets] = useState<TicketRow[]>([]);
  const [events, setEvents] = useState<Map<string, EventRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        setTickets([]);
        setPrevTickets([]);
        setLoading(false);
        return;
      }

      const now = new Date();
      const start = startOfDay(subDays(now, days)).toISOString();
      const prevStart = startOfDay(subDays(now, days * 2)).toISOString();
      const prevEnd = startOfDay(subDays(now, days)).toISOString();

      // Tickets del rango actual
      const { data: curRows, error: curErr } = await supabase
        .from("tickets")
        .select(
          "id, event_id, status, amount_paid_cents, paid_at, used_at, buyer_user_id, buyer_email"
        )
        .eq("partner_id", uid)
        .in("status", ["paid", "used"])
        .gte("paid_at", start);
      if (curErr) throw curErr;

      // Tickets del rango anterior (para delta)
      const { data: prevRows } = await supabase
        .from("tickets")
        .select("id, status, amount_paid_cents, paid_at")
        .eq("partner_id", uid)
        .in("status", ["paid", "used"])
        .gte("paid_at", prevStart)
        .lt("paid_at", prevEnd);

      setTickets((curRows ?? []) as TicketRow[]);
      setPrevTickets((prevRows ?? []) as TicketRow[]);

      // Eventos referenciados para top events / titulares
      const eventIds = Array.from(new Set((curRows ?? []).map((t) => t.event_id).filter(Boolean)));
      if (eventIds.length > 0) {
        const { data: evData } = await supabase
          .from("events")
          .select("id, title")
          .in("id", eventIds);
        const m = new Map<string, EventRow>();
        for (const e of (evData ?? []) as EventRow[]) m.set(e.id, e);
        setEvents(m);
      } else {
        setEvents(new Map());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error cargando reports";
      console.error("[PartnerReports] load:", err);
      setError(msg);
      toast({ title: "Error al cargar reports", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Agregados
  const stats = useMemo(() => {
    const sold = tickets.length;
    const revenue = tickets.reduce((s, t) => s + (t.amount_paid_cents ?? 0), 0);
    const used = tickets.filter((t) => t.status === "used").length;
    const usageRate = sold > 0 ? Math.round((used / sold) * 100) : 0;
    const uniqueBuyers = new Set(
      tickets.map((t) => t.buyer_user_id ?? t.buyer_email ?? "")
        .filter((x) => x.length > 0)
    ).size;

    const prevSold = prevTickets.length;
    const prevRev = prevTickets.reduce((s, t) => s + (t.amount_paid_cents ?? 0), 0);
    const deltaSoldPct = prevSold > 0 ? ((sold - prevSold) / prevSold) * 100 : 0;
    const deltaRevPct = prevRev > 0 ? ((revenue - prevRev) / prevRev) * 100 : 0;

    return { sold, revenue, used, usageRate, uniqueBuyers, deltaSoldPct, deltaRevPct };
  }, [tickets, prevTickets]);

  // Serie diaria
  const series = useMemo(() => {
    const now = new Date();
    const buckets = new Map<string, { sold: number; rev: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(now, i);
      buckets.set(format(d, "yyyy-MM-dd"), { sold: 0, rev: 0 });
    }
    for (const t of tickets) {
      if (!t.paid_at) continue;
      const key = format(new Date(t.paid_at), "yyyy-MM-dd");
      const cur = buckets.get(key);
      if (cur) {
        cur.sold++;
        cur.rev += t.amount_paid_cents ?? 0;
      }
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date: new Date(date),
      sold: v.sold,
      revenueCents: v.rev,
    }));
  }, [tickets, days]);

  // Top eventos por recaudación
  const topEvents = useMemo(() => {
    const map = new Map<string, { sold: number; rev: number; title: string }>();
    for (const t of tickets) {
      const cur = map.get(t.event_id);
      if (cur) {
        cur.sold++;
        cur.rev += t.amount_paid_cents ?? 0;
      } else {
        map.set(t.event_id, {
          sold: 1,
          rev: t.amount_paid_cents ?? 0,
          title: events.get(t.event_id)?.title ?? "Evento",
        });
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5);
  }, [tickets, events]);

  // Heatmap dia/hora (Lun=1..Dom=0)
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const t of tickets) {
      if (!t.paid_at) continue;
      const d = new Date(t.paid_at);
      const dow = d.getDay();
      const h = d.getHours();
      grid[dow][h]++;
    }
    return grid;
  }, [tickets]);

  const exportCsv = () => {
    if (tickets.length === 0) {
      toast({ title: "Nada que exportar", description: "Aún no tienes ventas en este rango." });
      return;
    }
    const header = "id,event_id,status,amount_paid_cents,paid_at,buyer_email\n";
    const lines = tickets.map((t) =>
      [t.id, t.event_id, t.status, t.amount_paid_cents, t.paid_at ?? "", (t.buyer_email ?? "").replace(/,/g, ";")].join(",")
    );
    const csv = header + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pasify-reports-${range}-${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
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
          <p className="mt-1 text-xs text-muted-foreground" style={mono}>
            Datos reales · {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"} en el rango
          </p>
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
          <Button variant="outline" onClick={exportCsv} disabled={tickets.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </header>

      {error && (
        <div
          className="rounded-2xl border p-4 text-sm"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <p className="font-semibold text-foreground">No pudimos cargar los reports</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{error}</p>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando métricas reales…
        </div>
      )}

      {!loading && tickets.length === 0 && !error && (
        <PasifyEmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          eyebrow="Sin datos todavía"
          title={<>Aún no hay <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>ventas</span> en este rango.</>}
          subtitle="Cuando empieces a vender tickets aparecerán aquí KPIs, serie diaria, top eventos y heatmap de horas. Datos reales, sin maquillaje."
        />
      )}

      {!loading && tickets.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Kpi
              icon={<Ticket className="h-4 w-4" />}
              color="#FF7A4D"
              eyebrow="Entradas vendidas"
              value={stats.sold.toString()}
              deltaPct={stats.deltaSoldPct}
            />
            <Kpi
              icon={<Euro className="h-4 w-4" />}
              color="#E8542A"
              eyebrow="Recaudado"
              value={`${(stats.revenue / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
              deltaPct={stats.deltaRevPct}
            />
            <Kpi
              icon={<Users className="h-4 w-4" />}
              color="#4DB87A"
              eyebrow="Compradores únicos"
              value={stats.uniqueBuyers.toString()}
              deltaPct={null}
            />
            <Kpi
              icon={<ScanLine className="h-4 w-4" />}
              color="#E8B04C"
              eyebrow="Tasa entrada"
              value={`${stats.usageRate}%`}
              deltaPct={null}
              sub={`${stats.used}/${stats.sold} usados`}
            />
          </section>

          <RevenueChart series={series} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <TopEvents items={topEvents} />
            <HoursHeatmap grid={heatmap} />
          </div>
        </>
      )}
    </div>
  );
};

// =============================================================
// KPI
// =============================================================

const Kpi = ({
  icon,
  color,
  eyebrow,
  value,
  deltaPct,
  sub,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  deltaPct: number | null;
  sub?: string;
}) => (
  <article
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-12 -top-12 h-24 w-24 rounded-full opacity-50"
      style={{ background: `${color}33`, filter: "blur(30px)" }}
    />
    <div className="relative flex items-start justify-between">
      <div
        className="grid h-9 w-9 place-items-center rounded-xl text-white"
        style={{ background: color }}
      >
        {icon}
      </div>
      {deltaPct !== null && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
          style={{
            ...mono,
            background: deltaPct >= 0 ? "rgba(77,184,122,0.15)" : "rgba(184,56,26,0.15)",
            color: deltaPct >= 0 ? "#4DB87A" : "#FF7A4D",
          }}
        >
          {deltaPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(deltaPct).toFixed(0)}%
        </span>
      )}
    </div>
    <div className="relative mt-3">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        {eyebrow}
      </div>
      <div className="mt-0.5 text-2xl font-bold text-foreground" style={mono}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
          {sub}
        </div>
      )}
    </div>
  </article>
);

// =============================================================
// Revenue chart (SVG simple, sin libs externas)
// =============================================================

const RevenueChart = ({ series }: { series: Array<{ date: Date; sold: number; revenueCents: number }> }) => {
  if (series.length === 0) return null;
  const maxRev = Math.max(...series.map((s) => s.revenueCents), 1);
  const W = 600;
  const H = 160;
  const pad = 8;
  const step = (W - pad * 2) / Math.max(series.length - 1, 1);

  const points = series
    .map((s, i) => {
      const x = pad + i * step;
      const y = H - pad - (s.revenueCents / maxRev) * (H - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <TrendingUp className="h-3 w-3" />
          Ventas diarias
        </div>
        <div className="text-xs text-muted-foreground" style={mono}>
          Pico: {(maxRev / 100).toFixed(0)}€/día
        </div>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF7A4D" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FF7A4D" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={points} fill="none" stroke="#FF7A4D" strokeWidth="2" strokeLinejoin="round" />
        <polyline
          points={`${pad},${H - pad} ${points} ${W - pad},${H - pad}`}
          fill="url(#revGrad)"
          stroke="none"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground" style={mono}>
        <span>{format(series[0].date, "d MMM", { locale: es })}</span>
        <span>{format(series[series.length - 1].date, "d MMM", { locale: es })}</span>
      </div>
    </article>
  );
};

// =============================================================
// Top events
// =============================================================

const TopEvents = ({
  items,
}: {
  items: Array<{ id: string; sold: number; rev: number; title: string }>;
}) => (
  <article className="rounded-2xl border border-border bg-card p-5">
    <header className="mb-4 flex items-center justify-between">
      <div
        className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        <Trophy className="h-3 w-3" />
        Top eventos
      </div>
    </header>
    {items.length === 0 ? (
      <div className="py-4 text-center text-xs text-muted-foreground">Sin datos</div>
    ) : (
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-3">
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold"
              style={{
                ...mono,
                background: i === 0 ? "rgba(255,122,77,0.2)" : "rgba(255,255,255,0.04)",
                color: i === 0 ? "#FF7A4D" : "#9b9388",
              }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{it.title}</div>
              <div className="text-[10px] text-muted-foreground" style={mono}>
                {it.sold} {it.sold === 1 ? "ticket" : "tickets"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-foreground" style={mono}>
                {(it.rev / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€
              </div>
            </div>
            {i === 0 && <Star className="h-3.5 w-3.5 text-orange-500" />}
          </li>
        ))}
      </ol>
    )}
  </article>
);

// =============================================================
// Hours heatmap
// =============================================================

const DOW_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const HoursHeatmap = ({ grid }: { grid: number[][] }) => {
  const max = Math.max(...grid.flat(), 1);
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <BarChart3 className="h-3 w-3" />
          Heatmap día / hora
        </div>
        <div className="text-[10px] text-muted-foreground" style={mono}>
          Pico {max} compras
        </div>
      </header>
      <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5 text-[9px]">
        <div></div>
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            className="text-center text-muted-foreground"
            style={mono}
          >
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {grid.map((row, dow) => (
          <>
            <div
              key={`d-${dow}`}
              className="pr-1 text-right text-muted-foreground"
              style={mono}
            >
              {DOW_LABELS[dow]}
            </div>
            {row.map((cell, h) => {
              const intensity = cell / max;
              return (
                <div
                  key={`${dow}-${h}`}
                  title={`${DOW_LABELS[dow]} ${h}h · ${cell}`}
                  className="aspect-square rounded-sm"
                  style={{
                    background:
                      cell === 0
                        ? "rgba(255,255,255,0.03)"
                        : `rgba(255,122,77,${Math.max(0.12, intensity)})`,
                  }}
                />
              );
            })}
          </>
        ))}
      </div>
    </article>
  );
};

export default PartnerReports;
