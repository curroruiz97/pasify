import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import type { PublicPartner } from "@/hooks/queries/clientData";

/**
 * Locales favoritos (B2-03): el corazón de las tarjetas de locales y de la
 * ficha /p/:id, y la sección «Locales» de Favoritos.
 *
 * partner_favorites.partner_id es el id del local de la vista public_partners
 * (migración 20260927120000). Antes se guardaba en org_id, una FK a
 * organizations: todos los INSERT fallaban con 23503 y el error se ignoraba.
 *
 * Caché: una sola lista para toda la app (qk.me.favoritePartners), con los
 * datos públicos de cada local (nombre, ciudad, fotos) para pintar la sección
 * sin más consultas. Se guarda 7 días en el dispositivo (policy.ts). Antes
 * cada tarjeta montaba el hook y hacía su propia consulta.
 *
 * Guardar y quitar: el corazón cambia al momento (cambio optimista); si el
 * servidor falla vuelve a como estaba y sale un aviso. Guardar es un upsert
 * que ignora duplicados (UNIQUE user_id, partner_id).
 *
 * Sin sesión no hay favoritos: el corazón lleva al login (lo decide quien
 * pinta el corazón, con `sinSesion`).
 */

/** Local guardado: los mismos datos públicos que la lista de locales. */
export type LocalFavorito = PublicPartner;

/** Lo que recibe `toggle`: el id basta para quitar; con el resto, al guardar sale ya en Favoritos. */
export type LocalFavoritoInput = { id: string } & Partial<Omit<PublicPartner, "id">>;

const COLUMNAS_LOCAL = "id, business_name, business_category, city, avatar_url, cover_image_url";
const SIN_LOCALES: LocalFavorito[] = [];

type ErrorPg = { message: string; code?: string };
type FilaFavorito = { partner_id: string | null; created_at: string };

/**
 * partner_favorites.partner_id aún no está en los types generados
 * (src/integrations/supabase/types.ts): acceso con la forma justa.
 */
interface TablaLocalesFavoritos {
  select(columnas: "partner_id, created_at"): {
    eq(
      columna: "user_id",
      valor: string,
    ): {
      order(
        columna: "created_at",
        opciones: { ascending: boolean },
      ): PromiseLike<{ data: FilaFavorito[] | null; error: ErrorPg | null }>;
    };
  };
  upsert(
    fila: { user_id: string; partner_id: string },
    opciones: { onConflict: string; ignoreDuplicates: boolean },
  ): PromiseLike<{ error: ErrorPg | null }>;
  delete(): {
    eq(
      columna: "user_id",
      valor: string,
    ): { eq(columna: "partner_id", valor: string): PromiseLike<{ error: ErrorPg | null }> };
  };
}

const tablaLocalesFavoritos = () =>
  (supabase as unknown as { from(tabla: "partner_favorites"): TablaLocalesFavoritos }).from("partner_favorites");

async function leerLocalesFavoritos(uid: string, lista: PublicPartner[] | undefined): Promise<LocalFavorito[]> {
  const { data, error } = await tablaLocalesFavoritos()
    .select("partner_id, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[locales favoritos] partner_favorites query failed", error);
    throw error;
  }
  // Filas de antes de la Ola 2 (solo org_id): no apuntan a ningún local.
  const ids = Array.from(new Set((data ?? []).map((f) => f.partner_id).filter((id): id is string => !!id)));
  if (ids.length === 0) return [];

  const { data: locales, error: localesError } = await supabase
    .from("public_partners")
    .select(COLUMNAS_LOCAL)
    .in("id", ids);
  if (localesError) {
    // Sin los datos del local, al menos el corazón sabe cuáles son: se usan
    // los de la lista de locales si está en la caché.
    console.warn("[locales favoritos] public_partners query failed", localesError);
    const porId = new Map((lista ?? []).map((p) => [p.id, p]));
    return ids.map((id) => porId.get(id) ?? aLocal({ id }));
  }
  // Un local que ya no es público (dado de baja, sin aprobar) no se enseña.
  const porId = new Map(((locales ?? []) as PublicPartner[]).map((p) => [p.id, p]));
  return ids.map((id) => porId.get(id)).filter((p): p is PublicPartner => !!p);
}

