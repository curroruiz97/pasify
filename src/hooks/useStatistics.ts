import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pasify · estadísticas globales para el Admin Dashboard.
 *
 * Antes (Students Life) agregaba sobre `qr_codes`, `access_logs`, `discount_scans`.
 * Esas tablas ya no existen. Ahora medimos sobre el modelo Pasify:
 *
 *  - `totalPartners`        → profiles con business_name (approved)
 *  - `totalClients`         → profiles con role=client
 *  - `totalEvents`          → events totales
 *  - `publishedEvents`      → events con status='published'
 *  - `totalTickets`         → tickets totales
 *  - `paidTickets`          → tickets con status='paid'
 *  - `usedTickets`          → tickets con used_at IS NOT NULL
 *
 * Mantenemos los aliases legacy (`totalQRCodes`, `usedQRCodes`,
 * `recentAccesses`) mapeados a los KPIs Pasify más cercanos para
 * compatibilidad con consumers existentes.
 */

const STATS_CACHE_TIME = 10 * 60 * 1000;
const STATS_STALE_TIME = 2 * 60 * 1000;

export interface UserData {
  id: string;
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
  avatar_url?: string | null;
  qr_count: number;
  used_count?: number;
  total_count?: number;
  last_access?: string;
  role: "partner" | "client";
}

export interface Stats {
  totalUsers: number;
  totalPartners: number;
  totalClients: number;
  totalEvents: number;
  publishedEvents: number;
  totalTickets: number;
  paidTickets: number;
  usedTickets: number;
  // Aliases legacy (apuntan a equivalentes Pasify)
  totalQRCodes: number;
  usedQRCodes: number;
  recentAccesses: number;
  allPartners: UserData[];
  allClients: UserData[];
}

const countRows = async (table: string, mod?: (q: ReturnType<typeof supabase.from>) => unknown) => {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (mod) q = mod(q as unknown as ReturnType<typeof supabase.from>) as typeof q;
  const { count, error } = await q;
  if (error) {
    console.warn(`[useStatistics] count(${table}) failed:`, error.message);
    return 0;
  }
  return count ?? 0;
};

export const useStatistics = () => {
  return useQuery<Stats>({
    queryKey: ["pasify-statistics"],
    queryFn: async () => {
      const [
        totalPartners,
        totalClients,
        totalEvents,
        publishedEvents,
        totalTickets,
        paidTickets,
        usedTickets,
        partnerProfilesRes,
        clientProfilesRes,
      ] = await Promise.all([
        countRows("profiles", (q) => q.not("business_name", "is", null)),
        countRows("user_roles", (q) => q.eq("role", "client")),
        countRows("events"),
        countRows("events", (q) => q.eq("status", "published")),
        countRows("tickets"),
        countRows("tickets", (q) => q.eq("status", "paid")),
        countRows("tickets", (q) => q.not("used_at", "is", null)),
        supabase
          .from("profiles")
          .select("id, business_name, business_city, first_name, last_name, avatar_url")
          .not("business_name", "is", null)
          .order("business_name")
          .limit(50),
        supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .is("business_name", null)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      const totalUsers = (partnerProfilesRes.data?.length ?? 0) + (clientProfilesRes.data?.length ?? 0);

      const allPartners: UserData[] = (partnerProfilesRes.data ?? []).map((p) => ({
        id: p.id as string,
        business_name: p.business_name as string | null,
        first_name: p.first_name as string | null,
        last_name: p.last_name as string | null,
        profile_image_url: p.avatar_url as string | null,
        avatar_url: p.avatar_url as string | null,
        qr_count: 0,
        used_count: 0,
        total_count: 0,
        role: "partner",
      }));

      const allClients: UserData[] = (clientProfilesRes.data ?? []).map((p) => ({
        id: p.id as string,
        first_name: p.first_name as string | null,
        last_name: p.last_name as string | null,
        profile_image_url: p.avatar_url as string | null,
        avatar_url: p.avatar_url as string | null,
        qr_count: 0,
        used_count: 0,
        total_count: 0,
        role: "client",
      }));

      return {
        totalUsers: totalUsers || totalPartners + totalClients,
        totalPartners,
        totalClients,
        totalEvents,
        publishedEvents,
        totalTickets,
        paidTickets,
        usedTickets,
        // Aliases legacy
        totalQRCodes: totalTickets,
        usedQRCodes: usedTickets,
        recentAccesses: paidTickets, // proxy razonable: "ventas recientes" = paid tickets
        allPartners,
        allClients,
      };
    },
    staleTime: STATS_STALE_TIME,
    gcTime: STATS_CACHE_TIME,
  });
};
