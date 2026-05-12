import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const POSTS_CACHE_TIME = 5 * 60 * 1000; // 5 minuti
const POSTS_STALE_TIME = 5 * 1000; // 5 secondi — post devono essere freschi
const PAGE_SIZE = 12;

export interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  media_type: "image" | "video" | null;
  status: string;
  city: string | null;
  created_at: string;
  profiles: {
    first_name: string;
    last_name: string;
    profile_image_url: string;
    business_name: string;
    business_city: string | null;
  };
  likes: Array<{ id: string; user_id: string }>;
}

// Helper to apply country/city filters
const applyLocationFilters = (query: any, country?: string, city?: string) => {
  if (country && city) {
    query = query.or(`country.eq.${country},country.is.null`);
    query = query.filter('city', 'ilike', city);
  } else if (country) {
    query = query.or(`country.eq.${country},country.is.null`);
  } else if (city) {
    query = query.filter('city', 'ilike', city);
  }
  return query;
};

// Fetch posts con infinite scroll e paginazione
export const usePosts = (city?: string, country?: string) => {
  return useInfiniteQuery({
    queryKey: ["posts", city, country],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from("posts")
        .select(`
          *,
          profiles!posts_user_id_fkey(first_name, last_name, profile_image_url, business_name, business_city),
          likes(id, user_id)
        `)
        .eq("status", "approved");

      query = applyLocationFilters(query, country, city);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;
      return (data || []) as Post[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined; // No more pages
      return allPages.flat().length; // Next offset
    },
    staleTime: POSTS_STALE_TIME,
    gcTime: POSTS_CACHE_TIME,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
};

// Flat helper: returns all posts from all pages as a single array
export const usePostsFlat = (city?: string, country?: string) => {
  const query = usePosts(city, country);
  return {
    ...query,
    data: query.data?.pages?.flat() ?? [],
    isLoading: query.isLoading,
  };
};

// Fetch video posts con cache - filtrati per città e paese
export const useVideoPosts = (enabled: boolean = true, city?: string, country?: string) => {
  return useQuery({
    queryKey: ["video-posts", city, country],
    queryFn: async () => {
      let query = supabase
        .from("posts")
        .select(`
          *,
          profiles!posts_user_id_fkey(first_name, last_name, profile_image_url, business_name, business_city),
          likes(id, user_id)
        `)
        .eq("media_type", "video")
        .eq("status", "approved");

      query = applyLocationFilters(query, country, city);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as Post[];
    },
    staleTime: POSTS_STALE_TIME,
    gcTime: POSTS_CACHE_TIME,
    enabled,
  });
};

// Hook per invalidare la cache — funzioni memoizzate per closure stabili nei useEffect
export const useInvalidatePosts = () => {
  const queryClient = useQueryClient();

  const invalidateAll = useCallback(() => {
    console.log("[useInvalidatePosts] Invalidating all post caches");
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "posts", refetchType: "all" });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "video-posts", refetchType: "all" });
  }, [queryClient]);

  const invalidatePosts = useCallback(
    () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "posts", refetchType: "all" }),
    [queryClient]
  );

  const invalidateVideoPosts = useCallback(
    () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "video-posts", refetchType: "all" }),
    [queryClient]
  );

  return { invalidateAll, invalidatePosts, invalidateVideoPosts };
};

// Hook per aggiornare optimisticamente un like (supporta infinite query pages)
export const useOptimisticLike = () => {
  const queryClient = useQueryClient();

  return (postId: string, userId: string, isLiked: boolean) => {
    const updateLikes = (oldData: any) => {
      if (!oldData) return oldData;
      // Support infinite query format (pages array)
      if (oldData.pages) {
        return {
          ...oldData,
          pages: oldData.pages.map((page: Post[]) =>
            page.map((post) => {
              if (post.id === postId) {
                return {
                  ...post,
                  likes: isLiked
                    ? [...post.likes, { id: "temp", user_id: userId }]
                    : post.likes.filter((l) => l.user_id !== userId),
                };
              }
              return post;
            })
          ),
        };
      }
      // Support flat array format (video-posts)
      if (Array.isArray(oldData)) {
        return oldData.map((post: Post) => {
          if (post.id === postId) {
            return {
              ...post,
              likes: isLiked
                ? [...post.likes, { id: "temp", user_id: userId }]
                : post.likes.filter((l) => l.user_id !== userId),
            };
          }
          return post;
        });
      }
      return oldData;
    };

    queryClient.setQueriesData(
      { predicate: (query) => query.queryKey[0] === "posts" },
      updateLikes
    );
    queryClient.setQueriesData(
      { predicate: (query) => query.queryKey[0] === "video-posts" },
      updateLikes
    );
  };
};
