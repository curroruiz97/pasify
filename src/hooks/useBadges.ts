import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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
  total_accesses: number;
  total_likes: number;
  total_qr_downloaded: number;
  total_posts: number;
  total_qr_scanned: number;
  total_events_created: number;
  total_quiz_wins: number;
}

export const useBadges = (userId: string | undefined, userRole: string | null) => {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [newBadge, setNewBadge] = useState<Badge | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBadges = async () => {
    if (!userId) return;

    try {
      // Load all badges for user type
      const { data: allBadges, error: badgesError } = await supabase
        .from("badges")
        .select("*")
        .in("user_type", [userRole === "partner" ? "partner" : "client", "both"])
        .order("threshold", { ascending: true });

      if (badgesError) throw badgesError;

      // Load user's earned badges
      const { data: earnedBadges, error: earnedError } = await supabase
        .from("user_badges")
        .select("badge_id, earned_at")
        .eq("user_id", userId);

      if (earnedError) throw earnedError;

      // Merge badges with earned status
      const earnedIds = new Set(earnedBadges?.map(b => b.badge_id) || []);
      const mergedBadges = allBadges?.map(badge => ({
        ...badge,
        earned: earnedIds.has(badge.id),
        earned_at: earnedBadges?.find(e => e.badge_id === badge.id)?.earned_at
      })) || [];

      setBadges(mergedBadges);
    } catch (error) {
      console.error("Error loading badges:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserStats = async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from("user_stats")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error && error.code !== "PGRST116") throw error;

      if (!data) {
        // Create initial stats
        const { data: newStats, error: insertError } = await supabase
          .from("user_stats")
          .insert({ user_id: userId })
          .select()
          .single();

        if (insertError) throw insertError;
        setUserStats(newStats);
      } else {
        setUserStats(data);
      }
    } catch (error) {
      console.error("Error loading user stats:", error);
    }
  };

  const checkAndAwardBadges = async () => {
    if (!userId || !userStats) return;

    const statsMap: Record<string, number> = {
      access: userStats.total_accesses,
      likes: userStats.total_likes,
      qr_downloaded: userStats.total_qr_downloaded,
      posts: userStats.total_posts,
      qr_scanned: userStats.total_qr_scanned,
      events_created: userStats.total_events_created,
      quiz_wins: userStats.total_quiz_wins || 0
    };

    for (const badge of badges) {
      if (!badge.earned && statsMap[badge.badge_type] >= badge.threshold) {
        try {
          const { error } = await supabase
            .from("user_badges")
            .insert({
              user_id: userId,
              badge_id: badge.id
            });

          if (!error) {
            setNewBadge(badge);
            await loadBadges();
          }
        } catch (error) {
          console.error("Error awarding badge:", error);
        }
      }
    }
  };

  useEffect(() => {
    loadBadges();
    loadUserStats();
  }, [userId, userRole]);

  useEffect(() => {
    checkAndAwardBadges();
  }, [userStats]);

  return {
    badges,
    userStats,
    newBadge,
    setNewBadge,
    loading,
    loadUserStats,
    loadBadges
  };
};
