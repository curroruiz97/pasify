import { useMemo, useState } from "react";
import {
  Sparkles,
  BarChart3,
  Globe2,
  Music2,
  Users,
  TrendingUp,
  TrendingDown,
  Coins,
  Calendar,
  MapPin,
  Activity,
  Eye,
  Building2,
  ChevronRight,
  Cpu,
  ShieldCheck,
  Layers,
  Lock,
  Sliders,
  PartyPopper,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

/* ============================================================
   IndustryBenchmarks — Fase 6
   Inteligencia ANÓNIMA cross-tenant. Cada partner ve cómo se
   compara con locales similares (mismo segmento, ciudad, tamaño)
   sin saber quiénes son. Pasify-only — el moat de datos.
   ============================================================ */

type VenueSegment = "discoteca" | "club" | "festival" | "bar-musica" | "sala-concierto";
type Region = "españa-nacional" | "madrid" | "barcelona" | "valencia" | "ibiza" | "andalucia";

const SEGMENT_META: Record<VenueSegment, { label: string; color: string }> = {
  "discoteca":       { label: "Discoteca",        color: "#FF7A4D" },
  "club":            { label: "Club",             color: "#8B5CF6" },
  "festival":        { label: "Festival",         color: "#E8B04C" },
  "bar-musica":      { label: "Bar musical",      color: "#3B82F6" },
  "sala-concierto":  { label: "Sala de conciertos", color: "#4DB87A" },
};

const REGION_META: Record<Region, { label: string }> = {
  "españa-nacional": { label: "España · agregado" },
  "madrid":          { label: "Madrid" },
  "barcelona":       { label: "Barcelona" },
  "valencia":        { label: "Valencia" },
  "ibiza":           { label: "Ibiza" },
  "andalucia":       { label: "Andalucía" },
};

interface PriceBenchmark {
  ticketType: string;
  p25: number;
  median: number;
  p75: number;
  yoy: number; // pct
}

const PRICE_BENCHMARKS: Record<VenueSegment, PriceBenchmark[]> = {
  discoteca: [
    { ticketType: "Early bird",  p25: 8,  median: 12, p75: 16, yoy: 6.2 },
    { ticketType: "Late release", p25: 15, median: 22, p75: 28, yoy: 8.4 },
    { ticketType: "VIP table 4p", p25: 180, median: 260, p75: 420, yoy: 12.1 },
    { ticketType: "Puerta",      p25: 18, median: 25, p75: 35, yoy: 4.8 },
  ],
  club: [
    { ticketType: "General",     p25: 12, median: 18, p75: 25, yoy: 5.5 },
    { ticketType: "VIP standing", p25: 30, median: 45, p75: 65, yoy: 9.0 },
    { ticketType: "Puerta",      p25: 20, median: 28, p75: 38, yoy: 4.2 },
  ],
  festival: [
    { ticketType: "Abono",       p25: 65, median: 95, p75: 145, yoy: 11.8 },
    { ticketType: "Día",         p25: 35, median: 55, p75: 78, yoy: 7.6 },
    { ticketType: "VIP pase",    p25: 180, median: 260, p75: 420, yoy: 14.2 },
  ],
  "bar-musica": [
    { ticketType: "Consumición", p25: 6, median: 9, p75: 12, yoy: 3.4 },
    { ticketType: "Evento esp.", p25: 8, median: 12, p75: 18, yoy: 6.0 },
  ],
  "sala-concierto": [
    { ticketType: "General",     p25: 18, median: 28, p75: 42, yoy: 7.1 },
    { ticketType: "Anticipada",  p25: 15, median: 22, p75: 32, yoy: 5.4 },
    { ticketType: "Meet & greet", p25: 80, median: 140, p75: 220, yoy: 12.6 },
  ],
};

interface DemandSlot {
  day: "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";
  hours: { hour: number; intensity: number }[]; // 0-1
}

/* simplified pattern — viernes-sabado-night dominante */
const DEMAND_DATA: DemandSlot[] = [
  { day: "lun", hours: gen([0.05, 0.04, 0.03, 0.03, 0.02, 0.02, 0.05, 0.10, 0.15, 0.18, 0.20, 0.18, 0.20, 0.25, 0.30, 0.32, 0.35, 0.30, 0.25, 0.22, 0.18, 0.15, 0.10, 0.06]) },
  { day: "mar", hours: gen([0.05, 0.04, 0.03, 0.02, 0.02, 0.02, 0.05, 0.12, 0.18, 0.22, 0.25, 0.20, 0.22, 0.28, 0.32, 0.35, 0.40, 0.35, 0.30, 0.25, 0.20, 0.18, 0.12, 0.08]) },
  { day: "mie", hours: gen([0.06, 0.05, 0.04, 0.03, 0.02, 0.02, 0.06, 0.14, 0.20, 0.25, 0.28, 0.22, 0.25, 0.30, 0.35, 0.42, 0.48, 0.42, 0.35, 0.30, 0.25, 0.22, 0.16, 0.10]) },
  { day: "jue", hours: gen([0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.08, 0.18, 0.25, 0.30, 0.35, 0.28, 0.32, 0.40, 0.50, 0.58, 0.62, 0.58, 0.50, 0.42, 0.36, 0.30, 0.22, 0.14]) },
  { day: "vie", hours: gen([0.30, 0.25, 0.18, 0.12, 0.08, 0.06, 0.12, 0.22, 0.30, 0.38, 0.45, 0.40, 0.45, 0.55, 0.65, 0.78, 0.88, 0.92, 0.95, 1.00, 0.96, 0.88, 0.72, 0.55]) },
  { day: "sab", hours: gen([0.65, 0.55, 0.42, 0.30, 0.20, 0.14, 0.18, 0.28, 0.35, 0.42, 0.50, 0.46, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 1.00, 1.00, 0.96, 0.90, 0.78, 0.60]) },
  { day: "dom", hours: gen([0.55, 0.42, 0.32, 0.22, 0.14, 0.08, 0.06, 0.10, 0.14, 0.18, 0.22, 0.20, 0.20, 0.25, 0.32, 0.40, 0.45, 0.42, 0.35, 0.28, 0.22, 0.18, 0.12, 0.08]) },
];
function gen(arr: number[]): { hour: number; intensity: number }[] {
  return arr.map((intensity, hour) => ({ hour, intensity }));
}

const GENRES = [
  { id: "techno",        label: "Techno",        share: 0.24, yoy: 8.2,  color: "#FF7A4D" },
  { id: "reggaeton",     label: "Reggaetón / urban", share: 0.21, yoy: 6.4,  color: "#EC4899" },
  { id: "house",         label: "House",         share: 0.16, yoy: 4.1,  color: "#8B5CF6" },
  { id: "comercial",     label: "Comercial",     share: 0.14, yoy: -2.3, color: "#3B82F6" },
  { id: "indie",         label: "Indie / alternativo", share: 0.09, yoy: 1.8, color: "#4DB87A" },
  { id: "hip-hop",       label: "Hip-Hop",       share: 0.08, yoy: 5.1,  color: "#E8B04C" },
  { id: "drum-and-bass", label: "DnB / hard",    share: 0.05, yoy: 18.4, color: "#A78BFA" },
  { id: "latino",        label: "Latino clásico", share: 0.03, yoy: -1.2, color: "#FB923C" },
];

const AGE_BUCKETS = [
  { label: "18-21", share: 0.32, yoy: 1.2 },
  { label: "22-25", share: 0.28, yoy: 3.4 },
  { label: "26-30", share: 0.20, yoy: 5.1 },
  { label: "31-40", share: 0.14, yoy: 8.2 },
  { label: "41+",   share: 0.06, yoy: 12.0 },
];

interface BenchmarkPaywallTier {
  id: string;
  name: string;
  priceEur: number;
  cycle: "mes" | "año";
  bullets: string[];
  highlight?: boolean;
}

const PAYWALL_TIERS: BenchmarkPaywallTier[] = [
  {
    id: "industry",
    name: "Industry Pulse",
    priceEur: 0,
    cycle: "mes",
    bullets: [
      "Tendencias mensuales agregadas",
      "Reparto de géneros y demografía",
      "Sin filtros por ciudad/segmento propio",
    ],
  },
  {
    id: "compare",
    name: "Compare",
    priceEur: 79,
    cycle: "mes",
    highlight: true,
    bullets: [
      "Benchmarks vs locales similares (segmento + ciudad + tamaño)",
      "Recomendaciones de pricing por nivel",
      "Heatmap de demanda por slot",
      "Exporte mensual a CSV",
    ],
  },
  {
    id: "edge",
    name: "Edge API",
    priceEur: 290,
    cycle: "mes",
    bullets: [
      "Acceso programático vía API a todos los datasets",
      "Updates diarios + alertas push",
      "Datos demograficos verticales (familias, estudiantes, turistas)",
      "Pricing recommendations en JSON para tu propio sistema",
    ],
  },
];

export const IndustryBenchmarks = () => {
  const [segment, setSegment] = useState<VenueSegment>("discoteca");
  const [region, setRegion] = useState<Region>("españa-nacional");
  const [tab, setTab] = useState<"snapshot" | "pricing" | "demand" | "audience" | "data">("snapshot");

  const benchmarks = PRICE_BENCHMARKS[segment];
  const meta = SEGMENT_META[segment];

  /* aggregate snapshot numbers */
  const snapshot = useMemo(() => {
    const tenants = Math.floor(110 + segment.length * 7 + region.length * 3);
    const events30d = Math.floor(tenants * 5.2);
    const tickets30d = Math.floor(events30d * 380);
    const avgPrice = benchmarks.reduce((s, b) => s + b.median, 0) / benchmarks.length;
    return { tenants, events30d, tickets30d, avgPrice };
  }, [segment, region, benchmarks]);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <header className="flex flex-col gap-1">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
          <Sparkles className="h-3 w-3" /> Data Intelligence · Fase 6
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Industry Benchmarks</h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Inteligencia anónima cross-tenant para que cada partner sepa cómo se compara con locales similares — sin ver datos individuales de nadie. Pasify es la única plataforma con datos suficientes para esto en España.
        </p>
      </header>

      {/* HERO */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(167,139,250,0.08) 50%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(167,139,250,0.32)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(167,139,250,0.22)", filter: "blur(80px)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 bottom-[-100px] h-64 w-64 rounded-full"
          style={{ background: "rgba(232,84,42,0.20)", filter: "blur(70px)" }}
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #A78BFA 0%, #8B5CF6 55%, #5B21B6 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 12px 30px -10px rgba(139,92,246,0.6)",
              }}
            >
              <BarChart3 className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">
                Compara tu local con el <span style={serif} className="text-orange-500">resto del país</span>.
              </h2>
              <div
                className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                style={mono}
              >
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-emerald-500" /> Anonimato k=15</span>
                <span>·</span>
                <span>Actualizado hace 3h</span>
                <span>·</span>
                <span>{snapshot.tenants} locales en el panel</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-2 md:items-end">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SEGMENT_META) as VenueSegment[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSegment(s)}
                  className="rounded-full border px-2.5 py-1 text-[10.5px] uppercase transition"
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    color: segment === s ? "#fff" : SEGMENT_META[s].color,
                    background: segment === s ? SEGMENT_META[s].color : `${SEGMENT_META[s].color}10`,
                    borderColor: segment === s ? SEGMENT_META[s].color : `${SEGMENT_META[s].color}40`,
                  }}
                >
                  {SEGMENT_META[s].label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REGION_META) as Region[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRegion(r)}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] uppercase transition"
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    color: region === r ? "#FF7A4D" : "#8A8275",
                    background: region === r ? "rgba(232,84,42,0.08)" : "transparent",
                    borderColor: region === r ? "rgba(232,84,42,0.45)" : "rgba(255,255,255,0.08)",
                  }}
                >
                  {r === "españa-nacional" && <Globe2 className="h-3 w-3" />}
                  {r !== "españa-nacional" && <MapPin className="h-3 w-3" />}
                  {REGION_META[r].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TABS */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1" role="tablist">
        <TabBtn active={tab === "snapshot"} onClick={() => setTab("snapshot")} icon={<Activity className="h-3.5 w-3.5" />}  label="Snapshot" />
        <TabBtn active={tab === "pricing"}  onClick={() => setTab("pricing")}  icon={<Coins className="h-3.5 w-3.5" />}     label="Pricing" />
        <TabBtn active={tab === "demand"}   onClick={() => setTab("demand")}   icon={<Calendar className="h-3.5 w-3.5" />}  label="Demanda" />
        <TabBtn active={tab === "audience"} onClick={() => setTab("audience")} icon={<Users className="h-3.5 w-3.5" />}     label="Audiencia" />
        <TabBtn active={tab === "data"}     onClick={() => setTab("data")}     icon={<Cpu className="h-3.5 w-3.5" />}       label="Data products" />
      </div>

      {/* ========== SNAPSHOT ========== */}
      {tab === "snapshot" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <KpiTile className="lg:col-span-3" label="Locales en panel" value={snapshot.tenants.toString()} sub={`${meta.label} · ${REGION_META[region].label}`} icon={<Building2 className="h-4 w-4" />} />
          <KpiTile className="lg:col-span-3" label="Eventos 30d" value={snapshot.events30d.toLocaleString("es-ES")} sub="ventana móvil" icon={<PartyPopper className="h-4 w-4" />} />
          <KpiTile className="lg:col-span-3" label="Tickets 30d" value={snapshot.tickets30d.toLocaleString("es-ES")} sub="vendidos en panel" icon={<Ticket className="h-4 w-4" />} />
          <KpiTile className="lg:col-span-3" label="Precio medio" value={`${snapshot.avgPrice.toFixed(1)} €`} sub="mediana sobre tipos" icon={<Coins className="h-4 w-4" />} tone="info" />

          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-7">
            <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
              <TrendingUp className="h-3 w-3" /> Tendencias clave del segmento
            </div>
            <h3 className="text-base font-semibold">Lo que está cambiando este trimestre</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <TrendCard
                title="VIP table: +12% YoY"
                detail="Mesas premium para grupos pequeños son el segmento de mayor crecimiento, especialmente en Ibiza y Madrid."
                icon={<TrendingUp className="h-4 w-4" />}
                tone="positive"
              />
              <TrendCard
                title="Comercial: −2% YoY"
                detail="La sesión 100% comercial pierde tracción frente a fórmulas mixtas con bloques de techno o house."
                icon={<TrendingDown className="h-4 w-4" />}
                tone="negative"
              />
              <TrendCard
                title="Edad media: +1.4 años"
                detail="El público está envejeciendo ligeramente. La franja 31-40 crece +8.2% interanual."
                icon={<Users className="h-4 w-4" />}
                tone="info"
              />
              <TrendCard
                title="Drum & Bass: +18%"
                detail="DnB pasa de nicho a slot relevante en jueves-viernes en grandes ciudades."
                icon={<Music2 className="h-4 w-4" />}
                tone="positive"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-5">
            <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase" style={{ ...mono, letterSpacing: "0.22em", color: "#A78BFA" }}>
              <Lock className="h-3 w-3" /> Privacidad por diseño
            </div>
            <h3 className="text-base font-semibold">Anonimato garantizado</h3>
            <ul className="mt-4 space-y-3 text-[12px] text-muted-foreground">
              <PrivacyBullet
                title="k-anonimato 15"
                description="Ningún corte muestra estadísticas si caen por debajo de 15 locales coincidentes."
              />
              <PrivacyBullet
                title="Ruido diferencial"
                description="Los percentiles incorporan ruido gaussiano para evitar ingeniería inversa."
              />
              <PrivacyBullet
                title="Sin nombres ni datos personales"
                description="Solo agregados estadísticos. Nadie ve los datos de otro local específico."
              />
              <PrivacyBullet
                title="Opt-out granular"
                description="Cada partner decide si aporta a benchmarks, audience research o pricing intelligence."
              />
            </ul>
          </div>
        </section>
      )}

      {/* ========== PRICING ========== */}
      {tab === "pricing" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
              <Coins className="h-3 w-3" /> Pricing benchmark
            </div>
            <h3 className="text-base font-semibold">
              Percentiles de precio · {meta.label} en {REGION_META[region].label}
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              P25/P50/P75 sobre {snapshot.tenants} locales del panel. Tus precios deberían estar normalmente entre P25 y P75.
            </p>

            <div className="mt-5 space-y-3">
              {benchmarks.map((b) => (
                <PriceRangeRow key={b.ticketType} benchmark={b} color={meta.color} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ background: "linear-gradient(135deg, rgba(232,176,76,0.08) 0%, transparent 100%)", borderColor: "rgba(232,176,76,0.32)" }}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "rgba(232,176,76,0.16)", color: "#E8B04C" }}>
                  <Sliders className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-semibold">Recomendación auto · Friday Sessions</h3>
                  <p className="mt-1 max-w-[60ch] text-[12px] text-muted-foreground">
                    Tu mediana de “Late release” está en €18, P75 del segmento es €28. Hay margen para subir hasta €22-24 sin salir del rango competitivo.
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline">
                <Eye className="mr-2 h-4 w-4" />
                Ver evidencia
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ========== DEMAND ========== */}
      {tab === "demand" && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
            <Calendar className="h-3 w-3" /> Demand heatmap
          </div>
          <h3 className="text-base font-semibold">Intensidad de venta por día y hora</h3>
          <p className="mt-1 max-w-[70ch] text-[12px] text-muted-foreground">
            Cuándo compra tickets el público de {meta.label}s en {REGION_META[region].label}. Útil para programar campañas push, releases de niveles y promos flash.
          </p>

          <div className="mt-5 overflow-x-auto">
            <div className="inline-grid min-w-full" style={{ gridTemplateColumns: "40px repeat(24, minmax(20px, 1fr))" }}>
              {/* Hour ruler */}
              <span />
              {Array.from({ length: 24 }).map((_, h) => (
                <span key={`h-${h}`} className="text-center text-[9px] text-muted-foreground" style={mono}>
                  {h % 3 === 0 ? `${h}h` : ""}
                </span>
              ))}
              {/* Rows */}
              {DEMAND_DATA.map((row) => (
                <>
                  <span key={`l-${row.day}`} className="pr-2 text-right text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.18em" }}>
                    {row.day}
                  </span>
                  {row.hours.map(({ hour, intensity }) => (
                    <div
                      key={`${row.day}-${hour}`}
                      className="m-[1.5px] aspect-square rounded-[3px]"
                      style={{
                        background: `rgba(232, 84, 42, ${(0.05 + intensity * 0.85).toFixed(3)})`,
                        boxShadow: intensity > 0.85 ? "0 0 0 1px rgba(232,84,42,0.35)" : undefined,
                      }}
                      title={`${row.day} ${hour}:00 · intensidad ${(intensity * 100).toFixed(0)}%`}
                    />
                  ))}
                </>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground" style={mono}>
            <span>Bajo</span>
            <div className="flex gap-1">
              {[0.1, 0.25, 0.45, 0.65, 0.85, 1.0].map((i) => (
                <div key={i} className="h-3 w-6 rounded-sm" style={{ background: `rgba(232,84,42,${(0.05 + i * 0.85).toFixed(2)})` }} />
              ))}
            </div>
            <span>Alto</span>
            <span className="ml-auto">Pico: viernes 19h-20h · sábado 17h-19h</span>
          </div>
        </section>
      )}

      {/* ========== AUDIENCE ========== */}
      {tab === "audience" && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-7">
            <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
              <Music2 className="h-3 w-3" /> Reparto de géneros
            </div>
            <h3 className="text-base font-semibold">Qué está pinchando el segmento</h3>
            <p className="mt-1 max-w-[60ch] text-[12px] text-muted-foreground">
              Share de tickets sobre eventos clasificados por género en el panel ({meta.label}s · {REGION_META[region].label}).
            </p>
            <div className="mt-5 space-y-2.5">
              {GENRES.map((g) => {
                const sharePct = Math.round(g.share * 100);
                return (
                  <div key={g.id} className="flex items-center gap-3">
                    <div className="flex w-44 items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: `${g.color}1A`, color: g.color }}>
                        <Music2 className="h-3 w-3" />
                      </span>
                      <span className="text-[12px]">{g.label}</span>
                    </div>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${sharePct * 3}%`, maxWidth: "100%", background: `linear-gradient(90deg, ${g.color} 0%, ${g.color}55 100%)` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[11px]" style={{ ...mono, color: g.color }}>
                      {sharePct}%
                    </span>
                    <span
                      className="w-14 rounded-full px-1.5 py-0.5 text-right text-[10px]"
                      style={{
                        ...mono,
                        color: g.yoy >= 0 ? "#4DB87A" : "#EF4444",
                        background: g.yoy >= 0 ? "rgba(77,184,122,0.08)" : "rgba(239,68,68,0.08)",
                      }}
                    >
                      {g.yoy >= 0 ? "+" : ""}
                      {g.yoy.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-5">
            <div className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500" style={{ ...mono, letterSpacing: "0.22em" }}>
              <Users className="h-3 w-3" /> Demografía
            </div>
            <h3 className="text-base font-semibold">Edades del segmento</h3>
            <div className="mt-5 space-y-3">
              {AGE_BUCKETS.map((b) => {
                const sharePct = Math.round(b.share * 100);
                return (
                  <div key={b.label} className="flex items-center gap-3">
                    <span className="w-12 text-[12px]" style={mono}>{b.label}</span>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/30">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${sharePct * 3}%`, maxWidth: "100%", background: "linear-gradient(90deg, #FF7A4D 0%, #E8542A 100%)" }}
                      />
                    </div>
                    <span className="w-10 text-right text-[11px]" style={{ ...mono, color: "#FF7A4D" }}>
                      {sharePct}%
                    </span>
                    <span
                      className="w-14 rounded-full px-1.5 py-0.5 text-right text-[10px]"
                      style={{
                        ...mono,
                        color: b.yoy >= 0 ? "#4DB87A" : "#EF4444",
                        background: b.yoy >= 0 ? "rgba(77,184,122,0.08)" : "rgba(239,68,68,0.08)",
                      }}
                    >
                      {b.yoy >= 0 ? "+" : ""}
                      {b.yoy.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 border-t pt-4 text-[11px] text-muted-foreground" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              Datos derivados de tickets comprados con cuenta verificada. Edad inferida del documento KYC, jamás de redes ni terceros.
            </div>
          </div>
        </section>
      )}

      {/* ========== DATA PRODUCTS / PAYWALL ========== */}
      {tab === "data" && (
        <section className="space-y-4">
          <div
            className="rounded-2xl border p-5"
            style={{
              background: "linear-gradient(135deg, rgba(232,176,76,0.10) 0%, rgba(232,84,42,0.08) 100%)",
              borderColor: "rgba(232,176,76,0.32)",
            }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "rgba(232,176,76,0.16)", color: "#E8B04C" }}>
                  <Layers className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold">Industry Pulse — ahora también monetizable</h3>
                  <p className="mt-1 max-w-[64ch] text-[12px] text-muted-foreground">
                    Los datos agregados que generamos para los partners ya tienen valor fuera: agencias, sellos, marcas y municipios pagan por entender la noche en tiempo real. Los planes Compare y Edge API son el primer paso.
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline">
                <Eye className="mr-2 h-4 w-4" />
                Roadmap completo
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PAYWALL_TIERS.map((tier) => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

const TabBtn = ({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) => (
  <button
    onClick={onClick}
    role="tab"
    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition ${active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    style={active ? { boxShadow: "0 1px 0 rgba(232,84,42,0.4) inset, 0 -2px 0 rgba(232,84,42,0.7) inset" } : undefined}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const KpiTile = ({
  label, value, sub, icon, tone = "neutral", className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "positive" | "negative" | "info" | "warning";
  className?: string;
}) => {
  const toneCfg = {
    neutral:  { color: "#F4EEE2", halo: "rgba(255,255,255,0.04)" },
    positive: { color: "#4DB87A", halo: "rgba(77,184,122,0.18)" },
    negative: { color: "#FF7A4D", halo: "rgba(232,84,42,0.18)" },
    info:     { color: "#A78BFA", halo: "rgba(167,139,250,0.18)" },
    warning:  { color: "#E8B04C", halo: "rgba(232,176,76,0.18)" },
  }[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 ${className}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full"
        style={{ background: toneCfg.halo, filter: "blur(40px)" }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.2em" }}>
            {label}
          </div>
          <div className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: toneCfg.color }}>{value}</div>
          {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
        </div>
        {icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: toneCfg.halo, color: toneCfg.color }}>
            {icon}
          </span>
        )}
      </div>
    </div>
  );
};

const TrendCard = ({
  title, detail, icon, tone,
}: {
  title: string;
  detail: string;
  icon: React.ReactNode;
  tone: "positive" | "negative" | "info";
}) => {
  const cfg = {
    positive: { color: "#4DB87A", bg: "rgba(77,184,122,0.08)", border: "rgba(77,184,122,0.32)" },
    negative: { color: "#EF4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.32)" },
    info:     { color: "#A78BFA", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.32)" },
  }[tone];
  return (
    <div className="rounded-xl border p-3" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md" style={{ background: cfg.color + "20", color: cfg.color }}>
          {icon}
        </span>
        <span className="text-[13px] font-medium">{title}</span>
      </div>
      <div className="mt-2 text-[11.5px] text-muted-foreground">{detail}</div>
    </div>
  );
};

const PrivacyBullet = ({ title, description }: { title: string; description: string }) => (
  <li className="flex items-start gap-3">
    <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: "rgba(167,139,250,0.12)", color: "#A78BFA" }}>
      <ShieldCheck className="h-3 w-3" />
    </span>
    <div>
      <div className="text-[12.5px] text-foreground">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div>
    </div>
  </li>
);

const PriceRangeRow = ({ benchmark, color }: { benchmark: PriceBenchmark; color: string }) => {
  const min = 0;
  const max = Math.max(benchmark.p75 * 1.2, 30);
  const pct = (v: number) => (v / max) * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{benchmark.ticketType}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px]"
          style={{
            ...mono,
            color: benchmark.yoy >= 0 ? "#4DB87A" : "#EF4444",
            background: benchmark.yoy >= 0 ? "rgba(77,184,122,0.08)" : "rgba(239,68,68,0.08)",
          }}
        >
          YoY {benchmark.yoy >= 0 ? "+" : ""}
          {benchmark.yoy.toFixed(1)}%
        </span>
      </div>
      <div className="relative h-7 rounded-lg border" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        {/* P25-P75 range */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${pct(benchmark.p25)}%`,
            width: `${pct(benchmark.p75) - pct(benchmark.p25)}%`,
            height: "10px",
            background: `linear-gradient(90deg, ${color}55 0%, ${color}80 50%, ${color}55 100%)`,
            border: `1px solid ${color}80`,
          }}
        />
        {/* Median marker */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm"
          style={{
            left: `${pct(benchmark.median)}%`,
            width: 3,
            height: 18,
            background: color,
            boxShadow: `0 0 12px ${color}90`,
          }}
        />
        {/* Markers */}
        {[benchmark.p25, benchmark.median, benchmark.p75].map((v, i) => (
          <span
            key={i}
            className="absolute top-full mt-1 -translate-x-1/2 text-[9.5px] text-muted-foreground"
            style={{ left: `${pct(v)}%`, ...mono }}
          >
            {v}€
          </span>
        ))}
      </div>
      <div className="mt-5 inline-flex gap-3 text-[10px] text-muted-foreground" style={mono}>
        <span>P25 {benchmark.p25}€</span>
        <span>·</span>
        <span style={{ color }}>Mediana {benchmark.median}€</span>
        <span>·</span>
        <span>P75 {benchmark.p75}€</span>
      </div>
    </div>
  );
};

const TierCard = ({ tier }: { tier: BenchmarkPaywallTier }) => (
  <div
    className="relative overflow-hidden rounded-2xl border p-5"
    style={{
      borderColor: tier.highlight ? "rgba(232,84,42,0.45)" : "rgba(255,255,255,0.08)",
      background: tier.highlight
        ? "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.04) 100%)"
        : "hsl(var(--card))",
    }}
  >
    {tier.highlight && (
      <span
        className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9.5px] uppercase"
        style={{ ...mono, letterSpacing: "0.16em", color: "#FF7A4D", background: "rgba(232,84,42,0.10)", border: "1px solid rgba(232,84,42,0.40)" }}
      >
        Más vendido
      </span>
    )}
    <h3 className="text-lg font-semibold">{tier.name}</h3>
    <div className="mt-2 flex items-baseline gap-1">
      <span className="text-3xl font-bold tracking-tight" style={{ color: tier.highlight ? "#FF7A4D" : "#F4EEE2" }}>
        {tier.priceEur === 0 ? "Gratis" : `${tier.priceEur}€`}
      </span>
      {tier.priceEur > 0 && (
        <span className="text-[11px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.18em" }}>
          /{tier.cycle}
        </span>
      )}
    </div>
    <ul className="mt-4 space-y-2 text-[12.5px] text-muted-foreground">
      {tier.bullets.map((b, i) => (
        <li key={i} className="flex items-start gap-2">
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" />
          {b}
        </li>
      ))}
    </ul>
    <Button
      className="mt-5 w-full"
      style={
        tier.highlight
          ? {
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              color: "#fff",
              border: 0,
              boxShadow: "0 8px 20px -6px rgba(232,84,42,0.55)",
            }
          : undefined
      }
      variant={tier.highlight ? "default" : "outline"}
      size="sm"
    >
      {tier.priceEur === 0 ? "Disponible para partners" : "Activar plan"}
    </Button>
  </div>
);

export default IndustryBenchmarks;
