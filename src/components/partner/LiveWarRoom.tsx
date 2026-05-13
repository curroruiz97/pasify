import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Euro,
  Radio,
  ScanLine,
  Ticket,
  Users,
  Zap,
} from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { supabase } from "@/integrations/supabase/client";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface LiveWarRoomEvent {
  id: string;
  title: string;
  date_start: string;
  capacity: number | null;
  tickets_sold: number;
  price_cents: number;
  partner_category?: string | null;
  partner_name?: string | null;
}

interface Props {
  /** Próximo evento publicado (o el más cercano en el tiempo). */
  event: LiveWarRoomEvent | null;
}

/**
 * War room del partner — pantalla operativa del día del evento.
 *
 * Datos REALES por tipo de entrada vía RPC `partner_event_tier_live_stats`:
 *   - Vendidas, dentro, pendientes, % check-in, ingresos, capacidad por tier
 *   - Sumatorias agregadas en KPI cards arriba
 *   - Alertas operativas reales (tier saturado, muchos pendientes, etc.)
 *
 * Reemplaza la versión anterior con "zonas simuladas" — todo lo que se ve
 * en pantalla viene del DB. Refresca automáticamente via Supabase Realtime
 * cuando un ticket cambia de estado (ej: tras un escaneo en puerta).
 */
export const LiveWarRoom = ({ event }: Props) => {
  if (!event) {
    return (
      <PasifyEmptyState
        icon={<Radio className="h-7 w-7" />}
        eyebrow="Sin eventos en directo"
        title={
          <>
            Aún no hay evento{" "}
            <span style={serif} className="text-orange-500">
              en vivo
            </span>
            .
          </>
        }
        subtitle="Cuando publiques un evento, esta pantalla mostrará vendidos, check-ins y porcentaje de entrada por cada tipo de ticket en tiempo real."
      />
    );
  }
  return <LiveWarRoomContent event={event} />;
};

// =============================================================
// Per-tier live stats row (server shape)
// =============================================================
type TierLiveStat = {
  tier_id: string;
  tier_name: string;
  tier_status: string;
  capacity: number | null;
  sold_count: number;
  used_count: number;
  pending_count: number;
  refunded_count: number;
  revenue_cents: number;
  checkin_pct: number;
  has_sales: boolean;
  sort_order: number;
};

