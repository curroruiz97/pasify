import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coffee,
  CreditCard,
  DoorOpen,
  Eye,
  EyeOff,
  Footprints,
  Frown,
  Gauge,
  GlassWater,
  Headphones,
  Heart,
  ImageIcon,
  Info,
  Layers,
  MapPin,
  Meh,
  MessageSquare,
  Music,
  Navigation,
  Plus,
  Radio,
  Search,
  Sparkles,
  Smile,
  Star,
  Toilet,
  Trophy,
  Users,
  Waves,
  Wifi,
  Wine,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { useToast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------
   Sets guardados — persistencia local real (sobrevive a reinicios de
   la app). Antes el boton "Guardar set" no tenia onClick y no hacia
   nada al tocarlo: mismo patron que Apple reporto en "Editar perfil"
   (Guideline 2.1(a)).
   ------------------------------------------------------------------ */
const SAVED_SETS_KEY = "pasify.savedSets";

const readSavedSets = (): string[] => {
  try {
    const raw = window.localStorage.getItem(SAVED_SETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const writeSavedSets = (ids: string[]) => {
  try {
    window.localStorage.setItem(SAVED_SETS_KEY, JSON.stringify(ids));
  } catch {
    /* storage lleno o bloqueado: la UI sigue funcionando en memoria */
  }
};

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

// =============================================================
// Demo data (mocks lo que se cargaría del backend al hacer check-in)
// =============================================================

interface LiveEvent {
  id: string;
  title: string;
  venue: string;
  city: string;
  startedAt: Date;
  endsAt: Date;
  lineup: Array<{ artist: string; start: Date; stage: string; headliner?: boolean }>;
  wallet: { balanceCents: number; lastTopUpCents: number; lastConsumption: { name: string; cents: number; at: Date } | null };
  photoCount: number;
  attendeesCount: number;
}

const buildLiveEvent = (): LiveEvent => {
  const tonight = new Date();
  tonight.setHours(23, 0, 0, 0);
  const nowM = (off: number) => {
    const d = new Date(tonight);
    d.setMinutes(d.getMinutes() + off);
    return d;
  };
  return {
    id: "live-evt-01",
    title: "Saturday Night · Resident DJs",
    venue: "Pacha Ibiza",
    city: "Ibiza",
    startedAt: tonight,
    endsAt: nowM(360),
    lineup: [
      { artist: "DJ Sound · Warm Up", start: nowM(0), stage: "Sala Principal" },
      { artist: "Marta Vibe", start: nowM(75), stage: "Sala Principal" },
      { artist: "Dani López", start: nowM(180), stage: "Sala Principal", headliner: true },
      { artist: "Nico DJ · Closing", start: nowM(285), stage: "Sala Principal" },
      { artist: "Pool side · Carla Set", start: nowM(60), stage: "Pool Side" },
      { artist: "VIP · Lounge Mix", start: nowM(120), stage: "VIP Lounge" },
    ],
    wallet: {
      balanceCents: 4800,
      lastTopUpCents: 5000,
      lastConsumption: {
        name: "Gin Tonic Bombay",
        cents: 1200,
        at: new Date(Date.now() - 18 * 60 * 1000),
      },
    },
    photoCount: 218,
    attendeesCount: 612,
  };
};


interface Props {
  /** Si true muestra la experiencia full. Si false sólo el banner de "entra al evento". */
  ticketHasEventToday?: boolean;
  onClose?: () => void;
}

/**
 * Live Experience del cliente — modo evento que se "activa" cuando
 * detectas que está dentro del local (geofencing / scan QR a la entrada).
 * Modo demo: usa datos mock; en producción se hidrata del backend.
 */
export const ClientLiveExperience = ({ ticketHasEventToday = true }: Props) => {
  const [activated, setActivated] = useState(false);
  const event = useMemo(buildLiveEvent, []);

  if (!ticketHasEventToday) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground"
      >
        Tu modo evento se activa cuando compres una entrada y llegues al local.
      </div>
    );
  }

  if (!activated) {
    return <ActivateBanner event={event} onActivate={() => setActivated(true)} />;
  }

  return <LiveExperienceFull event={event} />;
};

// =============================================================
// Banner de activación (estado pre-evento)
// =============================================================

const ActivateBanner = ({ event, onActivate }: { event: LiveEvent; onActivate: () => void }) => {
  return (
    <article
      className="relative overflow-hidden rounded-2xl border p-6 md:p-8"
      style={{
        background: "linear-gradient(135deg, rgba(232,84,42,0.18) 0%, rgba(184,56,26,0.04) 100%)",
        borderColor: "rgba(232,84,42,0.5)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px -10px rgba(0,0,0,0.5)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
        style={{ background: "rgba(232,84,42,0.28)", filter: "blur(90px)" }}
      />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="relative inline-flex h-2 w-2">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                  style={{ background: "#FF7A4D" }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: "#FF7A4D" }}
                />
              </span>
              Esta noche · Tienes entrada
            </span>
            <BetaBadge
              label="Vista previa"
              reason="Modo evento (line-up vivo, mapa interior, cashless NFC, muro de fotos, NPS) se activa cuando integremos geolocalización del local + push notifications de check-in. Los datos mostrados son ejemplos del producto final."
            />
          </div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Vive <span style={serif} className="text-orange-500">{event.venue}</span> esta noche
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Al llegar al local, activa el modo evento para tener line-up en vivo, mapa interior, cashless con NFC y muro de fotos compartido.
          </p>
          <div
            className="mt-4 inline-flex items-center gap-2 text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            <MapPin className="h-3 w-3" />
            {event.title} · {event.venue}, {event.city}
          </div>
        </div>
        <Button onClick={onActivate} size="lg">
          <Zap className="mr-2 h-4 w-4" />
          Activar modo evento
        </Button>
      </div>
    </article>
  );
};

// =============================================================
// Live full
// =============================================================

const LiveExperienceFull = ({ event }: { event: LiveEvent }) => {
  const [tab, setTab] = useState<"now" | "map" | "wall" | "exit">("now");

  return (
    <div className="space-y-6">
      {/* HEADER LIVE */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5 md:p-7"
        style={{
          background:
            "linear-gradient(160deg, rgba(232,84,42,0.18) 0%, rgba(11,9,8,1) 60%)",
          borderColor: "rgba(232,84,42,0.4)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -10px rgba(232,84,42,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full"
          style={{ background: "rgba(232,84,42,0.28)", filter: "blur(90px)" }}
        />

        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div
              className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.22em", color: "#4DB87A" }}
            >
              <span className="relative inline-flex h-2 w-2">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                  style={{ background: "#4DB87A" }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ background: "#4DB87A" }}
                />
              </span>
              Estás dentro · Modo evento activo
            </div>
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              {event.title}
            </h2>
            <div
              className="mt-1 inline-flex items-center gap-2 text-[12px] text-muted-foreground"
              style={mono}
            >
              <MapPin className="h-3 w-3" />
              {event.venue} · {event.city}
            </div>
          </div>

          <div className="flex shrink-0 gap-3">
            <MiniStat label="Asistentes" value={event.attendeesCount.toString()} icon={<Users className="h-3 w-3" />} />
            <MiniStat label="Fotos" value={event.photoCount.toString()} icon={<Camera className="h-3 w-3" />} />
            <MiniStat label="Wifi" value="Pasify" icon={<Wifi className="h-3 w-3" />} />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex items-end gap-1 border-b border-border">
        <Tab active={tab === "now"} onClick={() => setTab("now")} icon={<Music className="h-4 w-4" />}>
          Ahora suena
        </Tab>
        <Tab active={tab === "map"} onClick={() => setTab("map")} icon={<MapPin className="h-4 w-4" />}>
          Mapa
        </Tab>
        <Tab active={tab === "wall"} onClick={() => setTab("wall")} icon={<Camera className="h-4 w-4" />}>
          Photo wall
        </Tab>
        <Tab active={tab === "exit"} onClick={() => setTab("exit")} icon={<DoorOpen className="h-4 w-4" />}>
          Salida
        </Tab>
      </div>

      {tab === "now" && <LineupView event={event} />}
      {tab === "map" && <VenueMap />}
      {tab === "wall" && <PhotoWall photoCount={event.photoCount} />}
      {tab === "exit" && <ExitNps />}
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
    className="group relative inline-flex items-center gap-2 px-3 pb-3 pt-1 text-sm font-medium transition md:px-4"
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

const MiniStat = ({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) => (
  <div
    className="rounded-xl border border-border p-2.5"
    style={{ background: "rgba(255,255,255,0.04)" }}
  >
    <div
      className="inline-flex items-center gap-1 text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {icon}
      {label}
    </div>
    <div className="mt-0.5 text-sm font-bold text-foreground" style={mono}>
      {value}
    </div>
  </div>
);

// =============================================================
// Lineup view + Cashless wallet
// =============================================================

const LineupView = ({ event }: { event: LiveEvent }) => {
  const now = new Date();
  const { toast } = useToast();
  const [savedSets, setSavedSets] = useState<string[]>(() => readSavedSets());
  const [pingTick, setPingTick] = useState(0);

  const toggleSavedSet = (slot: { artist: string; stage: string }) => {
    const id = `${slot.artist}__${slot.stage}`;
    setSavedSets((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeSavedSets(next);
      toast(
        prev.includes(id)
          ? { title: "Set quitado", description: `${slot.artist} ya no esta en tus sets guardados.` }
          : { title: "Set guardado", description: `${slot.artist} · ${slot.stage} guardado en tus sets.` },
      );
      return next;
    });
  };
  useEffect(() => {
    const id = window.setInterval(() => setPingTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  void pingTick;

  const sorted = [...event.lineup].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find "playing now"
  const playingIdx = sorted.findIndex((slot, i) => {
    const nextStart = sorted[i + 1]?.start ?? event.endsAt;
    return slot.start <= now && nextStart > now;
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* Lineup timeline */}
      <section
        className="rounded-2xl border border-border bg-card p-5 md:p-6"
        style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
      >
        <div className="mb-4">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <Music className="h-3 w-3" />
            Line-up de la noche
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Programación en vivo
          </h3>
        </div>

        <ol className="relative space-y-3 border-l border-border pl-5">
          {sorted.map((slot, i) => {
            const isPast = slot.start < now && i !== playingIdx;
            const isLive = i === playingIdx;
            const dotColor = isLive ? "#4DB87A" : isPast ? "#5C544A" : "#E8542A";
            return (
              <li key={i} className="relative">
                <span
                  className="absolute -left-[27px] top-2 inline-block h-3 w-3 rounded-full border-2"
                  style={{
                    background: isPast ? "transparent" : dotColor,
                    borderColor: dotColor,
                    boxShadow: isLive ? `0 0 14px ${dotColor}AA` : "none",
                  }}
                />
                <div
                  className="rounded-2xl border p-3"
                  style={{
                    background: isLive ? "rgba(77,184,122,0.08)" : "rgba(255,255,255,0.02)",
                    borderColor: isLive ? "rgba(77,184,122,0.45)" : "rgba(244,238,226,0.08)",
                    opacity: isPast ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] uppercase"
                        style={{ ...mono, letterSpacing: "0.18em", color: isLive ? "#4DB87A" : "#8A8275" }}
                      >
                        {format(slot.start, "HH:mm", { locale: es })}h
                      </span>
                      {isLive && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.16em",
                            background: "rgba(77,184,122,0.2)",
                            color: "#4DB87A",
                          }}
                        >
                          Ahora suena
                        </span>
                      )}
                      {slot.headliner && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px] uppercase"
                          style={{
                            ...mono,
                            letterSpacing: "0.16em",
                            background: "rgba(232,84,42,0.18)",
                            color: "#FF7A4D",
                          }}
                        >
                          Headliner
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      {slot.stage}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-foreground md:text-base">
                    {slot.artist}
                  </div>
                  {isLive && (() => {
                    const isSaved = savedSets.includes(`${slot.artist}__${slot.stage}`);
                    return (
                      <Button
                        size="sm"
                        variant={isSaved ? "default" : "outline"}
                        className="mt-3"
                        onClick={() => toggleSavedSet(slot)}
                        aria-pressed={isSaved}
                      >
                        <Heart
                          className="mr-1.5 h-3.5 w-3.5"
                          fill={isSaved ? "currentColor" : "none"}
                        />
                        {isSaved ? "Set guardado" : "Guardar set"}
                      </Button>
                    );
                  })()}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Cashless wallet panel */}
      <CashlessPanel event={event} />
    </div>
  );
};

const CashlessPanel = ({ event }: { event: LiveEvent }) => {
  const [balance, setBalance] = useState(event.wallet.balanceCents);
  const lastConsumption = event.wallet.lastConsumption;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(70px)" }}
      />

      <div className="relative">
        <div
          className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.2em" }}
        >
          <CreditCard className="h-3 w-3" />
          Pasify Cashless · Tu pulsera
        </div>
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Pagas en barra con un <span style={serif} className="text-orange-500">tap</span>
        </h3>
      </div>

      {/* Wallet card */}
      <div
        className="relative mt-5 overflow-hidden rounded-2xl p-5 text-white"
        style={{
          background:
            "linear-gradient(135deg, #FF7A4D 0%, #E8542A 50%, #B8381A 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.25), 0 12px 30px -10px rgba(232,84,42,0.55)",
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
        <div className="relative flex items-start justify-between">
          <div>
            <div
              className="text-[10px] uppercase"
              style={{ ...mono, letterSpacing: "0.2em", color: "rgba(255,255,255,0.8)" }}
            >
              Saldo disponible
            </div>
            <div className="mt-1 text-4xl font-bold tracking-tight md:text-5xl" style={mono}>
              {(balance / 100).toFixed(2)}€
            </div>
          </div>
          <div
            className="grid h-10 w-10 place-items-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            <Radio className="h-5 w-5" />
          </div>
        </div>
        <div
          className="mt-4 text-[10px] uppercase"
          style={{ ...mono, letterSpacing: "0.22em", color: "rgba(255,255,255,0.7)" }}
        >
          WB-{event.id.slice(-6).toUpperCase()} · NFC activado
        </div>
      </div>

      {/* Top up + last */}
      <div className="relative mt-5 grid grid-cols-3 gap-2">
        {[10, 20, 50].map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => setBalance((b) => b + amount * 100)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-bold text-foreground transition hover:border-orange-500/40 hover:text-orange-500"
            style={mono}
          >
            +{amount}€
          </button>
        ))}
      </div>

      {/* Last consumption */}
      {lastConsumption && (
        <div className="relative mt-5 rounded-2xl border border-border p-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div
            className="text-[10px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            Último consumo
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{ background: "rgba(232,84,42,0.18)", color: "#FF7A4D" }}
              >
                <Wine className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">{lastConsumption.name}</div>
                <div
                  className="text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.16em" }}
                >
                  Hace 18 min · Barra 2
                </div>
              </div>
            </div>
            <div className="text-sm font-bold text-foreground" style={mono}>
              −{(lastConsumption.cents / 100).toFixed(2)}€
            </div>
          </div>
        </div>
      )}

      <div
        className="relative mt-4 inline-flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        <Sparkles className="h-3 w-3" />
        El saldo no consumido se reembolsa al cierre del evento
      </div>
    </section>
  );
};

// =============================================================
// Venue map · interactivo · zonas live · 2 plantas
// =============================================================

type ZoneId =
  | "dj_stage"
  | "sala_principal"
  | "barra_1"
  | "barra_2"
  | "vip"
  | "baños"
  | "entrada"
  | "pool_side"
  | "chill_lounge"
  | "rooftop_bar";

type FloorId = "planta_principal" | "rooftop";

interface VenueZone {
  id: ZoneId;
  floor: FloorId;
  label: string;
  short: string;
  icon: React.ReactNode;
  capacityPct: number; // 0-100
  queueMin: number;
  distanceM: number;
  vibe: 1 | 2 | 3 | 4 | 5;
  tip: string;
  // SVG geometry (viewBox 400x260)
  shape: { x: number; y: number; w: number; h: number; rx: number };
  accent: string;
  glow: string;
}

const ZONES: VenueZone[] = [
  {
    id: "dj_stage",
    floor: "planta_principal",
    label: "DJ Stage",
    short: "Stage",
    icon: <Music className="h-3.5 w-3.5" />,
    capacityPct: 92,
    queueMin: 0,
    distanceM: 18,
    vibe: 5,
    tip: "Dani López en headliner. La pista revienta hasta las 04:00.",
    shape: { x: 80, y: 30, w: 160, h: 22, rx: 8 },
    accent: "#FF7A4D",
    glow: "rgba(232,84,42,0.55)",
  },
  {
    id: "sala_principal",
    floor: "planta_principal",
    label: "Sala Principal",
    short: "Pista",
    icon: <Music className="h-3.5 w-3.5" />,
    capacityPct: 78,
    queueMin: 0,
    distanceM: 8,
    vibe: 5,
    tip: "Densidad alta cerca del DJ. Lateral derecho aún tiene aire.",
    shape: { x: 50, y: 60, w: 220, h: 130, rx: 16 },
    accent: "#E8542A",
    glow: "rgba(232,84,42,0.35)",
  },
  {
    id: "barra_1",
    floor: "planta_principal",
    label: "Barra 1 · Cócteles",
    short: "Barra 1",
    icon: <Wine className="h-3.5 w-3.5" />,
    capacityPct: 55,
    queueMin: 3,
    distanceM: 14,
    vibe: 4,
    tip: "Sin cola larga. El mejor mojito está aquí.",
    shape: { x: 58, y: 200, w: 95, h: 30, rx: 8 },
    accent: "#E8B04C",
    glow: "rgba(232,176,76,0.4)",
  },
  {
    id: "barra_2",
    floor: "planta_principal",
    label: "Barra 2 · Long drinks",
    short: "Barra 2",
    icon: <GlassWater className="h-3.5 w-3.5" />,
    capacityPct: 84,
    queueMin: 8,
    distanceM: 22,
    vibe: 3,
    tip: "Cola larga. Si no urgent, prueba Barra 1.",
    shape: { x: 168, y: 200, w: 95, h: 30, rx: 8 },
    accent: "#E8B04C",
    glow: "rgba(232,176,76,0.4)",
  },
  {
    id: "vip",
    floor: "planta_principal",
    label: "VIP Lounge",
    short: "VIP",
    icon: <Star className="h-3.5 w-3.5" />,
    capacityPct: 42,
    queueMin: 0,
    distanceM: 28,
    vibe: 4,
    tip: "Acceso con pulsera. Mesas reservadas disponibles.",
    shape: { x: 290, y: 60, w: 80, h: 100, rx: 14 },
    accent: "#B8381A",
    glow: "rgba(184,56,26,0.45)",
  },
  {
    id: "baños",
    floor: "planta_principal",
    label: "Baños",
    short: "Baños",
    icon: <Toilet className="h-3.5 w-3.5" />,
    capacityPct: 34,
    queueMin: 2,
    distanceM: 24,
    vibe: 3,
    tip: "Cola corta. Aforo bajo ahora.",
    shape: { x: 290, y: 170, w: 80, h: 28, rx: 8 },
    accent: "#C9BFA8",
    glow: "rgba(244,238,226,0.25)",
  },
  {
    id: "entrada",
    floor: "planta_principal",
    label: "Entrada · Guardarropa",
    short: "Entrada",
    icon: <DoorOpen className="h-3.5 w-3.5" />,
    capacityPct: 18,
    queueMin: 0,
    distanceM: 32,
    vibe: 2,
    tip: "Guardarropa abierto hasta las 04:30.",
    shape: { x: 290, y: 208, w: 80, h: 28, rx: 8 },
    accent: "#4DB87A",
    glow: "rgba(77,184,122,0.4)",
  },
  // Rooftop floor
  {
    id: "pool_side",
    floor: "rooftop",
    label: "Pool Side",
    short: "Pool",
    icon: <Waves className="h-3.5 w-3.5" />,
    capacityPct: 65,
    queueMin: 5,
    distanceM: 42,
    vibe: 4,
    tip: "Carla Set ahora. Vibe sunset + ambient.",
    shape: { x: 50, y: 50, w: 200, h: 100, rx: 18 },
    accent: "#3B82F6",
    glow: "rgba(59,130,246,0.45)",
  },
  {
    id: "chill_lounge",
    floor: "rooftop",
    label: "Chill Lounge",
    short: "Chill",
    icon: <Coffee className="h-3.5 w-3.5" />,
    capacityPct: 38,
    queueMin: 0,
    distanceM: 50,
    vibe: 3,
    tip: "Zona tranquila. Buena para charlar.",
    shape: { x: 50, y: 165, w: 130, h: 60, rx: 14 },
    accent: "#A78BFA",
    glow: "rgba(167,139,250,0.4)",
  },
  {
    id: "rooftop_bar",
    floor: "rooftop",
    label: "Sky Bar",
    short: "Sky Bar",
    icon: <Wine className="h-3.5 w-3.5" />,
    capacityPct: 72,
    queueMin: 6,
    distanceM: 46,
    vibe: 5,
    tip: "Vista mar. Cócteles premium con DJ ambient.",
    shape: { x: 200, y: 165, w: 165, h: 60, rx: 14 },
    accent: "#E8B04C",
    glow: "rgba(232,176,76,0.45)",
  },
];

const FLOOR_LABEL: Record<FloorId, string> = {
  planta_principal: "Planta principal",
  rooftop: "Rooftop · Pool Side",
};

// User position per floor (anchor inside the SVG)
const USER_POS: Record<FloorId, { x: number; y: number }> = {
  planta_principal: { x: 160, y: 175 },
  rooftop: { x: 150, y: 120 },
};

const VenueMap = () => {
  const { toast } = useToast();
  const [floor, setFloor] = useState<FloorId>("planta_principal");
  const [selectedId, setSelectedId] = useState<ZoneId>("sala_principal");
  const [showHeatmap, setShowHeatmap] = useState(true);
  /* Navegacion interior real: el marcador del usuario recorre el camino
     hasta la zona elegida. Antes el CTA "Llevarme aqui" no tenia onClick
     (Guideline 2.1(a) — controles que no responden al toque). */
  const [userPos, setUserPos] = useState(USER_POS["planta_principal"]);
  const [navState, setNavState] = useState<"idle" | "walking" | "arrived">("idle");

  // Al cambiar de planta, el usuario vuelve a su ancla y se cancela la ruta
  useEffect(() => {
    setUserPos(USER_POS[floor]);
    setNavState("idle");
  }, [floor]);

  // Cambiar de zona cancela la ruta en curso
  useEffect(() => {
    setNavState("idle");
  }, [selectedId]);

  // ensure selectedId is on current floor
  useEffect(() => {
    const z = ZONES.find((x) => x.id === selectedId);
    if (!z || z.floor !== floor) {
      const first = ZONES.find((x) => x.floor === floor);
      if (first) setSelectedId(first.id);
    }
  }, [floor, selectedId]);

  const floorZones = ZONES.filter((z) => z.floor === floor);
  const selected = ZONES.find((z) => z.id === selectedId) ?? floorZones[0];
  const user = userPos;

  const walkTo = (zone: VenueZone) => {
    if (navState === "walking") return;
    const from = userPos;
    const to = { x: zone.shape.x + zone.shape.w / 2, y: zone.shape.y + zone.shape.h / 2 };
    setNavState("walking");
    const steps = 28;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      const t = i / steps;
      setUserPos({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      if (i >= steps) {
        window.clearInterval(id);
        setNavState("arrived");
        toast({
          title: `Has llegado a ${zone.label}`,
          description: `${zone.distanceM} m recorridos · ${zone.tip}`,
        });
      }
    }, 45);
  };

  // Recommendation (lowest cost = queue + distance + capacity penalty)
  const recommendedBarId: ZoneId | null = useMemo(() => {
    const bars = ZONES.filter((z) => z.id === "barra_1" || z.id === "barra_2" || z.id === "rooftop_bar");
    if (bars.length === 0) return null;
    return bars
      .map((b) => ({ id: b.id, cost: b.queueMin * 1.6 + b.distanceM * 0.06 + b.capacityPct * 0.04 }))
      .sort((a, b) => a.cost - b.cost)[0].id;
  }, []);

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 md:p-5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            <MapPin className="h-3 w-3" />
            Mapa interior · live
          </div>
          <h3 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">
            Pacha · {FLOOR_LABEL[floor]}
          </h3>
          <div
            className="mt-1 inline-flex items-center gap-2 text-[10.5px] text-muted-foreground"
            style={mono}
          >
            <Activity className="h-3 w-3" />
            Actualizado hace 4s · {floorZones.length} zonas
          </div>
        </div>

        {/* Floor switcher + heatmap toggle */}
        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center gap-1 rounded-full border p-1"
            style={{ borderColor: "rgba(244,238,226,0.08)", background: "rgba(255,255,255,0.02)" }}
          >
            {(["planta_principal", "rooftop"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFloor(f)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] uppercase transition"
                style={{
                  ...mono,
                  letterSpacing: "0.14em",
                  background: floor === f ? "rgba(232,84,42,0.16)" : "transparent",
                  color: floor === f ? "#FF7A4D" : "#8A8275",
                  border: floor === f ? "1px solid rgba(232,84,42,0.4)" : "1px solid transparent",
                }}
              >
                <Layers className="h-3 w-3" />
                {f === "planta_principal" ? "P1" : "Rooftop"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border transition"
            style={{
              borderColor: showHeatmap ? "rgba(232,84,42,0.4)" : "rgba(244,238,226,0.08)",
              background: showHeatmap ? "rgba(232,84,42,0.10)" : "transparent",
              color: showHeatmap ? "#FF7A4D" : "#8A8275",
            }}
            aria-label="Toggle heatmap"
            title={showHeatmap ? "Ocultar heatmap" : "Mostrar heatmap"}
          >
            {showHeatmap ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Layout: map + side info panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* MAP */}
        <div
          className="relative overflow-hidden rounded-2xl border"
          style={{
            borderColor: "rgba(244,238,226,0.08)",
            background:
              "radial-gradient(120% 90% at 30% 20%, rgba(232,84,42,0.10) 0%, transparent 55%), radial-gradient(80% 60% at 80% 90%, rgba(167,139,250,0.10) 0%, transparent 60%), #0E0C0A",
            maxHeight: 360,
            aspectRatio: "16 / 11",
          }}
        >
          {/* grain */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.20 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
              mixBlendMode: "overlay",
              opacity: 0.5,
            }}
          />

          <svg viewBox="0 0 400 260" className="h-full w-full">
            <defs>
              {/* glow filter */}
              <filter id="zoneGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* grid pattern */}
              <pattern id="floorGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(244,238,226,0.04)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* Floor grid background */}
            <rect width="400" height="260" fill="url(#floorGrid)" />

            {/* Density heatmap (soft blobs per zone, intensity = capacityPct) */}
            {showHeatmap &&
              floorZones.map((z) => {
                const cx = z.shape.x + z.shape.w / 2;
                const cy = z.shape.y + z.shape.h / 2;
                const r = Math.max(z.shape.w, z.shape.h) * 0.55;
                const opacity = 0.04 + (z.capacityPct / 100) * 0.14;
                return (
                  <circle
                    key={`heat-${z.id}`}
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={z.accent}
                    opacity={opacity}
                    filter="url(#zoneGlow)"
                  />
                );
              })}

            {/* Zones */}
            {floorZones.map((z) => {
              const isActive = z.id === selected?.id;
              const isRecommended = z.id === recommendedBarId;
              return (
                <g
                  key={z.id}
                  onClick={() => setSelectedId(z.id)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Glow ring when active */}
                  {isActive && (
                    <rect
                      x={z.shape.x - 3}
                      y={z.shape.y - 3}
                      width={z.shape.w + 6}
                      height={z.shape.h + 6}
                      rx={z.shape.rx + 3}
                      fill="none"
                      stroke={z.accent}
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                      opacity="0.85"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="12"
                        dur="0.8s"
                        repeatCount="indefinite"
                      />
                    </rect>
                  )}
                  <rect
                    x={z.shape.x}
                    y={z.shape.y}
                    width={z.shape.w}
                    height={z.shape.h}
                    rx={z.shape.rx}
                    fill={
                      isActive
                        ? `${z.accent}33`
                        : `${z.accent}1A`
                    }
                    stroke={isActive ? z.accent : `${z.accent}88`}
                    strokeWidth={isActive ? 1.5 : 1}
                    style={{ transition: "all .25s ease" }}
                  />
                  {/* Zone label */}
                  <text
                    x={z.shape.x + z.shape.w / 2}
                    y={z.shape.y + z.shape.h / 2 + 3}
                    textAnchor="middle"
                    fill={isActive ? "#fff" : z.accent}
                    fontSize={z.shape.w < 100 ? 8.5 : 10}
                    fontFamily="'Geist Mono', monospace"
                    letterSpacing="1.6"
                    fontWeight={isActive ? 600 : 500}
                  >
                    {z.short.toUpperCase()}
                  </text>
                  {/* Recommended star */}
                  {isRecommended && (
                    <g>
                      <circle
                        cx={z.shape.x + z.shape.w - 8}
                        cy={z.shape.y + 8}
                        r="5"
                        fill="#4DB87A"
                      />
                      <text
                        x={z.shape.x + z.shape.w - 8}
                        y={z.shape.y + 10.5}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="7"
                        fontFamily="'Geist Mono', monospace"
                        fontWeight="700"
                      >
                        ★
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Path from user to selected zone */}
            {selected && (
              <line
                x1={user.x}
                y1={user.y}
                x2={selected.shape.x + selected.shape.w / 2}
                y2={selected.shape.y + selected.shape.h / 2}
                stroke={selected.accent}
                strokeWidth="1.5"
                strokeDasharray="2 4"
                opacity="0.65"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="0"
                  to="-12"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </line>
            )}

            {/* User position */}
            <g>
              <circle cx={user.x} cy={user.y} r="9" fill="rgba(232,84,42,0.18)">
                <animate attributeName="r" from="9" to="18" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={user.x} cy={user.y} r="5" fill="#fff" stroke="#FF7A4D" strokeWidth="2" />
              <text
                x={user.x}
                y={user.y + 17}
                textAnchor="middle"
                fill="#FF7A4D"
                fontSize="7"
                fontFamily="'Geist Mono', monospace"
                letterSpacing="1.4"
                fontWeight="700"
              >
                TÚ
              </text>
            </g>

            {/* Compass north */}
            <g transform="translate(370,18)" opacity="0.55">
              <circle r="10" fill="none" stroke="rgba(244,238,226,0.18)" strokeWidth="0.5" />
              <path d="M0,-6 L2.5,3 L0,1 L-2.5,3 Z" fill="#FF7A4D" />
              <text y="-12" textAnchor="middle" fill="#8A8275" fontSize="6.5" fontFamily="'Geist Mono', monospace" letterSpacing="1.2">N</text>
            </g>
          </svg>

          {/* Bottom legend */}
          <div
            className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between text-[9px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.18em" }}
          >
            <div className="flex items-center gap-2 rounded-md px-2 py-1" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Recomendado
            </div>
            {showHeatmap && (
              <div className="flex items-center gap-2 rounded-md px-2 py-1" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>
                <span>Aforo</span>
                <span className="inline-block h-2 w-12 rounded-full" style={{ background: "linear-gradient(90deg, rgba(232,84,42,0.1), rgba(232,84,42,0.95))" }} />
              </div>
            )}
          </div>
        </div>

        {/* SIDE PANEL — selected zone info */}
        {selected && (
          <div
            className="flex flex-col gap-3 rounded-2xl border p-4"
            style={{
              borderColor: `${selected.accent}40`,
              background: `linear-gradient(160deg, ${selected.accent}10 0%, rgba(11,9,8,0.6) 70%)`,
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                style={{ background: `${selected.accent}22`, color: selected.accent }}
              >
                {selected.icon}
              </div>
              <div className="min-w-0">
                <div
                  className="text-[10px] uppercase"
                  style={{ ...mono, letterSpacing: "0.18em", color: selected.accent }}
                >
                  Zona seleccionada
                </div>
                <div className="truncate text-base font-semibold tracking-tight text-foreground">
                  {selected.label}
                </div>
              </div>
            </div>

            {/* Live metrics */}
            <div className="grid grid-cols-3 gap-2">
              <ZoneMetric
                label="Aforo"
                value={`${selected.capacityPct}%`}
                bar={selected.capacityPct}
                barColor={selected.accent}
                icon={<Gauge className="h-3 w-3" />}
              />
              <ZoneMetric
                label="Cola"
                value={selected.queueMin === 0 ? "0 min" : `${selected.queueMin} min`}
                bar={Math.min(selected.queueMin * 10, 100)}
                barColor={selected.queueMin === 0 ? "#4DB87A" : selected.queueMin <= 4 ? "#E8B04C" : "#FF7A4D"}
                icon={<Clock className="h-3 w-3" />}
              />
              <ZoneMetric
                label="Distancia"
                value={`${selected.distanceM} m`}
                bar={Math.min(selected.distanceM * 2, 100)}
                barColor="#A78BFA"
                icon={<Footprints className="h-3 w-3" />}
              />
            </div>

            {/* Vibe */}
            <div
              className="flex items-center justify-between rounded-xl border px-3 py-2"
              style={{ borderColor: "rgba(244,238,226,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              <div
                className="inline-flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                <Activity className="h-3 w-3" />
                Vibe
              </div>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-2 w-3 rounded-sm"
                    style={{
                      background: i <= selected.vibe ? selected.accent : "rgba(244,238,226,0.06)",
                      boxShadow: i <= selected.vibe ? `0 0 6px ${selected.glow}` : "none",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Tip */}
            <div
              className="rounded-xl border px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground"
              style={{ borderColor: "rgba(244,238,226,0.06)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="mb-1 inline-flex items-center gap-1.5 text-[9.5px] uppercase" style={{ ...mono, letterSpacing: "0.2em", color: selected.accent }}>
                <Info className="h-3 w-3" />
                Recomendación Pasify
              </div>
              {selected.tip}
            </div>

            {/* CTA navigate */}
            <button
              type="button"
              onClick={() => walkTo(selected)}
              disabled={navState === "walking"}
              aria-live="polite"
              className="group inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-semibold transition disabled:opacity-70"
              style={{
                background: `linear-gradient(180deg, ${selected.accent} 0%, ${selected.accent}DD 60%, ${selected.accent}AA 100%)`,
                color: "#fff",
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 22px -10px ${selected.glow}`,
              }}
            >
              <Navigation
                className={`h-3.5 w-3.5 transition group-hover:translate-x-0.5 ${
                  navState === "walking" ? "animate-pulse" : ""
                }`}
              />
              {navState === "walking"
                ? `Yendo a ${selected.short}…`
                : navState === "arrived"
                  ? `Has llegado a ${selected.short}`
                  : `Llevarme aquí · ${selected.distanceM}m`}
            </button>
          </div>
        )}
      </div>

      {/* Zone chips (also clickable) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {floorZones.map((z) => {
          const active = z.id === selected?.id;
          return (
            <button
              key={z.id}
              type="button"
              onClick={() => setSelectedId(z.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] uppercase transition"
              style={{
                ...mono,
                letterSpacing: "0.14em",
                borderColor: active ? z.accent : "rgba(244,238,226,0.08)",
                background: active ? `${z.accent}1A` : "transparent",
                color: active ? z.accent : "#8A8275",
              }}
            >
              {z.icon}
              {z.short}
              {z.queueMin > 0 && (
                <span
                  className="ml-0.5 rounded-full px-1 py-0.5 text-[9px]"
                  style={{
                    background: z.queueMin <= 4 ? "rgba(232,176,76,0.15)" : "rgba(232,84,42,0.18)",
                    color: z.queueMin <= 4 ? "#E8B04C" : "#FF7A4D",
                  }}
                >
                  {z.queueMin}m
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

const ZoneMetric = ({
  label,
  value,
  bar,
  barColor,
  icon,
}: {
  label: string;
  value: string;
  bar: number;
  barColor: string;
  icon: React.ReactNode;
}) => (
  <div
    className="rounded-xl border px-2.5 py-2"
    style={{ borderColor: "rgba(244,238,226,0.06)", background: "rgba(255,255,255,0.02)" }}
  >
    <div
      className="inline-flex items-center gap-1 text-[9px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {icon}
      {label}
    </div>
    <div className="mt-1 text-sm font-bold text-foreground" style={mono}>
      {value}
    </div>
    <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "rgba(244,238,226,0.06)" }}>
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.max(2, Math.min(100, bar))}%`,
          background: `linear-gradient(90deg, ${barColor}55 0%, ${barColor} 100%)`,
        }}
      />
    </div>
  </div>
);

// =============================================================
// Photo wall
// =============================================================

const PhotoWall = ({ photoCount }: { photoCount: number }) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /* Fotos que sube el usuario en esta sesion. Antes el boton "Subir" no
     tenia onClick y no abria nada (Guideline 2.1(a)). */
  const [myPhotos, setMyPhotos] = useState<string[]>([]);

  // Libera las object URLs SOLO al desmontar (con [myPhotos] revocaria
  // en cada cambio las URLs que siguen en uso y las fotos se romperian).
  const photosRef = useRef<string[]>([]);
  photosRef.current = myPhotos;
  useEffect(() => {
    return () => photosRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const tooBig = files.filter((f) => f.size > 10 * 1024 * 1024);
    const valid = files.filter((f) => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024);

    if (tooBig.length > 0) {
      toast({
        title: "Imagen demasiado grande",
        description: "El limite por foto es 10 MB.",
        variant: "destructive",
      });
    }

    if (valid.length > 0) {
      setMyPhotos((prev) => [...valid.map((f) => URL.createObjectURL(f)), ...prev]);
      toast({
        title: valid.length === 1 ? "Foto anadida" : `${valid.length} fotos anadidas`,
        description: "Ya aparecen en el muro de fotos del evento.",
      });
    }

    // Permite volver a elegir el mismo archivo
    e.target.value = "";
  };

  const cells = Array.from({ length: Math.max(0, 12 - myPhotos.length) });
  return (
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
            <Camera className="h-3 w-3" />
            Photo wall · {photoCount + myPhotos.length} fotos
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            Lo que la gente está subiendo
          </h3>
        </div>
        <Button size="sm" onClick={() => fileInputRef.current?.click()}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Subir
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePick}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4">
        {myPhotos.map((url) => (
          <div
            key={url}
            className="relative aspect-square overflow-hidden rounded-xl"
            style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)" }}
          >
            <img src={url} alt="Foto subida por ti" className="h-full w-full object-cover" />
            <div
              className="absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[8px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.16em",
                background: "rgba(232,84,42,0.85)",
                color: "#fff",
              }}
            >
              Tuya
            </div>
          </div>
        ))}
        {cells.map((_, i) => {
          const gradients = [
            "linear-gradient(135deg, #3D1F12 0%, #7A2A0F 50%, #E8542A 100%)",
            "linear-gradient(160deg, #16183C 0%, #3A2D6B 60%, #9B5BC9 100%)",
            "linear-gradient(140deg, #0B2618 0%, #1F4D2C 50%, #56B36C 100%)",
            "linear-gradient(135deg, #1A0F08 0%, #B8381A 100%)",
          ];
          const isYours = i === 2 || i === 7;
          return (
            <div
              key={i}
              className="group/photo relative aspect-square overflow-hidden rounded-xl"
              style={{
                background: gradients[i % gradients.length],
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)",
              }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-25"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                  mixBlendMode: "overlay",
                }}
              />
              {isYours && (
                <span
                  className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] uppercase backdrop-blur-md"
                  style={{
                    ...mono,
                    letterSpacing: "0.16em",
                    background: "rgba(10,10,10,0.55)",
                    color: "#FF7A4D",
                  }}
                >
                  Tuya
                </span>
              )}
              <ImageIcon className="absolute bottom-1.5 right-1.5 h-3 w-3 text-white/70" />
            </div>
          );
        })}
      </div>
    </section>
  );
};

// =============================================================
// Exit NPS
// =============================================================

const ExitNps = () => {
  const [picked, setPicked] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <section
        className="relative overflow-hidden rounded-2xl border p-6 text-center md:p-10"
        style={{
          background:
            "linear-gradient(135deg, rgba(77,184,122,0.15) 0%, rgba(77,184,122,0.04) 100%)",
          borderColor: "rgba(77,184,122,0.4)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full"
          style={{ background: "rgba(77,184,122,0.22)", filter: "blur(60px)" }}
        />
        <div className="relative mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white" style={{ background: "linear-gradient(180deg, #4DB87A 0%, #2D7A4F 100%)" }}>
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h3 className="relative text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          ¡Gracias!{" "}
          <span style={serif} className="text-emerald-500">
            Hasta pronto.
          </span>
        </h3>
        <p className="relative mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          El local recibe tu feedback al cierre. Tu saldo cashless restante se reembolsará en 24h a tu tarjeta.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card p-6 md:p-8"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)" }}
    >
      <div className="text-center">
        <div
          className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <DoorOpen className="h-3 w-3" />
          Saliendo · Pasify
        </div>
        <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
          ¿Cómo ha estado <span style={serif} className="text-orange-500">tu noche</span>?
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Una respuesta rápida ayuda al local a mejorar su próximo evento.
        </p>
      </div>

      <div className="mx-auto mt-7 grid max-w-md grid-cols-11 gap-1.5">
        {Array.from({ length: 11 }).map((_, i) => {
          const isSelected = picked === i;
          const color = i <= 6 ? "#B8381A" : i <= 8 ? "#E8B04C" : "#4DB87A";
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicked(i)}
              className="flex aspect-square items-center justify-center rounded-lg text-sm font-bold transition"
              style={{
                ...mono,
                background: isSelected
                  ? `linear-gradient(180deg, ${color}DD 0%, ${color} 100%)`
                  : "rgba(255,255,255,0.04)",
                color: isSelected ? "#fff" : "#C9BFA8",
                boxShadow: isSelected ? `0 0 12px ${color}66` : "none",
                border: isSelected ? "none" : "1px solid rgba(244,238,226,0.08)",
              }}
            >
              {i}
            </button>
          );
        })}
      </div>
      <div
        className="mx-auto mt-2 flex max-w-md items-center justify-between text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.16em" }}
      >
        <span className="inline-flex items-center gap-1">
          <Frown className="h-3 w-3" />
          Nada bien
        </span>
        <span className="inline-flex items-center gap-1">
          <Meh className="h-3 w-3" />
          Normal
        </span>
        <span className="inline-flex items-center gap-1">
          <Smile className="h-3 w-3" />
          Brutal
        </span>
      </div>

      {picked !== null && (
        <div className="mx-auto mt-6 max-w-md">
          <Input placeholder="Cuéntanos algo (opcional)…" className="h-11 rounded-xl" />
          <Button className="mt-3 w-full" onClick={() => setSubmitted(true)}>
            Enviar feedback
          </Button>
        </div>
      )}
    </section>
  );
};

export default ClientLiveExperience;
