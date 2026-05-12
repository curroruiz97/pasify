import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuizQuestion as QuizQuestionType } from "@/hooks/useQuizMatch";
import { playButtonSound } from "@/hooks/useButtonSound";

interface QuizQuestionProps {
  question: QuizQuestionType;
  onAnswer: (selectedIndex: number, timeMs: number) => void;
  disabled: boolean;
  roundStartTime: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  history:   "bg-amber-500 text-white",
  science:   "bg-emerald-500 text-white",
  sports:    "bg-sky-500 text-white",
  geography: "bg-violet-500 text-white",
  music:     "bg-pink-500 text-white",
  cinema:    "bg-rose-500 text-white",
};

const ANSWER_COLORS = [
  { bg: "bg-blue-800", border: "border-blue-500", hover: "hover:bg-blue-700" },
  { bg: "bg-cyan-800", border: "border-cyan-500", hover: "hover:bg-cyan-700" },
  { bg: "bg-indigo-800", border: "border-indigo-500", hover: "hover:bg-indigo-700" },
  { bg: "bg-sky-800", border: "border-sky-500", hover: "hover:bg-sky-700" },
];

const QuizQuestionComponent = ({
  question,
  onAnswer,
  disabled,
  roundStartTime,
}: QuizQuestionProps) => {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleSelect = (index: number) => {
    if (disabled || selectedIndex !== null) return;
    playButtonSound();
    const timeMs = Date.now() - roundStartTime;
    setSelectedIndex(index);
    setShowResult(true);
    onAnswer(index, timeMs);
  };

  const getButtonClass = (index: number) => {
    const color = ANSWER_COLORS[index % ANSWER_COLORS.length];
    const base = "rounded-2xl p-4 text-left font-bold transition-all active:scale-[0.97] border-2 shadow-[0_4px_15px_rgba(0,0,0,0.3)]";

    if (!showResult) {
      return `${base} ${color.bg} ${color.border} text-white ${color.hover}`;
    }

    const isCorrect = index === question.correct_index;
    const isSelected = index === selectedIndex;

    if (isCorrect) {
      return `${base} bg-green-600 border-green-400 text-white shadow-[0_0_20px_rgba(74,222,128,0.5)] quiz-correct-glow`;
    }
    if (isSelected && !isCorrect) {
      return `${base} bg-red-700 border-red-400 text-white shadow-[0_0_20px_rgba(248,113,113,0.5)] quiz-shake`;
    }
    return `${base} ${color.bg} ${color.border} text-white/30`;
  };

  const catColor = CATEGORY_COLORS[question.category] || CATEGORY_COLORS.history;

  return (
    <div className="flex flex-col gap-4 w-full quiz-fade-in-up">
      {/* Category */}
      <div className="flex justify-center">
        <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider shadow-lg ${catColor}`}>
          {t(`quiz.categories.${question.category}`)}
        </span>
      </div>

      {/* Question */}
      <div className="bg-blue-950/80 rounded-2xl px-5 py-4 border-2 border-blue-400/20 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
        <h2 className="text-lg font-black text-center text-white leading-relaxed drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          {question.question}
        </h2>
      </div>

      {/* Answers 2x2 */}
      <div className="grid grid-cols-2 gap-3">
        {question.answers.map((answer, index) => (
          <button
            key={index}
            onClick={() => handleSelect(index)}
            disabled={disabled || selectedIndex !== null}
            className={getButtonClass(index)}
          >
            <span className="text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">{answer}</span>
          </button>
        ))}
      </div>

      {/* Feedback */}
      {showResult && (
        <div className="text-center mt-1 quiz-scale-in">
          {selectedIndex === question.correct_index ? (
            <span className="text-green-400 font-black text-xl drop-shadow-[0_0_10px_rgba(74,222,128,0.6)]">+1</span>
          ) : (
            <span className="text-red-400 font-black text-xl drop-shadow-[0_0_10px_rgba(248,113,113,0.6)]">0</span>
          )}
        </div>
      )}
    </div>
  );
};

export default QuizQuestionComponent;
