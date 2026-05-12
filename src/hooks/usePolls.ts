import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Poll {
  id: string;
  user_id: string;
  question: string;
  image_url: string | null;
  city: string | null;
  status: string;
  created_at: string;
  profiles: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    profile_image_url: string | null;
  } | null;
}

const POLLS_STALE_TIME = 10 * 1000; // 10s
const POLLS_CACHE_TIME = 5 * 60 * 1000; // 5 min

export const usePolls = (city?: string, country?: string) => {
  return useQuery({
    queryKey: ["polls", city, country],
    queryFn: async () => {
      let query = supabase
        .from("polls")
        .select(
          `id, user_id, question, image_url, city, status, created_at,
           profiles!polls_user_id_profiles_fkey(id, first_name, last_name, business_name, profile_image_url)`,
        )
        .eq("status", "approved");

      if (city) {
        query = query.or(`city.ilike.${city},city.is.null`);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return (data || []) as unknown as Poll[];
    },
    staleTime: POLLS_STALE_TIME,
    gcTime: POLLS_CACHE_TIME,
    refetchOnWindowFocus: "always",
  });
};

export const useInvalidatePolls = () => {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "polls", refetchType: "all" }),
    [queryClient],
  );
};
