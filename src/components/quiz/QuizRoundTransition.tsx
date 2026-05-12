import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface QuizRoundTransitionProps {
  myRoundScore: number;
  opponentRoundScore: number;
  nextRound: number;
  onComplete: () => void;
}

const QuizRoundTransition = ({
  myRoundScore,
  opponentRoundScore,
  nextRound,
  onComplete,
}: QuizRoundTransitionProps) => {
  const { t } = useTranslation();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setShow(false);
      onComplete();
    }, 1000);
    return () => clearTimeout(timeout);
  }, [onComplete]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-950/85">
      <div className="flex flex-col items-center gap-5 quiz-scale-in">
        <div className="flex items-center gap-10">
          <div className="flex flex-col items-center">
            <span className={`text-5xl font-black quiz-score-pop drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${myRoundScore > 0 ? "text-green-400" : "text-white/30"}`}>
              +{myRoundScore}
            </span>
            <span className="text-blue-300 text-sm font-bold mt-2">{t("quiz.you")}</span>
          </div>

          <div className="w-0.5 h-14 bg-blue-400/30 rounded-full" />

          <div className="flex flex-col items-center">
            <span className={`text-5xl font-black quiz-score-pop drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${opponentRoundScore > 0 ? "text-green-400" : "text-white/30"}`} style={{ animationDelay: "0.1s" }}>
              +{opponentRoundScore}
            </span>
            <span className="text-orange-300 text-sm font-bold mt-2">{t("quiz.opponent")}</span>
          </div>
        </div>

        {nextRound <= 10 && (
          <div className="bg-blue-900/60 px-5 py-2 rounded-xl border border-blue-400/20">
            <span className="text-blue-200 text-sm font-black uppercase tracking-widest">
              {t("quiz.round")} {nextRound}/10
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuizRoundTransition;
