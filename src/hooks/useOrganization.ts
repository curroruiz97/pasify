import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";
import { getErrorMessage, setSentryTag } from "@/lib/sentry";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId, useSessionReady } from "@/lib/cache/session";

export interface TenantContext {
  org_id: string;
  org_name: string;
  brand_id: string | null;
  brand_name: string | null;
  venue_id: string | null;
  venue_name: string | null;
  role: "owner" | "admin" | "manager" | "rrpp" | "door_staff" | "pos_staff" | "read_only";
}

// Una RPC colgada (red móvil, bridge nativo) no puede dejar el panel en el
// loader para siempre: a los 10 s se trata como error con "Reintentar".
const TENANT_TIMEOUT_MS = 10_000;

async function leerTenant(): Promise<TenantContext | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("tenant_for_user")),
    TENANT_TIMEOUT_MS,
    "rpc tenant_for_user",
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as TenantContext) : null;
}

/**
 * useOrganization · resuelve el tenant activo del partner
 * (org + brand + venue + rol) con la RPC `tenant_for_user`.
 *
 * Vive en la caché (qk.partner.tenant): todas las pantallas comparten una
 * sola lectura, al recargar sale al instante de lo guardado y se revalida
 * detrás. Para forzar refresh tras `switchVenue` u otra acción que mueva el
 * last_active_venue_id, usa el `refetch` que devuelve este hook.
 *
 * Estabilidad (Fase 0 del panel de local):
 *  - `loading` solo es true en la PRIMERA carga (todavía no hay tenant).
 *    Los refrescos van en segundo plano con `refreshing`.
 *  - Un refresco fallido deja `error` pero NO borra el tenant previo.
 *  - `refetch()` resuelve con el tenant más reciente (el nuevo si la carga
 *    fue bien, el anterior si falló). Nunca rechaza.
 */
export const useOrganization = () => {
  const sesionLista = useSessionReady();
  const uid = useCurrentUserId();

  const query = useQuery({
    queryKey: qk.partner.tenant(uid ?? ""),
    queryFn: leerTenant,
    enabled: !!uid,
    staleTime: 2 * 60_000,
  });

  const tenant = uid ? query.data ?? null : null;

  useEffect(() => {
    if (query.isSuccess) setSentryTag("org_id", query.data?.org_id ?? null);
  }, [query.isSuccess, query.data?.org_id]);

  const { refetch: refetchQuery } = query;
  const refetch = useCallback(async (): Promise<TenantContext | null> => {
    if (!uid) return null;
    const r = await refetchQuery();
    return r.data ?? null;
  }, [uid, refetchQuery]);

  const switchVenue = useCallback(
    async (venue_id: string) => {
      const { error } = await withTimeout(
        Promise.resolve(supabase.rpc("switch_active_venue", { _venue_id: venue_id })),
        TENANT_TIMEOUT_MS,
        "rpc switch_active_venue",
      );
      if (error) throw error;
      await refetch();
    },
    [refetch],
  );

  const can = useCallback(
    (allowedRoles: TenantContext["role"][]): boolean => !!tenant && allowedRoles.includes(tenant.role),
    [tenant],
  );

  // Sin sesión conocida todavía no se sabe nada: cargando. Sin usuario: nada
  // que cargar. Con usuario: solo la primera carga (ni datos ni error).
  const loading = !sesionLista || (!!uid && query.isPending && !query.isError);
  const error = uid && query.error ? getErrorMessage(query.error) : null;

  return {
    tenant,
    loading,
    refreshing: !!uid && query.isFetching && !query.isPending,
    error,
    refetch,
    switchVenue,
    can,
  };
};