// =============================================================
// LiveWarRoomContent
// =============================================================
const LiveWarRoomContent = ({ event }: { event: LiveWarRoomEvent }) => {
  const startDate = new Date(event.date_start);
  const now = useTicker(60_000);
  const diff = startDate.getTime() - now;
  const isLive = diff <= 0 && diff > -8 * 60 * 60 * 1000;
  const isUpcoming = diff > 0;
  const isPast = diff <= -8 * 60 * 60 * 1000;
  const status = isLive ? "live" : isUpcoming ? "upcoming" : "past";

  const [tiers, setTiers] = useState<TierLiveStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const realtimeId = useId();

  // Carga inicial + reload
  const loadStats = useCallback(async () => {
    setRefreshing(true);
    try {
      // Cast hasta que se regeneren los types post-migration.
      const rpcAny = supabase as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>
        ) => Promise<{ data: TierLiveStat[] | null; error: { message: string } | null }>;
      };
      const { data, error } = await rpcAny.rpc("partner_event_tier_live_stats", {
        _event_id: event.id,
      });
      if (!error) {
        setTiers(data ?? []);
      }
    } finally {
      setRefreshing(false);
    }
  }, [event.id]);

  useEffect(() => {
    setLoading(true);
    void loadStats().finally(() => setLoading(false));
  }, [loadStats]);

  // Realtime: refresca cuando un ticket de este evento cambia. Cada
  // consumidor obtiene un canal con id único (useId) para evitar colisiones.
  useEffect(() => {
    if (!event.id) return;
    const channel = supabase
      .channel(`live-warroom-${event.id}-${realtimeId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${event.id}`,
        },
        () => void loadStats()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${event.id}`,
        },
        () => void loadStats()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [event.id, realtimeId, loadStats]);

  // Totales agregados
  const totals = useMemo(() => {
    const sold = tiers.reduce((s, t) => s + (t.sold_count ?? 0), 0);
    const used = tiers.reduce((s, t) => s + (t.used_count ?? 0), 0);
    const pending = tiers.reduce((s, t) => s + (t.pending_count ?? 0), 0);
    const revenue = tiers.reduce((s, t) => s + Number(t.revenue_cents ?? 0), 0);
    const checkinPct = sold > 0 ? Math.round((used / sold) * 100 * 10) / 10 : 0;
    return { sold, used, pending, revenue, checkinPct };
  }, [tiers]);

  // Capacidad total declarada por tiers (cuando todos tienen cupo). Fallback a event.capacity.
  const declaredCapacity = useMemo(() => {
    const caps = tiers.map((t) => t.capacity).filter((c): c is number => typeof c === "number");
    if (caps.length === tiers.length && tiers.length > 0) {
      return caps.reduce((a, b) => a + b, 0);
    }
    return event.capacity ?? null;
  }, [tiers, event.capacity]);

  // Alertas operativas calculadas a partir de stats reales
  const alerts = useMemo(() => {
    type AlertItem = {
      level: "ok" | "info" | "warning" | "danger";
      title: string;
      detail: string;
    };
    const out: AlertItem[] = [];
    for (const t of tiers) {
      if (!t.capacity || t.capacity <= 0) continue;
      const pct = (t.sold_count / t.capacity) * 100;
      if (pct >= 100) {
        out.push({
          level: "danger",
          title: `${t.tier_name}: aforo legal alcanzado`,
          detail: `${t.sold_count} vendidas / ${t.capacity}`,
        });
      } else if (pct >= 85) {
        out.push({
          level: "warning",
          title: `${t.tier_name}: cerca del aforo`,
          detail: `${Math.round(pct)}% vendido · considera frenar venta`,
        });
      }
      if (isLive && t.pending_count > 10 && t.sold_count > 0) {
        const pendingPct = (t.pending_count / t.sold_count) * 100;
        if (pendingPct > 50) {
          out.push({
            level: "info",
            title: `${t.tier_name}: muchos pendientes de entrar`,
            detail: `${t.pending_count} pendientes (${Math.round(pendingPct)}% sin escanear)`,
          });
        }
      }
    }
    if (out.length === 0) {
      out.push({
        level: "ok",
        title: isLive ? "Todo en orden" : "Sin incidencias detectadas",
        detail: isLive
          ? "Ningún tipo de ticket saturado ni con muchos pendientes."
          : "Cuando empiece el evento veremos aforo y check-ins en vivo.",
      });
    }
    return out;
  }, [tiers, isLive]);

  return (
    <div className="space-y-6">
      {/* HERO del evento */}
      <header
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-7"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 20px -10px rgba(0,0,0,0.5)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(90px)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              {status === "live" && (
                <span
                  className="inline-flex items-center gap-2"
                  style={{ color: "#4DB87A" }}
                >
                  <span className="relative inline-flex h-2 w-2">
                    <span
                      className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                      style={{ background: "#4DB87A" }}
                    />
                    <span
                      className="relative inline-flex h-2 w-2 rounded-full"
                      style={{ background: "#4DB87A" }}
                    />
                  </span>
                  En directo
                </span>
              )}
              {status === "upcoming" && (
                <span className="text-orange-500">Próximo evento</span>
              )}
              {status === "past" && (
                <span className="text-muted-foreground">Evento finalizado</span>
              )}
            </div>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              {event.title}
            </h2>
            <div
              className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
              style={mono}
            >
              <span>{format(startDate, "EEEE d MMM · HH:mm", { locale: es })}h</span>
              {event.partner_name && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{event.partner_name}</span>
                </>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <div
              className="rounded-2xl border px-5 py-3 text-right"
              style={{
                background:
                  status === "live"
                    ? "linear-gradient(160deg, rgba(77,184,122,0.12), rgba(77,184,122,0.02))"
                    : status === "upcoming"
                    ? "linear-gradient(160deg, rgba(232,84,42,0.12), rgba(232,84,42,0.02))"
                    : "rgba(255,255,255,0.03)",
                borderColor:
                  status === "live"
                    ? "rgba(77,184,122,0.4)"
                    : status === "upcoming"
                    ? "rgba(232,84,42,0.4)"
                    : "rgba(244,238,226,0.1)",
              }}
            >
              <div
                className="text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.2em" }}
              >
                {status === "live"
                  ? "Tiempo en vivo"
                  : status === "upcoming"
                  ? "Empieza en"
                  : "Finalizó"}
              </div>
              <div
                className="mt-1 text-xl font-bold tracking-tight text-foreground md:text-2xl"
                style={mono}
              >
                {status === "live" && formatDistanceToNowStrict(startDate, { locale: es })}
                {status === "upcoming" && formatDistanceToNowStrict(startDate, { locale: es })}
                {status === "past" && format(startDate, "d MMM", { locale: es })}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* KPI totales */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile
          icon={<Ticket className="h-4 w-4" />}
          eyebrow="Vendidos"
          value={totals.sold.toString()}
          sub={declaredCapacity != null ? `Cap. ${declaredCapacity}` : "Sin aforo definido"}
          color="#FF7A4D"
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          eyebrow="Han entrado"
          value={totals.used.toString()}
          sub={`${totals.checkinPct}% check-in`}
          color="#4DB87A"
          pulse={isLive && totals.used > 0}
        />
        <KpiTile
          icon={<ScanLine className="h-4 w-4" />}
          eyebrow="Por entrar"
          value={totals.pending.toString()}
          sub={isLive ? "en puerta" : "antes de empezar"}
          color="#E8B04C"
          pulse={isLive && totals.pending > 0}
        />
        <KpiTile
          icon={<Euro className="h-4 w-4" />}
          eyebrow="Recaudado"
          value={`${(totals.revenue / 100).toFixed(0)}€`}
          sub={`${tiers.length} ${tiers.length === 1 ? "tipo" : "tipos"} de ticket`}
          color="#E8542A"
        />
      </div>

      {/* Per-tier breakdown */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
        }}
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              Por tipo de entrada
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {tiers.length} {tiers.length === 1 ? "tipo activo" : "tipos activos"}
            </h3>
          </div>
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"}`}
              aria-hidden="true"
            />
            En vivo
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Cargando stats por tier…
          </div>
        ) : tiers.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Este evento aún no tiene tipos de ticket configurados.
          </div>
        ) : (
          <div className="space-y-4">
            {tiers.map((t) => (
              <TierRow key={t.tier_id} tier={t} />
            ))}
          </div>
        )}
      </section>

      {/* Alertas */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
        }}
      >
        <div className="mb-4">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Zap className="h-3 w-3" />
            Alertas operativas
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {alerts.length === 1 && alerts[0].level === "ok"
              ? "Sin alertas"
              : `${alerts.length} ${alerts.length === 1 ? "abierta" : "abiertas"}`}
          </h3>
        </div>
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <AlertRow key={i} level={a.level} title={a.title} detail={a.detail} />
          ))}
        </ul>
      </section>
    </div>
  );
};

