import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  MapPin,
  MessageCircle,
  Plug,
  Send,
  Sparkles,
  Target,
  UserPlus,
  Webhook,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * PartnerAppMarketplace — Top 10 integraciones reales para Pasify.
 *
 * Antes esto era una "tienda" genérica con 30+ apps (Slack, Notion,
 * Mixpanel, Spotify, etc.) que no mueven la aguja del negocio. Lo
 * reenfocamos a un Top 10 honesto, organizado por caso de uso real:
 *
 *   1. Importar clientes      → CoverManager (destacada)
 *   2. Comunicación           → WhatsApp Business + Brevo
 *   3. Marketing y campañas   → Meta Ads/Instagram + TikTok Ads
 *   4. Medición               → Google Analytics 4 + Google Tag Manager
 *   5. Cobros físicos         → Stripe Terminal
 *   6. Finanzas               → Holded
 *   7. Automatización         → Zapier + Make
 *   8. Ubicación              → Google Maps + Google Business Profile
 *
 * Estados HONESTOS — si una integración aún no tiene OAuth real, NO
 * decimos "conecta en 30 segundos". Marcamos como `coming_soon` o
 * `available` (cuando hay flow de configuración manual real) y el CTA
 * se adapta: "Conectar", "Preparar importación", "Solicitar acceso",
 * "Configurar". Sin promesas vacías.
 *
 * Logos: SVGs locales en /public/integrations/ (no hotlinks externos).
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

type UseCase =
  | "customer_data"
  | "comms"
  | "ads"
  | "measurement"
  | "payments_physical"
  | "finance"
  | "automation"
  | "location";

type AppStatus = "available" | "coming_soon" | "beta" | "request_access";

interface IntegrationLogo {
  src: string;
  alt: string;
}

interface Integration {
  id: string;
  /** Nombre que ve el partner. Para integraciones combinadas usamos "/". */
  name: string;
  useCase: UseCase;
  description: string;
  /** Beneficio en 1 línea — qué desbloquea para el negocio. */
  benefit: string;
  /** Uno o dos logos. Si hay 2 → la UI los renderiza apilados. */
  logos: IntegrationLogo[];
  status: AppStatus;
  /** Texto del CTA principal. */
  ctaLabel: string;
  /** Si está disponible, podemos enlazar a docs / oauth start url. */
  ctaHref?: string;
  /** Featured = card grande tipo hero. Solo CoverManager. */
  featured?: boolean;
}

const USE_CASE_CONFIG: Record<
  UseCase,
  { label: string; icon: React.ReactNode; color: string }
> = {
  customer_data: {
    label: "Importar clientes",
    icon: <UserPlus className="h-3.5 w-3.5" />,
    color: "#FF7A4D",
  },
  comms: {
    label: "Comunicación",
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    color: "#4DB87A",
  },
  ads: {
    label: "Marketing y campañas",
    icon: <Target className="h-3.5 w-3.5" />,
    color: "#E8542A",
  },
  measurement: {
    label: "Medición",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    color: "#E8B04C",
  },
  payments_physical: {
    label: "Cobros físicos",
    icon: <CreditCard className="h-3.5 w-3.5" />,
    color: "#B8381A",
  },
  finance: {
    label: "Finanzas",
    icon: <Building2 className="h-3.5 w-3.5" />,
    color: "#0066FF",
  },
  automation: {
    label: "Automatización",
    icon: <Zap className="h-3.5 w-3.5" />,
    color: "#FF4A00",
  },
  location: {
    label: "Ubicación y descubrimiento",
    icon: <MapPin className="h-3.5 w-3.5" />,
    color: "#EA4335",
  },
};

