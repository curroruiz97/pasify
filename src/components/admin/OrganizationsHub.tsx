import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Crown,
  Euro,
  Globe,
  MapPin,
  Network,
  Search,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface Venue {
  id: string;
  name: string;
  city: string;
  capacity: number;
  monthlyGmvCents: number;
  status: "active" | "pending" | "paused";
  rating: number;
}

interface Brand {
  id: string;
  name: string;
  category: string;
  countries: string[];
  venues: Venue[];
}

interface Organization {
  id: string;
  name: string;
  country: string;
  tier: "enterprise" | "business" | "starter";
  contactEmail: string;
  joinedAt: string;
  brands: Brand[];
}

const ORGS: Organization[] = [
  {
    id: "org-1",
    name: "Pacha Group",
    country: "ES",
    tier: "enterprise",
    contactEmail: "ceo@pachagroup.com",
    joinedAt: "2024-02-15",
    brands: [
      {
        id: "br-1-1",
        name: "Pacha Ibiza",
        category: "Discoteca",
        countries: ["ES"],
        venues: [
          { id: "v-1-1-1", name: "Pacha Ibiza · Main Room", city: "Ibiza", capacity: 3000, monthlyGmvCents: 284_500_00, status: "active", rating: 4.8 },
          { id: "v-1-1-2", name: "Pacha Ibiza · Funky Room", city: "Ibiza", capacity: 600, monthlyGmvCents: 48_200_00, status: "active", rating: 4.6 },
        ],
      },
      {
        id: "br-1-2",
        name: "Lío Ibiza",
        category: "Beach Club",
        countries: ["ES"],
        venues: [
          { id: "v-1-2-1", name: "Lío Ibiza · Beach Club", city: "Ibiza", capacity: 800, monthlyGmvCents: 124_300_00, status: "active", rating: 4.9 },
        ],
      },
      {
        id: "br-1-3",
        name: "Pacha Barcelona",
        category: "Discoteca",
        countries: ["ES"],
        venues: [
          { id: "v-1-3-1", name: "Pacha Barcelona", city: "Barcelona", capacity: 1800, monthlyGmvCents: 142_800_00, status: "active", rating: 4.5 },
        ],
      },
    ],
  },
  {
    id: "org-2",
    name: "Costa Group",
    country: "ES",
    tier: "enterprise",
    contactEmail: "info@costagroup.es",
    joinedAt: "2024-09-08",
    brands: [
      {
        id: "br-2-1",
        name: "Costa Brava Beach",
        category: "Beach Club",
        countries: ["ES"],
        venues: [
          { id: "v-2-1-1", name: "Costa Brava · Lloret", city: "Lloret de Mar", capacity: 1200, monthlyGmvCents: 86_400_00, status: "active", rating: 4.4 },
          { id: "v-2-1-2", name: "Costa Brava · Platja d'Aro", city: "Platja d'Aro", capacity: 900, monthlyGmvCents: 64_200_00, status: "active", rating: 4.3 },
          { id: "v-2-1-3", name: "Costa Brava · Sitges", city: "Sitges", capacity: 700, monthlyGmvCents: 38_900_00, status: "pending", rating: 0 },
        ],
      },
    ],
  },
  {
    id: "org-3",
    name: "Razzmatazz S.L.",
    country: "ES",
    tier: "business",
    contactEmail: "operations@razzmatazz.com",
    joinedAt: "2024-04-22",
    brands: [
      {
        id: "br-3-1",
        name: "Razzmatazz",
        category: "Club",
        countries: ["ES"],
        venues: [
          { id: "v-3-1-1", name: "Razzmatazz · Sala 1", city: "Barcelona", capacity: 1800, monthlyGmvCents: 76_840_00, status: "active", rating: 4.7 },
          { id: "v-3-1-2", name: "Razzmatazz · Sala 2", city: "Barcelona", capacity: 600, monthlyGmvCents: 18_200_00, status: "active", rating: 4.4 },
        ],
      },
    ],
  },
  {
    id: "org-4",
    name: "Sala Apolo Group",
    country: "ES",
    tier: "business",
    contactEmail: "admin@salaapolo.com",
    joinedAt: "2023-10-14",
    brands: [
      {
        id: "br-4-1",
        name: "Sala Apolo",
        category: "Sala conciertos",
        countries: ["ES"],
        venues: [
          { id: "v-4-1-1", name: "Sala Apolo", city: "Barcelona", capacity: 1200, monthlyGmvCents: 52_180_00, status: "active", rating: 4.8 },
        ],
      },
      {
        id: "br-4-2",
        name: "La [2] de Apolo",
        category: "Sala conciertos",
        countries: ["ES"],
        venues: [
          { id: "v-4-2-1", name: "La [2] de Apolo", city: "Barcelona", capacity: 500, monthlyGmvCents: 18_400_00, status: "active", rating: 4.6 },
        ],
      },
    ],
  },
  {
    id: "org-5",
    name: "Medusa Events",
    country: "ES",
    tier: "starter",
    contactEmail: "hello@medusaevents.es",
    joinedAt: "2026-01-11",
    brands: [
      {
        id: "br-5-1",
        name: "Medusa Festival",
        category: "Festival",
        countries: ["ES"],
        venues: [
          { id: "v-5-1-1", name: "Medusa Beach Festival", city: "Cullera", capacity: 25000, monthlyGmvCents: 348_200_00, status: "active", rating: 4.6 },
        ],
      },
    ],
  },
];

