import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Camera,
  Check,
  Eye,
  IdCard,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface DetectionEvent {
  id: string;
  type: "match" | "mismatch" | "underage" | "blacklist" | "density";
  message: string;
  detail: string;
  at: Date;
  score: number;
}

const initialEvents: DetectionEvent[] = [
  {
    id: "d-1",
    type: "match",
    message: "Cara ↔ DNI · OK",
    detail: "TKT-018421 · Carla Sánchez · 98.4%",
    at: new Date(Date.now() - 12 * 1000),
    score: 98.4,
  },
  {
    id: "d-2",
    type: "match",
    message: "Cara ↔ DNI · OK",
    detail: "TKT-018422 · Diego Reyes · 96.1%",
    at: new Date(Date.now() - 28 * 1000),
    score: 96.1,
  },
  {
    id: "d-3",
    type: "mismatch",
    message: "Posible suplantación",
    detail: "TKT-018419 · Match 42% · Solicitar 2º documento",
    at: new Date(Date.now() - 84 * 1000),
    score: 42,
  },
  {
    id: "d-4",
    type: "underage",
    message: "Edad detectada < 18",
    detail: "DNI 2008 · Bloqueado en puerta",
    at: new Date(Date.now() - 218 * 1000),
    score: 16,
  },
  {
    id: "d-5",
    type: "density",
    message: "Densidad zona barra 2 alta",
    detail: "1.8 p/m² · Refuerza personal",
    at: new Date(Date.now() - 360 * 1000),
    score: 1.8,
  },
];

const TYPE_CFG: Record<DetectionEvent["type"], { color: string; icon: React.ReactNode; label: string }> = {
  match: { color: "#4DB87A", icon: <ShieldCheck className="h-3.5 w-3.5" />, label: "Match OK" },
  mismatch: { color: "#B8381A", icon: <ShieldAlert className="h-3.5 w-3.5" />, label: "Mismatch" },
  underage: { color: "#E8B04C", icon: <IdCard className="h-3.5 w-3.5" />, label: "Menor" },
  blacklist: { color: "#B8381A", icon: <AlertCircle className="h-3.5 w-3.5" />, label: "Lista negra" },
  density: { color: "#E8542A", icon: <Users className="h-3.5 w-3.5" />, label: "Densidad" },
};

export const PartnerDoorVision = () => {
  const [events, setEvents] = useState<DetectionEvent[]>(initialEvents);
  const [tick, setTick] = useState(0);

  // Simulate new events every 8-12 seconds
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      const types: DetectionEvent["type"][] = ["match", "match", "match", "mismatch", "match", "match", "underage"];
      const t = types[Math.floor(Math.random() * types.length)];
      const score = t === "match" ? 90 + Math.random() * 9 : t === "mismatch" ? 30 + Math.random() * 30 : 16;
      const ev: DetectionEvent = {
        id: `d-${Date.now()}`,
        type: t,
        message: TYPE_CFG[t].label === "Match OK" ? "Cara ↔ DNI · OK" : TYPE_CFG[t].label === "Mismatch" ? "Posible suplantación" : "Edad detectada < 18",
        detail: t === "match"
          ? `TKT-${Math.floor(Math.random() * 100000)} · ${["Lucía García", "Pablo López", "Alba Martínez", "Mateo F."][Math.floor(Math.random() * 4)]} · ${score.toFixed(1)}%`
          : "Solicitar 2º documento",
        at: new Date(),
        score,
      };
      setEvents((prev) => [ev, ...prev].slice(0, 20));
    }, 8000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const stats = {
    matchesToday: 612 + events.filter((e) => e.type === "match").length,
    mismatches: 7 + events.filter((e) => e.type === "mismatch").length,
    underage: 12,
    avgScore: 96.2,
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.18) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.28)", filter: "blur(80px)" }}
        />

        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(232,84,42,0.6)",
              }}
            >
              <ScanFace className="h-6 w-6" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
                style={{ ...mono, letterSpacing: "0.22em", color: "#4DB87A" }}
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
                Computer Vision · Activo
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Anti-reventa con <span style={serif} className="text-orange-500">cara ↔ DNI</span>
              </h2>
              <div
                className="mt-1 text-[12px] text-muted-foreground"
                style={mono}
              >
                3 cámaras conectadas · Latencia 280ms · GDPR compliant
              </div>
            </div>
          </div>
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" />
            Ver feed
          </Button>
        </div>
      </section>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<ShieldCheck className="h-4 w-4" />} color="#4DB87A" eyebrow="Matches OK hoy" value={stats.matchesToday.toString()} sub="98.2% confianza media" />
        <KpiTile icon={<ShieldAlert className="h-4 w-4" />} color="#B8381A" eyebrow="Suplantaciones" value={stats.mismatches.toString()} sub="Bloqueadas en puerta" pulse />
        <KpiTile icon={<IdCard className="h-4 w-4" />} color="#E8B04C" eyebrow="Menores bloqueados" value={stats.underage.toString()} sub="Detección OCR DNI" />
        <KpiTile icon={<Brain className="h-4 w-4" />} color="#FF7A4D" eyebrow="Score medio" value={`${stats.avgScore}%`} sub="Cara ↔ DNI" />
      </section>

      {/* Live feed split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* Camera feed */}
        <CameraFeed events={events} />

        {/* Live event log */}
        <section
          className="rounded-2xl border border-border bg-card p-5 md:p-6"
          style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.2em" }}
              >
                <Zap className="h-3 w-3" />
                Detecciones en vivo
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Stream
              </h3>
            </div>
          </div>

          <div className="space-y-2">
            {events.slice(0, 8).map((e) => (
              <DetectionRow key={e.id} ev={e} />
            ))}
          </div>
        </section>
      </div>

      {/* Density heatmap & demographics */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DensityHeatmap />
        <Demographics />
      </div>
    </div>
  );
};

