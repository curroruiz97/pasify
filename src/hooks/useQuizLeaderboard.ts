import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LeaderboardEntry {
  user_id: string;
  total_wins: number;
  total_matches: number;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

export const useQuizLeaderboard = (
  country?: string | null,
  city?: string | null
) => {
  return useQuery({
    queryKey: ["quiz-leaderboard", country, city],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      // Get ALL completed matches
      const { data: matches, error: mErr } = await supabase
        .from("quiz_matches")
        .select("id, player1_id, player2_id, winner_id, status")
        .eq("status", "completed");

      if (mErr) {
        console.error("Leaderboard matches error:", mErr);
        throw mErr;
      }
      if (!matches || matches.length === 0) return [];

      // Count wins and matches per player
      const statsMap = new Map<string, { wins: number; matches: number }>();

      for (const m of matches) {
        // Player 1
        const s1 = statsMap.get(m.player1_id) || { wins: 0, matches: 0 };
        s1.matches++;
        if (m.winner_id === m.player1_id) s1.wins++;
        statsMap.set(m.player1_id, s1);

        // Player 2
        const s2 = statsMap.get(m.player2_id) || { wins: 0, matches: 0 };
        s2.matches++;
        if (m.winner_id === m.player2_id) s2.wins++;
        statsMap.set(m.player2_id, s2);
      }

      // Get all player IDs
      const allUserIds = [...statsMap.keys()];
      if (allUserIds.length === 0) return [];

      // Load profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, profile_image_url, country, city")
        .in("id", allUserIds);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.id, p])
      );

      // Build entries, filter by country/city if needed
      let entries: LeaderboardEntry[] = [];
      for (const [uid, stats] of statsMap) {
        const profile = profileMap.get(uid);

        // Filter by country/city
        if (country && country !== "all" && profile?.country !== country) continue;
        if (city && city !== "all" && profile?.city !== city) continue;

        entries.push({
          user_id: uid,
          total_wins: stats.wins,
          total_matches: stats.matches,
          first_name: profile?.first_name || null,
          last_name: profile?.last_name || null,
          profile_image_url: profile?.profile_image_url || null,
        });
      }

      // Sort by wins DESC
      entries.sort((a, b) => b.total_wins - a.total_wins || b.total_matches - a.total_matches);

      return entries.slice(0, 50);
    },
    staleTime: 5000,
    refetchOnMount: "always",
  });
};
