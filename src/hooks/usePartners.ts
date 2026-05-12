import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const CACHE_TIME = 10 * 60 * 1000; // 10 minuti
const STALE_TIME = 2 * 60 * 1000; // 2 minuti - dati considerati freschi

export interface Partner {
  id: string;
  business_name: string | null;
  business_address: string | null;
  business_city: string | null;
  business_phone: string | null;
  business_description: string | null;
  profile_image_url: string | null;
  category_id: string | null;
  latitude: number | null;
  longitude: number | null;
  categories?: {
    name: string;
    display_name: string;
  };
}

// Fetch tutti i partner approvati
export const usePartners = () => {
  return useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id,
          business_name,
          business_address,
          business_city,
          business_phone,
          business_description,
          profile_image_url,
          category_id,
          latitude,
          longitude,
          account_status
        `)
        .not("business_name", "is", null)
        .order("business_name")
        .limit(50);

      if (error) throw error;

      // Filtra partner approvati
      const approvedPartners = (data || []).filter((p: any) =>
        p.account_status === 'approved' ||
        p.account_status === 'active' ||
        p.account_status === null ||
        p.account_status === undefined
      );

      return approvedPartners as Partner[];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });
};

// Fetch singolo partner
export const usePartner = (partnerId: string | undefined) => {
  return useQuery({
    queryKey: ["partner", partnerId],
    queryFn: async () => {
      if (!partnerId) return null;

      // Fetch profilo partner
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", partnerId)
        .single();

      if (profileError) throw profileError;

      // Fetch recensioni separatamente
      const { data: reviewsData } = await supabase
        .from("reviews")
        .select("rating, comment, created_at, client_id")
        .eq("partner_id", partnerId);

      // Fetch profili dei clienti che hanno fatto recensioni
      const reviews = reviewsData || [];
      let reviewsWithProfiles = reviews;

      if (reviews.length > 0) {
        const clientIds = [...new Set(reviews.map(r => r.client_id))];
        const { data: clientsData } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", clientIds);

        const clientsMap = new Map(clientsData?.map(c => [c.id, c]) || []);
        reviewsWithProfiles = reviews.map(review => ({
          ...review,
          profiles: clientsMap.get(review.client_id) || null
        }));
      }

      // Calcola rating medio
      const avgRating = reviews.length > 0
        ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length
        : 0;

      return {
        ...profileData,
        reviews: reviewsWithProfiles,
        avgRating: avgRating.toFixed(1),
        reviewCount: reviews.length,
      };
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
    enabled: !!partnerId,
  });
};

// Fetch categorie
export const useCategories = () => {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("display_name");

      if (error) throw error;
      return data;
    },
    staleTime: 30 * 60 * 1000, // 30 minuti - le categorie cambiano raramente
    gcTime: 60 * 60 * 1000, // 1 ora
  });
};

// Hook per invalidare la cache
export const useInvalidatePartners = () => {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ["partners"] });
      queryClient.invalidateQueries({ queryKey: ["partner"] });
    },
    invalidatePartner: (partnerId: string) =>
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] }),
  };
};

// Fetch TUTTI i partner con dettagli (una sola query, poi filtriamo client-side)
export const useAllPartnersWithDetails = () => {
  return useQuery({
    queryKey: ["all-partners-details"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id,
          business_name,
          business_address,
          business_city,
          business_country,
          business_category,
          profile_image_url,
          cover_image_url,
          account_status
        `)
        .not("business_name", "is", null)
        .limit(50);

      if (error) throw error;

      // Filtra partner approvati
      const approvedPartners = (data || []).filter((p: any) => {
        if (!p.business_name) return false;
        const isApproved =
          p.account_status === 'approved' ||
          p.account_status === 'active' ||
          p.account_status === null ||
          p.account_status === undefined;
        return isApproved;
      });

      if (approvedPartners.length === 0) return [];

      // Fetch reviews separatamente per tutti i partner
      const partnerIds = approvedPartners.map((p: any) => p.id);

      const { data: reviewsData } = await supabase
        .from("reviews")
        .select("partner_id, rating")
        .in("partner_id", partnerIds)
        .limit(200);

      const { data: galleryData } = await supabase
        .from("gallery")
        .select("partner_id, image_url")
        .in("partner_id", partnerIds)
        .limit(100);

      // Raggruppa reviews e gallery per partner
      const reviewsMap = new Map<string, Array<{rating: number}>>();
      const galleryMap = new Map<string, Array<{image_url: string}>>();

      reviewsData?.forEach(r => {
        if (!reviewsMap.has(r.partner_id)) reviewsMap.set(r.partner_id, []);
        reviewsMap.get(r.partner_id)!.push({ rating: r.rating });
      });

      galleryData?.forEach(g => {
        if (!galleryMap.has(g.partner_id)) galleryMap.set(g.partner_id, []);
        galleryMap.get(g.partner_id)!.push({ image_url: g.image_url });
      });

      return approvedPartners.map((partner: any) => ({
        ...partner,
        reviews: reviewsMap.get(partner.id) || [],
        gallery: galleryMap.get(partner.id) || [],
      }));
    },
    staleTime: 5 * 60 * 1000, // 5 minuti
    gcTime: 15 * 60 * 1000, // 15 minuti
  });
};

