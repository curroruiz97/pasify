import { useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  Globe,
  Headphones,
  Hexagon,
  ListChecks,
  Mail,
  MessageSquare,
  Music,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Webhook,
  Zap,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

type Category = "marketing" | "analytics" | "music" | "productivity" | "hardware" | "finance" | "social";

interface MarketplaceApp {
  id: string;
  name: string;
  category: Category;
  shortDescription: string;
  installed: boolean;
  featured?: boolean;
  popular?: boolean;
  monthlyPrice?: number; // €
  iconColor: string;
  iconSlug: string;
}

const APPS: MarketplaceApp[] = [
  // Marketing
  { id: "mailchimp", name: "Mailchimp", category: "marketing", shortDescription: "Sincroniza tus segmentos CRM en listas de email automáticas.", installed: true, featured: true, iconColor: "#FFE100", iconSlug: "M" },
  { id: "klaviyo", name: "Klaviyo", category: "marketing", shortDescription: "Flows de email avanzados con segmentación por LTV.", installed: false, popular: true, iconColor: "#000000", iconSlug: "K" },
  { id: "hubspot", name: "HubSpot CRM", category: "marketing", shortDescription: "Empuja tus clientes a HubSpot con scoring y deal stages.", installed: false, iconColor: "#FF7A59", iconSlug: "H" },
  { id: "brevo", name: "Brevo (ex Sendinblue)", category: "marketing", shortDescription: "Email + SMS unificado, ideal para newsletters de fin de semana.", installed: false, iconColor: "#0B996E", iconSlug: "B" },
  { id: "meta-ads", name: "Meta Ads", category: "marketing", shortDescription: "Conversion API + lookalike de tus compradores reales.", installed: true, featured: true, iconColor: "#1877F2", iconSlug: "f" },
  { id: "tiktok-ads", name: "TikTok Ads", category: "marketing", shortDescription: "Pixel + Events API para retargeting nocturno.", installed: true, popular: true, iconColor: "#000000", iconSlug: "T" },
  { id: "google-ads", name: "Google Ads", category: "marketing", shortDescription: "Tracking de conversiones con tus eventos reales.", installed: false, iconColor: "#4285F4", iconSlug: "G" },

  // Analytics
  { id: "ga4", name: "Google Analytics 4", category: "analytics", shortDescription: "Mide funnel de compra completo en GA4.", installed: true, iconColor: "#F9AB00", iconSlug: "G" },
  { id: "amplitude", name: "Amplitude", category: "analytics", shortDescription: "Cohortes y funnels enterprise para producto.", installed: false, monthlyPrice: 0, iconColor: "#1F4DCA", iconSlug: "A" },
  { id: "mixpanel", name: "Mixpanel", category: "analytics", shortDescription: "Análisis de eventos producto end-to-end.", installed: false, iconColor: "#7856FF", iconSlug: "M" },
  { id: "segment", name: "Segment CDP", category: "analytics", shortDescription: "Reenvía datos limpios a 200+ destinos.", installed: false, monthlyPrice: 49, iconColor: "#52BD94", iconSlug: "S" },
  { id: "posthog", name: "PostHog", category: "analytics", shortDescription: "Producto analytics open-source + session replay.", installed: false, iconColor: "#1D4AFF", iconSlug: "P" },

  // Music
  { id: "spotify", name: "Spotify for Artists", category: "music", shortDescription: "Auto-genera playlist colaborativa del evento.", installed: false, popular: true, iconColor: "#1DB954", iconSlug: "S" },
  { id: "songkick", name: "Songkick", category: "music", shortDescription: "Sincroniza tus eventos con concertgoers de Songkick.", installed: false, iconColor: "#F80046", iconSlug: "S" },
  { id: "bandsintown", name: "Bandsintown", category: "music", shortDescription: "Difunde tus eventos a 60M+ fans.", installed: false, iconColor: "#00CEC8", iconSlug: "B" },
  { id: "shazam", name: "Shazam for Artists", category: "music", shortDescription: "Detecta picos de Shazam y notifica al DJ.", installed: false, iconColor: "#0066FF", iconSlug: "S" },

  // Hardware
  { id: "stripe-terminal", name: "Stripe Terminal", category: "hardware", shortDescription: "Cobra con dataphone Stripe en taquilla y barra.", installed: true, featured: true, iconColor: "#635BFF", iconSlug: "S" },
  { id: "sumup", name: "SumUp", category: "hardware", shortDescription: "Datáfonos económicos para puerta y taquilla.", installed: false, iconColor: "#00C292", iconSlug: "S" },
  { id: "izettle", name: "Zettle by PayPal", category: "hardware", shortDescription: "TPV portátil con sincronización a Pasify.", installed: false, iconColor: "#00457C", iconSlug: "Z" },
  { id: "rfid-intellitix", name: "Intellitix RFID", category: "hardware", shortDescription: "Pulseras RFID para festivales con cashless.", installed: false, monthlyPrice: 199, iconColor: "#E8542A", iconSlug: "I" },

  // Finance
  { id: "stripe-tax", name: "Stripe Tax", category: "finance", shortDescription: "IVA y compliance fiscal automático por país.", installed: true, iconColor: "#635BFF", iconSlug: "$" },
  { id: "holded", name: "Holded", category: "finance", shortDescription: "Contabilidad española integrada con facturas.", installed: false, popular: true, iconColor: "#0066FF", iconSlug: "H" },
  { id: "sage", name: "Sage 50", category: "finance", shortDescription: "Exporta asientos contables a Sage.", installed: false, iconColor: "#00DC00", iconSlug: "S" },
  { id: "quickbooks", name: "QuickBooks", category: "finance", shortDescription: "Conciliación bancaria automática.", installed: false, iconColor: "#2CA01C", iconSlug: "Q" },

  // Productivity
  { id: "slack", name: "Slack", category: "productivity", shortDescription: "Notificaciones de venta + alertas a tu canal.", installed: true, iconColor: "#4A154B", iconSlug: "#" },
  { id: "notion", name: "Notion", category: "productivity", shortDescription: "Sincroniza el calendar de eventos con tu workspace.", installed: false, iconColor: "#000000", iconSlug: "N" },
  { id: "zapier", name: "Zapier", category: "productivity", shortDescription: "5000+ apps conectadas con triggers de Pasify.", installed: true, popular: true, iconColor: "#FF4F00", iconSlug: "Z" },
  { id: "make", name: "Make (Integromat)", category: "productivity", shortDescription: "Automatizaciones visuales sin código.", installed: false, iconColor: "#6D00CC", iconSlug: "M" },
  { id: "linear", name: "Linear", category: "productivity", shortDescription: "Crea issues automáticos para incidencias de evento.", installed: false, iconColor: "#5E6AD2", iconSlug: "L" },

  // Social
  { id: "instagram", name: "Instagram Graph API", category: "social", shortDescription: "Publica eventos auto-formateados como reels y posts.", installed: true, iconColor: "#E1306C", iconSlug: "IG" },
  { id: "whatsapp-biz", name: "WhatsApp Business", category: "social", shortDescription: "Atención al cliente VIP y broadcasts segmentados.", installed: false, popular: true, iconColor: "#25D366", iconSlug: "W" },
  { id: "discord", name: "Discord", category: "social", shortDescription: "Servidor de comunidad con verificación de tickets.", installed: false, iconColor: "#5865F2", iconSlug: "D" },
];

const CATEGORY_CONFIG: Record<Category, { label: string; icon: React.ReactNode; color: string }> = {
  marketing: { label: "Marketing", icon: <Mail className="h-4 w-4" />, color: "#FF7A4D" },
  analytics: { label: "Analytics & Data", icon: <BarChart3 className="h-4 w-4" />, color: "#E8542A" },
  music: { label: "Música & Artistas", icon: <Music className="h-4 w-4" />, color: "#B8381A" },
  hardware: { label: "Hardware & TPV", icon: <CreditCard className="h-4 w-4" />, color: "#E8B04C" },
  finance: { label: "Finanzas & Fiscal", icon: <Database className="h-4 w-4" />, color: "#4DB87A" },
  productivity: { label: "Productividad", icon: <ListChecks className="h-4 w-4" />, color: "#5C544A" },
  social: { label: "Social & Comunidad", icon: <MessageSquare className="h-4 w-4" />, color: "#C24DBC" },
};

export const PartnerAppMarketplace = () => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");

  const filtered = useMemo(() => {
    return APPS.filter((a) => {
      if (category !== "all" && a.category !== category) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return a.name.toLowerCase().includes(q) || a.shortDescription.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, category]);

  const installedCount = APPS.filter((a) => a.installed).length;
  const featured = APPS.filter((a) => a.featured);
  const popular = APPS.filter((a) => a.popular && !a.featured);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(80px)" }}
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
              <Plug className="h-6 w-6" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                App Marketplace
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Conecta tu Pasify con <span style={serif} className="text-orange-500">todo</span> tu stack
              </h2>
              <div
                className="mt-1 text-[12px] text-muted-foreground"
                style={mono}
              >
                {APPS.length} apps disponibles · {installedCount} instaladas · OAuth en 30 segundos
              </div>
            </div>
          </div>
          <Button variant="outline">
            <Webhook className="mr-2 h-4 w-4" />
            Mis webhooks
          </Button>
        </div>
      </section>

      {/* Search + categorías */}
      <section
        className="rounded-2xl border border-border bg-card p-4"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar app por nombre o función…"
            className="h-11 rounded-xl pl-10"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <CategoryChip
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="Todas"
            count={APPS.length}
            color="#FF7A4D"
            icon={<Hexagon className="h-3 w-3" />}
          />
          {(Object.keys(CATEGORY_CONFIG) as Category[]).map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const count = APPS.filter((a) => a.category === cat).length;
            return (
              <CategoryChip
                key={cat}
                active={category === cat}
                onClick={() => setCategory(cat)}
                label={cfg.label}
                count={count}
                color={cfg.color}
                icon={cfg.icon}
              />
            );
          })}
        </div>
      </section>

      {/* Featured (sólo en vista All) */}
      {category === "all" && !search.trim() && (
        <section>
          <div
            className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Star className="h-3 w-3" />
            Recomendadas
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {featured.map((a) => (
              <AppCard key={a.id} app={a} variant="featured" />
            ))}
          </div>
        </section>
      )}

      {/* Popular (sólo en vista All) */}
      {category === "all" && !search.trim() && (
        <section>
          <div
            className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Zap className="h-3 w-3" />
            Populares
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {popular.map((a) => (
              <AppCard key={a.id} app={a} variant="compact" />
            ))}
          </div>
        </section>
      )}

      {/* All / Filtered */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div
            className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <Plug className="h-3 w-3" />
            {category === "all" ? "Todas las apps" : CATEGORY_CONFIG[category].label} · {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
            Nada coincide con tu búsqueda.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((a) => (
              <AppCard key={a.id} app={a} variant="compact" />
            ))}
          </div>
        )}
      </section>

      {/* Developer section */}
      <section
        className="rounded-2xl border p-5 md:p-6"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,176,76,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,176,76,0.4)",
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #E8B04C 0%, #A6781D 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,176,76,0.5)",
              }}
            >
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
                style={{ ...mono, letterSpacing: "0.22em", color: "#E8B04C" }}
              >
                <ShieldCheck className="h-3 w-3" />
                Developer hub
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                ¿Quieres tu app aquí? <span style={serif} className="text-amber-400">Publica</span>
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                API REST + GraphQL + webhooks + SDKs (JS, iOS, Android, PHP).
              </p>
            </div>
          </div>
          <Button>
            <Settings className="mr-2 h-4 w-4" />
            Developer docs
          </Button>
        </div>
      </section>
    </div>
  );
};

