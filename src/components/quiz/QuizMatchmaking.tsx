import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { X, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface QuizMatchmakingProps {
  userId: string;
  userProfile: { first_name?: string; profile_image_url?: string };
  isSearching: boolean;
  opponentId: string | null;
  matchId: string | null;
  error?: string | null;
  onCancel: () => void;
  onMatchReady: () => void;
}

const QuizMatchmaking = ({
  userId,
  userProfile,
  isSearching,
  opponentId,
  matchId,
  error,
  onCancel,
  onMatchReady,
}: QuizMatchmakingProps) => {
  const { t } = useTranslation();
  const [opponentProfile, setOpponentProfile] = useState<any>(null);
  const [showVs, setShowVs] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!opponentId) return;
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, profile_image_url")
        .eq("id", opponentId)
        .single();
      setOpponentProfile(data);

      setTimeout(() => setShowVs(true), 300);
      setTimeout(() => setCountdown(3), 800);
      setTimeout(() => setCountdown(2), 1800);
      setTimeout(() => setCountdown(1), 2800);
      setTimeout(() => onMatchReady(), 3800);
    };
    load();
  }, [opponentId]);

  // VS screen when matched
  if (opponentId && matchId) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col">
        {/* Background */}
        <img src="/quiz_duello.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />

        {/* VS content at bottom */}
        <div className="relative z-10 flex flex-col justify-end flex-1">
          <div className="flex items-center justify-center gap-6 pb-32">
            {/* Me */}
            <div className="flex flex-col items-center quiz-fade-in-up">
              <Avatar className="h-20 w-20 ring-4 ring-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.5)]">
                <AvatarImage src={userProfile?.profile_image_url} />
                <AvatarFallback className="bg-blue-600 text-white text-2xl font-black">
                  {userProfile?.first_name?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-blue-300 font-bold mt-2 text-sm">
                {userProfile?.first_name || t("quiz.you")}
              </span>
            </div>

            {/* VS / Countdown */}
            {showVs && (
              <div className="flex flex-col items-center quiz-scale-in">
                {countdown !== null ? (
                  <span className="text-6xl font-black text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.5)] quiz-score-pop">
                    {countdown}
                  </span>
                ) : (
                  <>
                    <Swords className="w-10 h-10 text-yellow-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.5)]" />
                    <span className="text-white/50 text-xs mt-1 font-bold uppercase tracking-widest">
                      {t("quiz.getReady")}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Opponent */}
            <div className="flex flex-col items-center quiz-slide-in-right">
              <Avatar className="h-20 w-20 ring-4 ring-red-400 shadow-[0_0_20px_rgba(248,113,113,0.5)]">
                <AvatarImage src={opponentProfile?.profile_image_url} />
                <AvatarFallback className="bg-red-600 text-white text-2xl font-black">
                  {opponentProfile?.first_name?.[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="text-red-300 font-bold mt-2 text-sm">
                {opponentProfile?.first_name || t("quiz.opponent")}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Searching state
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Background */}
      <img src="/quiz_duello.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />

      {/* Content at bottom */}
      <div className="relative z-10 flex flex-col justify-end flex-1">
        <div className="w-full max-w-[470px] mx-auto px-5 pb-28 flex flex-col items-center">

          {/* Avatar with radar */}
          <div className="relative mb-6">
            <div className="absolute -inset-6 w-40 h-40 rounded-full border-2 border-white/15 quiz-search-pulse" />
            <div className="absolute -inset-6 w-40 h-40 rounded-full border-2 border-white/10 quiz-search-pulse" style={{ animationDelay: "0.6s" }} />
            <div className="absolute -inset-6 w-40 h-40 rounded-full border-2 border-white/5 quiz-search-pulse" style={{ animationDelay: "1.2s" }} />
            <Avatar className="relative h-28 w-28 ring-4 ring-white/30 shadow-[0_0_25px_rgba(255,255,255,0.15)]">
              <AvatarImage src={userProfile?.profile_image_url} />
              <AvatarFallback className="bg-white/15 text-white text-3xl font-black">
                {userProfile?.first_name?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </div>

          {error === "timeout" ? (
            <h2 className="text-yellow-400 text-lg font-black mb-1">{t("quiz.timeout")}</h2>
          ) : error ? (
            <h2 className="text-red-400 text-lg font-black mb-1">{error}</h2>
          ) : (
            <h2 className="text-white text-lg font-black mb-1">{t("quiz.searching")}</h2>
          )}

          <p className="text-white/40 text-sm mb-6">{t("quiz.searchingDesc")}</p>

          {/* Dots */}
          {isSearching && !error && (
            <div className="flex gap-2 mb-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2.5 h-2.5 bg-white/60 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}

          <button
            onClick={onCancel}
            className="h-11 px-6 rounded-xl bg-black/40 backdrop-blur-sm text-white/80 font-bold text-sm flex items-center gap-2 active:scale-95 transition-transform"
          >
            <X className="w-4 h-4" />
            {error ? t("quiz.backToLobby") : t("quiz.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuizMatchmaking;
