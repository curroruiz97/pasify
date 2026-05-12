import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pasify · hooks de partners.
 *
 * Antes (Students Life) consultaba `reviews`, `gallery`, `partner_views`,
 * `categories`, `profile_image_url`, `latitude/longitude` (en profiles).
 * En Pasify esas tablas/columnas no existen — devolvemos defaults seguros
 * para no romper los consumers (PartnerDetails, PartnersList, RecentPartners,
 * PartnersMap, CategoryCarousel).
 *
 * Mantenemos la misma firma pública. `avatar_url` se expone también como
 * `profile_image_url` para compat con los componentes legacy.
 */

const CACHE_TIME = 10 * 60 * 1000;
const STALE_TIME = 2 * 60 * 1000;

export interface Partner {
  id: string;
  business_name: string | null;
  business_address: string | null;
  business_city: string | null;
  business_phone: string | null;
  business_description: string | null;
  business_category: string | null;
  business_country: string | null;
  profile_image_url: string | null; // alias legacy de avatar_url
  avatar_url: string | null;
  cover_image_url: string | null;
  category_id: string | null;
  latitude: number | null;
  longitude: number | null;
  categories?: {
    name: string;
    display_name: string;
  };
}

const PASIFY_PROFILE_COLUMNS =
  "id, business_name, business_address, business_city, business_country, business_phone, business_description, business_category, avatar_url, cover_image_url, account_status";

const mapProfileToPartner = (p: Record<string, unknown>): Partner => ({
  id: p.id as string,
  business_name: (p.business_name as string | null) ?? null,
  business_address: (p.business_address as string | null) ?? null,
  business_city: (p.business_city as string | null) ?? null,
  business_country: (p.business_country as string | null) ?? null,
  business_phone: (p.business_phone as string | null) ?? null,
  business_description: (p.business_description as string | null) ?? null,
  business_category: (p.business_category as string | null) ?? null,
  // legacy aliases
  profile_image_url: (p.avatar_url as string | null) ?? null,
  avatar_url: (p.avatar_url as string | null) ?? null,
  cover_image_url: (p.cover_image_url as string | null) ?? null,
  category_id: (p.business_category as string | null) ?? null,
  latitude: null,
  longitude: null,
});

const isApprovedAccount = (status: unknown) =>
  status === "approved" || status === "active" || status === null || status === undefined;

/* ============ usePartners ============ */
export const usePartners = () => {
  return useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(PASIFY_PROFILE_COLUMNS)
        .not("business_name", "is", null)
        .order("business_name")
        .limit(50);
      if (error) throw error;
      return (data ?? [])
        .filter((p: Record<string, unknown>) => isApprovedAccount(p.account_status))
        .map(mapProfileToPartner);
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });
};

/* ============ usePartner (single) ============ */
export const usePartner = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["partner", partnerId],
    queryFn: async () => {
      if (!partnerId) return null;

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", partnerId)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profileData) return null;

      // Reviews y gallery no existen en Pasify aún. Devolvemos arrays vacíos
      // hasta que se reintroduzca el sistema de moderación + galería real.
      return {
        ...profileData,
        profile_image_url: profileData.avatar_url ?? null,
        reviews: [] as Array<{
          rating: number;
          comment: string | null;
          created_at: string;
          client_id: string;
          profiles?: { first_name: string | null; last_name: string | null } | null;
        }>,
        avgRating: "0.0",
        reviewCount: 0,
      };
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

/* ============ useCategories ============ */
// Pasify usa `business_categories` (slug + label) en lugar de `categories`.
export const useCategories = () => {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_categories")
        .select("slug, label_es, label_en, sort_order")
        .order("sort_order");
      if (error) {
        // Si la tabla aún no existe en local, devolvemos vacío en lugar de crash.
        console.warn("[useCategories] business_categories unavailable:", error.message);
        return [];
      }
      return (data ?? []).map((c: { slug: string; label_es: string | null; label_en: string | null }) => ({
        id: c.slug,
        name: c.slug,
        display_name: c.label_es ?? c.label_en ?? c.slug,
      }));
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

/* ============ useInvalidatePartners ============ */
export const useInvalidatePartners = () => {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partner"] });
      queryClient.invalidateQueries({ queryKey: ["all-partners-details"] });
      queryClient.invalidateQueries({ queryKey: ["partners-map"] });
      queryClient.invalidateQueries({ queryKey: ["recent-partners"] });
    },
    invalidatePartner: (partnerId: string) =>
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] }),
  };
};

/* ============ useAllPartnersWithDetails ============ */
export const useAllPartnersWithDetails = () => {
  return useQuery({
    queryKey: ["all-partners-details"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(PASIFY_PROFILE_COLUMNS)
        .not("business_name", "is", null)
        .limit(50);
      if (error) throw error;
      return (data ?? [])
        .filter((p: Record<string, unknown>) => isApprovedAccount(p.account_status))
        .map((p) => ({
          ...mapProfileToPartner(p as Record<string, unknown>),
          reviews: [] as Array<{ rating: number }>,
          gallery: [] as Array<{ image_url: string }>,
        }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/* ============ usePartnersByCategory ============ */
export const usePartnersByCategory = (
  category: string | null,
  city?: string | null,
  country?: string | null
) => {
  const { data: allPartners = [], isLoading } = useAllPartnersWithDetails();

  const filteredPartners = category
    ? allPartners.filter((p) => {
        const partnerCategory = p.business_category?.toLowerCase().trim();
        const searchCategory = category.toLowerCase().trim();
        if (partnerCategory !== searchCategory) return false;
        if (country) {
          const partnerCountry = p.business_country ?? "ES";
          if (partnerCountry !== country) return false;
        }
        if (city) {
          const partnerCity = p.business_city?.toLowerCase().trim();
          if (partnerCity && partnerCity !== city.toLowerCase().trim()) return false;
        }
        return true;
      })
    : [];

  return { data: filteredPartners, isLoading };
};

/* ============ usePartnersForMap ============ */
// Pasify profiles no tiene latitude/longitude. Hasta que se añada geocoding
// del business_address, devolvemos vacío (la PartnersMap aterriza con un mensaje
// de "datos próximamente" en lugar de crash).
export const usePartnersForMap = (_city?: string | null, _country?: string | null) => {
  return useQuery({
    queryKey: ["partners-map", _city, _country],
    queryFn: async () => [] as Array<Partner>,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });
};

/* ============ useRecentPartners ============ */
// `partner_views` no existe en Pasify (era audit legacy). Devolvemos vacío;
// los componentes consumidores muestran "sin partners recientes".
export const useRecentPartners = (_userId: string | undefined) => {
  return useQuery({
    queryKey: ["recent-partners", _userId],
    queryFn: async () => [] as Partner[],
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!_userId,
  });
};
