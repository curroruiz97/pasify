import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  /** Hora de fin, si la tiene: separa Próximos y Pasados con isEventOver. */
  date_end?: string | null;
  city: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url: string | null;
};

/**
 * Lo que recibe `toggle`: el id basta para quitar; para que al añadir la
 * tarjeta salga al momento en Favoritos hacen falta título y fecha (las
 * tarjetas de evento los mandan). Sin ellos, aparece con el refresco.
 */
export type FavToggleInput = { id: string; partnerId?: string } & Partial<Omit<FavEvent, "id" | "partnerId">>;

interface DbRow {
  event_id: string;
  events: {
    id: string;
    partner_id: string | null;
    title: string;
    description: string | null;
    date_start: string;
    date_end: string | null;
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
      "event_id, events!inner(id, partner_id, title, description, date_start, date_end, city, venue_name, price_cents, capacity, tickets_sold, image_url)"
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
    date_end: r.events.date_end ?? null,
    city: r.events.city,
    price_cents: r.events.price_cents,
    capacity: r.events.capacity,
    tickets_sold: r.events.tickets_sold,
    image_url: r.events.image_url,
  }));
}

/** Tarjeta completa para el cambio optimista; null si faltan título o fecha. */
function aFavorito(e: FavToggleInput): FavEvent | null {
  if (!e.title || !e.date_start) return null;
  return {
    id: e.id,
    partnerId: e.partnerId ?? "",
    partnerName: e.partnerName,
    title: e.title,
    description: e.description ?? null,
    date_start: e.date_start,
    date_end: e.date_end ?? null,
    city: e.city ?? "",
    price_cents: e.price_cents ?? 0,
    capacity: e.capacity ?? null,
    tickets_sold: e.tickets_sold ?? 0,
    image_url: e.image_url ?? null,
  };
}

/**
 * Favoritos con un cambio en curso (`<uid>:<eventId>`), compartidos por todas
 * las tarjetas: un doble toque mientras se guarda no vuelve a añadir (antes
 * mandaba otro INSERT, o un DELETE detrás del INSERT, según llegara la lista).
 */
const enCurso = new Set<string>();

/** `guardar`: true = añadir a favoritos, false = quitar. */
type Cambio = { evento: FavToggleInput; guardar: boolean; uid: string };

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
 *
 * Guardar y quitar (useMutation): el corazón cambia al momento (cambio
 * optimista en la lista), si el servidor falla vuelve a como estaba y sale un
 * aviso. El INSERT es un upsert que ignora duplicados (UNIQUE user_id,
 * event_id): nunca falla por "ya estaba".
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

  const { mutateAsync } = useMutation({
    // Sin conexión falla al momento (y se deshace) en vez de quedarse en
    // espera con el corazón cambiado sin guardar.
    networkMode: "always",
    mutationFn: async ({ evento, guardar, uid }: Cambio) => {
      if (guardar) {
        const { error } = await supabase
          .from("favorites_v2")
          .upsert({ user_id: uid, event_id: evento.id }, { onConflict: "user_id,event_id", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("favorites_v2").delete().eq("user_id", uid).eq("event_id", evento.id);
        if (error) throw error;
      }
    },
    onMutate: async ({ evento, guardar, uid }: Cambio) => {
      const key = qk.me.favorites(uid);
      // Que un refresco en vuelo no pise el cambio optimista.
      await queryClient.cancelQueries({ queryKey: key });
      const previos = queryClient.getQueryData<FavEvent[]>(key);
      queryClient.setQueryData<FavEvent[]>(key, (prev) => {
        const lista = prev ?? [];
        const sinEste = lista.filter((e) => e.id !== evento.id);
        if (!guardar) return sinEste;
        const nuevo = aFavorito(evento);
        return nuevo ? [nuevo, ...sinEste] : lista;
      });
      return { previos };
    },
    onError: (err, { guardar, uid }, contexto) => {
      console.warn("[useFavorites] no se pudo guardar el cambio", err);
      queryClient.setQueryData(qk.me.favorites(uid), contexto?.previos);
      toast.error(guardar ? "No se ha podido guardar en favoritos" : "No se ha podido quitar de favoritos", {
        description: "Revisa tu conexión e inténtalo de nuevo.",
      });
    },
    onSettled: (_data, _err, { uid }) => queryClient.invalidateQueries({ queryKey: qk.me.favorites(uid) }),
  });

  const toggleFav = useCallback(
    async (evento: FavToggleInput): Promise<boolean> => {
      if (!userId) return false;
      const clave = `${userId}:${evento.id}`;
      // Doble toque con el primero aún guardándose: se ignora.
      if (enCurso.has(clave)) return favIds.has(evento.id);
      const guardar = !favIds.has(evento.id);
      enCurso.add(clave);
      try {
        await mutateAsync({ evento, guardar, uid: userId });
        return guardar;
      } catch {
        // onError ya ha deshecho el cambio y avisado.
        return !guardar;
      } finally {
        enCurso.delete(clave);
      }
    },
    [favIds, userId, mutateAsync]
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
    loading: !!userId && query.isPending && !query.isError && query.fetchStatus !== "paused",
    /** Fallo al cargar (con o sin lista guardada: si hay, se sigue enseñando). */
    isError: query.isError,
    error: query.error,
    /** Sin lista todavía y sin red: la consulta espera a que vuelva la conexión. */
    offline: !!userId && query.isPending && query.fetchStatus === "paused",
    /** Hay una lista (de la red o guardada en el dispositivo). */
    hasData: query.data !== undefined,
    isFetching: query.isFetching,
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