const CategoryChip = ({
  active,
  onClick,
  label,
  count,
  color,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color: string;
  icon: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition"
    style={{
      background: active ? `${color}22` : "rgba(255,255,255,0.02)",
      borderColor: active ? `${color}66` : "rgba(244,238,226,0.1)",
      color: active ? color : "#C9BFA8",
    }}
  >
    {icon}
    {label}
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px]"
      style={{
        ...mono,
        letterSpacing: "0.06em",
        background: active ? `${color}33` : "rgba(255,255,255,0.05)",
      }}
    >
      {count}
    </span>
  </button>
);

const AppCard = ({
  app,
  variant,
}: {
  app: MarketplaceApp;
  variant: "featured" | "compact";
}) => {
  const cfg = CATEGORY_CONFIG[app.category];
  const isFeatured = variant === "featured";
  return (
    <article
      className="group/app relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 14px -6px rgba(0,0,0,0.4)",
      }}
    >
      {isFeatured && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full"
          style={{ background: `${app.iconColor}26`, filter: "blur(36px)" }}
        />
      )}

      <header className="relative flex items-start justify-between gap-2">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
          style={{
            background: `linear-gradient(180deg, ${app.iconColor}EE 0%, ${app.iconColor} 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -4px ${app.iconColor}88`,
            color: app.iconColor === "#FFE100" || app.iconColor === "#00DC00" ? "#1A1714" : "#fff",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          {app.iconSlug}
        </div>
        {app.installed ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: "rgba(77,184,122,0.18)",
              color: "#4DB87A",
            }}
          >
            <Check className="h-2.5 w-2.5" />
            Conectado
          </span>
        ) : app.monthlyPrice ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: "rgba(232,176,76,0.18)",
              color: "#E8B04C",
            }}
          >
            {app.monthlyPrice}€/mes
          </span>
        ) : (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: "rgba(255,255,255,0.04)",
              color: "#8A8275",
            }}
          >
            Gratis
          </span>
        )}
      </header>

      <div className="relative mt-3">
        <div className="flex items-center gap-2">
          <h4 className="text-base font-semibold tracking-tight text-foreground">{app.name}</h4>
        </div>
        <div
          className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase"
          style={{ ...mono, letterSpacing: "0.16em", color: cfg.color }}
        >
          {cfg.icon}
          {cfg.label}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {app.shortDescription}
        </p>
      </div>

      <footer className="relative mt-4 flex items-center justify-between">
        {app.installed ? (
          <Button variant="outline" size="sm">
            <Settings className="mr-1.5 h-3.5 w-3.5" />
            Configurar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Instalar
          </Button>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover/app:translate-x-1 group-hover/app:text-orange-500" />
      </footer>
    </article>
  );
};

export default PartnerAppMarketplace;
