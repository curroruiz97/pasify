import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage, setSentryTag } from "@/lib/sentry";

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

const mismoTenant = (a: TenantContext | null, b: TenantContext | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.org_id === b.org_id &&
    a.org_name === b.org_name &&
    a.brand_id === b.brand_id &&
    a.brand_name === b.brand_name &&
    a.venue_id === b.venue_id &&
    a.venue_name === b.venue_name &&
    a.role === b.role);

/**
 * useOrganization · resuelve el tenant activo del partner
 * (org + brand + venue + rol).
 *
 * Usa la RPC `tenant_for_user`. Se carga una vez por usuario y se recarga
 * solo si CAMBIA el usuario (login/logout/cambio de cuenta) — NO escucha
 * realtime sobre `last_active_venue_id`. Para forzar refresh tras
 * `switchVenue` u otra acción que mueva el last_active_venue_id, usa el
 * `refetch` que devuelve este hook.
 *
 * Estabilidad (Fase 0 del panel de local):
 *  - `loading` solo es true en la PRIMERA carga (todavía no hay tenant).
 *    Los refrescos (refetch, switchVenue) van en segundo plano con
 *    `refreshing`, sin volver a `loading`: antes el SIGNED_IN de volver a la
 *    pestaña y el TOKEN_REFRESHED horario ponían `loading=true` y PartnerGate
 *    desmontaba el panel.
 *  - Un refresco fallido deja `error` pero NO borra el tenant previo.
 *  - `refetch()` resuelve con el tenant más reciente (el nuevo si la carga
 *    fue bien, el anterior si falló). Nunca rechaza.
 */
export const useOrganization = () => {
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // Usuario de la sesión: undefined = todavía no lo sabemos.
  const userIdRef = useRef<string | null | undefined>(undefined);
  // Hay un tenant resuelto (aunque sea null = sin organización) para el usuario actual.
  const hayDatosRef = useRef(false);
  const tenantRef = useRef<TenantContext | null>(null);
  // Cada carga lleva un número; solo la última puede escribir estado.
  const seqRef = useRef(0);
  const enVueloRef = useRef(false);

  const fetchTenant = useCallback(async (): Promise<TenantContext | null> => {
    const seq = ++seqRef.current;
    const enSegundoPlano = hayDatosRef.current;
    enVueloRef.current = true;
    if (enSegundoPlano) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const { data, error: rpcError } = await withTimeout(
        Promise.resolve(supabase.rpc("tenant_for_user")),
        TENANT_TIMEOUT_MS,
        "rpc tenant_for_user",
      );
      if (rpcError) throw rpcError;
      if (!mountedRef.current || seq !== seqRef.current) return tenantRef.current;

      const row = Array.isArray(data) ? data[0] : data;
      const next = row ? (row as TenantContext) : null;
      if (!mismoTenant(tenantRef.current, next)) {
        tenantRef.current = next;
        setTenant(next);
      }
      hayDatosRef.current = true;
      setError(null);
      setSentryTag("org_id", next?.org_id ?? null);
      return tenantRef.current;
    } catch (e) {
      if (!mountedRef.current || seq !== seqRef.current) return tenantRef.current;
      const msg = getErrorMessage(e);
      console.error("[useOrganization] tenant_for_user:", msg);
      // Un refresco fallido NO borra el tenant que ya teníamos.
      setError(msg);
      if (!enSegundoPlano) captureError(e, { where: "useOrganization.fetchTenant" });
      return tenantRef.current;
    } finally {
      if (mountedRef.current && seq === seqRef.current) {
        enVueloRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  /**
   * Aplica el usuario de un evento de auth. Idempotente: TOKEN_REFRESHED o el
   * SIGNED_IN de volver a la pestaña traen el mismo usuario y no recargan.
   */
  const aplicarUsuario = useCallback(
    (uid: string | null) => {
      if (uid === userIdRef.current) {
        // Mismo usuario. Solo si la primera carga falló (no hay tenant) y no
        // hay otra en curso, aprovechamos el evento para reintentar.
        if (uid && !hayDatosRef.current && !enVueloRef.current) void fetchTenant();
        return;
      }

      // Usuario nuevo (primera vez, login, logout o cambio de cuenta): fuera
      // lo del anterior e invalidamos cualquier carga suya en vuelo.
      userIdRef.current = uid;
      seqRef.current++;
      enVueloRef.current = false;
      hayDatosRef.current = false;
      tenantRef.current = null;
      setTenant(null);
      setError(null);
      setRefreshing(false);
      if (!uid) {
        setLoading(false);
        return;
      }
      void fetchTenant();
    },
    [fetchTenant],
  );

  useEffect(() => {
    mountedRef.current = true;
    let vivo = true;
    let eventoRecibido = false;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      eventoRecibido = true;
      const uid = session?.user?.id ?? null;
      // Diferido: llamar a Supabase dentro del callback puede bloquear el lock
      // de auth-js.
      setTimeout(() => {
        if (vivo) aplicarUsuario(uid);
      }, 0);
    });

    // Red de seguridad por si INITIAL_SESSION no llega: sin esto `loading`
    // se quedaría en true para siempre. Si ya llegó algún evento, se ignora.
    withTimeout(supabase.auth.getSession(), TENANT_TIMEOUT_MS, "auth.getSession")
      .then(({ data, error: sessionError }) => {
        if (!vivo || eventoRecibido) return;
        if (sessionError) throw sessionError;
        aplicarUsuario(data.session?.user?.id ?? null);
      })
      .catch((e) => {
        if (!vivo || eventoRecibido) return;
        // No sabemos si hay sesión: error recuperable, no "sin organización".
        setError(getErrorMessage(e));
        setLoading(false);
      });

    return () => {
      vivo = false;
      mountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, [aplicarUsuario]);

  const switchVenue = useCallback(
    async (venue_id: string) => {
      const { error } = await withTimeout(
        Promise.resolve(supabase.rpc("switch_active_venue", { _venue_id: venue_id })),
        TENANT_TIMEOUT_MS,
        "rpc switch_active_venue",
      );
      if (error) throw error;
      await fetchTenant();
    },
    [fetchTenant],
  );

  const can = useCallback(
    (allowedRoles: TenantContext["role"][]): boolean => !!tenant && allowedRoles.includes(tenant.role),
    [tenant]
  );

  return { tenant, loading, refreshing, error, refetch: fetchTenant, switchVenue, can };
};
