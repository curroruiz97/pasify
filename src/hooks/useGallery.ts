import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const CACHE_TIME = 15 * 60 * 1000; // 15 minuti
const STALE_TIME = 5 * 60 * 1000; // 5 minuti - le immagini cambiano raramente

export interface GalleryImage {
  id: string;
  partner_id: string;
  image_url: string;
  caption: string | null;
  display_order: number | null;
}

// Fetch gallery di un partner
export const usePartnerGallery = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["gallery", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];

      const { data, error } = await supabase
        .from("gallery")
        .select("*")
        .eq("partner_id", partnerId)
        .order("display_order", { ascending: true });

      if (error) throw error;
      return data as GalleryImage[];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

// Hook per invalidare la cache
export const useInvalidateGallery = () => {
  const queryClient = useQueryClient();

  return {
    invalidatePartnerGallery: (partnerId: string) =>
      queryClient.invalidateQueries({ queryKey: ["gallery", partnerId] }),
  };
};
