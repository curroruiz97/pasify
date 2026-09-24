import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";

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

const SIN_FAVORITOS: FavEvent[] = [];

async function leerFavoritos(uid: string): Promise<FavEvent[]> {
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
    throw error;
  }
  const rows = ((data ?? []) as unknown as DbRow[]).filter(
    (r): r is DbRow & { events: NonNullable<DbRow["events"]> } => !!r.events
  );

  const partnerIds = Array.from(new Set(rows.map((r) => r.events.partner_id).filter((id): id is string => !!id)));
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

  return rows.map((r) => ({
    id: r.events.id,
    partnerId: r.events.partner_id ?? "",
    partnerName:
      (r.events.partner_id && partnerNames.get(r.events.partner_id)) || r.events.venue_name || undefined,
    title: r.events.title,
    description: r.events.description,
    date_start: r.events.date_start,
    city: r.events.city,
    price_cents: r.events.price_cents,
    capacity: r.events.capacity,
    tickets_sold: r.events.tickets_sold,
    image_url: r.events.image_url,
  }));
}

/**
 * useFavorites · backend-backed sobre favorites_v2.
 * Sustituye al hook localStorage anterior. RLS asegura aislamiento por user.
 *
 * El nombre del local sale de la vista pública `public_partners` (la lectura
 * directa de `profiles` de otros usuarios ya no está permitida, así que el
 * embed `profiles!events_partner_id_fkey` dejó de servir); si no está, se usa
 * la sala del evento (`venue_name`).
 *
 * Caché: una sola lista para toda la app (qk.me.favorites). Antes CADA
 * tarjeta de evento que usaba el hook pedía la sesión a la red y cargaba su
 * propia copia de los favoritos.
 */
export const useFavorites = () => {
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.me.favorites(userId ?? ""),
    queryFn: () => leerFavoritos(userId as string),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const favEvents = (userId ? query.data : undefined) ?? SIN_FAVORITOS;
  const favIds = useMemo(() => new Set(favEvents.map((e) => e.id)), [favEvents]);
  const ids = useMemo(() => Array.from(favIds), [favIds]);

  const toggleFav = useCallback(
    async (event: { id: string; partnerId?: string }) => {
      if (!userId) return false;
      const key = qk.me.favorites(userId);
      const eraFavorito = favIds.has(event.id);
      if (eraFavorito) {
        // Quitar se ve al momento; si falla, la recarga de abajo lo devuelve.
        queryClient.setQueryData<FavEvent[]>(key, (prev) => (prev ?? []).filter((e) => e.id !== event.id));
        const { error } = await supabase.from("favorites_v2").delete().eq("user_id", userId).eq("event_id", event.id);
        if (error) console.warn("[useFavorites] no se pudo quitar el favorito", error);
      } else {
        const { error } = await supabase.from("favorites_v2").insert({ user_id: userId, event_id: event.id });
        if (error) console.warn("[useFavorites] no se pudo guardar el favorito", error);
      }
      await queryClient.invalidateQueries({ queryKey: key });
      return !eraFavorito;
    },
    [favIds, userId, queryClient]
  );

  const isFav = useCallback((eventId: string) => favIds.has(eventId), [favIds]);
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    if (userId) await refetchQuery();
  }, [userId, refetchQuery]);

  return {
    // API canónica
    favEvents,
    favIds,
    loading: !!userId && query.isPending && !query.isError,
    toggleFav,
    isFav,
    refetch,
    // Aliases legacy (ClientDashboard / EventListCard / etc.). Mantienen
    // compatibilidad con el destructuring anterior `{ events, ids, toggle, isFavorite }`.
    // `ids` se expone como Array (no Set) porque consumers viejos usan `.length`.
    events: favEvents,
    ids,
    toggle: toggleFav,
    isFavorite: isFav,
  };
};
