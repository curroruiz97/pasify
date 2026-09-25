import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin, ChevronDown, Sparkles, LayoutGrid, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useCalendarEvents, useInvalidateEvents, type CalendarEvent } from "@/hooks/useEvents";
import EventPosterCard from "@/components/calendar/EventPosterCard";
import MonthCalendarView from "@/components/calendar/MonthCalendarView";
import CitySelector from "@/components/shared/CitySelector";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AnimatedMarqueeHero } from "@/components/ui/hero-3";
import { useToast } from "@/hooks/use-toast";
import { useTicketCheckout } from "@/hooks/useTicketCheckout";
import { TODA_ESPANA, useCiudadElegida } from "@/hooks/queries/clientData";
import { loginPathWithNext } from "@/lib/eventLinks";

// Stable empty array — usado como fallback cuando react-query aún no tiene
// data, así el useEffect que depende de `events` no se re-dispara por un
// `[]` literal nuevo en cada render.
const EMPTY_EVENTS: CalendarEvent[] = [];

// Temporary placeholder images for the hero marquee. The user will swap
// these for real Spanish party flyers — keep them here as a single source
// of truth so the swap is a one-line change.
const HERO_MARQUEE_IMAGES = [
  "https://images.unsplash.com/photo-1756312148347-611b60723c7a?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1757865579201-693dd2080c73?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1756786605218-28f7dd95a493?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1757519740947-eef07a74c4ab?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1757263005786-43d955f07fb1?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1757207445614-d1e12b8f753e?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1757269746970-dc477517268f?w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1755119902709-a53513bcbedc?w=900&auto=format&fit=crop",
];

