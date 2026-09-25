import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { EVENT_OPEN_WITHOUT_END_MS, isEventOver } from "@/components/tickets/ticketUtils";

/**
 * Pasify · hooks de eventos.
 *
 * Antes (Pasify) la tabla `events` tenía: `start_date`, `end_date`,
 * `type`, `is_active`, `show_in_calendar`, `show_in_social_feed`, `country`.
 * En Pasify el schema es:
 *   id, partner_id, title, description, date_start, date_end, city,
 *   venue_name, address, price_cents, currency, capacity, tickets_sold,
 *   image_url, category, status, stripe_price_id, created_at, updated_at,
 *   venue_id, brand_id, org_id
 *
 * `status` (enum event_status_t) tiene: draft · published · cancelled · past.
 * RLS pública (`events_public_read`) deja leer 'published' y 'past'.
 *
 * Los hooks devuelven el row Pasify + ALIASES legacy (`start_date`, `end_date`,
 * `profile_image_url`) que aún usan las tarjetas del calendario
 * (EventPosterCard, MonthCalendarView).
 */

const STALE_TIME = 60 * 1000;

type Profile = {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type EventRow = {
  id: string;
  partner_id: string;
  title: string;
  description: string | null;
  date_start: string;
  date_end: string | null;
  city: string;
  venue_name: string | null;
  address: string | null;
  price_cents: number;
  currency: string;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
  category: string | null;
  status: string;
};

const decorate = (e: EventRow, p: Profile | null) => ({
  ...e,
  // ====== Aliases legacy (Pasify) para back-compat ======
  start_date: e.date_start,
  // Sin hora de fin (es opcional) no se inventa ninguna: antes salía
  // "23:00 → 03:00" en eventos que nadie había dicho que acabaran a las 3.
  end_date: e.date_end,
  discount_percentage: null as number | null,
  price: e.price_cents / 100,
  location_name: e.venue_name,
  // ============================================================
  profiles: p
    ? {
        id: p.id,
        business_name: p.business_name,
        first_name: p.first_name,
        last_name: p.last_name,
        profile_image_url: p.avatar_url, // legacy alias
        avatar_url: p.avatar_url,
      }
    : null,
});

/** Evento del calendario público, tal como lo pintan sus tarjetas. */
export type CalendarEvent = ReturnType<typeof decorate>;

const eventsQuery = () =>
  supabase
    .from("events")
    .select(
      "id, partner_id, title, description, date_start, date_end, city, venue_name, address, price_cents, currency, capacity, tickets_sold, image_url, category, status"
    );
type EventsQuery = ReturnType<typeof eventsQuery>;

const fetchEventsWithProfiles = async (applyFilters: (q: EventsQuery) => EventsQuery) => {
  // Step 1: events
  const { data: eventsData, error: eventsError } = await applyFilters(eventsQuery()).order("date_start", {
    ascending: true,
  });
  if (eventsError) throw eventsError;
  const events = (eventsData ?? []) as EventRow[];
  if (events.length === 0) return [];

  // Step 2: nombre y avatar del local desde la vista pública `public_partners`
  // (la lectura directa de `profiles` de otros usuarios no está permitida).
  // `partner_id` puede ser null (local dado de baja): se filtra.
  const partnerIds = [
    ...new Set(events.map((e) => e.partner_id).filter((id): id is string => !!id)),
  ];
  const profilesMap = new Map<string, Profile>();
  if (partnerIds.length > 0) {
    const { data: partnersData, error: partnersError } = await supabase
      .from("public_partners")
      .select("id, business_name, avatar_url")
      .in("id", partnerIds);
    if (partnersError) {
      console.warn("[useEvents] public_partners query failed", partnersError);
    }
    (partnersData ?? []).forEach((p) => {
      if (!p.id) return;
      profilesMap.set(p.id, {
        id: p.id,
        business_name: p.business_name,
        first_name: null,
        last_name: null,
        avatar_url: p.avatar_url,
      });
    });
  }

  return events.map((e) => decorate(e, (e.partner_id && profilesMap.get(e.partner_id)) || null));
};

// Lo guardado en el dispositivo puede ser de ayer: nunca se pinta un evento
// que ya terminó, aunque venga de la caché (el refresco lo quita del todo).
const sinTerminados = (eventos: CalendarEvent[]): CalendarEvent[] => {
  const ahora = Date.now();
  return eventos.filter((e) => !isEventOver(e, ahora));
};

/* ============ useCalendarEvents (página /calendar pública) ============ */
// Eventos 'published' que siguen a la venta, con la MISMA regla que el
// servidor (`create_ticket_order`, ver isEventOver): hasta `date_end` o, sin
// hora de fin, hasta 12 h después de empezar. Así salen las noches que ya
// han empezado y los eventos de varios días en curso, y no los que ya
// acabaron aunque empezaran hace poco. Filtra por city si llega.
// Caché pública (qk.public.calendarEvents), guardada un día en el
// dispositivo: al volver al calendario o recargar sale al instante.
export const useCalendarEvents = (city?: string, _country?: string) => {
  return useQuery({
    queryKey: qk.public.calendarEvents(city ?? null),
    queryFn: async () => {
      const ahora = Date.now();
      const nowIso = new Date(ahora).toISOString();
      const sinFinDesde = new Date(ahora - EVENT_OPEN_WITHOUT_END_MS).toISOString();
      return fetchEventsWithProfiles((q) => {
        let r = q
          .eq("status", "published")
          .or(`date_end.gte.${nowIso},and(date_end.is.null,date_start.gte.${sinFinDesde})`);
        if (city) r = r.ilike("city", city);
        return r;
      });
    },
    select: sinTerminados,
    staleTime: STALE_TIME,
    refetchOnReconnect: "always",
  });
};

/* ============ useInvalidateEvents ============ */
export const useInvalidateEvents = () => {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["public", "calendar-events"], refetchType: "all" });
  }, [queryClient]);

  return { invalidateAll };
};
