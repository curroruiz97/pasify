import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTranslation } from "react-i18next";
import { useEffect, useState, useRef } from "react";

interface PlayerInfo {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
}

interface QuizScoreBarProps {
  player1: PlayerInfo;
  player2: PlayerInfo;
  player1Score: number;
  player2Score: number;
  currentRound: number;
  userId: string;
}

const AnimatedScore = ({ score }: { score: number }) => {
  const [animate, setAnimate] = useState(false);
  const prevScore = useRef(score);

  useEffect(() => {
    if (score !== prevScore.current) {
      setAnimate(true);
      prevScore.current = score;
      const t = setTimeout(() => setAnimate(false), 400);
      return () => clearTimeout(t);
    }
  }, [score]);

  return (
    <span className={`text-3xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] ${animate ? "quiz-score-pop" : ""}`}>
      {score}
    </span>
  );
};

const QuizScoreBar = ({
  player1,
  player2,
  player1Score,
  player2Score,
  currentRound,
  userId,
}: QuizScoreBarProps) => {
  const { t } = useTranslation();

  const isP1 = userId === player1.id;
  const me = isP1 ? player1 : player2;
  const opp = isP1 ? player2 : player1;
  const myScore = isP1 ? player1Score : player2Score;
  const oppScore = isP1 ? player2Score : player1Score;

  const getName = (p: PlayerInfo) => p.first_name || "?";

  return (
    <div className="flex items-center justify-between w-full px-4 py-3 bg-blue-950/90 rounded-2xl border-2 border-blue-400/30 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
      {/* My side */}
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12 ring-2 ring-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.4)]">
          <AvatarImage src={me.profile_image_url || undefined} />
          <AvatarFallback className="bg-blue-600 text-white text-sm font-black">
            {getName(me)[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col items-start">
          <span className="text-[11px] text-blue-300 font-bold">{t("quiz.you")}</span>
          <AnimatedScore score={myScore} />
        </div>
      </div>

      {/* Round */}
      <div className="flex flex-col items-center px-3">
        <span className="text-[10px] text-blue-300/70 font-bold uppercase tracking-widest">
          {t("quiz.round")}
        </span>
        <span className="text-2xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          {Math.min(currentRound, 10)}<span className="text-blue-300/50 text-base">/10</span>
        </span>
      </div>

      {/* Opponent */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-[11px] text-orange-300 font-bold">{t("quiz.opponent")}</span>
          <AnimatedScore score={oppScore} />
        </div>
        <Avatar className="h-12 w-12 ring-2 ring-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.4)]">
          <AvatarImage src={opp.profile_image_url || undefined} />
          <AvatarFallback className="bg-orange-600 text-white text-sm font-black">
            {getName(opp)[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
};

export default QuizScoreBar;
