import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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

const CACHE_TIME = 10 * 60 * 1000; // 10 min
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

const fetchEventsWithProfiles = async (
  applyFilters: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>
) => {
  // Step 1: events
  let query = supabase
    .from("events")
    .select(
      "id, partner_id, title, description, date_start, date_end, city, venue_name, address, price_cents, currency, capacity, tickets_sold, image_url, category, status"
    );
  query = applyFilters(query as unknown as ReturnType<typeof supabase.from>) as typeof query;

  const { data: eventsData, error: eventsError } = await query.order("date_start", {
    ascending: true,
  });
  if (eventsError) throw eventsError;
  const events = (eventsData ?? []) as EventRow[];
  if (events.length === 0) return [];

  // Step 2: profiles del partner
  const partnerIds = [...new Set(events.map((e) => e.partner_id))];
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, business_name, first_name, last_name, avatar_url")
    .in("id", partnerIds);
  const profilesMap = new Map(
    (profilesData ?? []).map((p) => [p.id, p as Profile])
  );

  return events.map((e) => decorate(e, profilesMap.get(e.partner_id) ?? null));
};

/* ============ usePartnerEvents (dashboard del partner) ============ */
export const usePartnerEvents = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["events", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      // Partner ve todos sus eventos (draft, published, cancelled, past)
      return fetchEventsWithProfiles((q) => q.eq("partner_id", partnerId));
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

/* ============ useAllEvents (feed cliente) ============ */
// Solo events 'published'. Filtra por city si llega. `country` se ignora
// (el schema Pasify no tiene country en events; se mapea por city).
export const useAllEvents = (city?: string, _country?: string) => {
  return useQuery({
    queryKey: ["all-events", city],
    queryFn: async () => {
      return fetchEventsWithProfiles((q) => {
        let r = q.eq("status", "published");
        if (city) r = r.ilike("city", city);
        return r;
      });
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    refetchOnReconnect: "always",
  });
};

/* ============ useCalendarEvents (página /calendar pública) ============ */
// Events 'published' + futuros (date_start >= ahora-12h para cubrir noches
// que ya empezaron pero siguen activas). Filtra por city si llega.
export const useCalendarEvents = (city?: string, _country?: string) => {
  return useQuery({
    queryKey: ["calendar-events", city],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      return fetchEventsWithProfiles((q) => {
        let r = q.eq("status", "published").gte("date_start", cutoff);
        if (city) r = r.ilike("city", city);
        return r;
      });
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    refetchOnReconnect: "always",
  });
};

/* ============ useInvalidateEvents ============ */
export const useInvalidateEvents = () => {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    console.log("[useInvalidateEvents] Invalidating all event caches");
    queryClient.invalidateQueries({ queryKey: ["events"], refetchType: "all" });
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "all-events" || query.queryKey[0] === "calendar-events",
      refetchType: "all",
    });
  }, [queryClient]);

  const invalidatePartnerEvents = useCallback(
    (partnerId: string) =>
      queryClient.invalidateQueries({ queryKey: ["events", partnerId], refetchType: "all" }),
    [queryClient]
  );

  return { invalidateAll, invalidatePartnerEvents };
};
