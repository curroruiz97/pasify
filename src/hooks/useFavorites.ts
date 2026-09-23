import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FavEvent = {
  id: string;
  partnerId: string;
  partnerName?: string;
  title: string;
  description: string | null;
  date_start: string;
  city: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

interface DbRow {
  event_id: string;
  events: {
    id: string;
    partner_id: string | null;
    title: string;
    description: string | null;
    date_start: string;
    city: string;
    venue_name: string | null;
    price_cents: number;
    capacity: number | null;
    tickets_sold: number;
    image_url: string | null;
  } | null;
}

/**
 * useFavorites · backend-backed sobre favorites_v2.
 * Sustituye al hook localStorage anterior. RLS asegura aislamiento por user.
 *
 * El nombre del local sale de la vista pública `public_partners` (la lectura
 * directa de `profiles` de otros usuarios ya no está permitida, así que el
 * embed `profiles!events_partner_id_fkey` dejó de servir); si no está, se usa
 * la sala del evento (`venue_name`).
 */
export const useFavorites = () => {
  const [favEvents, setFavEvents] = useState<FavEvent[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchFavs = useCallback(async (uid: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("favorites_v2")
      .select(
        "event_id, events!inner(id, partner_id, title, description, date_start, city, venue_name, price_cents, capacity, tickets_sold, image_url)"
      )
      .eq("user_id", uid)
      .not("event_id", "is", null)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[useFavorites] favorites_v2 query failed", error);
      setLoading(false);
      return;
    }
    const rows = ((data ?? []) as unknown as DbRow[]).filter(
      (r): r is DbRow & { events: NonNullable<DbRow["events"]> } => !!r.events
    );

    const partnerIds = Array.from(
      new Set(rows.map((r) => r.events.partner_id).filter((id): id is string => !!id))
    );
    const partnerNames = new Map<string, string>();
    if (partnerIds.length > 0) {
      const { data: partners, error: partnersError } = await supabase
        .from("public_partners")
        .select("id, business_name")
        .in("id", partnerIds);
      if (partnersError) console.warn("[useFavorites] public_partners query failed", partnersError);
      (partners ?? []).forEach((p) => {
        if (p.id && p.business_name) partnerNames.set(p.id, p.business_name);
      });
    }

    const events = rows.map((r) => ({
      id: r.events.id,
      partnerId: r.events.partner_id ?? "",
      partnerName:
        (r.events.partner_id && partnerNames.get(r.events.partner_id)) ||
        r.events.venue_name ||
        undefined,
      title: r.events.title,
      description: r.events.description,
      date_start: r.events.date_start,
      city: r.events.city,
      price_cents: r.events.price_cents,
      capacity: r.events.capacity,
      tickets_sold: r.events.tickets_sold,
      image_url: r.events.image_url,
    }));
    setFavEvents(events);
    setFavIds(new Set(events.map((e) => e.id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUserId(data.user.id);
        await fetchFavs(data.user.id);
      } else {
        setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) fetchFavs(uid);
      else {
        setFavEvents([]);
        setFavIds(new Set());
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchFavs]);

  const toggleFav = useCallback(async (event: { id: string; partnerId?: string }) => {
    if (!userId) return false;
    if (favIds.has(event.id)) {
      await supabase.from("favorites_v2").delete().eq("user_id", userId).eq("event_id", event.id);
    } else {
      await supabase.from("favorites_v2").insert({ user_id: userId, event_id: event.id });
    }
    await fetchFavs(userId);
    return !favIds.has(event.id);
  }, [favIds, userId, fetchFavs]);

  const isFav = useCallback((eventId: string) => favIds.has(eventId), [favIds]);
  const refetch = useCallback(() => {
    if (userId) return fetchFavs(userId);
    return Promise.resolve();
  }, [userId, fetchFavs]);

  return {
    // API canónica
    favEvents,
    favIds,
    loading,
    toggleFav,
    isFav,
    refetch,
    // Aliases legacy (ClientDashboard / EventListCard / etc.). Mantienen
    // compatibilidad con el destructuring anterior `{ events, ids, toggle, isFavorite }`.
    // `ids` se expone como Array (no Set) porque consumers viejos usan `.length`.
    events: favEvents,
    ids: Array.from(favIds),
    toggle: toggleFav,
    isFavorite: isFav,
  };
};
