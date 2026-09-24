import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";

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
 * `profile_image_url`) para no romper los componentes legacy (EventListCard,
 * EventPosterCard, MonthCalendarView) que aún usan los nombres viejos.
 */

const STALE_TIME = 60 * 1000;
/** El calendario enseña lo de las últimas 12 h en adelante (noches en curso). */
const VENTANA_PASADO_MS = 12 * 60 * 60 * 1000;

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

const decorate = (e: EventRow, p: Profile | null) => {
  // Si no hay date_end usamos date_start + 4h por defecto (la mayoría de los
  // eventos nocturnos duran <4h y los consumers legacy esperan end_date no-null).
  const effectiveEnd =
    e.date_end ??
    new Date(new Date(e.date_start).getTime() + 4 * 60 * 60 * 1000).toISOString();

  return {
    ...e,
    // ====== Aliases legacy (Pasify) para back-compat ======
    start_date: e.date_start,
    end_date: effectiveEnd,
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
  };
};

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

type CalendarEvent = ReturnType<typeof decorate>;

// Lo guardado en el dispositivo puede ser de ayer: nunca se pinta un evento
// que ya pasó, aunque venga de la caché (el refresco lo quita del todo).
const sinPasados = (eventos: CalendarEvent[]): CalendarEvent[] => {
  const corte = Date.now() - VENTANA_PASADO_MS;
  return eventos.filter((e) => new Date(e.date_start).getTime() >= corte);
};

/* ============ useCalendarEvents (página /calendar pública) ============ */
// Events 'published' + futuros (date_start >= ahora-12h para cubrir noches
// que ya empezaron pero siguen activas). Filtra por city si llega.
// Caché pública (qk.public.calendarEvents), guardada un día en el
// dispositivo: al volver al calendario o recargar sale al instante.
export const useCalendarEvents = (city?: string, _country?: string) => {
  return useQuery({
    queryKey: qk.public.calendarEvents(city ?? null),
    queryFn: async () => {
      const cutoff = new Date(Date.now() - VENTANA_PASADO_MS).toISOString();
      return fetchEventsWithProfiles((q) => {
        let r = q.eq("status", "published").gte("date_start", cutoff);
        if (city) r = r.ilike("city", city);
        return r;
      });
    },
    select: sinPasados,
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