// Fetch partner per categoria, città e paese - FILTRO CLIENT-SIDE dalla cache
export const usePartnersByCategory = (category: string | null, city?: string | null, country?: string | null) => {
  const { data: allPartners = [], isLoading } = useAllPartnersWithDetails();

  // Filtra client-side - confronto case-insensitive e gestisce null/undefined
  const filteredPartners = category
    ? allPartners.filter(p => {
        const partnerCategory = (p as any).business_category?.toLowerCase().trim();
        const searchCategory = category.toLowerCase().trim();
        const categoryMatch = partnerCategory === searchCategory;

        if (!categoryMatch) return false;

        // Filtra per paese se specificato (include partner senza country)
        if (country) {
          const partnerCountry = (p as any).business_country || "ES";
          if (partnerCountry !== country) return false;
        }

        // Filtra per città se specificata (include partner senza città)
        if (city) {
          const partnerCity = (p as any).business_city?.toLowerCase().trim();
          if (partnerCity && partnerCity !== city.toLowerCase().trim()) return false;
        }

        return true;
      })
    : [];

  return {
    data: filteredPartners,
    isLoading,
  };
};

// Fetch partner per mappa (con coordinate) - con filtro città e paese opzionale
export const usePartnersForMap = (city?: string | null, country?: string | null) => {
  return useQuery({
    queryKey: ["partners-map", city, country],
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("id, business_name, business_address, business_city, business_country, profile_image_url, latitude, longitude")
        .not("business_name", "is", null)
        .not("business_address", "is", null)
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      // Filtra per paese se specificato
      if (country) {
        query = query.eq("business_country", country);
      }

      // Filtra per città se specificata
      if (city) {
        query = query.ilike("business_city", city);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });
};

// Fetch partner recenti visti dall'utente
export const useRecentPartners = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["recent-partners", userId],
    queryFn: async () => {
      if (!userId) return [];

      // Get most recently viewed partners
      const { data: viewsData } = await supabase
        .from("partner_views")
        .select("partner_id, viewed_at")
        .eq("client_id", userId)
        .order("viewed_at", { ascending: false })
        .limit(20);

      if (!viewsData || viewsData.length === 0) {
        return [];
      }

      // Get unique partner IDs (most recent view for each)
      const seenPartners = new Set<string>();
      const uniquePartnerIds: string[] = [];

      viewsData.forEach(view => {
        if (!seenPartners.has(view.partner_id)) {
          seenPartners.add(view.partner_id);
          uniquePartnerIds.push(view.partner_id);
        }
      });

      // Take only top 5
      const recentPartnerIds = uniquePartnerIds.slice(0, 5);

      // Fetch partner details with reviews and gallery
      const { data: partnersData } = await supabase
        .from("profiles")
        .select(`
          *,
          reviews!reviews_partner_id_fkey(rating),
          gallery(image_url)
        `)
        .in("id", recentPartnerIds);

      if (!partnersData) return [];

      // Sort partners by the order in recentPartnerIds
      return recentPartnerIds
        .map(id => partnersData.find(p => p.id === id))
        .filter(Boolean);
    },
    staleTime: 60 * 1000, // 1 minuto - i partner recenti cambiano spesso
    gcTime: 5 * 60 * 1000, // 5 minuti
    enabled: !!userId,
  });
};

// NOTA: Il prefetch dei partner ora avviene in DataPrefetcher con la query "all-partners-details"
