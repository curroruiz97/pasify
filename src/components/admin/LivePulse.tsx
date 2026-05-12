import { useEffect, useState } from "react";
import { AlertTriangle, Euro, Radio, ScanLine } from "lucide-react";
import { format } from "date-fns";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface Props {
  /** Eventos activos ahora (mock o real). */
  liveEvents?: number;
  /** GMV de la jornada en céntimos. */
  gmvCentsToday?: number;
  /** Scans/min agregados. */
  scansPerMin?: number;
  /** Alertas operativas abiertas. */
  openAlerts?: number;
}

/**
 * Live Pulse del admin — 4 tiles editoriales con "latido" de la red
 * en tiempo real. Headline tipo NOC (Network Operations Center).
 */
export const LivePulse = ({
  liveEvents = 3,
  gmvCentsToday = 184523_00,
  scansPerMin = 47,
  openAlerts = 2,
}: Props) => {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section
      className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-7"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
      }}
    >
      {/* Halo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
        style={{ background: "rgba(232,84,42,0.22)", filter: "blur(90px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 -bottom-32 h-60 w-60 rounded-full"
        style={{ background: "rgba(77,184,122,0.12)", filter: "blur(80px)" }}
      />

      {/* Header */}
      <header className="relative mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
            style={{ ...mono, letterSpacing: "0.22em", color: "#4DB87A" }}
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
            Live Pulse · Red Pasify
          </div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
            La red <span style={serif} className="text-orange-500">latiendo</span> ahora.
          </h2>
        </div>
        <div
          className="text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          Actualizado · {format(now, "HH:mm")}h
        </div>
      </header>

      {/* 4 tiles */}
      <div className="relative grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <PulseTile
          icon={<Radio className="h-4 w-4" />}
          eyebrow="Eventos en vivo"
          value={liveEvents.toString()}
          sub={liveEvents > 0 ? `${liveEvents} en curso` : "Ninguno ahora"}
          color="#FF7A4D"
          pulse={liveEvents > 0}
        />
        <PulseTile
          icon={<Euro className="h-4 w-4" />}
          eyebrow="GMV hoy"
          value={`${(gmvCentsToday / 100).toLocaleString("es-ES", {
            maximumFractionDigits: 0,
          })}€`}
          sub={`+${Math.round((Math.random() * 8 + 6) * 10) / 10}% vs ayer`}
          color="#E8542A"
        />
        <PulseTile
          icon={<ScanLine className="h-4 w-4" />}
          eyebrow="Scans/min"
          value={scansPerMin.toString()}
          sub="Agregado red"
          color="#4DB87A"
          pulse
        />
        <PulseTile
          icon={<AlertTriangle className="h-4 w-4" />}
          eyebrow="Alertas"
          value={openAlerts.toString()}
          sub={openAlerts > 0 ? "Requieren atención" : "Todo en orden"}
          color={openAlerts > 0 ? "#E8B04C" : "#8A8275"}
          pulse={openAlerts > 0}
        />
      </div>
    </section>
  );
};

const PulseTile = ({
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
    className="relative overflow-hidden rounded-2xl border border-border bg-card/80 p-4 backdrop-blur-sm md:p-5"
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

export default LivePulse;