const STATUS_CONFIG: Record<
  AppStatus,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  available: {
    label: "Disponible",
    color: "#4DB87A",
    bg: "rgba(77,184,122,0.10)",
    border: "rgba(77,184,122,0.32)",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  beta: {
    label: "Beta",
    color: "#E8B04C",
    bg: "rgba(232,176,76,0.10)",
    border: "rgba(232,176,76,0.32)",
    icon: <Sparkles className="h-3 w-3" />,
  },
  coming_soon: {
    label: "Disponible próximamente",
    color: "#FF7A4D",
    bg: "rgba(255,122,77,0.10)",
    border: "rgba(255,122,77,0.32)",
    icon: <Clock className="h-3 w-3" />,
  },
  request_access: {
    label: "Solicitar acceso",
    color: "#8A8275",
    bg: "rgba(244,238,226,0.04)",
    border: "rgba(244,238,226,0.12)",
    icon: <Send className="h-3 w-3" />,
  },
};

/**
 * Top 10 definitivo. El orden de este array es el orden de presentación
 * (excepto la integración `featured` que se monta como hero arriba).
 */
const TOP_10: Integration[] = [
  {
    id: "covermanager",
    name: "CoverManager",
    useCase: "customer_data",
    description:
      "Importa clientes, reservas, cumpleaños, preferencias y segmentos para activar campañas y listas VIP.",
    benefit:
      "Convierte tu base de reservas en compradores recurrentes con segmentación real (RFM, asistencia, gasto medio).",
    logos: [{ src: "/integrations/covermanager.svg", alt: "CoverManager" }],
    status: "coming_soon",
    ctaLabel: "Solicitar integración",
    featured: true,
  },
  {
    id: "whatsapp-biz",
    name: "WhatsApp Business",
    useCase: "comms",
    description:
      "Envía confirmaciones, recordatorios, mensajes VIP y campañas segmentadas con opt-in.",
    benefit:
      "Mensajería 1-a-1 + broadcast con tasas de apertura del 95%.",
    logos: [{ src: "/integrations/whatsapp.svg", alt: "WhatsApp Business" }],
    status: "beta",
    ctaLabel: "Solicitar acceso",
  },
  {
    id: "brevo",
    name: "Brevo",
    useCase: "comms",
    description:
      "Crea newsletters, campañas SMS/email y automatizaciones para clientes recurrentes.",
    benefit:
      "Email + SMS + workflows desde un solo dashboard.",
    logos: [{ src: "/integrations/brevo.svg", alt: "Brevo" }],
    status: "available",
    ctaLabel: "Conectar Brevo",
  },
  {
    id: "meta-ads",
    name: "Meta Ads · Instagram",
    useCase: "ads",
    description:
      "Crea audiencias y conversiones basadas en compradores y asistentes reales.",
    benefit:
      "Conversion API + lookalike audiences sobre datos verificados.",
    logos: [
      { src: "/integrations/meta.svg", alt: "Meta Ads" },
      { src: "/integrations/instagram.svg", alt: "Instagram" },
    ],
    status: "available",
    ctaLabel: "Conectar Meta",
  },
  {
    id: "tiktok-ads",
    name: "TikTok Ads",
    useCase: "ads",
    description:
      "Optimiza campañas para eventos, fiestas y público joven con eventos reales de compra.",
    benefit:
      "Events API + Pixel para retargeting de noche y captación.",
    logos: [{ src: "/integrations/tiktok.svg", alt: "TikTok Ads" }],
    status: "available",
    ctaLabel: "Conectar TikTok",
  },
  {
    id: "ga4-gtm",
    name: "Google Analytics 4 · Tag Manager",
    useCase: "measurement",
    description:
      "Mide visitas, checkout, compras y campañas desde el funnel completo de Pasify.",
    benefit:
      "Tracking sin tocar código + funnel de conversión real.",
    logos: [
      { src: "/integrations/ga4.svg", alt: "Google Analytics 4" },
      { src: "/integrations/gtm.svg", alt: "Google Tag Manager" },
    ],
    status: "available",
    ctaLabel: "Configurar GA4 / GTM",
  },
  {
    id: "stripe-terminal",
    name: "Stripe Terminal",
    useCase: "payments_physical",
    description:
      "Cobra en puerta, taquilla y barra con pagos presenciales conectados a Pasify.",
    benefit:
      "Datáfono + caja unificada con tus ventas online.",
    logos: [{ src: "/integrations/stripe.svg", alt: "Stripe Terminal" }],
    status: "available",
    ctaLabel: "Configurar Terminal",
  },
  {
    id: "holded",
    name: "Holded",
    useCase: "finance",
    description:
      "Exporta ventas, comisiones, IVA, reembolsos y facturación para contabilidad.",
    benefit:
      "Contabilidad española en una integración nativa (no CSVs).",
    logos: [{ src: "/integrations/holded.svg", alt: "Holded" }],
    status: "coming_soon",
    ctaLabel: "Solicitar integración",
  },
  {
    id: "zapier-make",
    name: "Zapier · Make",
    useCase: "automation",
    description:
      "Automatiza tareas conectando Pasify con miles de herramientas sin código.",
    benefit:
      "Triggers + actions sobre eventos, tickets, ventas y RRPP.",
    logos: [
      { src: "/integrations/zapier.svg", alt: "Zapier" },
      { src: "/integrations/make.svg", alt: "Make" },
    ],
    status: "available",
    ctaLabel: "Ver triggers",
  },
  {
    id: "google-location",
    name: "Google Maps · Business Profile",
    useCase: "location",
    description:
      "Mejora la ubicación, ficha del local, mapa, SEO local y descubrimiento.",
    benefit:
      "Ficha de Google actualizada con tus eventos y ubicación.",
    logos: [
      { src: "/integrations/googlemaps.svg", alt: "Google Maps" },
      { src: "/integrations/googlebusiness.svg", alt: "Google Business Profile" },
    ],
    status: "coming_soon",
    ctaLabel: "Solicitar integración",
  },
];

