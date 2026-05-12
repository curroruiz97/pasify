import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseQuizMatchmakingOptions {
  userId: string;
  country?: string;
  city?: string;
}

interface UseQuizMatchmakingReturn {
  isSearching: boolean;
  matchId: string | null;
  opponentId: string | null;
  error: string | null;
  startSearching: () => Promise<void>;
  cancelSearch: () => Promise<void>;
}

export const useQuizMatchmaking = ({
  userId,
  country,
  city,
}: UseQuizMatchmakingOptions): UseQuizMatchmakingReturn => {
  const [isSearching, setIsSearching] = useState(false);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchmakingIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      // Cancel any pending matchmaking on unmount
      if (matchmakingIdRef.current) {
        supabase
          .from("quiz_matchmaking")
          .update({ status: "cancelled" })
          .eq("id", matchmakingIdRef.current)
          .then(() => {});
      }
    };
  }, [cleanup]);

  const startSearching = useCallback(async () => {
    setIsSearching(true);
    setMatchId(null);
    setOpponentId(null);
    setError(null);

    try {
      // Subscribe to changes BEFORE inserting (to catch instant match)
      const channel = supabase
        .channel(`matchmaking-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "quiz_matchmaking",
            filter: `user_id=eq.${userId}`,
          },
          (payload: any) => {
            const row = payload.new;
            if (row && row.status === "matched" && row.match_id) {
              // Matched! Get the opponent
              supabase
                .from("quiz_matches")
                .select("player1_id, player2_id")
                .eq("id", row.match_id)
                .single()
                .then(({ data }) => {
                  if (data) {
                    const opp =
                      data.player1_id === userId
                        ? data.player2_id
                        : data.player1_id;
                    setOpponentId(opp);
                    setMatchId(row.match_id);
                    setIsSearching(false);
                    cleanup();
                  }
                });
            }
          }
        )
        .subscribe();

      channelRef.current = channel;

      // Insert into matchmaking queue
      const { data, error: insertError } = await supabase
        .from("quiz_matchmaking")
        .insert({
          user_id: userId,
          country: country || null,
          city: city || null,
          status: "waiting",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      matchmakingIdRef.current = data.id;

      // Check if already matched (trigger may have matched instantly)
      if (data.status === "matched" && data.match_id) {
        const { data: matchData } = await supabase
          .from("quiz_matches")
          .select("player1_id, player2_id")
          .eq("id", data.match_id)
          .single();

        if (matchData) {
          const opp =
            matchData.player1_id === userId
              ? matchData.player2_id
              : matchData.player1_id;
          setOpponentId(opp);
          setMatchId(data.match_id);
          setIsSearching(false);
          cleanup();
          return;
        }
      }

      // 30s timeout
      timeoutRef.current = setTimeout(async () => {
        if (matchmakingIdRef.current) {
          await supabase
            .from("quiz_matchmaking")
            .update({ status: "cancelled" })
            .eq("id", matchmakingIdRef.current);
        }
        setIsSearching(false);
        setError("timeout");
        cleanup();
      }, 30000);
    } catch (err: any) {
      console.error("Matchmaking error:", err);
      setError(err.message || "Error searching for opponent");
      setIsSearching(false);
      cleanup();
    }
  }, [userId, country, city, cleanup]);

  const cancelSearch = useCallback(async () => {
    if (matchmakingIdRef.current) {
      await supabase
        .from("quiz_matchmaking")
        .update({ status: "cancelled" })
        .eq("id", matchmakingIdRef.current);
    }
    setIsSearching(false);
    setError(null);
    cleanup();
  }, [cleanup]);

  return {
    isSearching,
    matchId,
    opponentId,
    error,
    startSearching,
    cancelSearch,
  };
};
