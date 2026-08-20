import { useMemo, useState } from "react";
import {
  Crown,
  Euro,
  Gem,
  GlassWater,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
  Star,
  Users,
  Wine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Mock data — mesas VIP, reservas, bottles
// =============================================================

type TableStatus = "available" | "held" | "booked" | "checked_in";

interface VipTable {
  id: string;
  zone: string;
  number: string;
  capacity: number;
  minSpendCents: number;
  status: TableStatus;
  guest?: string;
  host?: string;
}

const TABLES: VipTable[] = [
  { id: "t-01", zone: "VIP Center", number: "01", capacity: 6, minSpendCents: 80000, status: "checked_in", guest: "Familia Pereda", host: "Carla" },
  { id: "t-02", zone: "VIP Center", number: "02", capacity: 8, minSpendCents: 100000, status: "booked", guest: "@martagomez +6", host: "Diego" },
  { id: "t-03", zone: "VIP Center", number: "03", capacity: 4, minSpendCents: 60000, status: "available" },
  { id: "t-04", zone: "VIP Center", number: "04", capacity: 4, minSpendCents: 60000, status: "held", guest: "Reserva tentativa · Hotel Ushuaïa", host: "Lucía" },
  { id: "t-05", zone: "Pool side", number: "P1", capacity: 10, minSpendCents: 150000, status: "booked", guest: "Equipo agencia Razzmatazz", host: "Carla" },
  { id: "t-06", zone: "Pool side", number: "P2", capacity: 6, minSpendCents: 90000, status: "available" },
  { id: "t-07", zone: "Pool side", number: "P3", capacity: 6, minSpendCents: 90000, status: "checked_in", guest: "Despedida Andrea", host: "Pablo" },
  { id: "t-08", zone: "Terraza", number: "TR-1", capacity: 4, minSpendCents: 50000, status: "available" },
  { id: "t-09", zone: "Terraza", number: "TR-2", capacity: 4, minSpendCents: 50000, status: "booked", guest: "Cumple Sara López", host: "Diego" },
];

interface Bottle {
  id: string;
  name: string;
  category: "champagne" | "spirit" | "premium";
  priceCents: number;
  available: number;
  sold: number;
}

const BOTTLES: Bottle[] = [
  { id: "b-1", name: "Moët & Chandon Brut", category: "champagne", priceCents: 22000, available: 24, sold: 7 },
  { id: "b-2", name: "Veuve Clicquot Rosé", category: "champagne", priceCents: 28000, available: 12, sold: 4 },
  { id: "b-3", name: "Dom Pérignon Vintage", category: "premium", priceCents: 65000, available: 6, sold: 2 },
  { id: "b-4", name: "Belvedere Pure 1.75L", category: "spirit", priceCents: 18000, available: 18, sold: 6 },
  { id: "b-5", name: "Grey Goose 1L", category: "spirit", priceCents: 16000, available: 22, sold: 9 },
  { id: "b-6", name: "Hennessy XO", category: "premium", priceCents: 38000, available: 8, sold: 1 },
];

const STATUS_CONFIG: Record<TableStatus, { label: string; color: string; bg: string }> = {
  available: { label: "Disponible", color: "#4DB87A", bg: "rgba(77,184,122,0.08)" },
  held: { label: "Bloqueada", color: "#E8B04C", bg: "rgba(232,176,76,0.08)" },
  booked: { label: "Reservada", color: "#E8542A", bg: "rgba(232,84,42,0.08)" },
  checked_in: { label: "Llegó", color: "#FF7A4D", bg: "rgba(255,122,77,0.12)" },
};

// =============================================================
// Main
// =============================================================

export const PartnerVipHospitality = () => {
  const [tab, setTab] = useState<"tables" | "bottles" | "concierge" | "noshow">("tables");
  const [tables, setTables] = useState<VipTable[]>(TABLES);

  const stats = useMemo(() => {
    const totalCap = tables.reduce((s, t) => s + t.capacity, 0);
    const bookedCap = tables
      .filter((t) => t.status === "booked" || t.status === "checked_in")
      .reduce((s, t) => s + t.capacity, 0);
    const expectedRevenue = tables
      .filter((t) => t.status === "booked" || t.status === "checked_in")
      .reduce((s, t) => s + t.minSpendCents, 0);
    const occupancyPct = totalCap > 0 ? Math.round((bookedCap / totalCap) * 100) : 0;
    return { totalCap, bookedCap, expectedRevenue, occupancyPct };
  }, [tables]);

  const cycleStatus = (id: string) => {
    const next: Record<TableStatus, TableStatus> = {
      available: "held",
      held: "booked",
      booked: "checked_in",
      checked_in: "available",
    };
    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: next[t.status] } : t))
    );
  };

  return (
    <div className="w-full min-w-0 space-y-6 overflow-x-clip">
      {/* Hero KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile icon={<Users className="h-4 w-4" />} color="#FF7A4D" eyebrow="Aforo VIP" value={stats.bookedCap.toString()} sub={`/ ${stats.totalCap} (${stats.occupancyPct}%)`} />
        <KpiTile icon={<Gem className="h-4 w-4" />} color="#E8542A" eyebrow="Reservados" value={tables.filter((t) => t.status === "booked").length.toString()} sub="Pendientes de llegada" />
        <KpiTile icon={<Crown className="h-4 w-4" />} color="#E8B04C" eyebrow="Mín. esperado" value={`${(stats.expectedRevenue / 100).toFixed(0)}€`} sub="Consumición mínima" />
        <KpiTile icon={<Wine className="h-4 w-4" />} color="#B8381A" eyebrow="Botellas vendidas" value={BOTTLES.reduce((s, b) => s + b.sold, 0).toString()} sub={`${BOTTLES.length} en carta`} />
      </section>

      {/* Tabs */}
      <div className="flex items-end justify-between gap-4 border-b border-border">
        {/* min-w-0 + overflow-x-auto: sin esto las 4 pestañas suman mas ancho
            que la pantalla de un movil y desbordan TODA la pagina hacia la
            derecha, cortando titulo y tarjetas. Ahora la tira scrollea sola. */}
        <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tab active={tab === "tables"} onClick={() => setTab("tables")} icon={<Gem className="h-4 w-4" />}>
            Mesas
          </Tab>
          <Tab active={tab === "bottles"} onClick={() => setTab("bottles")} icon={<Wine className="h-4 w-4" />}>
            Bottle service
          </Tab>
          <Tab active={tab === "concierge"} onClick={() => setTab("concierge")} icon={<MessageSquare className="h-4 w-4" />}>
            Concierge
          </Tab>
          <Tab active={tab === "noshow"} onClick={() => setTab("noshow")} icon={<Sparkles className="h-4 w-4" />}>
            No-show IA
          </Tab>
        </div>
      </div>

      {tab === "tables" && <TablesMap tables={tables} onCycle={cycleStatus} />}
      {tab === "bottles" && <BottleCatalog bottles={BOTTLES} />}
      {tab === "concierge" && <ConciergeInbox />}
      {tab === "noshow" && <NoShowPredictor tables={tables} />}
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
    className="group relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-4 pb-3 pt-1 text-sm font-medium transition"
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
// Tables map by zone
// =============================================================

const TablesMap = ({ tables, onCycle }: { tables: VipTable[]; onCycle: (id: string) => void }) => {
  const zones = useMemo(() => {
    const map = new Map<string, VipTable[]>();
    tables.forEach((t) => {
      if (!map.has(t.zone)) map.set(t.zone, []);
      map.get(t.zone)!.push(t);
    });
    return Array.from(map.entries());
  }, [tables]);

  return (
    <div className="space-y-6">
      {zones.map(([zone, list]) => (
        <section
          key={zone}
          className="rounded-2xl border border-border bg-card p-5 md:p-6"
          style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
        >
          <header className="mb-4 flex items-center justify-between">
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.2em" }}
              >
                <MapPin className="h-3 w-3" />
                Zona
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
                {zone}
              </h3>
              <p
                className="mt-0.5 text-[11px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                {list.length} mesas ·{" "}
                {list.filter((t) => t.status === "available").length} disponibles
              </p>
            </div>
            <Button size="sm" variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Mesa
            </Button>
          </header>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {list.map((t) => (
              <TableCard key={t.id} table={t} onClick={() => onCycle(t.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

const TableCard = ({ table, onClick }: { table: VipTable; onClick: () => void }) => {
  const cfg = STATUS_CONFIG[table.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/table relative overflow-hidden rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
      style={{
        background: cfg.bg,
        borderColor: `${cfg.color}40`,
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="grid h-9 w-9 place-items-center rounded-xl text-white"
          style={{
            background: `linear-gradient(180deg, ${cfg.color}DD 0%, ${cfg.color} 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -3px ${cfg.color}88`,
          }}
        >
          <Gem className="h-4 w-4" />
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] uppercase"
          style={{
            ...mono,
            letterSpacing: "0.18em",
            background: `${cfg.color}33`,
            color: cfg.color,
          }}
        >
          {cfg.label}
        </span>
      </div>

      <div className="mt-3">
        <div
          className="text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          Mesa
        </div>
        <div className="text-xl font-bold tracking-tight text-foreground" style={mono}>
          {table.number}
        </div>
      </div>

      <div
        className="mt-3 flex items-center justify-between text-[11px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.14em" }}
      >
        <span>Cap. {table.capacity}</span>
        <span>{(table.minSpendCents / 100).toFixed(0)}€</span>
      </div>

      {table.guest && (
        <div className="mt-3 border-t border-border pt-2">
          <div
            className="text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            Reservado para
          </div>
          <div className="mt-0.5 truncate text-xs font-semibold text-foreground">
            {table.guest}
          </div>
          {table.host && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground" style={mono}>
              <Star className="h-2.5 w-2.5" />
              Host: {table.host}
            </div>
          )}
        </div>
      )}
    </button>
  );
};

// =============================================================
// Bottle catalog
// =============================================================

const BottleCatalog = ({ bottles }: { bottles: Bottle[] }) => {
  const totalRev = bottles.reduce((s, b) => s + b.sold * b.priceCents, 0);
  return (
    <section className="space-y-4">
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
              <GlassWater className="h-3 w-3" />
              Catálogo activo
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {(totalRev / 100).toFixed(0)}€ <span className="text-muted-foreground" style={serif}>vendido en bottles</span>
            </h3>
          </div>
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Añadir botella
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bottles.map((b) => {
          const color = b.category === "champagne" ? "#E8B04C" : b.category === "premium" ? "#FF7A4D" : "#5C544A";
          const Icon = b.category === "champagne" ? GlassWater : b.category === "premium" ? Crown : Wine;
          return (
            <article
              key={b.id}
              className="relative overflow-hidden rounded-2xl border border-border bg-card p-4"
              style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full"
                style={{ background: `${color}22`, filter: "blur(28px)" }}
              />
              <div className="relative flex items-start justify-between">
                <div
                  className="grid h-12 w-12 place-items-center rounded-2xl text-white"
                  style={{
                    background: `linear-gradient(180deg, ${color}DD 0%, ${color} 100%)`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px ${color}99`,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                  style={{
                    ...mono,
                    letterSpacing: "0.18em",
                    background: `${color}22`,
                    color,
                  }}
                >
                  {b.category}
                </span>
              </div>

              <div className="relative mt-4 text-base font-semibold text-foreground">
                {b.name}
              </div>
              <div className="relative mt-3 flex items-end justify-between">
                <div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    Precio
                  </div>
                  <div className="text-xl font-bold text-foreground" style={mono}>
                    {(b.priceCents / 100).toFixed(0)}€
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    Stock
                  </div>
                  <div className="text-sm font-semibold text-foreground" style={mono}>
                    {b.available} ud
                  </div>
                </div>
              </div>
              <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (b.sold / (b.available + b.sold)) * 100)}%`,
                    background: `linear-gradient(90deg, ${color}88 0%, ${color} 100%)`,
                  }}
                />
              </div>
              <div
                className="relative mt-1 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                Vendido · {b.sold} ud · {((b.sold * b.priceCents) / 100).toFixed(0)}€
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

// =============================================================
// Concierge inbox (demo)
// =============================================================

const CONCIERGE_REQUESTS = [
  {
    id: "cn-1",
    from: "Hotel Ushuaïa · Concierge",
    via: "whatsapp",
    text: "Tenemos clientes VIP llegando esta noche. Necesitamos mesa para 6 con Dom Pérignon, ¿podéis confirmar?",
    at: new Date(Date.now() - 12 * 60 * 1000),
    status: "open",
  },
  {
    id: "cn-2",
    from: "@martagomez",
    via: "ig",
    text: "Es el cumple de mi amiga, ¿podríais ponerle algo especial cuando llegue?",
    at: new Date(Date.now() - 38 * 60 * 1000),
    status: "open",
  },
  {
    id: "cn-3",
    from: "Razzmatazz Group",
    via: "email",
    text: "Reserva confirmada · 10 personas zona Pool side · adjunto detalles de allergens.",
    at: new Date(Date.now() - 4 * 60 * 60 * 1000),
    status: "closed",
  },
];

const ConciergeInbox = () => (
  <section className="space-y-3">
    <div
      className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
      style={{ ...mono, letterSpacing: "0.2em" }}
    >
      <span className="inline-block h-px w-5 bg-orange-500/70" />
      Concierge inbox · {CONCIERGE_REQUESTS.filter((r) => r.status === "open").length} pendientes
    </div>
    {CONCIERGE_REQUESTS.map((r) => (
      <article
        key={r.id}
        className="rounded-2xl border border-border bg-card p-4 md:p-5"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{ background: "rgba(232,84,42,0.18)", color: "#FF7A4D" }}
          >
            {r.via === "whatsapp" ? <Phone className="h-4 w-4" /> : r.via === "ig" ? <Sparkles className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-semibold text-foreground">{r.from}</div>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.16em",
                  background: r.status === "open" ? "rgba(232,176,76,0.18)" : "rgba(140,140,140,0.12)",
                  color: r.status === "open" ? "#E8B04C" : "#8A8275",
                }}
              >
                {r.status === "open" ? "Pendiente" : "Cerrado"}
              </span>
              <span className="text-[10px] text-muted-foreground" style={mono}>
                {format(r.at, "HH:mm", { locale: es })}
              </span>
            </div>
            <p className="mt-2 text-sm text-foreground/85">{r.text}</p>
            {r.status === "open" && (
              <div className="mt-3 flex gap-2">
                <Button size="sm">Confirmar</Button>
                <Button size="sm" variant="outline">
                  Responder
                </Button>
              </div>
            )}
          </div>
        </div>
      </article>
    ))}
  </section>
);

// =============================================================
// Subcomponents
// =============================================================

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  sub,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  sub: string;
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
    <div
      className="relative inline-flex items-center gap-1.5 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color }}
    >
      {icon}
      {eyebrow}
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

// =============================================================
// No-show predictor (AI-10)
// =============================================================

const NoShowPredictor = ({ tables }: { tables: VipTable[] }) => {
  const reserved = tables.filter((t) => t.status === "booked" || t.status === "held");
  const ranked = reserved
    .map((t) => {
      const seed = t.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
      const noShowRisk = ((seed * 17) % 95) + 5; // 5-99
      const reasons = buildReasons(seed);
      return { table: t, risk: noShowRisk, reasons };
    })
    .sort((a, b) => b.risk - a.risk);

  const highRisk = ranked.filter((r) => r.risk >= 60);
  const protectedValue = highRisk.reduce((s, r) => s + r.table.minSpendCents, 0);

  return (
    <div className="space-y-4">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-6"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,176,76,0.12) 0%, rgba(232,176,76,0.02) 100%)",
          borderColor: "rgba(232,176,76,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
          style={{ background: "rgba(232,176,76,0.18)", filter: "blur(70px)" }}
        />
        <div className="relative flex items-start gap-3">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{
              background: "linear-gradient(180deg, #E8B04C 0%, #A6781D 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,176,76,0.5)",
            }}
          >
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em", color: "#E8B04C" }}
            >
              <Sparkles className="h-3 w-3" />
              No-show prediction · IA
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              <span style={serif} className="text-amber-400">{highRisk.length}</span> mesas con alto riesgo de no presentarse
            </h3>
            <p
              className="mt-1 max-w-xl text-sm text-muted-foreground"
              style={mono}
            >
              {(protectedValue / 100).toFixed(0)}€ de mínimos en juego · confirma 4h antes para liberar mesa si no responden
            </p>
          </div>
        </div>
      </section>

      <ul className="space-y-2">
        {ranked.map(({ table, risk, reasons }) => {
          const color = risk >= 70 ? "#B8381A" : risk >= 40 ? "#E8B04C" : "#4DB87A";
          const level = risk >= 70 ? "Alto" : risk >= 40 ? "Medio" : "Bajo";
          return (
            <article
              key={table.id}
              className="rounded-2xl border bg-card p-4 md:p-5"
              style={{
                background: `${color}08`,
                borderColor: `${color}40`,
                boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
              }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                      style={{
                        ...mono,
                        letterSpacing: "0.18em",
                        background: `${color}22`,
                        color,
                      }}
                    >
                      Riesgo {level}
                    </span>
                    <span
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      Mesa {table.number} · {table.zone}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-semibold text-foreground">
                    {table.guest ?? "Reserva sin nombre"}
                  </div>
                  <div
                    className="mt-0.5 text-[11px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    Mínimo {(table.minSpendCents / 100).toFixed(0)}€ · Host {table.host ?? "—"}
                  </div>

                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {reasons.map((r) => (
                      <li
                        key={r}
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{
                          ...mono,
                          letterSpacing: "0.1em",
                          background: "rgba(255,255,255,0.04)",
                          color: "#C9BFA8",
                        }}
                      >
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="text-right">
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.18em" }}
                  >
                    No-show prob.
                  </div>
                  <div className="mt-0.5 text-3xl font-bold" style={{ ...mono, color }}>
                    {risk}%
                  </div>
                  <div className="mt-3 flex gap-2 sm:justify-end">
                    <Button size="sm" variant="outline">
                      Confirmar por WhatsApp
                    </Button>
                    {risk >= 70 && (
                      <Button size="sm">
                        Liberar mesa
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </ul>
    </div>
  );
};

const buildReasons = (seed: number): string[] => {
  const pool = [
    "Reserva creada hace +14 días",
    "No abrió ningún email reciente",
    "Cumple no-show pasado",
    "Origen: Instagram (DM frío)",
    "Sin historial previo de mesa",
    "Reserva fuera de horario habitual",
    "Sin teléfono confirmado",
  ];
  const picks = [];
  for (let i = 0; i < 3; i++) {
    picks.push(pool[(seed + i * 3) % pool.length]);
  }
  return picks;
};

export default PartnerVipHospitality;