const FEATURED = TOP_10.find((i) => i.featured) ?? null;
const REST = TOP_10.filter((i) => !i.featured);

// Agrupar por caso de uso para la sección "Recomendadas"
const groupByUseCase = (items: Integration[]) => {
  const groups = new Map<UseCase, Integration[]>();
  for (const it of items) {
    const arr = groups.get(it.useCase) ?? [];
    arr.push(it);
    groups.set(it.useCase, arr);
  }
  return groups;
};

export const PartnerAppMarketplace = () => {
  const [useCaseFilter, setUseCaseFilter] = useState<UseCase | "all">("all");

  const filtered = useMemo(() => {
    if (useCaseFilter === "all") return REST;
    return REST.filter((i) => i.useCase === useCaseFilter);
  }, [useCaseFilter]);

  const grouped = useMemo(() => groupByUseCase(filtered), [filtered]);
  const useCasesInOrder: UseCase[] = useMemo(
    () => Array.from(new Set(filtered.map((i) => i.useCase))),
    [filtered]
  );

  const availableCount = TOP_10.filter((i) => i.status === "available" || i.status === "beta").length;
  const useCasesCount = new Set(TOP_10.map((i) => i.useCase)).size;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
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
                background:
                  "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 20px -8px rgba(232,84,42,0.6)",
              }}
            >
              <Plug className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Sparkles className="h-3 w-3" />
                Integraciones clave
              </div>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
                Integraciones para vender más y{" "}
                <span style={serif} className="text-orange-500">
                  operar mejor
                </span>
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Conecta Pasify con las herramientas que ya usa tu local para importar
                clientes, medir campañas, cobrar en puerta y automatizar tareas.
              </p>
              <div
                className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                <span>
                  <span className="text-foreground">{TOP_10.length}</span> integraciones
                  recomendadas
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  <span className="text-foreground">{useCasesCount}</span> áreas clave
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  <span className="text-foreground">{availableCount}</span> disponibles
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>OAuth / API · Webhooks</span>
              </div>
            </div>
          </div>
          <Button variant="outline" className="shrink-0">
            <Webhook className="mr-2 h-4 w-4" />
            Mis webhooks
          </Button>
        </div>
      </section>

      {/* Featured: CoverManager */}
      {FEATURED && <FeaturedCard integration={FEATURED} />}

      {/* Filter chips por caso de uso */}
      <section
        className="rounded-2xl border border-border bg-card p-3"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      >
        <div className="flex flex-wrap gap-2">
          <UseCaseChip
            active={useCaseFilter === "all"}
            onClick={() => setUseCaseFilter("all")}
            label="Todas"
            count={REST.length}
            color="#FF7A4D"
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
          {(Object.keys(USE_CASE_CONFIG) as UseCase[]).map((uc) => {
            const count = REST.filter((i) => i.useCase === uc).length;
            if (count === 0) return null;
            const cfg = USE_CASE_CONFIG[uc];
            return (
              <UseCaseChip
                key={uc}
                active={useCaseFilter === uc}
                onClick={() => setUseCaseFilter(uc)}
                label={cfg.label}
                count={count}
                color={cfg.color}
                icon={cfg.icon}
              />
            );
          })}
        </div>
      </section>

      {/* Recomendadas — agrupadas por caso de uso */}
      <section className="space-y-6">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <span className="inline-block h-px w-5 bg-orange-500/70" />
          Recomendadas para tu negocio
        </div>

        {useCasesInOrder.map((uc) => {
          const cfg = USE_CASE_CONFIG[uc];
          const items = grouped.get(uc) ?? [];
          return (
            <div key={uc} className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{ background: `${cfg.color}1A`, color: cfg.color }}
                >
                  {cfg.icon}
                </span>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {cfg.label}
                </h3>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  {items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => (
                  <IntegrationCard key={i.id} integration={i} />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Webhooks + developer hub (slim, honesto) */}
      <section
        className="rounded-2xl border p-5 md:p-6"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,176,76,0.10) 0%, rgba(184,56,26,0.02) 100%)",
          borderColor: "rgba(232,176,76,0.30)",
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
                <span className="inline-block h-px w-5 bg-amber-300/60" />
                Para developers
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Webhooks + Zapier + Make
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Pasify expone webhooks de eventos (orden pagada, ticket usado,
                reembolso, etc.) y triggers en Zapier/Make. API pública abierta
                próximamente.
              </p>
            </div>
          </div>
          <Button variant="outline">
            <ExternalLink className="mr-2 h-4 w-4" />
            Ver webhooks
          </Button>
        </div>
      </section>
    </div>
  );
};

