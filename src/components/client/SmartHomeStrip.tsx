import { Brain, ChevronRight, Flame, Heart, Sparkles, Users } from "lucide-react";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface Partner {
  id: string;
  business_name: string | null;
  business_category: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
}

interface Props {
  partners: Partner[];
  onOpen: (id: string) => void;
}

type StripKind = "for_you" | "trending" | "because" | "friends";

interface Strip {
  kind: StripKind;
  eyebrow: string;
  title: React.ReactNode;
  reasonByPartner?: Map<string, string>;
  partners: Partner[];
  accent: string;
  icon: React.ReactNode;
}

/**
 * SmartHomeStrip — carruseles de descubrimiento del cliente impulsados por IA mock.
 * Se inyecta arriba del grid de locales para dar la sensación de feed personalizado.
 */
export const SmartHomeStrip = ({ partners, onOpen }: Props) => {
  if (partners.length === 0) return null;

  const strips = buildStrips(partners);

  return (
    <div className="mb-8 space-y-8">
      {/* IA banner */}
      <div
        className="relative overflow-hidden rounded-2xl border p-4 md:p-5"
        style={{
          background:
            "linear-gradient(135deg, rgba(232,84,42,0.14) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
          style={{ background: "rgba(232,84,42,0.22)", filter: "blur(70px)" }}
        />
        <div className="relative flex items-center gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
            style={{
              background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.6)",
            }}
          >
            <Brain className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              Curado por IA · Pasify
            </div>
            <div className="mt-0.5 text-sm font-semibold leading-tight text-foreground md:text-base">
              Hemos seleccionado <span style={serif} className="text-orange-500">{partners.length}</span> locales para ti según tu gusto musical, tu ciudad y a dónde fueron tus amigos esta semana.
            </div>
          </div>
        </div>
      </div>

      {/* Strips */}
      {strips.map((s) => (
        <DiscoveryStrip key={s.kind} strip={s} onOpen={onOpen} />
      ))}
    </div>
  );
};

const buildStrips = (partners: Partner[]): Strip[] => {
  const half = Math.ceil(partners.length / 2);
  const forYou = partners.slice(0, Math.min(6, half));
  const trending = [...partners].slice(0, partners.length).sort((a, b) => (b.id > a.id ? 1 : -1)).slice(0, 6);
  const because = partners.slice(Math.min(2, partners.length - 1), Math.min(8, partners.length));
  const friends = partners.slice(0, Math.min(5, partners.length)).reverse();

  const becauseReasons = new Map<string, string>();
  because.forEach((p, i) => {
    const seeds = [
      "Porque te gustó Pacha Ibiza",
      "Porque has ido 3 veces a Razzmatazz",
      "Similar a tu última visita a Sala Apolo",
      "Coincide con tu género (house · techno)",
    ];
    becauseReasons.set(p.id, seeds[i % seeds.length]);
  });

  return [
    {
      kind: "for_you",
      eyebrow: "Para ti",
      title: (
        <>
          Lo que <span style={serif} className="text-orange-500">probablemente</span> te enganche
        </>
      ),
      partners: forYou,
      accent: "#FF7A4D",
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      kind: "trending",
      eyebrow: "Trending esta noche",
      title: <>Lo que está <span style={serif} className="text-orange-500">ardiendo</span> ahora mismo</>,
      partners: trending,
      accent: "#B8381A",
      icon: <Flame className="h-4 w-4" />,
    },
    {
      kind: "because",
      eyebrow: "Te puede interesar",
      title: <>Porque te gustó <span style={serif} className="text-orange-500">otro</span></>,
      reasonByPartner: becauseReasons,
      partners: because,
      accent: "#E8542A",
      icon: <Heart className="h-4 w-4" />,
    },
    {
      kind: "friends",
      eyebrow: "Tus amigos van",
      title: <>5 amigos tuyos van <span style={serif} className="text-orange-500">esta semana</span></>,
      partners: friends,
      accent: "#4DB87A",
      icon: <Users className="h-4 w-4" />,
    },
  ];
};

const DiscoveryStrip = ({ strip, onOpen }: { strip: Strip; onOpen: (id: string) => void }) => (
  <section>
    <header className="mb-3 flex items-center justify-between">
      <div>
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase"
          style={{ ...mono, letterSpacing: "0.22em", color: strip.accent }}
        >
          {strip.icon}
          {strip.eyebrow}
        </div>
        <h3 className="text-xl font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
          {strip.title}
        </h3>
      </div>
      <button
        type="button"
        className="hidden text-[11px] uppercase text-muted-foreground transition hover:text-orange-500 sm:inline-flex sm:items-center sm:gap-1"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        Ver todos
        <ChevronRight className="h-3 w-3" />
      </button>
    </header>

    <div
      className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {strip.partners.map((p) => (
        <DiscoveryCard
          key={p.id}
          partner={p}
          accent={strip.accent}
          reason={strip.reasonByPartner?.get(p.id)}
          friendsGoing={strip.kind === "friends" ? Math.floor(Math.random() * 3) + 1 : 0}
          onClick={() => onOpen(p.id)}
        />
      ))}
    </div>
  </section>
);

const DiscoveryCard = ({
  partner,
  accent,
  reason,
  friendsGoing,
  onClick,
}: {
  partner: Partner;
  accent: string;
  reason?: string;
  friendsGoing: number;
  onClick: () => void;
}) => {
  const initial = (partner.business_name?.[0] ?? "?").toUpperCase();
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/card relative w-56 shrink-0 overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-orange-500/50"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 14px -6px rgba(0,0,0,0.4)" }}
    >
      {/* Cover */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
        {partner.cover_image_url ? (
          <img
            src={partner.cover_image_url}
            alt={partner.business_name ?? ""}
            className="h-full w-full object-cover transition duration-500 group-hover/card:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
              color: "#F4EEE2",
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            {initial}
          </div>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.25) 50%, transparent 100%)",
          }}
        />

        {/* Reason chip top */}
        {reason && (
          <div
            className="absolute left-2 right-2 top-2 rounded-full px-2 py-0.5 text-[9px] uppercase backdrop-blur-md"
            style={{
              ...mono,
              letterSpacing: "0.16em",
              background: "rgba(10,10,10,0.55)",
              border: `1px solid ${accent}66`,
              color: accent,
            }}
          >
            {reason}
          </div>
        )}

        {/* Friends badge */}
        {friendsGoing > 0 && (
          <div
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase text-white backdrop-blur-md"
            style={{
              ...mono,
              letterSpacing: "0.14em",
              background: `${accent}DD`,
            }}
          >
            <Users className="h-2.5 w-2.5" />
            +{friendsGoing}
          </div>
        )}

        {/* Info bottom */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="truncate text-base font-bold text-white drop-shadow">
            {partner.business_name ?? "Local"}
          </div>
          <div
            className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-white/85 drop-shadow"
            style={{ ...mono, letterSpacing: "0.08em" }}
          >
            <span className="capitalize">{partner.business_category ?? "Local"}</span>
            {partner.city && (
              <>
                <span className="opacity-50">·</span>
                <span>{partner.city}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export default SmartHomeStrip;
