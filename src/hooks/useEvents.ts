import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const CACHE_TIME = 10 * 60 * 1000; // 10 minuti
// 60s evita refetch ad ogni navigazione tra pagine. La freschezza
// degli eventi è garantita dalle subscription realtime + invalidateAll
// dopo create/update.
const STALE_TIME = 60 * 1000;

// Fetch eventi di un partner
export const usePartnerEvents = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["events", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("type", "event")
        .eq("is_active", true)
        .gte("end_date", now)
        .order("start_date", { ascending: true });

      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

// Fetch eventi attivi visibili nel feed Home Social.
// Calendar-only events (show_in_social_feed = false) sono esclusi qui.
// Per il Calendar usa useCalendarEvents.
export const useAllEvents = (city?: string, country?: string) => {
  return useQuery({
    queryKey: ["all-events", city, country],
    queryFn: async () => {
      const now = new Date().toISOString();

      // Prima fetch degli eventi
      let query = supabase
        .from("events")
        .select("*")
        .eq("type", "event")
        .eq("is_active", true)
        .eq("show_in_social_feed", true)
        .gte("end_date", now);

      // Filtra per paese e città
      if (country && city) {
        query = query.or(`country.eq.${country},country.is.null`);
        query = query.filter('city', 'ilike', city);
      } else if (country) {
        query = query.or(`country.eq.${country},country.is.null`);
      } else if (city) {
        query = query.filter('city', 'ilike', city);
      }

      const { data: eventsData, error: eventsError } = await query.order("start_date", { ascending: true });

      if (eventsError) throw eventsError;
      if (!eventsData || eventsData.length === 0) return [];

      // Poi fetch dei profili dei partner
      const partnerIds = [...new Set(eventsData.map(e => e.partner_id))];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, business_name, first_name, last_name, profile_image_url")
        .in("id", partnerIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      // Combina eventi con profili
      return eventsData.map(event => ({
        ...event,
        profiles: profilesMap.get(event.partner_id) || null
      }));
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    // Realtime subscription gestisce le invalidazioni → no polling necessario.
    // refetchOnReconnect resta on per coprire il caso "perdo connessione → torna".
    refetchOnReconnect: "always",
  });
};

// Fetch eventi attivi e futuri per Calendar (vetrina catalogue).
// Filtra per show_in_calendar=true: gli eventi pubblicati dal partner
// dashboard senza opt-in al Calendar appaiono solo in Home Social,
// mentre quelli creati dall'admin Calendar Management hanno il flag
// pre-attivato. Eventi scaduti (end_date <= now) scompaiono da soli.
export const useCalendarEvents = (city?: string, country?: string) => {
  return useQuery({
    queryKey: ["calendar-events", city, country],
    queryFn: async () => {
      const now = new Date().toISOString();

      let query = supabase
        .from("events")
        .select("*")
        .eq("type", "event")
        .eq("is_active", true)
        .eq("show_in_calendar", true)
        .gte("end_date", now);

      if (country && city) {
        query = query.or(`country.eq.${country},country.is.null`);
        query = query.filter("city", "ilike", city);
      } else if (country) {
        query = query.or(`country.eq.${country},country.is.null`);
      } else if (city) {
        query = query.filter("city", "ilike", city);
      }

      const { data: eventsData, error: eventsError } = await query.order("start_date", {
        ascending: true,
      });

      if (eventsError) throw eventsError;
      if (!eventsData || eventsData.length === 0) return [];

      const partnerIds = [...new Set(eventsData.map((e) => e.partner_id))];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, business_name, first_name, last_name, profile_image_url")
        .in("id", partnerIds);

      const profilesMap = new Map(profilesData?.map((p) => [p.id, p]) || []);

      return eventsData.map((event) => ({
        ...event,
        profiles: profilesMap.get(event.partner_id) || null,
      }));
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    refetchOnReconnect: "always",
  });
};

// Hook per invalidare la cache — funzioni memoizzate per evitare closure stale nei useEffect
export const useInvalidateEvents = () => {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    console.log("[useInvalidateEvents] Invalidating all event caches");
    // Forza refetch immediato (non solo mark stale) per query attive
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