// =================================================================
// Sub-components
// =================================================================

const FeaturedCard = ({ integration }: { integration: Integration }) => {
  const cfg = USE_CASE_CONFIG[integration.useCase];
  const statusCfg = STATUS_CONFIG[integration.status];
  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
      style={{
        background:
          "linear-gradient(135deg, rgba(232,84,42,0.10) 0%, rgba(184,56,26,0.02) 100%)",
        borderColor: "rgba(232,84,42,0.45)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -22px rgba(232,84,42,0.30)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(70px)" }}
      />

      <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        {/* Logo */}
        <div className="flex items-center gap-4">
          <LogoStack logos={integration.logos} size={64} />
          <div className="lg:hidden">
            <UseCaseBadge useCase={integration.useCase} />
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0">
          <div className="hidden lg:block">
            <UseCaseBadge useCase={integration.useCase} />
          </div>
          <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Importa tu base de{" "}
            <span style={serif} className="text-orange-500">
              clientes
            </span>{" "}
            desde {integration.name}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            {integration.description}
          </p>

          {/* Beneficios concretos */}
          <ul
            className="mt-4 grid grid-cols-1 gap-1.5 text-[12px] text-muted-foreground sm:grid-cols-2"
          >
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ background: cfg.color }}
              />
              Importar clientes + historial de reservas
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ background: cfg.color }}
              />
              Detectar clientes frecuentes y VIP
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ background: cfg.color }}
              />
              Cumpleaños y preferencias para campañas
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ background: cfg.color }}
              />
              Reactivar clientes inactivos
            </li>
          </ul>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-stretch gap-2 lg:items-end">
          <StatusBadge status={integration.status} />
          <Button
            className="h-11"
            style={{
              background:
                "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
              color: "#fff",
            }}
          >
            {integration.ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p
            className="text-right text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            Próximamente: import CSV + API
          </p>
        </div>
      </div>

      <span className="sr-only">{statusCfg.label}</span>
    </article>
  );
};