// =============================================================
// Sub-components
// =============================================================

const TierRow = ({ tier }: { tier: TierLiveStat }) => {
  const sold = tier.sold_count ?? 0;
  const used = tier.used_count ?? 0;
  const pending = tier.pending_count ?? 0;
  const capacity = tier.capacity ?? null;
  const occPct = capacity ? Math.min(100, Math.round((sold / capacity) * 100)) : null;
  const checkinPct = tier.checkin_pct ?? 0;
  const revenue = (Number(tier.revenue_cents ?? 0) / 100).toFixed(0);

  const occColor =
    occPct == null
      ? "#FF7A4D"
      : occPct >= 100
      ? "#B8381A"
      : occPct >= 85
      ? "#E8B04C"
      : occPct >= 50
      ? "#E8542A"
      : "#FF7A4D";

  const inactive = tier.tier_status !== "active";

  return (
    <article
      className={`rounded-2xl border border-border bg-card/40 p-4 transition ${inactive ? "opacity-70" : ""}`}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            {inactive ? "Tipo oculto" : "Tipo activo"}
          </div>
          <div className="truncate text-base font-semibold text-foreground md:text-lg">
            {tier.tier_name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.16em" }}>
            Ingresos
          </div>
          <div className="text-base font-bold text-foreground md:text-lg" style={mono}>
            €{revenue}
          </div>
        </div>
      </div>

      {/* Mini-stats por tier */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Vendidas" value={String(sold)} accent />
        <MiniStat label="Dentro" value={String(used)} />
        <MiniStat label="Pendientes" value={String(pending)} />
        <MiniStat label="% Entrada" value={`${checkinPct}%`} />
      </div>

      {/* Bar: ocupación si hay capacity */}
      {capacity != null && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
            <span>
              {sold} / {capacity}{" "}
              <span className="text-muted-foreground/60">vendidas</span>
            </span>
            <span style={mono}>{occPct}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${occPct ?? 0}%`,
                background: `linear-gradient(90deg, ${occColor}aa 0%, ${occColor} 100%)`,
                boxShadow: `0 0 12px ${occColor}66`,
              }}
            />
          </div>
        </div>
      )}
    </article>
  );
};

const MiniStat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div
    className={`rounded-xl border ${accent ? "border-orange-500/30 bg-orange-500/5" : "border-border bg-card"} p-2.5`}
  >
    <div
      className="text-[9.5px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div
      className="mt-0.5 text-base font-bold leading-none text-foreground md:text-lg"
      style={mono}
    >
      {value}
    </div>
  </div>
);

const KpiTile = ({
  icon,
  eyebrow,
  value,
  sub,
  color,
  pulse,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  value: string;
  sub: string;
  color: string;
  pulse?: boolean;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 md:p-5"
    style={{
      boxShadow:
        "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)",
    }}
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

const AlertRow = ({
  level,
  title,
  detail,
}: {
  level: "ok" | "info" | "warning" | "danger";
  title: string;
  detail: string;
}) => {
  const config = {
    ok: { color: "#4DB87A", Icon: CheckCircle2 },
    info: { color: "#E8B04C", Icon: Activity },
    warning: { color: "#E8B04C", Icon: AlertTriangle },
    danger: { color: "#B8381A", Icon: AlertTriangle },
  }[level];
  return (
    <li
      className="flex items-start gap-3 rounded-xl border border-border p-3"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${config.color}22`, color: config.color }}
      >
        <config.Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div
          className="mt-0.5 text-[11px] text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.04em" }}
        >
          {detail}
        </div>
      </div>
    </li>
  );
};

// =============================================================
// Helpers
// =============================================================

const useTicker = (ms: number) => {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
};

export default LiveWarRoom;
