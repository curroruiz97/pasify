import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TenantContext {
  org_id: string;
  org_name: string;
  brand_id: string | null;
  brand_name: string | null;
  venue_id: string | null;
  venue_name: string | null;
  role: "owner" | "admin" | "manager" | "rrpp" | "door_staff" | "pos_staff" | "read_only";
}

/**
 * useOrganization · resuelve el tenant activo del partner (org + brand + venue + rol).
 * Usa la RPC `tenant_for_user`. Realtime: si cambia last_active_venue_id, refresca.
 */
export const useOrganization = () => {
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenant = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("tenant_for_user");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setTenant(row ? (row as TenantContext) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenant();
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) fetchTenant();
      else setTenant(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchTenant]);

  const switchVenue = useCallback(async (venue_id: string) => {
    const { error } = await supabase.rpc("switch_active_venue", { _venue_id: venue_id });
    if (error) throw error;
    await fetchTenant();
  }, [fetchTenant]);

  const can = useCallback(
    (allowedRoles: TenantContext["role"][]): boolean => !!tenant && allowedRoles.includes(tenant.role),
    [tenant]
  );

  return { tenant, loading, error, refetch: fetchTenant, switchVenue, can };
};