const Calendar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  // /calendar?event=<id>: vuelta del login tras pulsar "Comprar" sin sesión
  // (y enlaces antiguos). Resaltamos esa tarjeta y la acercamos en cuanto
  // carga la lista. Los enlaces compartidos (/e/:id) ya abren la página del
  // evento, que no depende de la ciudad elegida.
  const focusEventId = searchParams.get("event");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Una sola ciudad para toda la app (B2-10): la del perfil del cliente o,
  // sin sesión, la del dispositivo. null = «Toda España». Cambiarla aquí
  // cambia también la de Inicio (y la del perfil). Antes el calendario tenía
  // la suya propia en localStorage, con Valladolid por defecto y países fuera
  // de España.
  const { ciudad: selectedCity, cambiarCiudad } = useCiudadElegida();
  const [citySelectorOpen, setCitySelectorOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [view, setView] = useState<"posters" | "calendar">(
    () => (localStorage.getItem("calendar_view") as "posters" | "calendar") || "posters"
  );

  const setViewPersist = (v: "posters" | "calendar") => {
    setView(v);
    localStorage.setItem("calendar_view", v);
  };

  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [participatingIds, setParticipatingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setIsAuthed(!!session);
      setAuthedUserId(uid);
    });
  }, []);

  const { data: eventsData, isLoading } = useCalendarEvents(selectedCity);
  // Misma lista (misma caché), sin filtrar por ciudad: para el ?event= de abajo.
  const { data: todosLosEventos } = useCalendarEvents(null);
  // Estabilizamos la referencia de events: si data llega undefined (durante el
  // primer fetch), devolvemos siempre el MISMO array vacío para que el
  // useEffect que depende de `events` no caiga en loop por cambio de
  // referencia. Es la misma técnica que usa react-query con su cache interna.
  // Con ?event= (vuelta del login tras «Comprar»), ese evento sale aunque sea
  // de otra ciudad: la del perfil puede no ser la que se miraba sin sesión.
  const events = useMemo(() => {
    const lista = eventsData ?? EMPTY_EVENTS;
    if (!focusEventId || lista.some((e) => e.id === focusEventId)) return lista;
    const foco = todosLosEventos?.find((e) => e.id === focusEventId);
    return foco ? [...lista, foco].sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)) : lista;
  }, [eventsData, todosLosEventos, focusEventId]);
  const { invalidateAll } = useInvalidateEvents();
  // Ids de los eventos visibles, como texto estable: cambiar de ciudad puede
  // dejar el mismo número de eventos pero otros distintos.
  const idsVisibles = useMemo(() => events.map((e) => e.id).join(","), [events]);

  // Once we know the user + the visible events, fetch which of those they
  // already participate in so the card shows "Mi entrada" (y "Comprar más").
  useEffect(() => {
    if (!authedUserId || !idsVisibles) {
      // Solo limpiar si ya hay algo (evita re-renders innecesarios → loops).
      setParticipantIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const visibles = new Set(idsVisibles.split(","));
    let cancelled = false;
    (async () => {
      // Pasify: la participación se materializa con un ticket pagado, no con
      // un row en `event_participants`. Consultamos `tickets` con status
      // 'paid' o 'used' que el usuario tiene AHORA: comprados y no
      // transferidos, o transferidos a él (misma regla que la RLS).
      // Sin filtrar por evento en la URL: con «Toda España» serían cientos
      // de ids; las entradas de una persona son pocas.
      const { data } = await supabase
        .from("tickets")
        .select("event_id, buyer_user_id, transferred_to_user_id")
        .or(`buyer_user_id.eq.${authedUserId},transferred_to_user_id.eq.${authedUserId}`)
        .in("status", ["paid", "used"]);
      if (cancelled) return;
      const held = (data ?? []).filter(
        (r) =>
          visibles.has(r.event_id) &&
          (r.transferred_to_user_id ? r.transferred_to_user_id === authedUserId : r.buyer_user_id === authedUserId)
      );
      setParticipantIds(new Set(held.map((r) => r.event_id)));
    })();
    return () => {
      cancelled = true;
    };
    // Los ids como texto, no el array: react-query da una referencia nueva
    // en cada refresco aunque los eventos sean los mismos.
  }, [authedUserId, idsVisibles]);

  // Anchor for the hero CTA — scrolls the user from the marquee section
  // straight to the event list below.
  const eventsListRef = useRef<HTMLElement | null>(null);
  const scrollToEvents = () => {
    eventsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Con ?event=<id>, acercamos esa tarjeta y la resaltamos un momento para
  // que se vea cuál era.
  useEffect(() => {
    if (!focusEventId || events.length === 0) return;
    const exists = events.some((e) => e.id === focusEventId);
    if (!exists) return;
    // La tarjeta solo está en la vista de pósters (sin guardarlo como preferida).
    setView("posters");
    setHighlightedId(focusEventId);
    const timer = window.setTimeout(() => setHighlightedId(null), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId, events.length]);

  // Ya con la tarjeta pintada (y la vista de pósters puesta), la acercamos.
  useEffect(() => {
    if (!highlightedId) return;
    document
      .getElementById(`event-card-${highlightedId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedId]);

  // Realtime: any event change in the city refreshes the list immediately.
  useEffect(() => {
    const channel = supabase
      .channel("calendar-events-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => invalidateAll()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [invalidateAll]);

  const handleCityChange = (city: string | null) => {
    void cambiarCiudad(city);
  };

  // Hook compartido de compra. Encapsula auth gate, selector de tipo de
  // entrada y cantidad (`checkoutSheet`, hay que renderizarlo), payload a
  // `stripe-create-checkout` y redirect a hosted checkout. La lógica vive
  // en `src/hooks/useTicketCheckout.ts` y la usa también `PublicPartnerPage`.
  const { checkout: buyTicket, pendingId: buyingId, checkoutSheet } = useTicketCheckout();

  // "Mi entrada": a la cartera con el QR de este evento abierto.
  // ClientDashboard lee ?wallet=... al montar y se lo pasa a WalletSheet.
  const handleViewTicket = (event: CalendarEvent) => {
    navigate(`/client-dashboard?wallet=${encodeURIComponent(event.id)}`);
  };

  // Comprar (también "Comprar más" si ya tiene entrada: otra más u otro
  // tipo). Sin sesión, al login, que vuelve aquí con la tarjeta resaltada.
  const handleBuy = async (event: CalendarEvent) => {
    if (!authedUserId) {
      navigate(loginPathWithNext(`/calendar?event=${encodeURIComponent(event.id)}`));
      return;
    }
    // Mantén el optimistic Set local para que la card muestre estado
    // "loading" instantáneo (además del pendingId del hook).
    setParticipatingIds((prev) => new Set(prev).add(event.id));
    try {
      // Abre el selector de entradas (tipo, cantidad y total) del evento.
      await buyTicket({
        id: event.id,
        title: event.title,
        dateStart: event.start_date,
        place: event.location_name ?? event.profiles?.business_name ?? event.city ?? null,
      });
    } finally {
      setParticipatingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  };

  // Misma tarjeta en la cuadrícula de pósters y en la lista del día elegido
  // en la vista de calendario.
  const renderPosterCard = (ev: CalendarEvent) => (
    <EventPosterCard
      key={ev.id}
      event={ev}
      isParticipant={participantIds.has(ev.id)}
      participating={participatingIds.has(ev.id) || buyingId === ev.id}
      highlighted={highlightedId === ev.id}
      onBuy={handleBuy}
      onViewTicket={handleViewTicket}
    />
  );

  const handleBack = () => {
    if (isAuthed) {
      navigate("/client-dashboard");
    } else {
      navigate("/home");
    }
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Top bar — minimal, sticky with liquid glass */}
      <div
        className="sticky top-0 z-30 border-b border-border/40"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top, 0.5rem))",
          background: "rgba(var(--background-rgb, 255 255 255), 0.75)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex-1 text-base font-bold tracking-tight">
            {t("calendar.title", "Calendar")}
          </h1>
          <button
            type="button"
            onClick={() => setCitySelectorOpen(true)}
            aria-label={`Ciudad: ${selectedCity ?? TODA_ESPANA}. Cambiar`}
            className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span className="truncate max-w-[140px]">{selectedCity ?? TODA_ESPANA}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Hero — animated image marquee with Spanish copy. Placeholder
          flyers from Unsplash for now; user will swap to real Spanish
          party flyers later. */}
      <AnimatedMarqueeHero
        tagline={t(
          "calendar.heroTagline",
          "Tu vida nocturna, en un solo sitio"
        )}
        title={
          <>
            {t("calendar.heroTitleA", "Vive la noche")}
            <br />
            {t("calendar.heroTitleB", "como nunca antes")}
          </>
        }
        description={t(
          "calendar.heroDescription",
          "Descubre los eventos, conciertos y fiestas más calientes de tu ciudad. Pasify reúne en un solo sitio todo lo que la noche tiene esta semana."
        )}
        ctaText={t("calendar.heroCta", "Ver eventos")}
        images={HERO_MARQUEE_IMAGES}
        onCtaClick={scrollToEvents}
      />

      {/* Header section — "Próximos eventos" + view toggle (posters / calendar) */}
      <header
        ref={eventsListRef}
        className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 pt-8 pb-4 sm:px-6 sm:pt-12 sm:pb-6 lg:px-8"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              {t("calendar.upcomingTitle", "Próximos eventos")}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
              {t(
                "calendar.upcomingSubtitle",
                "Descubre lo que está por venir en tu ciudad."
              )}
            </p>
          </div>

          {/* View toggle — segmented control */}
          <div
            role="group"
            aria-label={t("calendar.viewToggle", "Vista")}
            className="inline-flex flex-shrink-0 rounded-full border border-border/50 bg-card/50 p-1 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setViewPersist("posters")}
              aria-pressed={view === "posters"}
              aria-label={t("calendar.viewPosters", "Vista posters")}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors sm:h-9 sm:w-9 ${
                view === "posters"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewPersist("calendar")}
              aria-pressed={view === "calendar"}
              aria-label={t("calendar.viewCalendar", "Vista calendario")}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors sm:h-9 sm:w-9 ${
                view === "calendar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Unified poster grid: 2-col on mobile, 3-col centered on tablet+.
          Container max-w-5xl keeps the desktop cards generous without
          stretching them edge-to-edge. */}
      <main className="mx-auto w-full max-w-5xl px-3 pb-24 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="aspect-[3/4] w-full animate-pulse rounded-3xl bg-muted/40"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {selectedCity
                ? `Aún no hay eventos publicados en ${selectedCity}.`
                : t("calendar.emptyDescription", "Aún no hay eventos publicados.")}
            </p>
            {selectedCity && (
              <Button variant="outline" className="mt-4 min-h-[44px] rounded-full" onClick={() => handleCityChange(null)}>
                Ver toda España
              </Button>
            )}
          </div>
        ) : view === "calendar" ? (
          <MonthCalendarView events={events} renderEvent={renderPosterCard} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {events.map(renderPosterCard)}
          </div>
        )}
      </main>

      <CitySelector
        open={citySelectorOpen}
        onOpenChange={setCitySelectorOpen}
        selectedCity={selectedCity}
        onCityChange={handleCityChange}
      />

      {/* Selector de entradas del hook de compra */}
      {checkoutSheet}
    </div>
  );
};

export default Calendar;
