/**
 * usePolls · LEGACY NEUTRALIZED stub.
 * Tabla `polls` eliminada en Pasify. Stub para que Social.tsx orphan compile.
 */
import { useQueryClient } from "@tanstack/react-query";

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
    business_name?: string | null;
    profile_image_url?: string | null;
    avatar_url?: string | null;
  } | null;
}

export const usePolls = () => ({ data: [] as Poll[], isLoading: false, error: null });
export const useInvalidatePolls = () => {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: ["polls"] }),
  };
};
