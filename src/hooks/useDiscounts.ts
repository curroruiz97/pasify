import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const CACHE_TIME = 10 * 60 * 1000; // 10 minuti
const STALE_TIME = 2 * 60 * 1000; // 2 minuti

export interface Discount {
  id: string;
  partner_id: string;
  title: string;
  description: string | null;
  discount_percentage: number;
  start_date: string;
  end_date: string;
  image_url: string | null;
  link_url: string | null;
  qr_enabled: boolean;
  is_active: boolean;
}

// Fetch sconti di un partner
export const usePartnerDiscounts = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["discounts", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("discounts")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("is_active", true)
        .gte("end_date", now)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as Discount[];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

// Fetch tutti gli sconti attivi
export const useAllDiscounts = () => {
  return useQuery({
    queryKey: ["all-discounts"],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("discounts")
        .select("*")
        .eq("is_active", true)
        .gte("end_date", now)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });
};

// Hook per invalidare la cache
export const useInvalidateDiscounts = () => {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      queryClient.invalidateQueries({ queryKey: ["all-discounts"] });
    },
    invalidatePartnerDiscounts: (partnerId: string) =>
      queryClient.invalidateQueries({ queryKey: ["discounts", partnerId] }),
  };
};
