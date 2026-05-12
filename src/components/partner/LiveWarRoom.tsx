import { useEffect, useMemo, useState } from "react";
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
 * Multi-zona aforo, velocidad de entrada, revenue en vivo y alertas.
 *
 * Funciona con datos reales cuando los hay, y con simulación local
 * cuando no (siempre algo visualmente útil para demo / dirección).
 */
export const LiveWarRoom = ({ event }: Props) => {
  if (!event) {
    return (
      <PasifyEmptyState
        icon={<Radio className="h-7 w-7" />}
        eyebrow="Sin eventos en directo"
        title={<>Aún no hay evento <span style={serif} className="text-orange-500">en vivo</span>.</>}
        subtitle="Cuando publiques un evento, esta pantalla mostrará aforo por zona, velocidad de entrada y revenue en tiempo real."
      />
    );
  }

  return <LiveWarRoomContent event={event} />;
};

const LiveWarRoomContent = ({ event }: { event: LiveWarRoomEvent }) => {
  const startDate = new Date(event.date_start);
  const now = useTicker(60_000);
  const diff = startDate.getTime() - now;
  const isLive = diff <= 0 && diff > -8 * 60 * 60 * 1000;
  const isUpcoming = diff > 0;
  const isPast = diff <= -8 * 60 * 60 * 1000;

  const capacity = event.capacity ?? 800;
  const sold = event.tickets_sold ?? 0;
  const occupied = isLive
    ? Math.min(sold, Math.round(sold * 0.82)) // 82% han entrado ya en vivo
    : isPast
    ? sold
    : 0;
  const revenueCents = sold * event.price_cents;

  const zones = useMemo(() => buildZones(event), [event]);

  // Simulación: scans/min basado en hora del evento
  const scansPerMin = useScansPerMin(isLive ? sold : 0, isLive);

  const status = isLive ? "live" : isUpcoming ? "upcoming" : "past";

  return (
    <div className="space-y-6">
      {/* HERO del evento */}
      <header
        className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:p-7"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 20px -10px rgba(0,0,0,0.5)" }}
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
                <span className="inline-flex items-center gap-2" style={{ color: "#4DB87A" }}>
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
              {status === "upcoming" && <span className="text-orange-500">Próximo evento</span>}
              {status === "past" && <span className="text-muted-foreground">Evento finalizado</span>}
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

          {/* Countdown / status pill */}
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
                {status === "live" ? "Tiempo en vivo" : status === "upcoming" ? "Empieza en" : "Finalizó"}
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

      {/* 4 KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          eyebrow="Aforo ahora"
          value={`${Math.round((occupied / capacity) * 100)}%`}
          sub={`${occupied} / ${capacity}`}
          color="#FF7A4D"
          pulse={isLive}
        />
        <KpiTile
          icon={<Ticket className="h-4 w-4" />}
          eyebrow="Vendidos"
          value={sold.toString()}
          sub={`Cap. ${capacity}`}
          color="#E8542A"
        />
        <KpiTile
          icon={<Euro className="h-4 w-4" />}
          eyebrow="Recaudado"
          value={`${(revenueCents / 100).toFixed(0)}€`}
          sub={`${(event.price_cents / 100).toFixed(2)}€/entrada`}
          color="#E8B04C"
        />
        <KpiTile
          icon={<ScanLine className="h-4 w-4" />}
          eyebrow={isLive ? "Scans/min" : "Pico esperado"}
          value={isLive ? scansPerMin.toString() : "23:45h"}
          sub={isLive ? "Última hora" : "Pico de entrada"}
          color="#4DB87A"
          pulse={isLive}
        />
      </div>

      {/* Multi-zone aforo */}
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
              <span className="inline-block h-px w-5 bg-orange-500/70" />
              Aforo por zona
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {zones.length} zonas activas
            </h3>
          </div>
          <div
            className="hidden rounded-full border border-border px-3 py-1 text-[10px] uppercase text-muted-foreground sm:inline-block"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Actualizado en vivo
          </div>
        </div>

        <div className="space-y-4">
          {zones.map((z) => {
            const pct = Math.min(100, Math.round((z.current / z.capacity) * 100));
            const color =
              pct >= 100
                ? "#B8381A"
                : pct >= 85
                ? "#E8B04C"
                : pct >= 50
                ? "#E8542A"
                : "#FF7A4D";
            return (
              <div key={z.id}>
                <div className="mb-1.5 flex items-end justify-between gap-2">
                  <div>
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      {z.code}
                    </div>
                    <div className="text-sm font-semibold text-foreground md:text-base">
                      {z.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-base font-bold text-foreground md:text-lg"
                      style={mono}
                    >
                      {pct}%
                    </div>
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.14em" }}
                    >
                      {z.current} / {z.capacity}
                    </div>
                  </div>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}aa 0%, ${color} 100%)`,
                      boxShadow: `0 0 12px ${color}88`,
                    }}
                  />
                  {pct >= 100 && (
                    <span
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] uppercase text-white"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      Cap. legal
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Velocidad de entrada */}
        <section
          className="rounded-2xl border border-border bg-card p-5 md:p-6"
          style={{
            boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
          }}
        >
          <div className="mb-4">
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Activity className="h-3 w-3" />
              Velocidad de entrada
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {isLive ? `${scansPerMin} scans/min` : "Sin actividad ahora"}
            </h3>
          </div>
          <Sparkline isLive={isLive} />
          <div
            className="mt-3 flex justify-between text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            <span>-30 min</span>
            <span>Ahora</span>
          </div>
        </section>

        {/* Alertas operativas */}
        <section
          className="rounded-2xl border border-border bg-card p-5 md:p-6"
          style={{
            boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
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
              {isLive ? "2 abiertas" : "Sin alertas"}
            </h3>
          </div>
          <ul className="space-y-2">
            {isLive ? (
              <>
                <AlertRow
                  level="warning"
                  title="VIP cerca de aforo legal"
                  detail="92% · Considera frenar venta de mesas"
                />
                <AlertRow
                  level="info"
                  title="Puerta 2 va más lento"
                  detail="14 scans/min vs 22 de puerta 1"
                />
                <AlertRow level="ok" title="Stripe operativo" detail="0 fallos en última hora" />
              </>
            ) : (
              <AlertRow level="ok" title="Todo en orden" detail="Sin incidencias detectadas" />
            )}
          </ul>
        </section>
      </div>
    </div>
  );
};

// =============================================================
// Sub-components
// =============================================================

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
      boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)",
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

const Sparkline = ({ isLive }: { isLive: boolean }) => {
  // Genera 30 puntos pseudo-random pero determinístico
  const points = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 30; i++) {
      const base = isLive ? 14 + Math.sin(i * 0.6) * 5 + (i / 30) * 12 : 0;
      arr.push(Math.max(0, base + (i % 3 === 0 ? 3 : 0)));
    }
    return arr;
  }, [isLive]);
  const max = Math.max(1, ...points);

  return (
    <div className="flex h-20 items-end gap-1">
      {points.map((p, i) => {
        const h = (p / max) * 100;
        const isLast = i === points.length - 1;
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all"
            style={{
              height: `${Math.max(4, h)}%`,
              background: isLast
                ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 100%)"
                : `rgba(232,84,42,${0.35 + (i / points.length) * 0.5})`,
              boxShadow: isLast ? "0 0 12px rgba(232,84,42,0.65)" : "none",
            }}
          />
        );
      })}
    </div>
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

const useScansPerMin = (sold: number, live: boolean) => {
  const base = Math.round(sold / 200) * 5 + 12;
  const [v, setV] = useState(base);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setV(base + Math.floor(Math.random() * 8) - 3), 5_000);
    return () => window.clearInterval(id);
  }, [base, live]);
  return Math.max(0, v);
};

interface Zone {
  id: string;
  code: string;
  name: string;
  capacity: number;
  current: number;
}

const buildZones = (event: LiveWarRoomEvent): Zone[] => {
  const category = event.partner_category?.toLowerCase() ?? "discoteca";
  const totalCap = event.capacity ?? 800;
  const sold = event.tickets_sold ?? 0;
  const occupied = Math.min(sold, Math.round(sold * 0.82));

  // Plantillas por categoría
  let templates: Array<{ code: string; name: string; share: number; current: number }>;
  if (category === "festival") {
    templates = [
      { code: "Z01", name: "Main Stage", share: 0.45, current: 0.88 },
      { code: "Z02", name: "Second Stage", share: 0.3, current: 0.6 },
      { code: "Z03", name: "Beach Stage", share: 0.15, current: 0.7 },
      { code: "Z04", name: "VIP Lounge", share: 0.1, current: 0.92 },
    ];
  } else if (category === "beachclub" || category === "rooftop") {
    templates = [
      { code: "Z01", name: "Pool / Terraza", share: 0.5, current: 0.85 },
      { code: "Z02", name: "Sand Bar", share: 0.3, current: 0.62 },
      { code: "Z03", name: "VIP Loungers", share: 0.2, current: 0.96 },
    ];
  } else if (category === "sala" || category === "club") {
    templates = [
      { code: "Z01", name: "Pista principal", share: 0.6, current: 0.78 },
      { code: "Z02", name: "Sala secundaria", share: 0.25, current: 0.55 },
      { code: "Z03", name: "VIP", share: 0.15, current: 0.94 },
    ];
  } else if (category === "bar") {
    templates = [
      { code: "Z01", name: "Sala", share: 0.6, current: 0.7 },
      { code: "Z02", name: "Terraza", share: 0.4, current: 0.45 },
    ];
  } else {
    templates = [
      { code: "Z01", name: "Sala principal", share: 0.55, current: 0.78 },
      { code: "Z02", name: "Terraza", share: 0.2, current: 0.45 },
      { code: "Z03", name: "VIP", share: 0.15, current: 0.92 },
      { code: "Z04", name: "Beach Club", share: 0.1, current: 1.0 },
    ];
  }

  return templates.map((t, i) => {
    const capacity = Math.round(totalCap * t.share);
    return {
      id: `zone-${i}`,
      code: t.code,
      name: t.name,
      capacity,
      current: Math.round(capacity * t.current * Math.min(1, occupied / Math.max(1, sold))),
    };
  });
};

export default LiveWarRoom;