const IntegrationCard = ({ integration }: { integration: Integration }) => {
  return (
    <article
      className="group/app relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 14px -6px rgba(0,0,0,0.4)",
      }}
    >
      <header className="relative flex items-start justify-between gap-3">
        <LogoStack logos={integration.logos} size={44} />
        <StatusBadge status={integration.status} compact />
      </header>

      <div className="relative mt-3">
        <h4 className="text-base font-semibold tracking-tight text-foreground">
          {integration.name}
        </h4>
        <UseCaseBadge useCase={integration.useCase} muted />
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {integration.description}
        </p>
        <p className="mt-2 text-[11.5px] italic text-muted-foreground/80">
          {integration.benefit}
        </p>
      </div>

      <footer className="relative mt-4 flex items-center justify-between">
        <Button size="sm" variant="outline" className="text-xs">
          {integration.ctaLabel}
        </Button>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover/app:translate-x-1 group-hover/app:text-orange-500" />
      </footer>
    </article>
  );
};

const LogoStack = ({
  logos,
  size = 44,
}: {
  logos: IntegrationLogo[];
  size?: number;
}) => {
  if (logos.length === 1) {
    return (
      <div
        className="shrink-0 overflow-hidden rounded-xl"
        style={{
          width: size,
          height: size,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 12px -4px rgba(0,0,0,0.5)",
        }}
      >
        <img
          src={logos[0].src}
          alt={logos[0].alt}
          width={size}
          height={size}
          loading="lazy"
          className="h-full w-full"
        />
      </div>
    );
  }
  // 2 logos apilados horizontalmente con offset
  return (
    <div className="relative flex shrink-0 items-center" style={{ width: size + size * 0.55, height: size }}>
      <div
        className="absolute left-0 overflow-hidden rounded-xl"
        style={{
          width: size,
          height: size,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 12px -4px rgba(0,0,0,0.5)",
        }}
      >
        <img src={logos[0].src} alt={logos[0].alt} width={size} height={size} loading="lazy" className="h-full w-full" />
      </div>
      <div
        className="absolute overflow-hidden rounded-xl ring-2 ring-card"
        style={{
          left: size * 0.55,
          width: size,
          height: size,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 12px -4px rgba(0,0,0,0.5)",
        }}
      >
        <img src={logos[1].src} alt={logos[1].alt} width={size} height={size} loading="lazy" className="h-full w-full" />
      </div>
    </div>
  );
};

const StatusBadge = ({
  status,
  compact,
}: {
  status: AppStatus;
  compact?: boolean;
}) => {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase"
      style={{
        ...mono,
        letterSpacing: "0.16em",
        background: cfg.bg,
        borderColor: cfg.border,
        color: cfg.color,
      }}
    >
      {cfg.icon}
      {compact && status === "coming_soon" ? "Próx." : cfg.label}
    </span>
  );
};

const UseCaseBadge = ({
  useCase,
  muted,
}: {
  useCase: UseCase;
  muted?: boolean;
}) => {
  const cfg = USE_CASE_CONFIG[useCase];
  return (
    <span
      className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase"
      style={{
        ...mono,
        letterSpacing: "0.18em",
        color: muted ? "#8A8275" : cfg.color,
      }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
};

const UseCaseChip = ({
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
    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition"
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

export default PartnerAppMarketplace;
