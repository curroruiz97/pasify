import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Swords, Clock } from "lucide-react";
import { playButtonSound } from "@/hooks/useButtonSound";
import { supabase } from "@/integrations/supabase/client";

interface QuizRecentMatchesProps {
  userId: string;
  onBack: () => void;
}

const QuizRecentMatches = ({ userId, onBack }: QuizRecentMatchesProps) => {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("quiz_matches")
        .select("id, player1_id, player2_id, player1_score, player2_score, status, winner_id, created_at")
        .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(20);

      if (data) {
        const oppIds = data.map((m) =>
          m.player1_id === userId ? m.player2_id : m.player1_id
        );
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, profile_image_url")
          .in("id", [...new Set(oppIds)]);

        const profileMap = new Map(
          (profiles || []).map((p) => [p.id, p])
        );

        setMatches(
          data.map((m) => {
            const oppId = m.player1_id === userId ? m.player2_id : m.player1_id;
            return { ...m, opponent: profileMap.get(oppId) };
          })
        );
      }
      setLoading(false);
    };
    load();
  }, [userId]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("quiz.justNow");
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gradient-to-b from-orange-50 to-white">
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-4 pt-4 pb-4 shadow-[0_4px_20px_rgba(249,115,22,0.4)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { playButtonSound(); onBack(); }}
              className="text-white active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-black text-white tracking-wide">{t("quiz.recentMatches")}</h1>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 pb-24">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : matches.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-orange-100 flex items-center justify-center">
                <Swords className="w-10 h-10 text-orange-300" />
              </div>
              <p className="font-bold text-orange-400 text-sm">{t("quiz.noMatches")}</p>
            </div>
          ) : (
            <div className="space-y-3 pt-4">
              {matches.map((match, idx) => {
                const isP1 = match.player1_id === userId;
                const myScore = isP1 ? match.player1_score : match.player2_score;
                const oppScore = isP1 ? match.player2_score : match.player1_score;
                const won = match.winner_id === userId;
                const draw = match.winner_id === null;

                const statusColor = won
                  ? "from-green-500 to-emerald-600"
                  : draw
                  ? "from-gray-400 to-gray-500"
                  : "from-red-400 to-red-500";

                const statusBg = won
                  ? "bg-green-50"
                  : draw
                  ? "bg-gray-50"
                  : "bg-red-50";

                return (
                  <div
                    key={match.id}
                    className={`relative overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-gray-100 quiz-fade-in-up`}
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    {/* Top color accent bar */}
                    <div className={`h-1 bg-gradient-to-r ${statusColor}`} />

                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Opponent avatar */}
                      <div className="relative">
                        <Avatar className="h-12 w-12 ring-2 ring-gray-200 shadow-md">
                          <AvatarImage src={match.opponent?.profile_image_url || undefined} />
                          <AvatarFallback className="bg-gradient-to-br from-orange-400 to-orange-500 text-white font-bold text-sm">
                            {(match.opponent?.first_name || "?")[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-gray-800 truncate">
                          vs {match.opponent?.first_name || "Opponent"}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-300" />
                          <p className="text-[10px] text-gray-400 font-medium">
                            {formatDate(match.created_at)}
                          </p>
                        </div>
                      </div>

                      {/* Score */}
                      <div className="flex items-center gap-2">
                        <div className={`px-3 py-1.5 rounded-xl ${statusBg}`}>
                          <span
                            className={`text-lg font-black ${
                              won ? "text-green-600" : draw ? "text-gray-500" : "text-red-500"
                            }`}
                          >
                            {myScore}-{oppScore}
                          </span>
                        </div>
                      </div>

                      {/* Result badge */}
                      <div className={`px-2.5 py-1 rounded-lg bg-gradient-to-r ${statusColor} shadow-sm`}>
                        <span className="text-[10px] font-black text-white uppercase tracking-wider">
                          {won ? t("quiz.victory") : draw ? t("quiz.draw") : t("quiz.defeat")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizRecentMatches;
