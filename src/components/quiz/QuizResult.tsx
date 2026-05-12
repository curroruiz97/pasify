import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Handshake, ArrowLeft, RotateCcw, Check, X } from "lucide-react";
import type { QuizMatchState, QuizQuestion, QuizAnswer } from "@/hooks/useQuizMatch";
import { playButtonSound } from "@/hooks/useButtonSound";

interface PlayerProfile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
}

interface QuizResultProps {
  matchState: QuizMatchState;
  userId: string;
  questions: QuizQuestion[];
  myAnswers: QuizAnswer[];
  opponentAnswers: QuizAnswer[];
  player1Profile: PlayerProfile | null;
  player2Profile: PlayerProfile | null;
  onPlayAgain: () => void;
  onBack: () => void;
}

const QuizResult = ({
  matchState,
  userId,
  questions,
  myAnswers,
  opponentAnswers,
  player1Profile,
  player2Profile,
  onPlayAgain,
  onBack,
}: QuizResultProps) => {
  const { t } = useTranslation();
  const confettiTriggered = useRef(false);

  const isP1 = userId === matchState.player1Id;
  const myScore = isP1 ? matchState.player1Score : matchState.player2Score;
  const oppScore = isP1 ? matchState.player2Score : matchState.player1Score;
  const isWinner = matchState.winnerId === userId;
  const isDraw = matchState.winnerId === null && matchState.status === "completed";

  useEffect(() => {
    if (confettiTriggered.current) return;
    confettiTriggered.current = true;
    if (isWinner || isDraw) {
      import("canvas-confetti").then((confettiModule) => {
        const confetti = confettiModule.default;
        if (isWinner) {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ["#FFD700", "#FFA500", "#FF6347", "#00CED1"] });
          setTimeout(() => {
            confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0 }, colors: ["#FFD700", "#FFA500"] });
            confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1 }, colors: ["#FFD700", "#FFA500"] });
          }, 300);
        } else {
          confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 }, colors: ["#C0C0C0", "#A9A9A9", "#D3D3D3"] });
        }
      }).catch(() => {});
    }
  }, [isWinner, isDraw]);

  const getName = (p: PlayerProfile | null) => p?.first_name || "?";
  const meProfile = isP1 ? player1Profile : player2Profile;
  const oppProfile = isP1 ? player2Profile : player1Profile;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto">
      {/* Background */}
      <img src="/sfondo_game.png" alt="" className="fixed inset-0 w-full h-full object-cover -z-10" />
      <div className={`fixed inset-0 -z-[5] ${
        isWinner
          ? "bg-gradient-to-t from-blue-950/90 via-yellow-900/40 to-blue-950/70"
          : isDraw
          ? "bg-gradient-to-t from-blue-950/90 via-gray-800/40 to-blue-950/70"
          : "bg-gradient-to-t from-blue-950/90 via-blue-900/50 to-blue-950/70"
      }`} />

      {/* Hero */}
      <div className="relative z-10 px-6 pt-14 pb-8 text-center">
        <div className="mb-4 quiz-scale-in">
          {isWinner ? (
            <Trophy className="w-20 h-20 text-yellow-400 mx-auto drop-shadow-[0_0_30px_rgba(251,191,36,0.6)]" />
          ) : isDraw ? (
            <Handshake className="w-20 h-20 text-gray-300 mx-auto drop-shadow-[0_0_20px_rgba(209,213,219,0.4)]" />
          ) : (
            <div className="w-20 h-20 bg-blue-900/60 rounded-full flex items-center justify-center mx-auto border-2 border-blue-400/30">
              <span className="text-4xl">💪</span>
            </div>
          )}
        </div>

        <h1 className={`text-4xl font-black mb-3 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${
          isWinner ? "text-yellow-400" : isDraw ? "text-gray-300" : "text-blue-300"
        }`}>
          {isWinner ? t("quiz.victory") : isDraw ? t("quiz.draw") : t("quiz.defeat")}
        </h1>

        {/* Scores */}
        <div className="flex items-center justify-center gap-8 mt-4">
          <div className="flex flex-col items-center quiz-fade-in-up">
            <Avatar className="h-16 w-16 ring-3 ring-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.4)]">
              <AvatarImage src={meProfile?.profile_image_url || undefined} />
              <AvatarFallback className="bg-blue-600 text-white font-black text-xl">
                {getName(meProfile)[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-blue-300 text-xs mt-2 font-bold">{t("quiz.you")}</span>
            <span className="text-white text-3xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{myScore}</span>
          </div>

          <span className="text-blue-400/40 text-2xl font-black">vs</span>

          <div className="flex flex-col items-center quiz-fade-in-up" style={{ animationDelay: "0.1s" }}>
            <Avatar className="h-16 w-16 ring-3 ring-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.4)]">
              <AvatarImage src={oppProfile?.profile_image_url || undefined} />
              <AvatarFallback className="bg-orange-600 text-white font-black text-xl">
                {getName(oppProfile)[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-orange-300 text-xs mt-2 font-bold">{getName(oppProfile)}</span>
            <span className="text-white text-3xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">{oppScore}</span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="relative z-10 px-4 py-4">
        <h3 className="text-base font-black text-blue-200 mb-3">{t("quiz.summary")}</h3>
        <div className="space-y-2">
          {questions.map((q, i) => {
            const myAns = myAnswers.find((a) => a.round_number === i + 1);
            const oppAns = opponentAnswers.find((a) => a.round_number === i + 1);
            return (
              <div key={q.id} className="bg-blue-950/70 rounded-xl p-3 border-2 border-blue-400/15 shadow-[0_2px_10px_rgba(0,0,0,0.3)]">
                <p className="text-sm font-bold text-white/80 mb-2">
                  {i + 1}. {q.question}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    {myAns?.is_correct ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className="text-blue-300">
                      {t("quiz.you")}: {myAns?.is_correct ? "1" : "0"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {oppAns?.is_correct ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <X className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className="text-orange-300">
                      {t("quiz.opponent")}: {oppAns?.is_correct ? "1" : "0"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Buttons */}
      <div className="relative z-10 px-4 pb-10 flex gap-3 mt-auto">
        <button
          onClick={() => { playButtonSound(); onBack(); }}
          className="flex-1 h-14 rounded-2xl bg-blue-900/80 border-2 border-blue-400/30 text-white font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_4px_15px_rgba(0,0,0,0.3)]"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("quiz.backToLobby")}
        </button>
        <button
          onClick={() => { playButtonSound(); onPlayAgain(); }}
          className="flex-1 h-14 rounded-2xl bg-gradient-to-r from-blue-500 via-blue-400 to-cyan-400 text-white font-black flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(96,165,250,0.4)] active:scale-95 transition-transform overflow-hidden relative"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent quiz-btn-shine" />
          <RotateCcw className="w-4 h-4 relative z-10" />
          <span className="relative z-10">{t("quiz.playAgain")}</span>
        </button>
      </div>
    </div>
  );
};

export default QuizResult;
