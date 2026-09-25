import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  CalendarDays,
  List as ListIcon,
  Loader2,
  RotateCcw,
  Share2,
} from "lucide-react";
import { EventListCard } from "@/components/event/EventListCard";
import { MonthGrid } from "@/components/event/MonthGrid";
import { isEventOver } from "@/components/tickets/ticketUtils";
import { useTicketCheckout } from "@/hooks/useTicketCheckout";
import type { PublicPartner } from "@/hooks/queries/clientData";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { sharePartnerLink } from "@/lib/eventLinks";
import { format } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Ficha pública de un local: `/#/p/:id` (y `/p/:id`, que pasa por
 * api/p/[id].ts para la vista previa en WhatsApp).
 *
 * Datos en caché pública (qk.public.partner / partnerEvents), guardada en el
 * dispositivo: un local ya visitado se ve también sin conexión. La ficha sale
 * al instante si el local ya estaba en la lista de locales.
 */

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
  date_end: string | null;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PARTNER_COLUMNS =
  "id, business_name, business_category, business_description, city, avatar_url, cover_image_url";
const EVENT_COLUMNS =
  "id, title, description, date_start, date_end, city, price_cents, capacity, tickets_sold, image_url, status";

const monoFont = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

// Nota: DEMO_PARTNERS y demoEventsFor eliminados (mayo 2026, hardening).
// Antes se hardcoded Pacha/Razzmatazz/etc. con id "demo-*". En producción
// real eso engañaba al usuario (mostraba locales que no existen).

/** null = el local no existe o no está aprobado. Un fallo de red lanza. */
async function leerLocal(id: string): Promise<Partner | null> {
  // `public_partners` (mig 0045) ya filtra approved + business_name NOT NULL
  // y oculta los datos personales del perfil.
  const { data, error } = await supabase
    .from("public_partners")
    .select(PARTNER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Partner | null) ?? null;
}

