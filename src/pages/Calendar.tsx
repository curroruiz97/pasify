import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin, ChevronDown, Sparkles, LayoutGrid, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useCalendarEvents, useInvalidateEvents } from "@/hooks/useEvents";
import { type CalendarEvent } from "@/components/calendar/EventListCard";
import EventPosterCard from "@/components/calendar/EventPosterCard";
import MonthCalendarView from "@/components/calendar/MonthCalendarView";
import CitySelector from "@/components/shared/CitySelector";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AnimatedMarqueeHero } from "@/components/ui/hero-3";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_CITY } from "@/constants/spanishCities";
import { DEFAULT_COUNTRY, getCountryByCode } from "@/constants/countries";

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
  // /e/:id → 302 → /calendar?event=<id>. We highlight the matching card
  // and scroll to it once the event list has loaded.
  const focusEventId = searchParams.get("event");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [selectedCity, setSelectedCity] = useState<string>(
    () => localStorage.getItem("selectedCity") || DEFAULT_CITY
  );
  const [selectedCountry, setSelectedCountry] = useState<string>(
    () => localStorage.getItem("selectedCountry") || DEFAULT_COUNTRY
  );
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

  const { data: eventsData, isLoading } = useCalendarEvents(selectedCity, selectedCountry);
  // Estabilizamos la referencia de events: si data llega undefined (durante el
  // primer fetch), devolvemos siempre el MISMO array vacío para que el
  // useEffect que depende de `events` no caiga en loop por cambio de
  // referencia. Es la misma técnica que usa react-query con su cache interna.
  const events = useMemo(() => eventsData ?? EMPTY_EVENTS, [eventsData]);
  const { invalidateAll } = useInvalidateEvents();

  // Once we know the user + the visible events, fetch which of those they
  // already participate in so the inline button shows "Mi entrada" instead
  // of "Participar".
  useEffect(() => {
    if (!authedUserId || events.length === 0) {
      // Solo limpiar si ya hay algo (evita re-renders innecesarios → loops).
      setParticipantIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const eventIds = (events as CalendarEvent[]).map((e) => e.id);
    let cancelled = false;
    (async () => {
      // Pasify: la participación se materializa con un ticket pagado, no con
      // un row en `event_participants`. Consultamos `tickets` con status
      // 'paid' o 'used' para saber a qué eventos ya tiene acceso el user.
      const { data } = await supabase
        .from("tickets")
        .select("event_id")
        .eq("buyer_user_id", authedUserId)
        .in("event_id", eventIds)
        .in("status", ["paid", "used"]);
      if (cancelled) return;
      setParticipantIds(new Set((data ?? []).map((r: { event_id: string }) => r.event_id)));
    })();
    return () => {
      cancelled = true;
    };
    // Solo nos importa cuántos eventos hay (length) y el user, no la
    // identidad del array (react-query nos da una referencia nueva al refetch
    // aunque los IDs no cambien).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedUserId, events.length]);

  // Anchor for the hero CTA — scrolls the user from the marquee section
  // straight to the event list below.
  const eventsListRef = useRef<HTMLElement | null>(null);
  const scrollToEvents = () => {
    eventsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // When the user lands here from /e/:id, scroll to the matching card
  // and pulse a highlight ring so they know which one was shared.
  useEffect(() => {
    if (!focusEventId || events.length === 0) return;
    const exists = (events as CalendarEvent[]).some((e) => e.id === focusEventId);
    if (!exists) return;
    setHighlightedId(focusEventId);
    // Defer until the card is in the DOM
    requestAnimationFrame(() => {
      const el = document.getElementById(`event-card-${focusEventId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightedId(null), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEventId, events.length]);

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

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    localStorage.setItem("selectedCity", city);
  };

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    localStorage.setItem("selectedCountry", country);
  };

  // Inline participation — replaces the old detail-page navigation.
  // Anonymous users → bounce to /register-client?next=/calendar so they
  // come back to the same view after sign-up. Authed users get an
  // optimistic toggle + insert.
  const handleParticipate = async (event: CalendarEvent) => {
    if (!authedUserId) {
      navigate(`/register-client?next=${encodeURIComponent("/calendar")}`);
      return;
    }
    if (participantIds.has(event.id)) {
      // Already participating → drop straight into the Wallet sheet
      // with this event's QR card open. ClientDashboard reads the
      // ?wallet=... param at mount and forwards it to WalletSheet.
      navigate(`/client-dashboard?wallet=${encodeURIComponent(event.id)}`);
      return;
    }
    setParticipatingIds((prev) => new Set(prev).add(event.id));
    try {
      // Pasify: la compra real de tickets se hace vía Stripe Checkout.
      // El edge function `stripe-create-checkout` crea el ticket_order +
      // tickets pending y redirige al hosted checkout. Si el function aún
      // no está desplegado (caso del entorno actual), degradamos con un
      // toast informativo en lugar de crashear.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");

      const checkoutFnName =
        import.meta.env.VITE_STRIPE_TEST_MODE === "true"
          ? "stripe-create-checkout-test"
          : "stripe-create-checkout";
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${checkoutFnName}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "payment",
          event_id: event.id,
          qty: 1,
          locale: "es",
          successUrl: `${window.location.origin}/#/client-dashboard?wallet={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/#/calendar`,
        }),
      });

      if (resp.status === 404) {
        // Edge function aún no desplegada en producción.
        toast({
          title: "Checkout próximamente",
          description:
            "El sistema de pago está siendo desplegado. Vuelve a intentarlo en unos minutos.",
        });
        return;
      }

      const raw = await resp.text();
      if (!resp.ok) {
        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.error || parsed?.message || parsed?.code || raw;
        } catch { /* noop */ }
        throw new Error(`${resp.status}: ${detail}`);
      }
      const data = JSON.parse(raw);
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("Respuesta inesperada del servidor de pagos.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error inesperado";
      console.error("[Calendar] participate error:", e);
      toast({
        title: t("common.error", "Error"),
        description: msg,
        variant: "destructive",
      });
    } finally {
      setParticipatingIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  };

  const handleBack = () => {
    if (isAuthed) {
      navigate("/client-dashboard");
    } else {
      navigate("/home");
    }
  };

  const countryFlag = getCountryByCode(selectedCountry)?.flag || "🇪🇸";

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
            className="flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span className="truncate max-w-[120px]">{selectedCity}</span>
            <span className="text-base leading-none">{countryFlag}</span>
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
              {t("calendar.emptyDescription", "Aún no hay eventos publicados.")}
            </p>
          </div>
        ) : view === "calendar" ? (
          <MonthCalendarView
            events={events as CalendarEvent[]}
            onEventClick={handleParticipate}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {(events as CalendarEvent[]).map((ev) => (
              <EventPosterCard
                key={ev.id}
                event={ev}
                isAuthed={isAuthed}
                isParticipant={participantIds.has(ev.id)}
                participating={participatingIds.has(ev.id)}
                highlighted={highlightedId === ev.id}
                onParticipate={handleParticipate}
              />
            ))}
          </div>
        )}
      </main>

      <CitySelector
        open={citySelectorOpen}
        onOpenChange={setCitySelectorOpen}
        selectedCity={selectedCity}
        onCityChange={handleCityChange}
        selectedCountry={selectedCountry}
        onCountryChange={handleCountryChange}
      />
    </div>
  );
};

export default Calendar;
