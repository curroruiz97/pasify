import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Cake,
  Crown,
  Filter,
  Heart,
  Mail,
  MapPin,
  MoreVertical,
  Phone,
  Search,
  Send,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Mock CRM data
// =============================================================

export type SegmentId = "all" | "vip" | "recurrent" | "new" | "inactive" | "birthday";

interface CrmClient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  avatarColor: string;
  birthday: string;
  events: number;
  spendCents: number;
  lastEvent: string | null;
  tags: string[];
  optin: { email: boolean; sms: boolean; push: boolean };
}

const seedClients = (): CrmClient[] => {
  const firstNames = ["Carla", "Diego", "Lucía", "Pablo", "Alba", "Mateo", "Sara", "Iván", "Marta", "Hugo", "Elena", "Javi", "Aitana", "Daniel", "Andrea", "Adrián", "Olivia", "Bruno"];
  const lastNames = ["Sánchez", "Reyes", "García", "López", "Martínez", "Fernández", "Ruiz", "Moreno", "Pérez", "Romero", "Alonso", "Núñez", "Castro", "Vidal", "Torres", "Ortega"];
  const cities = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Málaga", "Ibiza", "Zaragoza", "Bilbao"];
  const colors = ["#FF7A4D", "#E8542A", "#B8381A", "#E8B04C", "#4DB87A", "#5C544A", "#8A8275"];
  const now = Date.now();
  return Array.from({ length: 22 }).map((_, i) => {
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[(i * 3) % lastNames.length];
    const events = Math.max(0, Math.round(2 + Math.sin(i * 1.3) * 6 + (i % 4)));
    const avgSpend = 15 + (i % 5) * 4;
    const daysSinceLast = i % 4 === 0 ? 120 + (i % 30) : Math.floor(((i * 7) % 60) + (i % 4 === 3 ? 14 : 0));
    return {
      id: `c-${i.toString().padStart(2, "0")}`,
      firstName: fn,
      lastName: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@pasify.es`,
      phone: `+34 6${(10000000 + i * 31247).toString().slice(0, 8)}`,
      city: cities[i % cities.length],
      avatarColor: colors[i % colors.length],
      birthday: format(new Date(1990 + (i % 15), i % 12, 1 + ((i * 7) % 28)), "yyyy-MM-dd"),
      events,
      spendCents: events * avgSpend * 100,
      lastEvent: events > 0 ? new Date(now - daysSinceLast * 24 * 60 * 60 * 1000).toISOString() : null,
      tags: buildTags(events, daysSinceLast, i),
      optin: {
        email: i % 5 !== 0,
        sms: i % 3 !== 0,
        push: i % 2 === 0,
      },
    };
  });
};

const buildTags = (events: number, daysSinceLast: number, i: number): string[] => {
  const t: string[] = [];
  if (events >= 8) t.push("VIP");
  else if (events >= 4) t.push("Recurrente");
  else if (events <= 1) t.push("Nuevo");
  if (daysSinceLast > 90) t.push("Inactivo");
  if (i % 7 === 0) t.push("Bottle service");
  if (i % 11 === 0) t.push("Prensa");
  return t;
};

const ALL_CLIENTS = seedClients();

const SEGMENTS: Array<{ id: SegmentId; label: string; tone: string; description: string }> = [
  { id: "all", label: "Todos", tone: "#F4EEE2", description: "Toda tu base de clientes" },
  { id: "vip", label: "VIP", tone: "#FF7A4D", description: "+8 eventos · alto gasto" },
  { id: "recurrent", label: "Recurrentes", tone: "#E8542A", description: "4-7 eventos en últimos 6m" },
  { id: "new", label: "Nuevos", tone: "#4DB87A", description: "Primer o segundo evento" },
  { id: "inactive", label: "Inactivos", tone: "#8A8275", description: "+90 días sin venir" },
  { id: "birthday", label: "Cumpleaños del mes", tone: "#E8B04C", description: "Cumple este mes" },
];

const applySegment = (clients: CrmClient[], segment: SegmentId): CrmClient[] => {
  if (segment === "all") return clients;
  const now = new Date();
  const currentMonth = now.getMonth();
  return clients.filter((c) => {
    const last = c.lastEvent ? new Date(c.lastEvent).getTime() : 0;
    const daysSince = (Date.now() - last) / (24 * 60 * 60 * 1000);
    if (segment === "vip") return c.events >= 8;
    if (segment === "recurrent") return c.events >= 4 && c.events < 8 && daysSince <= 180;
    if (segment === "new") return c.events <= 2;
    if (segment === "inactive") return daysSince > 90 && c.events > 0;
    if (segment === "birthday") return new Date(c.birthday).getMonth() === currentMonth;
    return true;
  });
};

// =============================================================
// PartnerCRM main
// =============================================================

export const PartnerCRM = () => {
  const [segment, setSegment] = useState<SegmentId>("all");
  const [search, setSearch] = useState("");
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const segmented = useMemo(() => applySegment(ALL_CLIENTS, segment), [segment]);
  const filtered = useMemo(() => {
    if (!search.trim()) return segmented;
    const q = search.trim().toLowerCase();
    return segmented.filter(
      (c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [segmented, search]);

  const openClient = filtered.find((c) => c.id === openClientId) ?? ALL_CLIENTS.find((c) => c.id === openClientId);

  // KPIs
  const totalRevenue = filtered.reduce((s, c) => s + c.spendCents, 0);
  const avgRevenue = filtered.length > 0 ? totalRevenue / filtered.length : 0;
  const vipCount = filtered.filter((c) => c.events >= 8).length;
  const inactiveCount = filtered.filter((c) => {
    if (!c.lastEvent) return false;
    const days = (Date.now() - new Date(c.lastEvent).getTime()) / (24 * 60 * 60 * 1000);
    return days > 90;
  }).length;

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          color="#FF7A4D"
          eyebrow="Clientes"
          value={filtered.length.toString()}
          sub={segment === "all" ? "En tu base" : SEGMENTS.find((s) => s.id === segment)?.label ?? ""}
        />
        <KpiTile
          icon={<TrendingUp className="h-4 w-4" />}
          color="#E8542A"
          eyebrow="ARPU"
          value={`${(avgRevenue / 100).toFixed(0)}€`}
          sub="Gasto medio"
        />
        <KpiTile
          icon={<Crown className="h-4 w-4" />}
          color="#E8B04C"
          eyebrow="VIPs"
          value={vipCount.toString()}
          sub="8+ eventos"
        />
        <KpiTile
          icon={<Activity className="h-4 w-4" />}
          color="#8A8275"
          eyebrow="Inactivos"
          value={inactiveCount.toString()}
          sub="+90 días"
        />
      </section>

      {/* Segments + filters */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              <Filter className="h-3 w-3" />
              Segmentos
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {SEGMENTS.find((s) => s.id === segment)?.label} ·{" "}
              <span className="text-muted-foreground" style={mono}>
                {filtered.length}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {SEGMENTS.find((s) => s.id === segment)?.description}
            </p>
          </div>
          {filtered.length > 0 && (
            <Button onClick={() => setCampaignOpen(true)}>
              <Send className="mr-2 h-4 w-4" />
              Enviar campaña
            </Button>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {SEGMENTS.map((s) => {
            const active = segment === s.id;
            const count = applySegment(ALL_CLIENTS, s.id).length;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegment(s.id)}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition"
                style={{
                  background: active ? `${s.tone}22` : "rgba(255,255,255,0.02)",
                  borderColor: active ? `${s.tone}66` : "rgba(244,238,226,0.1)",
                  color: active ? s.tone : "#C9BFA8",
                }}
              >
                {s.label}
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{
                    ...mono,
                    letterSpacing: "0.06em",
                    background: active ? `${s.tone}33` : "rgba(255,255,255,0.05)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, ciudad o tag…"
            className="h-10 rounded-xl pl-10"
          />
        </div>
      </section>

      {/* Client list */}
      {filtered.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground"
        >
          Nadie coincide con este segmento o búsqueda.
        </div>
      ) : (
        <section className="space-y-2">
          {filtered.map((c) => (
            <ClientRow key={c.id} client={c} onOpen={() => setOpenClientId(c.id)} />
          ))}
        </section>
      )}

      {/* 360 profile drawer */}
      <Sheet open={!!openClientId} onOpenChange={(o) => !o && setOpenClientId(null)}>
        <SheetContent
          side="right"
          className="w-[92vw] max-w-md overflow-y-auto border-l border-border bg-card p-0"
        >
          {openClient && <ClientProfile client={openClient} onClose={() => setOpenClientId(null)} />}
        </SheetContent>
      </Sheet>

      {/* Campaign dialog */}
      {campaignOpen && (
        <CampaignDialog
          segmentLabel={SEGMENTS.find((s) => s.id === segment)?.label ?? "Todos"}
          recipients={filtered.length}
          onClose={() => setCampaignOpen(false)}
        />
      )}
    </div>
  );
};

// =============================================================
// Client list row
// =============================================================

const ClientRow = ({ client, onOpen }: { client: CrmClient; onOpen: () => void }) => {
  const lastEventDate = client.lastEvent ? new Date(client.lastEvent) : null;
  return (
    <article
      className="group/row flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition hover:-translate-y-0.5 hover:border-orange-500/40 md:p-4"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <button type="button" onClick={onOpen} className="flex flex-1 items-center gap-3 text-left">
        <Avatar client={client} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-foreground md:text-base">
              {client.firstName} {client.lastName}
            </div>
            {client.tags.includes("VIP") && (
              <Crown className="h-3.5 w-3.5 text-orange-400" />
            )}
          </div>
          <div
            className="mt-0.5 truncate text-[11px] text-muted-foreground"
            style={mono}
          >
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {client.city}
            </span>
            <span className="mx-2 opacity-50">·</span>
            <span>{client.events} eventos</span>
            <span className="mx-2 opacity-50">·</span>
            <span>{(client.spendCents / 100).toFixed(0)}€ gastados</span>
          </div>
        </div>
      </button>

      <div className="hidden flex-col items-end sm:flex">
        <div
          className="text-[9px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          Último
        </div>
        <div className="text-xs font-medium text-foreground" style={mono}>
          {lastEventDate
            ? format(lastEventDate, "d MMM", { locale: es })
            : "—"}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-orange-500"
        aria-label="Abrir perfil"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </article>
  );
};

// =============================================================
// 360 profile drawer
// =============================================================

const ClientProfile = ({ client, onClose }: { client: CrmClient; onClose: () => void }) => {
  const lastEventDate = client.lastEvent ? new Date(client.lastEvent) : null;
  const birthdayDate = new Date(client.birthday);
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative overflow-hidden border-b border-border p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full"
          style={{ background: `${client.avatarColor}33`, filter: "blur(60px)" }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar client={client} size={56} />
            <div>
              <div
                className="mb-0.5 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                Perfil 360
              </div>
              <h3 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
                {client.firstName}{" "}
                <span style={serif} className="text-orange-500">
                  {client.lastName}
                </span>
              </h3>
              <div
                className="mt-1 text-[11px] text-muted-foreground"
                style={mono}
              >
                ID · {client.id.toUpperCase()}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {client.tags.length > 0 && (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {client.tags.map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                style={{
                  ...mono,
                  letterSpacing: "0.18em",
                  background: "rgba(232,84,42,0.18)",
                  color: "#FF7A4D",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-2 p-5">
        <ProfileKpi label="Eventos" value={client.events.toString()} />
        <ProfileKpi label="Gastado" value={`${(client.spendCents / 100).toFixed(0)}€`} />
        <ProfileKpi
          label="Ticket medio"
          value={`${(client.events > 0 ? client.spendCents / client.events / 100 : 0).toFixed(0)}€`}
        />
        <ProfileKpi
          label="Último"
          value={lastEventDate ? format(lastEventDate, "d MMM", { locale: es }) : "—"}
        />
      </section>

      {/* Contact + birthday */}
      <section className="border-t border-border p-5">
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          Contacto
        </div>
        <div className="space-y-2">
          <InfoRow icon={<Mail className="h-3.5 w-3.5" />} value={client.email} optedIn={client.optin.email} />
          <InfoRow icon={<Phone className="h-3.5 w-3.5" />} value={client.phone} optedIn={client.optin.sms} />
          <InfoRow icon={<Smartphone className="h-3.5 w-3.5" />} value="Push notifications" optedIn={client.optin.push} />
          <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} value={client.city} />
          <InfoRow
            icon={<Cake className="h-3.5 w-3.5" />}
            value={`${format(birthdayDate, "d MMM", { locale: es })} (${new Date().getFullYear() - birthdayDate.getFullYear()} años)`}
          />
        </div>
      </section>

      {/* Activity timeline mock */}
      <section className="border-t border-border p-5">
        <div
          className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          Actividad reciente
        </div>
        <ol className="relative space-y-3 border-l border-border pl-4">
          {[0, 1, 2].slice(0, Math.min(3, client.events)).map((i) => (
            <li key={i} className="relative">
              <span
                className="absolute -left-[19px] top-1.5 inline-block h-2 w-2 rounded-full"
                style={{ background: "#E8542A", boxShadow: "0 0 8px rgba(232,84,42,0.7)" }}
              />
              <div
                className="text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.16em" }}
              >
                {format(
                  new Date(Date.now() - (i * 14 + 3) * 24 * 60 * 60 * 1000),
                  "d MMM · HH:mm",
                  { locale: es }
                )}
              </div>
              <div className="mt-0.5 text-sm font-medium text-foreground">
                Asistió · {["Saturday Night", "Friday Vibes", "Halloween Edition"][i]}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground" style={mono}>
                Pagó {15 + i * 5}€ con tarjeta
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Actions footer */}
      <footer className="mt-auto border-t border-border p-4">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" disabled={!client.optin.email}>
            <Mail className="mr-1.5 h-3.5 w-3.5" />
            Email
          </Button>
          <Button variant="outline" size="sm" disabled={!client.optin.sms}>
            <Phone className="mr-1.5 h-3.5 w-3.5" />
            SMS
          </Button>
          <Button variant="outline" size="sm">
            <Heart className="mr-1.5 h-3.5 w-3.5" />
            VIP
          </Button>
        </div>
      </footer>
    </div>
  );
};

const InfoRow = ({
  icon,
  value,
  optedIn,
}: {
  icon: React.ReactNode;
  value: string;
  optedIn?: boolean;
}) => (
  <div className="flex items-center gap-2.5">
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground" style={{ background: "rgba(232,84,42,0.08)" }}>
      {icon}
    </span>
    <span className="flex-1 truncate text-sm text-foreground">{value}</span>
    {optedIn !== undefined && (
      <span
        className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
        style={{
          ...mono,
          letterSpacing: "0.16em",
          background: optedIn ? "rgba(77,184,122,0.18)" : "rgba(140,140,140,0.12)",
          color: optedIn ? "#4DB87A" : "#8A8275",
        }}
      >
        {optedIn ? "Opt-in" : "Opt-out"}
      </span>
    )}
  </div>
);

// =============================================================
// Subcomponents
// =============================================================

const Avatar = ({ client, size }: { client: CrmClient; size: number }) => (
  <div
    className="grid shrink-0 place-items-center rounded-full text-white"
    style={{
      width: size,
      height: size,
      fontSize: size / 2.4,
      fontWeight: 700,
      background: `linear-gradient(135deg, ${client.avatarColor} 0%, ${shade(client.avatarColor, -20)} 100%)`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
    }}
  >
    {client.firstName[0]}
    {client.lastName[0]}
  </div>
);

const shade = (hex: string, percent: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adj = (v: number) => Math.max(0, Math.min(255, Math.round(v + (v * percent) / 100)));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

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

const ProfileKpi = ({ label, value }: { label: string; value: string }) => (
  <div
    className="rounded-xl border border-border p-3"
    style={{ background: "rgba(255,255,255,0.02)" }}
  >
    <div
      className="text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div className="mt-1 text-base font-bold tracking-tight text-foreground md:text-lg" style={mono}>
      {value}
    </div>
  </div>
);

// =============================================================
// Campaign dialog
// =============================================================

const CampaignDialog = ({
  segmentLabel,
  recipients,
  onClose,
}: {
  segmentLabel: string;
  recipients: number;
  onClose: () => void;
}) => {
  const [channel, setChannel] = useState<"email" | "push" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/85 backdrop-blur-md p-4">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full"
          style={{ background: "rgba(232,84,42,0.2)", filter: "blur(70px)" }}
        />
        <header className="relative flex items-center justify-between border-b border-border p-5">
          <div>
            <div
              className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <Send className="h-3 w-3" />
              Nueva campaña
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Enviar a <span style={serif} className="text-orange-500">{segmentLabel.toLowerCase()}</span>
            </h3>
            <div
              className="mt-1 text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              {recipients} destinatarios estimados
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative space-y-4 p-5">
          <div>
            <label className="text-xs text-muted-foreground">Canal</label>
            <Select value={channel} onValueChange={(v) => setChannel(v as "email" | "push" | "sms")}>
              <SelectTrigger className="mt-1.5 h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="push">Push notification</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {channel === "email" && (
            <div>
              <label className="text-xs text-muted-foreground">Asunto</label>
              <Input
                className="mt-1.5 h-10 rounded-xl"
                placeholder="Tu sábado en Pacha te espera"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground">Mensaje</label>
            <textarea
              className="mt-1.5 min-h-[120px] w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm text-foreground outline-none transition focus:border-orange-500/60"
              placeholder="Hola {{firstName}}, esta noche tenemos…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
            />
            <div
              className="mt-1 text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.16em" }}
            >
              Tip · usa {"{{firstName}}"} para personalizar
            </div>
          </div>
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t border-border p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <button
            type="button"
            disabled={!body.trim()}
            onClick={() => {
              // Demo only: simulate send + close
              onClose();
            }}
            className="group/send inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
            }}
          >
            <Send className="h-4 w-4" />
            Enviar a {recipients}
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover/send:translate-x-1 group-hover/send:-translate-y-0.5" />
          </button>
        </footer>
      </div>
    </div>
  );
};

export default PartnerCRM;