// =============================================================
// Camera feed (mock with face detection boxes)
// =============================================================

const CameraFeed = ({ events }: { events: DetectionEvent[] }) => {
  const recent = events[0];
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border bg-card"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <header className="flex items-center justify-between border-b border-border p-4 md:p-5">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Camera className="h-3 w-3" />
            Cámara · Puerta principal
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            Stream en directo
          </h3>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: "rgba(184,56,26,0.18)",
            color: "#FF7A4D",
          }}
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
              style={{ background: "#FF7A4D" }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: "#FF7A4D" }}
            />
          </span>
          REC
        </span>
      </header>

      {/* Mock camera view */}
      <div
        className="relative aspect-video w-full overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, #1A0F08 0%, #3D1F12 30%, #1A1714 70%, #0B0908 100%)",
        }}
      >
        {/* Noise overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            mixBlendMode: "overlay",
          }}
        />

        {/* Scan grid */}
        <div className="absolute inset-0 grid grid-cols-12 grid-rows-8 opacity-30">
          {Array.from({ length: 96 }).map((_, i) => (
            <div key={i} className="border-r border-t" style={{ borderColor: "rgba(232,84,42,0.15)" }} />
          ))}
        </div>

        {/* Face boxes */}
        <FaceBox top="32%" left="18%" width="14%" height="22%" score={98} matchOk />
        <FaceBox top="36%" left="42%" width="13%" height="20%" score={96} matchOk />
        <FaceBox top="42%" left="68%" width="14%" height="22%" score={42} matchOk={false} />

        {/* HUD */}
        <div
          className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[10px] uppercase backdrop-blur-md"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: "rgba(11,9,8,0.7)",
            color: "#F4EEE2",
          }}
        >
          PUERTA 01 · {new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>

        <div
          className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-[10px] uppercase backdrop-blur-md"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: "rgba(11,9,8,0.7)",
            color: "#4DB87A",
          }}
        >
          <Brain className="h-3 w-3" />
          IA · 3 caras detectadas
        </div>

        {/* Last event overlay */}
        {recent && (
          <div
            className="absolute bottom-3 left-3 max-w-xs rounded-xl px-3 py-2 backdrop-blur-md"
            style={{
              background: `${TYPE_CFG[recent.type].color}33`,
              border: `1px solid ${TYPE_CFG[recent.type].color}AA`,
            }}
          >
            <div
              className="inline-flex items-center gap-1.5 text-[9px] uppercase"
              style={{ ...mono, letterSpacing: "0.18em", color: TYPE_CFG[recent.type].color }}
            >
              {TYPE_CFG[recent.type].icon}
              {TYPE_CFG[recent.type].label}
            </div>
            <div className="mt-0.5 text-xs font-semibold text-white">
              {recent.message}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const FaceBox = ({
  top,
  left,
  width,
  height,
  score,
  matchOk,
}: {
  top: string;
  left: string;
  width: string;
  height: string;
  score: number;
  matchOk: boolean;
}) => {
  const color = matchOk ? "#4DB87A" : "#B8381A";
  return (
    <div
      className="absolute"
      style={{
        top,
        left,
        width,
        height,
        border: `2px solid ${color}`,
        boxShadow: `0 0 12px ${color}80`,
        borderRadius: 4,
      }}
    >
      <span
        className="absolute -top-5 left-0 rounded px-1 py-0.5 text-[9px] uppercase text-white"
        style={{
          ...mono,
          letterSpacing: "0.14em",
          background: color,
        }}
      >
        {matchOk ? "OK" : "MISMATCH"} {score}%
      </span>
    </div>
  );
};

// =============================================================
// Detection row
// =============================================================

const DetectionRow = ({ ev }: { ev: DetectionEvent }) => {
  const cfg = TYPE_CFG[ev.type];
  const secAgo = Math.floor((Date.now() - ev.at.getTime()) / 1000);
  const timeLabel = secAgo < 60 ? `${secAgo}s` : `${Math.floor(secAgo / 60)}min`;
  return (
    <article
      className="flex items-center gap-3 rounded-xl border p-3"
      style={{
        background: `${cfg.color}08`,
        borderColor: `${cfg.color}40`,
      }}
    >
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
        style={{
          background: `linear-gradient(180deg, ${cfg.color}DD 0%, ${cfg.color} 100%)`,
        }}
      >
        {cfg.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              background: `${cfg.color}22`,
              color: cfg.color,
            }}
          >
            {cfg.label}
          </span>
          <span
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            {timeLabel}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{ev.message}</div>
        <div
          className="text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.14em" }}
        >
          {ev.detail}
        </div>
      </div>
    </article>
  );
};