const TIER_CONFIG: Record<Organization["tier"], { label: string; color: string; icon: React.ReactNode }> = {
  enterprise: { label: "Enterprise", color: "#FF7A4D", icon: <Crown className="h-3 w-3" /> },
  business: { label: "Business", color: "#E8B04C", icon: <Star className="h-3 w-3" /> },
  starter: { label: "Starter", color: "#8A8275", icon: <Sparkles className="h-3 w-3" /> },
};

export const OrganizationsHub = () => {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["org-1"]));

  const filtered = useMemo(() => {
    if (!search.trim()) return ORGS;
    const q = search.trim().toLowerCase();
    return ORGS.filter((o) => {
      if (o.name.toLowerCase().includes(q) || o.contactEmail.toLowerCase().includes(q)) return true;
      return o.brands.some(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.venues.some((v) => v.name.toLowerCase().includes(q) || v.city.toLowerCase().includes(q))
      );
    });
  }, [search]);

  // Aggregate stats
  const stats = useMemo(() => {
    let orgs = 0;
    let brands = 0;
    let venues = 0;
    let gmv = 0;
    let capacity = 0;
    ORGS.forEach((o) => {
      orgs++;
      o.brands.forEach((b) => {
        brands++;
        b.venues.forEach((v) => {
          venues++;
          gmv += v.monthlyGmvCents;
          capacity += v.capacity;
        });
      });
    });
    return { orgs, brands, venues, gmv, capacity };
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-1 text-3xl font-bold tracking-tight">
          Organizations <span style={serif} className="text-orange-500">hub</span>
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Jerarquía completa Organization → Brand → Venue · multi-tenant enterprise.
        </p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        <KpiTile icon={<Network className="h-4 w-4" />} color="#FF7A4D" eyebrow="Organizaciones" value={stats.orgs.toString()} />
        <KpiTile icon={<Building2 className="h-4 w-4" />} color="#E8542A" eyebrow="Brands" value={stats.brands.toString()} />
        <KpiTile icon={<MapPin className="h-4 w-4" />} color="#E8B04C" eyebrow="Venues" value={stats.venues.toString()} />
        <KpiTile icon={<Users className="h-4 w-4" />} color="#4DB87A" eyebrow="Aforo total" value={stats.capacity.toLocaleString("es-ES")} />
        <KpiTile icon={<Euro className="h-4 w-4" />} color="#B8381A" eyebrow="GMV mes" value={`${(stats.gmv / 100 / 1000).toFixed(0)}k€`} highlight />
      </section>

      {/* Search */}
      <section
        className="rounded-2xl border border-border bg-card p-4"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar organización, brand o venue…"
            className="h-11 rounded-xl pl-10"
          />
        </div>
      </section>

      {/* Tree */}
      <section className="space-y-3">
        {filtered.map((o) => (
          <OrganizationCard
            key={o.id}
            org={o}
            expanded={expanded.has(o.id)}
            onToggle={() => toggle(o.id)}
            allExpanded={expanded}
            onToggleBrand={toggle}
          />
        ))}
      </section>
    </div>
  );
};

