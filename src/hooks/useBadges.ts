/**
 * useBadges · LEGACY NEUTRALIZED stub.
 *
 * El sistema de badges/stamps de Students Life se eliminó al migrar a Pasify
 * (tablas `badges`, `user_badges`, `user_stats` ya no existen). Este módulo
 * mantiene la firma para que los consumers actuales (BadgesGallery,
 * BadgeAnimation y la página `/badges` orphaned) no rompan los imports.
 *
 * Devolvemos arrays vacíos y no-ops. Si en el futuro Pasify reintroduce
 * gamificación de tickets/loyalty, este es el punto de extensión.
 */

export interface Badge {
  id: string;
  name: string;
  description: string;
  badge_type: string;
  threshold: number;
  icon: string;
  color: string;
  user_type: string;
  earned?: boolean;
  earned_at?: string;
}

export interface UserStats {
  user_id: string;
  events_attended: number;
  discounts_used: number;
  posts_count: number;
  comments_count: number;
  likes_received: number;
}

export const useBadges = (_userId?: string) => {
  return {
    badges: [] as Badge[],
    userBadges: [] as Badge[],
    userStats: null as UserStats | null,
    loading: false,
    error: null as Error | null,
    refetch: async () => {},
  };
};
