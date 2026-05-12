import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  CalendarDays,
  List as ListIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { EventListCard } from "@/components/event/EventListCard";
import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
} from "date-fns";
import { es } from "date-fns/locale";

const serif = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const, fontWeight: 400 };

type Partner = {
  id: string;
  business_name: string | null;
  business_category: string | null;
  business_description: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  city: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
  status: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  discoteca: "Discoteca",
  bar: "Bar",
  club: "Club",
  sala: "Sala",
  festival: "Festival",
  rooftop: "Rooftop",
  beachclub: "Beach Club",
  otro: "Otro",
};

// === DEMO data per partner di esempio (id "demo-*") ===
const DEMO_PARTNERS: Record<string, Partner> = {
  "demo-1": { id: "demo-1", business_name: "Pacha Ibiza", business_category: "discoteca", business_description: "El club más icónico de Ibiza. House, techno y la mejor música electrónica desde 1973.", city: "Ibiza", avatar_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&h=600&fit=crop&auto=format" },
  "demo-2": { id: "demo-2", business_name: "Razzmatazz", business_category: "club", business_description: "5 salas, 1 noche. La sala de conciertos más versátil de Barcelona.", city: "Barcelona", avatar_url: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=1200&h=600&fit=crop&auto=format" },
  "demo-3": { id: "demo-3", business_name: "Teatro Kapital", business_category: "discoteca", business_description: "7 plantas, 7 ambientes. La macrodiscoteca de referencia de Madrid.", city: "Madrid", avatar_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=600&fit=crop&auto=format" },
  "demo-4": { id: "demo-4", business_name: "Sala Apolo", business_category: "sala", business_description: "Templo de la música indie y electrónica desde 1943.", city: "Barcelona", avatar_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200&h=600&fit=crop&auto=format" },
  "demo-5": { id: "demo-5", business_name: "Beach Club Estrella", business_category: "beachclub", business_description: "Pool, beats y atardeceres frente al Mediterráneo.", city: "Málaga", avatar_url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&h=600&fit=crop&auto=format" },
  "demo-6": { id: "demo-6", business_name: "Opium Mar", business_category: "rooftop", business_description: "El rooftop más glam de Barceloneta. Música, cocktails y vistas al mar.", city: "Barcelona", avatar_url: "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&h=600&fit=crop&auto=format" },
  "demo-7": { id: "demo-7", business_name: "Café Berlín", business_category: "bar", business_description: "Jazz, soul y funk en directo en pleno corazón de Madrid.", city: "Madrid", avatar_url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200&h=600&fit=crop&auto=format" },
  "demo-8": { id: "demo-8", business_name: "La Riviera", business_category: "sala", business_description: "Conciertos en directo de los artistas más grandes a orillas del Manzanares.", city: "Madrid", avatar_url: "https://images.unsplash.com/photo-1572276596237-5db2c3e16c5d?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1572276596237-5db2c3e16c5d?w=1200&h=600&fit=crop&auto=format" },
  "demo-9": { id: "demo-9", business_name: "Medusa Festival", business_category: "festival", business_description: "El festival electrónico más grande del sur de Europa.", city: "Valencia", avatar_url: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=200&h=200&fit=crop&auto=format", cover_image_url: "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=1200&h=600&fit=crop&auto=format" },
};

const demoEventsFor = (partner: Partner): EventRow[] => {
  const now = new Date();
  const base = (offsetDays: number, hour = 23) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const city = partner.city ?? "España";
  return [
    {
      id: `${partner.id}-e1`,
      title: "Saturday Night · Resident DJs",
      description: "Sesión con los residentes del club. Doors 23:30.",
      date_start: base(3, 23),
      city,
      price_cents: 1500,
      capacity: 800,
      tickets_sold: 234,
      image_url: partner.cover_image_url,
      status: "published",
    },
    {
      id: `${partner.id}-e2`,
      title: "Friday Vibes · Special Guest",
      description: "Guest internacional. Lista hasta las 01:30.",
      date_start: base(9, 23),
      city,
      price_cents: 2000,
      capacity: 1200,
      tickets_sold: 521,
      image_url: partner.cover_image_url,
      status: "published",
    },
    {
      id: `${partner.id}-e3`,
      title: "Halloween Edition",
      description: "Disfrázate y entra gratis antes de medianoche.",
      date_start: base(17, 22),
      city,
      price_cents: 1200,
      capacity: 1500,
      tickets_sold: 122,
      image_url: partner.cover_image_url,
      status: "published",
    },
    {
      id: `${partner.id}-e4`,
      title: "Closing Party",
      description: "Cierre de temporada con line-up sorpresa.",
      date_start: base(28, 23),
      city,
      price_cents: 2500,
      capacity: 1000,
      tickets_sold: 800,
      image_url: partner.cover_image_url,
      status: "published",
    },
  ];
};

const PublicPartnerPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "calendar">("list");
  const [monthCursor, setMonthCursor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);

      // Demo partner: usa dati hardcoded
      if (id.startsWith("demo-")) {
        const demo = DEMO_PARTNERS[id];
        if (demo) {
          setPartner(demo);
          setEvents(demoEventsFor(demo));
        }
        setLoading(false);
        return;
      }

      const { data: p } = await supabase
        .from("profiles")
        .select("id, business_name, business_category, business_description, city, avatar_url, cover_image_url")
        .eq("id", id)
        .maybeSingle();

      if (p) setPartner(p as Partner);

      const { data: ev } = await supabase
        .from("events")
        .select("id, title, description, date_start, city, price_cents, capacity, tickets_sold, image_url, status")
        .eq("partner_id", id)
        .eq("status", "published")
        .order("date_start", { ascending: true });
      setEvents((ev ?? []) as EventRow[]);
      setLoading(false);
    })();
  }, [id]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return events.filter((e) => new Date(e.date_start) >= new Date(now.setHours(0, 0, 0, 0)));
  }, [events]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    events.forEach((e) => {
      const k = format(new Date(e.date_start), "yyyy-MM-dd");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    });
    return map;
  }, [events]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground mb-4">Local no encontrado.</p>
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const initial = (partner.business_name?.[0] ?? "?").toUpperCase();
  const categoryLabel = partner.business_category ? CATEGORY_LABEL[partner.business_category] ?? partner.business_category : null;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Hero with cover */}
      <div className="relative">
        <div className="relative h-56 w-full overflow-hidden md:h-80">
          {partner.cover_image_url ? (
            <img src={partner.cover_image_url} alt={partner.business_name ?? ""} className="h-full w-full object-cover" />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background: "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
              }}
            />
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.1) 60%)" }}
          />
        </div>

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          style={{ marginTop: "env(safe-area-inset-top, 0px)" }}
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Avatar + info overlay */}
        <div className="relative -mt-16 mx-auto max-w-5xl px-4 md:-mt-24 md:px-6">
          <div className="flex items-end gap-4">
            <div
              className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 md:h-32 md:w-32"
              style={{
                background: partner.avatar_url ? "#0F0F0F" : "#E8542A",
                color: "#fff",
                fontWeight: 700,
                fontSize: 40,
                borderColor: "#F4EEE2",
              }}
            >
              {partner.avatar_url ? (
                <img src={partner.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="flex-1 pb-2">
              <h1 className="text-2xl font-bold leading-tight text-white drop-shadow md:text-4xl">
                {partner.business_name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/90">
                {categoryLabel && (
                  <Badge
                    variant="outline"
                    style={{ background: "rgba(232,84,42,0.95)", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
                  >
                    {categoryLabel}
                  </Badge>
                )}
                {partner.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {partner.city}
                  </span>
                )}
              </div>
            </div>
          </div>

          {partner.business_description && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {partner.business_description}
            </p>
          )}
        </div>
      </div>

      {/* Tabs — editorial style */}
      <div className="mx-auto mt-10 max-w-5xl px-4 md:px-6">
        <div className="mb-6 flex items-end justify-between gap-4 border-b border-border">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("list")}
              className="group relative inline-flex items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition"
              style={{ color: tab === "list" ? "#F4EEE2" : "#8A8275" }}
            >
              <ListIcon className="h-4 w-4" />
              Próximos eventos
              <span
                className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  ...monoFont,
                  letterSpacing: "0.08em",
                  background: tab === "list" ? "rgba(232,84,42,0.18)" : "rgba(255,255,255,0.06)",
                  color: tab === "list" ? "#FF7A4D" : "#8A8275",
                }}
              >
                {upcomingEvents.length.toString().padStart(2, "0")}
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-x-3 -bottom-px h-0.5 transition"
                style={{
                  background:
                    tab === "list"
                      ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)"
                      : "transparent",
                  boxShadow: tab === "list" ? "0 0 12px rgba(232,84,42,0.65)" : "none",
                }}
              />
            </button>
            <button
              onClick={() => setTab("calendar")}
              className="group relative inline-flex items-center gap-2 px-4 pb-3 pt-1 text-sm font-medium transition"
              style={{ color: tab === "calendar" ? "#F4EEE2" : "#8A8275" }}
            >
              <CalendarDays className="h-4 w-4" />
              Calendario
              <span
                aria-hidden="true"
                className="absolute inset-x-3 -bottom-px h-0.5 transition"
                style={{
                  background:
                    tab === "calendar"
                      ? "linear-gradient(90deg, #FF7A4D 0%, #E8542A 60%, #B8381A 100%)"
                      : "transparent",
                  boxShadow: tab === "calendar" ? "0 0 12px rgba(232,84,42,0.65)" : "none",
                }}
              />
            </button>
          </div>

          {tab === "list" && upcomingEvents.length > 0 && (
            <div
              className="hidden pb-3 text-[10px] uppercase text-muted-foreground sm:inline-flex sm:items-center sm:gap-2"
              style={{ ...monoFont, letterSpacing: "0.2em" }}
            >
              <span className="inline-block h-px w-6 bg-orange-500/60" />
              Próxima · {format(new Date(upcomingEvents[0].date_start), "d MMM · HH:mm", { locale: es })}h
            </div>
          )}
        </div>

        {tab === "list" && (
          <div className="space-y-4 pb-12">
            {upcomingEvents.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Aún no hay eventos publicados.
                </CardContent>
              </Card>
            ) : (
              upcomingEvents.map((e) => (
                <EventListCard key={e.id} event={e} partnerId={partner.id} partnerName={partner.business_name ?? undefined} />
              ))
            )}
          </div>
        )}

        {tab === "calendar" && (
          <div className="pb-12">
            <MonthGrid
              cursor={monthCursor}
              setCursor={setMonthCursor}
              eventsByDay={eventsByDay}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
            />

            {selectedDay && (
              <div className="mt-8 space-y-4">
                <div
                  className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                  style={{ ...monoFont, letterSpacing: "0.2em" }}
                >
                  <span className="inline-block h-px w-6 bg-orange-500/70" />
                  Día seleccionado
                </div>
                <h3 className="text-2xl font-semibold capitalize tracking-tight text-foreground">
                  {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
                </h3>
                {(eventsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? []).length === 0 ? (
                  <p
                    className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    Sin eventos este día.
                  </p>
                ) : (
                  (eventsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? []).map((e) => (
                    <EventListCard key={e.id} event={e} partnerId={partner.id} partnerName={partner.business_name ?? undefined} />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const monoFont = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

// =============================================================
// Sub-components
// =============================================================

const MonthGrid = ({
  cursor,
  setCursor,
  eventsByDay,
  selectedDay,
  setSelectedDay,
}: {
  cursor: Date;
  setCursor: (d: Date) => void;
  eventsByDay: Map<string, EventRow[]>;
  selectedDay: Date | null;
  setSelectedDay: (d: Date | null) => void;
}) => {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  const weekdayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const monthEventCount = Array.from(eventsByDay.entries()).reduce((acc, [k, list]) => {
    return isSameMonth(new Date(k), cursor) ? acc + list.length : acc;
  }, 0);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      {/* Soft terracota glow top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
      />

      {/* Header */}
      <div className="relative mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...monoFont, letterSpacing: "0.2em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Agenda · {monthEventCount.toString().padStart(2, "0")} eventos
          </div>
          <div className="truncate text-xl font-semibold capitalize tracking-tight text-foreground md:text-2xl">
            {format(cursor, "MMMM", { locale: es })}{" "}
            <span className="text-muted-foreground/80" style={monoFont}>
              {format(cursor, "yyyy")}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="hidden rounded-full border border-border px-3 py-1.5 text-[10px] uppercase text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground sm:inline-flex"
            style={{ ...monoFont, letterSpacing: "0.18em" }}
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div
        className="relative mb-2 grid grid-cols-7 gap-1.5 border-b border-border pb-2 text-center text-[10px] uppercase text-muted-foreground md:gap-2"
        style={{ ...monoFont, letterSpacing: "0.18em" }}
      >
        {weekdayLabels.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="relative mt-3 grid grid-cols-7 gap-1.5 md:gap-2">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const hasEvents = dayEvents.length > 0;
          const isSelected = !!(selectedDay && isSameDay(selectedDay, day));
          const isToday = isSameDay(day, new Date());
          const previewImage = hasEvents ? dayEvents[0].image_url : null;

          // Cell base styling — only used when no image (fallback)
          let bg = "transparent";
          let borderColor = "transparent";
          let textColor = inMonth ? "#F4EEE2" : "rgba(244,238,226,0.25)";
          let shadow = "none";

          if (isSelected && !previewImage) {
            bg = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";
            textColor = "#fff";
            shadow =
              "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px -10px rgba(232,84,42,0.7)";
          } else if (hasEvents && !previewImage) {
            bg = "rgba(232,84,42,0.08)";
            borderColor = "rgba(232,84,42,0.35)";
          } else if (hasEvents && previewImage) {
            // Image cell — border tone changes based on selection
            borderColor = isSelected ? "rgba(232,84,42,0.85)" : "rgba(232,84,42,0.35)";
            textColor = "#fff";
            if (isSelected) {
              shadow = "0 12px 30px -10px rgba(232,84,42,0.65), inset 0 1px 0 rgba(255,255,255,0.25)";
            }
          }

          return (
            <button
              key={key}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className="group/day relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl text-sm transition duration-200 hover:scale-[1.03] disabled:cursor-default"
              style={{
                background: bg,
                border: `1px solid ${borderColor}`,
                boxShadow: shadow,
                color: textColor,
              }}
              disabled={!inMonth}
            >
              {/* Event poster thumbnail */}
              {hasEvents && previewImage && (
                <>
                  <img
                    src={previewImage}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover/day:scale-110"
                    loading="lazy"
                  />
                  {/* Tint overlay — terracota wash if selected, dark gradient otherwise */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{
                      background: isSelected
                        ? "linear-gradient(165deg, rgba(255,122,77,0.78) 0%, rgba(232,84,42,0.82) 45%, rgba(184,56,26,0.88) 100%)"
                        : "linear-gradient(180deg, rgba(10,10,10,0.20) 0%, rgba(10,10,10,0.55) 55%, rgba(10,10,10,0.85) 100%)",
                    }}
                  />
                </>
              )}

              {/* "Today" amber dot */}
              {isToday && !isSelected && (
                <span
                  className="absolute right-1.5 top-1.5 z-10 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "#E8B04C", boxShadow: "0 0 8px #E8B04C" }}
                  aria-label="Hoy"
                />
              )}

              {/* Day number */}
              <span
                className={`relative z-[1] text-base font-semibold leading-none md:text-lg`}
                style={{
                  ...monoFont,
                  letterSpacing: isSelected ? "-0.02em" : undefined,
                  textShadow: hasEvents && previewImage ? "0 1px 6px rgba(0,0,0,0.7)" : undefined,
                  color: textColor,
                }}
              >
                {format(day, "d")}
              </span>

              {/* Event count badge for multi-event days */}
              {hasEvents && dayEvents.length > 1 && (
                <span
                  className="absolute right-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
                  style={{
                    ...monoFont,
                    background: isSelected ? "rgba(255,255,255,0.95)" : "rgba(232,84,42,0.95)",
                    color: isSelected ? "#B8381A" : "#fff",
                    boxShadow: "0 4px 10px -3px rgba(0,0,0,0.4)",
                  }}
                >
                  {dayEvents.length}
                </span>
              )}

              {/* Subtle dots at bottom — only when no image fallback */}
              {hasEvents && !previewImage && !isSelected && (
                <span
                  className="absolute bottom-1.5 inline-flex items-center gap-0.5"
                  aria-hidden="true"
                >
                  {Array.from({ length: Math.min(3, dayEvents.length) }).map((_, i) => (
                    <span
                      key={i}
                      className="inline-block h-1 w-1 rounded-full"
                      style={{
                        background: "#E8542A",
                        boxShadow: "0 0 6px rgba(232,84,42,0.65)",
                      }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PublicPartnerPage;