const OrganizationCard = ({
  org,
  expanded,
  onToggle,
  allExpanded,
  onToggleBrand,
}: {
  org: Organization;
  expanded: boolean;
  onToggle: () => void;
  allExpanded: Set<string>;
  onToggleBrand: (id: string) => void;
}) => {
  const tier = TIER_CONFIG[org.tier];
  const venuesCount = org.brands.reduce((s, b) => s + b.venues.length, 0);
  const gmvCents = org.brands.reduce(
    (s, b) => s + b.venues.reduce((sv, v) => sv + v.monthlyGmvCents, 0),
    0
  );

  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      {/* Org header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.02] md:p-5"
      >
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
          style={{
            background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.55)",
          }}
        >
          <Network className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight text-foreground md:text-xl">
              {org.name}
            </h3>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                background: `${tier.color}22`,
                color: tier.color,
                border: `1px solid ${tier.color}44`,
              }}
            >
              {tier.icon}
              {tier.label}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: "rgba(255,255,255,0.05)",
                color: "#C9BFA8",
              }}
            >
              {org.country}
            </span>
          </div>
          <div
            className="mt-1 inline-flex items-center gap-2 text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            <Building2 className="h-3 w-3" />
            {org.brands.length} brands · {venuesCount} venues · {(gmvCents / 100 / 1000).toFixed(0)}k€/mes
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Brands */}
      {expanded && (
        <div className="border-t border-border bg-background/40 p-3 md:p-4">
          <div className="space-y-2">
            {org.brands.map((b) => (
              <BrandRow
                key={b.id}
                brand={b}
                expanded={allExpanded.has(b.id)}
                onToggle={() => onToggleBrand(b.id)}
              />
            ))}
          </div>
        </div>
      )}
    </article>
  );
};

const BrandRow = ({
  brand,
  expanded,
  onToggle,
}: {
  brand: Brand;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const gmv = brand.venues.reduce((s, v) => s + v.monthlyGmvCents, 0);
  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-white/[0.02]"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${expanded ? "rotate-90" : ""}`}
        />
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
          style={{
            background: "linear-gradient(180deg, #E8542A 0%, #B8381A 100%)",
          }}
        >
          <Building2 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{brand.name}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: "rgba(255,255,255,0.04)",
                color: "#C9BFA8",
              }}
            >
              {brand.category}
            </span>
          </div>
          <div
            className="mt-0.5 text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.16em" }}
          >
            {brand.venues.length} venues · {(gmv / 100 / 1000).toFixed(0)}k€/mes
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-background/40 p-3">
          <div className="space-y-1.5">
            {brand.venues.map((v) => (
              <VenueRow key={v.id} venue={v} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
};

const VenueRow = ({ venue }: { venue: Venue }) => {
  const statusCfg = {
    active: { label: "Activo", color: "#4DB87A" },
    pending: { label: "Pendiente", color: "#E8B04C" },
    paused: { label: "Pausado", color: "#8A8275" },
  }[venue.status];
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border p-3"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
        style={{ background: "rgba(232,84,42,0.18)", color: "#FF7A4D" }}
      >
        <MapPin className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{venue.name}</span>
          {venue.rating > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-amber-400"
              style={mono}
            >
              <Star className="h-3 w-3 fill-current" />
              {venue.rating}
            </span>
          )}
        </div>
        <div
          className="mt-0.5 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.14em" }}
        >
          {venue.city} · Aforo {venue.capacity.toLocaleString("es-ES")} ·{" "}
          {(venue.monthlyGmvCents / 100 / 1000).toFixed(0)}k€/mes
        </div>
      </div>
      <span
        className="rounded-full px-2 py-0.5 text-[9px] uppercase"
        style={{
          ...mono,
          letterSpacing: "0.18em",
          background: `${statusCfg.color}22`,
          color: statusCfg.color,
        }}
      >
        {statusCfg.label}
      </span>
    </div>
  );
};

const KpiTile = ({
  icon,
  color,
  eyebrow,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  highlight?: boolean;
}) => (
  <div
    className="relative overflow-hidden rounded-2xl border p-4 md:p-5"
    style={{
      boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 12px -6px rgba(0,0,0,0.4)",
      background: highlight ? `${color}08` : undefined,
      borderColor: highlight ? `${color}40` : "rgba(244,238,226,0.1)",
    }}
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
  </div>
);

export default OrganizationsHub;