async function leerEventosDelLocal(id: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("partner_id", id)
    .eq("status", "published")
    .order("date_start", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

const PublicPartnerPage = () => {
  const { id: rawId } = useParams<{ id: string }>();
  const id = rawId ?? "";
  // Un id que no es un UUID (enlaces viejos "demo-1", recortados…) no se
  // consulta: la base de datos solo devolvería un 400 (salían en los logs).
  const validId = UUID_RE.test(id);
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"list" | "calendar">("list");
  const [monthCursor, setMonthCursor] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  // Hook único de compra. `pendingId` se compara con event.id en cada
  // card para mostrar el spinner solo en la que el usuario pulsó.
  // `checkoutSheet` es el selector de tipo/cantidad: se renderiza abajo.
  const { checkout: buyTicket, pendingId, checkoutSheet } = useTicketCheckout();

  const partnerQuery = useQuery({
    queryKey: qk.public.partner(id),
    queryFn: () => leerLocal(id),
    enabled: validId,
    staleTime: 5 * 60_000,
    // Si el local ya está en la lista de locales, la ficha sale al instante
    // (también sin conexión). Con fecha 0: se refresca en cuanto hay red (la
    // lista no trae la descripción) y no se guarda en el dispositivo hasta
    // tener la ficha completa.
    initialData: () => {
      const lista = queryClient.getQueryData<PublicPartner[]>(qk.public.partners());
      const p = lista?.find((x) => x.id === id);
      return p ? { ...p, business_description: null } : undefined;
    },
    initialDataUpdatedAt: 0,
  });

  const eventsQuery = useQuery({
    queryKey: qk.public.partnerEvents(id),
    queryFn: () => leerEventosDelLocal(id),
    enabled: validId,
    staleTime: 60_000,
  });

  const partner = partnerQuery.data;
  const events = eventsQuery.data;
  // Sin datos que enseñar: o ha fallado, o no hay red (la consulta queda en pausa).
  const partnerFailed =
    partner === undefined &&
    (partnerQuery.isError || (partnerQuery.isPending && partnerQuery.fetchStatus === "paused"));
  const eventsFailed =
    events === undefined &&
    (eventsQuery.isError || (eventsQuery.isPending && eventsQuery.fetchStatus === "paused"));

  // Título de la pestaña: el del local mientras se ve su ficha.
  useEffect(() => {
    const previo = document.title;
    return () => {
      document.title = previo;
    };
  }, []);
  useEffect(() => {
    if (partner?.business_name) document.title = `${partner.business_name} · Pasify`;
  }, [partner?.business_name]);

  const upcomingEvents = useMemo(() => {
    // Misma regla que el servidor: se ve (y se vende) hasta que termina.
    const ahora = Date.now();
    return (events ?? []).filter((e) => !isEventOver(e, ahora));
  }, [events]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    (events ?? []).forEach((e) => {
      const k = format(new Date(e.date_start), "yyyy-MM-dd");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    });
    return map;
  }, [events]);

  const buyEvent = (e: EventRow) =>
    buyTicket({
      id: e.id,
      title: e.title,
      dateStart: e.date_start,
      place: partner?.business_name ?? e.city,
    });

  // Entrando por un enlace directo (WhatsApp, Instagram…) no hay pantalla
  // anterior en la app: "Volver" lleva al inicio que toca en vez de sacarte.
  const volver = () => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate(userId ? "/client-dashboard" : "/calendar");
  };

  if (!validId || partner === null) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground mb-4">Local no encontrado.</p>
            <Button onClick={volver}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (partner === undefined) {
    if (partnerFailed) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-semibold text-foreground">No hemos podido cargar este local</p>
              <p className="mt-2 mb-6 text-sm text-muted-foreground">
                Revisa tu conexión y vuelve a intentarlo.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button onClick={() => void partnerQuery.refetch()} disabled={partnerQuery.isFetching}>
                  {partnerQuery.isFetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  Reintentar
                </Button>
                <Button variant="outline" onClick={volver}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Volver
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const initial = (partner.business_name?.[0] ?? "?").toUpperCase();
  const categoryLabel = partner.business_category ? CATEGORY_LABEL[partner.business_category] ?? partner.business_category : null;
  const dayEvents = selectedDay ? eventsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [] : [];

  // Error de carga de los eventos: no es lo mismo que "no hay eventos".
  const eventsError = (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="font-semibold text-foreground">No hemos podido cargar los eventos</p>
        <p className="mt-2 mb-6 text-sm text-muted-foreground">
          Revisa tu conexión y vuelve a intentarlo.
        </p>
        <Button onClick={() => void eventsQuery.refetch()} disabled={eventsQuery.isFetching}>
          {eventsQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          Reintentar
        </Button>
      </CardContent>
    </Card>
  );

  const eventsLoading = (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando eventos…
      </CardContent>
    </Card>
  );

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
          onClick={volver}
          className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          style={{ marginTop: "env(safe-area-inset-top, 0px)" }}
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Compartir: enlace de la web pública, con vista previa en WhatsApp */}
        <button
          onClick={() => void sharePartnerLink(id, partner.business_name ?? "Local en Pasify")}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
          style={{ marginTop: "env(safe-area-inset-top, 0px)" }}
          aria-label="Compartir local"
        >
          <Share2 className="h-5 w-5" />
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
              {events !== undefined && (
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
              )}
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
            {events === undefined ? (
              eventsFailed ? eventsError : eventsLoading
            ) : upcomingEvents.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  Aún no hay eventos publicados.
                </CardContent>
              </Card>
            ) : (
              upcomingEvents.map((e) => (
                <EventListCard
                  key={e.id}
                  event={e}
                  partnerId={id}
                  partnerName={partner.business_name ?? undefined}
                  onBuyTicket={() => buyEvent(e)}
                  pending={pendingId === e.id}
                />
              ))
            )}
          </div>
        )}

        {tab === "calendar" && (
          <div className="pb-12">
            {events === undefined ? (
              eventsFailed ? eventsError : eventsLoading
            ) : (
              <>
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
                    {dayEvents.length === 0 ? (
                      <p
                        className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground"
                      >
                        Sin eventos este día.
                      </p>
                    ) : (
                      dayEvents.map((e) => (
                        <EventListCard
                          key={e.id}
                          event={e}
                          partnerId={id}
                          partnerName={partner.business_name ?? undefined}
                          onBuyTicket={() => buyEvent(e)}
                          pending={pendingId === e.id}
                        />
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Selector de entradas del hook de compra */}
      {checkoutSheet}
    </div>
  );
};

export default PublicPartnerPage;
