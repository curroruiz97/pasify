/**
 * usePosts · LEGACY NEUTRALIZED stub.
 *
 * Tabla `posts` eliminada al migrar a Pasify. Stub que mantiene la firma para
 * que Social.tsx (orphan), VideoFeed (orphan), PostCard (orphan) y cualquier
 * import latente compilen sin romper.
 */
import { useQueryClient } from "@tanstack/react-query";

export interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  media_type: "image" | "video" | null;
  created_at: string;
  status: string;
  profiles?: {
    id?: string;
    first_name: string | null;
    last_name: string | null;
    business_name?: string | null;
    profile_image_url?: string | null;
    avatar_url?: string | null;
  } | null;
  likes_count?: number;
  comments_count?: number;
}

const emptyPage = { posts: [] as Post[], hasMore: false, nextCursor: null as string | null };

export const usePosts = () => ({ data: emptyPage, isLoading: false, error: null });
export const usePostsFlat = () => ({
  posts: [] as Post[],
  isLoading: false,
  fetchNextPage: async () => {},
  hasNextPage: false,
  isFetchingNextPage: false,
  refetch: async () => {},
});
export const useVideoPosts = () => ({
  posts: [] as Post[],
  isLoading: false,
  fetchNextPage: async () => {},
  hasNextPage: false,
  isFetchingNextPage: false,
});
export const useOptimisticLike = () => ({
  toggleLike: async (_postId: string) => false,
  isLiked: (_postId: string) => false,
});
export const useInvalidatePosts = () => {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  };
};