// =============================================================
// Density heatmap
// =============================================================

const DensityHeatmap = () => {
  const cells = Array.from({ length: 24 }).map((_, i) => {
    const seed = (Math.sin(i * 1.7) * 0.5 + 0.5) * 0.9 + 0.1;
    return seed;
  });
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
          <Users className="h-3 w-3" />
          Densidad por zona
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Heatmap del local
        </h3>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {cells.map((v, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg"
            style={{
              background: `rgba(232,84,42,${0.1 + v * 0.75})`,
              boxShadow: v > 0.7 ? "inset 0 0 0 1px rgba(184,56,26,0.4)" : undefined,
            }}
            title={`Densidad ${(v * 2).toFixed(1)} p/m²`}
          />
        ))}
      </div>

      <div
        className="mt-3 flex items-center justify-between text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.16em" }}
      >
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.2)" }} />
          Baja
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.55)" }} />
          Media
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded" style={{ background: "rgba(232,84,42,0.85)" }} />
          Alta
        </span>
      </div>

      <div
        className="mt-3 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px] uppercase"
        style={{
          ...mono,
          letterSpacing: "0.16em",
          background: "rgba(184,56,26,0.1)",
          borderColor: "rgba(184,56,26,0.4)",
          color: "#B8381A",
        }}
      >
        <AlertTriangle className="h-3 w-3" />
        Zona barra 2 · 1.8 p/m² · revisar
      </div>
    </section>
  );
};

// =============================================================
// Demographics
// =============================================================

const Demographics = () => {
  const ageRanges = [
    { range: "18-21", pct: 18 },
    { range: "22-26", pct: 38 },
    { range: "27-32", pct: 26 },
    { range: "33-40", pct: 12 },
    { range: "40+", pct: 6 },
  ];
  const genderMix = { f: 54, m: 44, x: 2 };

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
          <Sparkles className="h-3 w-3" />
          Demografía estimada
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Quién está dentro
        </h3>
      </div>

      <div className="space-y-4">
        <div>
          <div
            className="mb-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Edad
          </div>
          <div className="space-y-1.5">
            {ageRanges.map((a) => (
              <div key={a.range}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-foreground/85" style={mono}>
                    {a.range}
                  </span>
                  <span className="font-bold text-foreground" style={mono}>
                    {a.pct}%
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${a.pct * 2}%`,
                      background: "linear-gradient(90deg, #FF7A4D 0%, #E8542A 100%)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div
            className="mb-2 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Distribución
          </div>
          <div className="flex h-3 overflow-hidden rounded-full">
            <div
              style={{
                width: `${genderMix.f}%`,
                background: "linear-gradient(90deg, #E8542A 0%, #FF7A4D 100%)",
              }}
            />
            <div
              style={{
                width: `${genderMix.m}%`,
                background: "linear-gradient(90deg, #4DB87A 0%, #2D7A4F 100%)",
              }}
            />
            <div
              style={{
                width: `${genderMix.x}%`,
                background: "rgba(232,176,76,0.6)",
              }}
            />
          </div>
          <div
            className="mt-2 flex justify-between text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            <span style={{ color: "#FF7A4D" }}>♀ {genderMix.f}%</span>
            <span style={{ color: "#4DB87A" }}>♂ {genderMix.m}%</span>
            <span>X {genderMix.x}%</span>
          </div>
        </div>

        <div
          className="rounded-xl border p-3 text-[11px] text-foreground/85"
          style={{
            background: "rgba(232,176,76,0.08)",
            borderColor: "rgba(232,176,76,0.3)",
          }}
        >
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" style={{ color: "#E8B04C" }} />
            <span>
              <strong>IA · GDPR safe</strong> — La demografía se computa on-device sin guardar caras.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

// =============================================================
// Shared KPI
// =============================================================

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
  pulse,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
  pulse?: boolean;
}) => (
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

export default PartnerDoorVision;
