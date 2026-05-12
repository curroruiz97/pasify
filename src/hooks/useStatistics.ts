import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const STATS_CACHE_TIME = 10 * 60 * 1000; // 10 minuti
const STATS_STALE_TIME = 2 * 60 * 1000; // 2 minuti

interface UserData {
  id: string;
  business_name?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  qr_count: number;
  used_count?: number;
  total_count?: number;
  last_access?: string;
  role: "partner" | "client";
}

interface Stats {
  totalUsers: number;
  totalPartners: number;
  totalClients: number;
  totalQRCodes: number;
  usedQRCodes: number;
  recentAccesses: number;
  allPartners: UserData[];
  allClients: UserData[];
}

export const useStatistics = () => {
  return useQuery({
    queryKey: ["admin-statistics"],
    queryFn: async (): Promise<Stats> => {
      // Fetch all counts in parallel
      const [
        { count: totalUsers },
        { count: totalPartners },
        { count: totalClients },
        { count: totalQRCodes },
        { count: usedQRCodes },
        { count: recentAccesses },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "partner"),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "client"),
        supabase.from("qr_codes").select("*", { count: "exact", head: true }),
        // QR usato = used_at IS NOT NULL. Lo scanner non aggiorna is_used.
        supabase.from("qr_codes").select("*", { count: "exact", head: true }).not("used_at", "is", null),
        supabase.from("access_logs").select("*", { count: "exact", head: true })
          .gte("accessed_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      // Fetch all partners and clients in parallel
      // .range(0, 99999) serve a superare il cap PostgREST di 1000 righe.
      const [
        { data: partnerRoles },
        { data: clientRoles },
        { data: allProfiles },
        { data: allQRCodes },
        { data: allEvents },
        { data: allDiscounts },
        { data: allAccessLogs },
      ] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "partner").range(0, 99999),
        supabase.from("user_roles").select("user_id").eq("role", "client").range(0, 99999),
        supabase.from("profiles").select("id, business_name, first_name, last_name, profile_image_url").range(0, 99999),
        supabase.from("qr_codes").select("id, event_id, discount_id, client_id, used_at").range(0, 99999),
        supabase.from("events").select("id, partner_id").eq("type", "event").range(0, 99999),
        supabase.from("discounts").select("id, partner_id").range(0, 99999),
        supabase.from("access_logs").select("user_id, accessed_at").order("accessed_at", { ascending: false }).range(0, 99999),
      ]);

      // Create maps for efficient lookup
      const profilesMap = new Map(allProfiles?.map(p => [p.id, p]) || []);

      // Map events and discounts to partners
      const partnerEventsMap = new Map<string, string[]>();
      const partnerDiscountsMap = new Map<string, string[]>();

      allEvents?.forEach(e => {
        const events = partnerEventsMap.get(e.partner_id) || [];
        events.push(e.id);
        partnerEventsMap.set(e.partner_id, events);
      });

      allDiscounts?.forEach(d => {
        const discounts = partnerDiscountsMap.get(d.partner_id) || [];
        discounts.push(d.id);
        partnerDiscountsMap.set(d.partner_id, discounts);
      });

      // Map QR codes
      const eventQRMap = new Map<string, { total: number; used: number }>();
      const discountQRMap = new Map<string, { total: number; used: number }>();
      const clientQRMap = new Map<string, number>();

      allQRCodes?.forEach(qr => {
        if (qr.event_id) {
          const current = eventQRMap.get(qr.event_id) || { total: 0, used: 0 };
          current.total++;
          if (qr.used_at) current.used++;
          eventQRMap.set(qr.event_id, current);
        }
        if (qr.discount_id) {
          const current = discountQRMap.get(qr.discount_id) || { total: 0, used: 0 };
          current.total++;
          if (qr.used_at) current.used++;
          discountQRMap.set(qr.discount_id, current);
        }
        if (qr.client_id) {
          clientQRMap.set(qr.client_id, (clientQRMap.get(qr.client_id) || 0) + 1);
        }
      });

      // Map last access
      const lastAccessMap = new Map<string, string>();
      allAccessLogs?.forEach(log => {
        if (!lastAccessMap.has(log.user_id)) {
          lastAccessMap.set(log.user_id, log.accessed_at);
        }
      });

      // Build partners data
      const allPartners: UserData[] = (partnerRoles || []).map(pr => {
        const profile = profilesMap.get(pr.user_id);
        const eventIds = partnerEventsMap.get(pr.user_id) || [];
        const discountIds = partnerDiscountsMap.get(pr.user_id) || [];

        let qr_count = 0;
        let used_count = 0;

        eventIds.forEach(eventId => {
          const stats = eventQRMap.get(eventId);
          if (stats) {
            qr_count += stats.total;
            used_count += stats.used;
          }
        });

        discountIds.forEach(discountId => {
          const stats = discountQRMap.get(discountId);
          if (stats) {
            qr_count += stats.total;
            used_count += stats.used;
          }
        });

        return {
          id: pr.user_id,
          business_name: profile?.business_name || "N/A",
          profile_image_url: profile?.profile_image_url,
          qr_count,
          used_count,
          total_count: qr_count,
          last_access: lastAccessMap.get(pr.user_id),
          role: "partner" as const,
        };
      }).sort((a, b) => b.qr_count - a.qr_count);

      // Build clients data
      const allClients: UserData[] = (clientRoles || []).map(cr => {
        const profile = profilesMap.get(cr.user_id);
        return {
          id: cr.user_id,
          first_name: profile?.first_name || "",
          last_name: profile?.last_name || "",
          profile_image_url: profile?.profile_image_url,
          qr_count: clientQRMap.get(cr.user_id) || 0,
          last_access: lastAccessMap.get(cr.user_id),
          role: "client" as const,
        };
      }).sort((a, b) => b.qr_count - a.qr_count);

      return {
        totalUsers: totalUsers || 0,
        totalPartners: totalPartners || 0,
        totalClients: totalClients || 0,
        totalQRCodes: totalQRCodes || 0,
        usedQRCodes: usedQRCodes || 0,
        recentAccesses: recentAccesses || 0,
        allPartners,
        allClients,
      };
    },
    staleTime: STATS_STALE_TIME,
    gcTime: STATS_CACHE_TIME,
  });
};
