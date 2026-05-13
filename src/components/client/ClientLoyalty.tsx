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
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLoyalty, type LoyaltyLevel, type LoyaltyMovement } from "@/hooks/useLoyalty";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// Icon + color por código de level. Los códigos del seed (mig 0021) son
// bronze / silver / gold / platinum. Si el admin añade niveles nuevos,
// caemos en un icono default.
const LEVEL_VISUALS: Record<string, { icon: React.ReactNode; color: string }> = {
  bronze:   { icon: <Star className="h-5 w-5" />,     color: "#B8763C" },
  silver:   { icon: <Sparkles className="h-5 w-5" />, color: "#C9C9C9" },
  gold:     { icon: <Crown className="h-5 w-5" />,    color: "#E8B04C" },
  platinum: { icon: <Gem className="h-5 w-5" />,      color: "#E8E1D4" },
  // Fallbacks si el admin añade niveles fuera del seed
  newbie:   { icon: <Star className="h-5 w-5" />,     color: "#8A8275" },
  vip:      { icon: <Crown className="h-5 w-5" />,    color: "#FF7A4D" },
  insider:  { icon: <Gem className="h-5 w-5" />,      color: "#E8542A" },
  icon:     { icon: <Diamond className="h-5 w-5" />,  color: "#B8381A" },
};

const visualFor = (level: LoyaltyLevel | null) => {
  if (!level) return { icon: <Star className="h-5 w-5" />, color: "#8A8275" };
  return LEVEL_VISUALS[level.code] ?? { icon: <Star className="h-5 w-5" />, color: level.color ?? "#8A8275" };
};

const movementVisual = (m: LoyaltyMovement) => {
  if (m.change_amount > 0) {
    if (m.reason_code === "bonus" || m.reason?.toLowerCase().includes("bonus")) {
      return { icon: <Sparkles className="h-4 w-4" />, color: "#E8B04C", type: "bonus" as const };
    }
    return { icon: <Ticket className="h-4 w-4" />, color: "#4DB87A", type: "earn" as const };
  }
  return { icon: <Gift className="h-4 w-4" />, color: "#B8381A", type: "spend" as const };
};

export const ClientLoyalty = () => {
  const { balance, levels, movements, currentLevel, nextLevel, pointsToNext, progressPct, loading, error } =
    useLoyalty();

  const visualsByCode = useMemo(() => {
    const m = new Map<string, { icon: React.ReactNode; color: string }>();
    for (const l of levels) m.set(l.code, visualFor(l));
    return m;
  }, [levels]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
        No pudimos cargar tus puntos: {error}
      </div>
    );
  }

  // Si no hay levels seedados todavía (proyectos nuevos sin la mig 0021
  // aplicada), mostramos estado neutro.
  if (levels.length === 0 || !currentLevel) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <Sparkles className="mx-auto mb-3 h-10 w-10 text-orange-500" />
        <h3 className="text-xl font-semibold tracking-tight">Pasify Points</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          El programa de puntos se activará pronto. Mientras tanto, sigue comprando entradas — los
          puntos se acumularán retroactivamente.
        </p>
      </div>
    );
  }

  const currentVisual = visualFor(currentLevel);
  const nextVisual = nextLevel ? visualFor(nextLevel) : null;
  const tierIdx = levels.findIndex((l) => l.code === currentLevel.code);

  return (
    <div className="space-y-6">
      {/* Hero membership card */}
      <section
        className="relative overflow-hidden rounded-2xl p-6 text-white md:p-8"
        style={{
          background: `linear-gradient(135deg, ${currentVisual.color}DD 0%, ${shade(currentVisual.color, -30)} 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 24px 60px -24px ${currentVisual.color}66`,
        }}
      >
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
              {currentVisual.icon}
              Tier {tierIdx + 1} / {levels.length}
            </div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {currentLevel.name} <span style={serif}>de Pasify</span>
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
              {balance}
            </div>
          </div>
        </header>

        {nextLevel && (
          <div className="relative mt-6">
            <div
              className="mb-2 flex items-center justify-between text-[11px] uppercase"
              style={{ ...mono, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}
            >
              <span>{currentLevel.name}</span>
              <span>
                {pointsToNext} puntos para {nextLevel.name}
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

        {/* Quick stats — derivados de movimientos reales */}
        <div className="relative mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5">
          <CardStat
            label="Movimientos"
            value={String(movements.length)}
          />
          <CardStat
            label="Ganados"
            value={String(movements.filter((m) => m.change_amount > 0).reduce((s, m) => s + m.change_amount, 0))}
          />
          <CardStat
            label="Próximo tier"
            value={nextLevel ? `${pointsToNext}` : "Máx"}
            icon={<TrendingUp className="h-3 w-3" />}
          />
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
          {levels.map((t, i) => {
            const v = visualsByCode.get(t.code) ?? visualFor(t);
            const isCurrent = i === tierIdx;
            const isReached = i <= tierIdx;
            return (
              <li key={t.code} className="relative">
                <span
                  className="absolute -left-[19px] top-3 inline-block h-3 w-3 rounded-full border-2"
                  style={{
                    background: isReached ? v.color : "transparent",
                    borderColor: isReached ? v.color : "rgba(244,238,226,0.2)",
                    boxShadow: isCurrent ? `0 0 12px ${v.color}AA` : "none",
                  }}
                />
                <div
                  className="rounded-2xl border p-3 transition"
                  style={{
                    background: isCurrent ? `${v.color}12` : "rgba(255,255,255,0.02)",
                    borderColor: isCurrent ? `${v.color}66` : "rgba(244,238,226,0.08)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{ color: v.color }}>{v.icon}</span>
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
                            background: `${v.color}22`,
                            color: v.color,
                          }}
                        >
                          Tu nivel
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] uppercase"
                      style={{ ...mono, letterSpacing: "0.16em", color: v.color }}
                    >
                      {t.min_points}+ pts
                    </span>
                  </div>
                  {t.perks.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {t.perks.map((p, idx) => (
                        <li
                          key={`${t.code}-perk-${idx}`}
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
                  )}
                </div>
              </li>
            );
          })}
        </ol>
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

        {movements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <Cake className="mx-auto mb-2 h-5 w-5" />
            Sin movimientos todavía. Compra tu primera entrada y empezarás a sumar puntos.
          </div>
        ) : (
          <ul className="space-y-2">
            {movements.map((m) => {
              const v = movementVisual(m);
              const dateStr = new Date(m.created_at).toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "short",
              });
              const description = m.event_title
                ? `${m.reason} · ${m.event_title}`
                : m.reason;
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                    style={{ background: `${v.color}22`, color: v.color }}
                  >
                    {v.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{description}</div>
                    <div
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      {dateStr}
                    </div>
                  </div>
                  <div className="text-right" style={{ ...mono, color: v.color }}>
                    <div className="text-base font-bold">
                      {m.change_amount > 0 ? "+" : ""}
                      {m.change_amount} pts
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Refer-a-friend CTA — leyenda (referral codes pendientes en futura iteración) */}
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
                Sistema de invitaciones próximamente. Mientras tanto, comparte Pasify en tus redes.
              </p>
            </div>
          </div>
          <Button disabled title="Disponible en próxima iteración">
            Compartir
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