function aLocal(l: LocalFavoritoInput): LocalFavorito {
  return {
    id: l.id,
    business_name: l.business_name ?? null,
    business_category: l.business_category ?? null,
    city: l.city ?? null,
    avatar_url: l.avatar_url ?? null,
    cover_image_url: l.cover_image_url ?? null,
  };
}

/** Cambios en curso (`<uid>:<localId>`), compartidos por todos los corazones: un doble toque no repite. */
const enCurso = new Set<string>();

/** `guardar`: true = guardar en favoritos, false = quitar. */
type Cambio = { local: LocalFavoritoInput; guardar: boolean; uid: string };

export const useFavoritePartners = () => {
  const uid = useCurrentUserId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.me.favoritePartners(uid ?? ""),
    queryFn: () =>
      leerLocalesFavoritos(uid as string, queryClient.getQueryData<PublicPartner[]>(qk.public.partners())),
    enabled: !!uid,
    staleTime: 60_000,
  });

  const locales = (uid ? query.data : undefined) ?? SIN_LOCALES;
  const ids = useMemo(() => new Set(locales.map((l) => l.id)), [locales]);

  const { mutateAsync } = useMutation({
    // Sin conexión falla al momento (y se deshace) en vez de quedarse en espera.
    networkMode: "always",
    mutationFn: async ({ local, guardar, uid: usuario }: Cambio) => {
      const tabla = tablaLocalesFavoritos();
      const { error } = guardar
        ? await tabla.upsert(
            { user_id: usuario, partner_id: local.id },
            { onConflict: "user_id,partner_id", ignoreDuplicates: true },
          )
        : await tabla.delete().eq("user_id", usuario).eq("partner_id", local.id);
      if (error) throw error;
    },
    onMutate: async ({ local, guardar, uid: usuario }: Cambio) => {
      const key = qk.me.favoritePartners(usuario);
      // Que un refresco en vuelo no pise el cambio optimista.
      await queryClient.cancelQueries({ queryKey: key });
      const previos = queryClient.getQueryData<LocalFavorito[]>(key);
      queryClient.setQueryData<LocalFavorito[]>(key, (prev) => {
        const sinEste = (prev ?? []).filter((l) => l.id !== local.id);
        return guardar ? [aLocal(local), ...sinEste] : sinEste;
      });
      return { previos };
    },
    onError: (err, { guardar, uid: usuario }, contexto) => {
      console.warn("[locales favoritos] no se pudo guardar el cambio", err);
      queryClient.setQueryData(qk.me.favoritePartners(usuario), contexto?.previos);
      toast.error(guardar ? "No se ha podido guardar el local" : "No se ha podido quitar el local", {
        description: "Revisa tu conexión e inténtalo de nuevo.",
      });
    },
    onSettled: (_data, _err, { uid: usuario }) =>
      queryClient.invalidateQueries({ queryKey: qk.me.favoritePartners(usuario) }),
  });

  /** Guarda o quita. Devuelve si queda guardado. Sin sesión no hace nada (false). */
  const toggle = useCallback(
    async (local: LocalFavoritoInput): Promise<boolean> => {
      if (!uid) return false;
      const clave = `${uid}:${local.id}`;
      if (enCurso.has(clave)) return ids.has(local.id);
      const guardar = !ids.has(local.id);
      enCurso.add(clave);
      try {
        await mutateAsync({ local, guardar, uid });
        return guardar;
      } catch {
        // onError ya ha deshecho el cambio y avisado.
        return !guardar;
      } finally {
        enCurso.delete(clave);
      }
    },
    [ids, uid, mutateAsync],
  );

  const isFav = useCallback((localId: string) => ids.has(localId), [ids]);
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async () => {
    if (uid) await refetchQuery();
  }, [uid, refetchQuery]);

  return {
    locales,
    ids,
    isFav,
    toggle,
    refetch,
    /** Sin sesión: el corazón lleva al login. */
    sinSesion: !uid,
    loading: !!uid && query.isPending && !query.isError && query.fetchStatus !== "paused",
    isError: query.isError,
    /** Sin lista todavía y sin red: espera a que vuelva la conexión. */
    offline: !!uid && query.isPending && query.fetchStatus === "paused",
    /** Hay una lista (de la red o guardada en el dispositivo). */
    hasData: query.data !== undefined,
    isFetching: query.isFetching,
  };
};
