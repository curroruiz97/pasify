import { useMemo } from "react";
import {
  Cake,
  ChevronRight,
  Crown,
  Diamond,
  Gem,
  Gift,
  Sparkles,
  Star,
  Ticket,
  TrendingUp,
  Trophy,
  UserPlus,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Demo loyalty data
// =============================================================

interface Tier {
  id: string;
  name: string;
  minPoints: number;
  color: string;
  icon: React.ReactNode;
  perks: string[];
}

const TIERS: Tier[] = [
  { id: "newbie", name: "Newbie", minPoints: 0, color: "#8A8275", icon: <Star className="h-5 w-5" />, perks: ["Acceso a la app"] },
  { id: "regular", name: "Regular", minPoints: 250, color: "#E8B04C", icon: <Sparkles className="h-5 w-5" />, perks: ["5% descuento entradas", "Eventos exclusivos curados"] },
  { id: "vip", name: "VIP", minPoints: 750, color: "#FF7A4D", icon: <Crown className="h-5 w-5" />, perks: ["Priority queue", "Invitación a previas", "Pulsera RFID gratis"] },
  { id: "insider", name: "Insider", minPoints: 1500, color: "#E8542A", icon: <Gem className="h-5 w-5" />, perks: ["Mesa VIP con descuento", "Backstage acceso 2/año", "Atención prioritaria"] },
  { id: "icon", name: "Icon", minPoints: 3500, color: "#B8381A", icon: <Diamond className="h-5 w-5" />, perks: ["Concierge personal", "Meet & greet artistas", "Mesa garantizada"] },
];

interface Activity {
  id: string;
  date: Date;
  description: string;
  points: number;
  type: "earn" | "spend" | "bonus";
}

const buildActivity = (now: Date): Activity[] => [
  { id: "a-1", date: new Date(now.getTime() - 3 * 24 * 3600 * 1000), description: "Saturday Night · Pacha Ibiza", points: 45, type: "earn" },
  { id: "a-2", date: new Date(now.getTime() - 8 * 24 * 3600 * 1000), description: "Friday Vibes · Razzmatazz", points: 60, type: "earn" },
  { id: "a-3", date: new Date(now.getTime() - 14 * 24 * 3600 * 1000), description: "Bonus · Cumpleaños", points: 100, type: "bonus" },
  { id: "a-4", date: new Date(now.getTime() - 22 * 24 * 3600 * 1000), description: "Canjeado · Mesa Pool side", points: -150, type: "spend" },
  { id: "a-5", date: new Date(now.getTime() - 30 * 24 * 3600 * 1000), description: "Closing Party · Sala Apolo", points: 75, type: "earn" },
];

const buildPerks = () => [
  {
    id: "p-1",
    label: "Priority queue",
    description: "Entra por la cola VIP en cualquier local de la red.",
    cost: 0,
    available: true,
    color: "#FF7A4D",
    icon: <Crown className="h-4 w-4" />,
    tier: "vip",
  },
  {
    id: "p-2",
    label: "Botella de bienvenida",
    description: "Tu primera botella gratis al reservar mesa.",
    cost: 200,
    available: true,
    color: "#E8B04C",
    icon: <Gift className="h-4 w-4" />,
    tier: "regular",
  },
  {
    id: "p-3",
    label: "Backstage pass",
    description: "Acceso a un evento backstage al mes.",
    cost: 500,
    available: false,
    color: "#E8542A",
    icon: <Diamond className="h-4 w-4" />,
    tier: "insider",
  },
  {
    id: "p-4",
    label: "Meet & greet",
    description: "1 encuentro con DJ headliner / año.",
    cost: 1200,
    available: false,
    color: "#B8381A",
    icon: <Sparkles className="h-4 w-4" />,
    tier: "icon",
  },
];

// =============================================================
// Component
// =============================================================

export const ClientLoyalty = () => {
  const totalPoints = 480; // demo
  const tierIdx = useMemo(() => {
    for (let i = TIERS.length - 1; i >= 0; i--) {
      if (totalPoints >= TIERS[i].minPoints) return i;
    }
    return 0;
  }, [totalPoints]);
  const currentTier = TIERS[tierIdx];
  const nextTier = TIERS[tierIdx + 1];
  const pointsToNext = nextTier ? nextTier.minPoints - totalPoints : 0;
  const progressPct = nextTier
    ? Math.min(
        100,
        Math.round(
          ((totalPoints - currentTier.minPoints) / (nextTier.minPoints - currentTier.minPoints)) * 100
        )
      )
    : 100;

  const now = new Date();
  const activity = useMemo(() => buildActivity(now), []);
  const perks = useMemo(buildPerks, []);

  return (
    <div className="space-y-6">
      {/* Hero membership card */}
      <section
        className="relative overflow-hidden rounded-2xl p-6 text-white md:p-8"
        style={{
          background: `linear-gradient(135deg, ${currentTier.color}DD 0%, ${shade(currentTier.color, -30)} 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 24px 60px -24px ${currentTier.color}66`,
        }}
      >
        {/* Grain overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            mixBlendMode: "overlay",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-64 w-64 rounded-full"
          style={{ background: "rgba(255,255,255,0.2)", filter: "blur(80px)" }}
        />

        <header className="relative flex items-start justify-between">
          <div>
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em", color: "rgba(255,255,255,0.85)" }}
            >
              {currentTier.icon}
              Tier {tierIdx + 1} / {TIERS.length}
            </div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {currentTier.name} <span style={serif}>de Pasify</span>
            </h2>
            <div
              className="mt-2 text-[11px] uppercase"
              style={{ ...mono, letterSpacing: "0.2em", color: "rgba(255,255,255,0.7)" }}
            >
              ★ Pasify Points · Reward Program
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.18em", color: "rgba(255,255,255,0.7)" }}
            >
              Tus puntos
            </div>
            <div className="mt-0.5 text-4xl font-bold tracking-tight md:text-5xl" style={mono}>
              {totalPoints}
            </div>
          </div>
        </header>

        {/* Progress to next tier */}
        {nextTier && (
          <div className="relative mt-6">
            <div
              className="mb-2 flex items-center justify-between text-[11px] uppercase"
              style={{ ...mono, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}
            >
              <span>{currentTier.name}</span>
              <span>
                {pointsToNext} puntos para {nextTier.name}
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.16)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progressPct}%`,
                  background: "rgba(255,255,255,0.9)",
                  boxShadow: "0 0 12px rgba(255,255,255,0.5)",
                }}
              />
            </div>
          </div>
        )}

        {/* Quick stats */}
        <div className="relative mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
          <CardStat label="Eventos LTV" value="12" />
          <CardStat label="Gastado" value="184€" />
          <CardStat label="Cumple" value="Mar 15" icon={<Cake className="h-3 w-3" />} />
        </div>
      </section>

      {/* Tier ladder */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <TrendingUp className="h-3 w-3" />
            Niveles
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Tu escalera
          </h3>
        </div>

        <ol className="relative space-y-3 border-l border-border pl-4">
          {TIERS.map((t, i) => {
            const isCurrent = i === tierIdx;
            const isReached = i <= tierIdx;
            return (
              <li key={t.id} className="relative">
                <span
                  className="absolute -left-[19px] top-3 inline-block h-3 w-3 rounded-full border-2"
                  style={{
                    background: isReached ? t.color : "transparent",
                    borderColor: isReached ? t.color : "rgba(244,238,226,0.2)",
                    boxShadow: isCurrent ? `0 0 12px ${t.color}AA` : "none",
                  }}
                />
                <div
                  className="rounded-2xl border p-3 transition"
                  style={{
                    background: isCurrent ? `${t.color}12` : "rgba(255,255,255,0.02)",
                    borderColor: isCurrent ? `${t.color}66` : "rgba(244,238,226,0.08)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{ color: t.color }}>{t.icon}</span>
                      <span
                        className="text-base font-semibold tracking-tight"
                        style={{ color: isReached ? "#F4EEE2" : "rgba(244,238,226,0.5)" }}
                      >
                        {t.name}
                      </span>
                      {isCurrent && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.16em",
                            background: `${t.color}22`,
                            color: t.color,
                          }}
                        >
                          Tu nivel
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] uppercase"
                      style={{ ...mono, letterSpacing: "0.16em", color: t.color }}
                    >
                      {t.minPoints}+ pts
                    </span>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {t.perks.map((p) => (
                      <li
                        key={p}
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{
                          ...mono,
                          letterSpacing: "0.1em",
                          background: "rgba(255,255,255,0.04)",
                          color: isReached ? "#C9BFA8" : "rgba(244,238,226,0.4)",
                        }}
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Perks marketplace */}
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
              <Gift className="h-3 w-3" />
              Perks
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Canjea tus puntos
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {perks.map((p) => {
            const canRedeem = p.cost === 0 || (p.cost <= totalPoints && p.available);
            const tierUnlocked = TIERS.findIndex((t) => t.id === p.tier) <= tierIdx;
            return (
              <article
                key={p.id}
                className="relative overflow-hidden rounded-2xl border p-4"
                style={{
                  background: tierUnlocked ? `${p.color}0F` : "rgba(255,255,255,0.02)",
                  borderColor: tierUnlocked ? `${p.color}40` : "rgba(244,238,226,0.1)",
                  boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
                  opacity: tierUnlocked ? 1 : 0.55,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
                    style={{
                      background: `linear-gradient(180deg, ${p.color}DD 0%, ${p.color} 100%)`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 10px -3px ${p.color}88`,
                    }}
                  >
                    {p.icon}
                  </div>
                  <div className="text-right">
                    <div
                      className="text-[10px] uppercase"
                      style={{ ...mono, letterSpacing: "0.16em", color: p.color }}
                    >
                      Coste
                    </div>
                    <div className="mt-0.5 text-base font-bold text-foreground" style={mono}>
                      {p.cost === 0 ? "Gratis" : `${p.cost} pts`}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-base font-semibold text-foreground">{p.label}</div>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>

                {tierUnlocked ? (
                  <Button size="sm" className="mt-3 w-full" disabled={!canRedeem}>
                    {p.cost === 0 ? "Activado" : canRedeem ? "Canjear" : "Faltan puntos"}
                  </Button>
                ) : (
                  <div
                    className="mt-3 rounded-xl border border-dashed border-border px-3 py-2 text-center text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.18em" }}
                  >
                    Desbloquea al llegar a {TIERS.find((t) => t.id === p.tier)?.name}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* Recent activity */}
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
              <Trophy className="h-3 w-3" />
              Movimientos
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Tu historial de puntos
            </h3>
          </div>
        </div>

        <ul className="space-y-2">
          {activity.map((a) => {
            const isEarn = a.type === "earn";
            const isBonus = a.type === "bonus";
            const color = isBonus ? "#E8B04C" : isEarn ? "#4DB87A" : "#B8381A";
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-border p-3"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                  style={{ background: `${color}22`, color }}
                >
                  {isBonus ? <Sparkles className="h-4 w-4" /> : isEarn ? <Ticket className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{a.description}</div>
                  <div
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    {a.date.toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </div>
                </div>
                <div className="text-right" style={{ ...mono, color }}>
                  <div className="text-base font-bold">
                    {a.points > 0 ? "+" : ""}
                    {a.points} pts
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Refer-a-friend CTA */}
      <section
        className="relative overflow-hidden rounded-2xl border p-5 md:p-6"
        style={{
          background: "linear-gradient(135deg, rgba(232,84,42,0.12) 0%, rgba(184,56,26,0.04) 100%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-60 w-60 rounded-full"
          style={{ background: "rgba(232,84,42,0.2)", filter: "blur(70px)" }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white"
              style={{
                background: "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -6px rgba(232,84,42,0.6)",
              }}
            >
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <div
                className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                style={{ ...mono, letterSpacing: "0.22em" }}
              >
                <Zap className="h-3 w-3" />
                Refer a friend
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Trae un amigo, <span style={serif} className="text-orange-500">5€</span> para los dos
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Comparte tu código <span className="font-mono" style={mono}>PASIFY-LU24X</span> y cuando complete su primer evento, los dos ganáis 5€ + 50 puntos.
              </p>
            </div>
          </div>
          <Button>
            Compartir código
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  );
};

const CardStat = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) => (
  <div>
    <div
      className="inline-flex items-center gap-1 text-[10px] uppercase"
      style={{ ...mono, letterSpacing: "0.18em", color: "rgba(255,255,255,0.7)" }}
    >
      {icon}
      {label}
    </div>
    <div className="mt-1 text-lg font-bold" style={mono}>
      {value}
    </div>
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

export default ClientLoyalty;
