import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuizMatch } from "@/hooks/useQuizMatch";
import { playButtonSound } from "@/hooks/useButtonSound";
import QuizScoreBar from "./QuizScoreBar";
import QuizTimerRing from "./QuizTimerRing";
import QuizQuestionComponent from "./QuizQuestion";
import QuizResult from "./QuizResult";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Flag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PlayerProfile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_image_url?: string | null;
}

interface QuizMatchProps {
  matchId: string;
  userId: string;
  language: string;
  onBack: () => void;
  onPlayAgain: () => void;
}

const QuizMatch = ({
  matchId,
  userId,
  language,
  onBack,
  onPlayAgain,
}: QuizMatchProps) => {
  const { t } = useTranslation();
  const {
    questions,
    matchState,
    currentQuestion,
    myAnswers,
    opponentAnswers,
    timeRemaining,
    isWaitingForOpponent,
    hasAnsweredCurrentRound,
    submitAnswer,
    forfeit,
    loading,
  } = useQuizMatch({ matchId, userId, language });

  const [player1Profile, setPlayer1Profile] = useState<PlayerProfile | null>(null);
  const [player2Profile, setPlayer2Profile] = useState<PlayerProfile | null>(null);
  const roundStartRef = useRef(Date.now());

  useEffect(() => {
    if (!matchState) return;
    const loadProfiles = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, profile_image_url")
        .in("id", [matchState.player1Id, matchState.player2Id]);
      if (data) {
        setPlayer1Profile(data.find((p) => p.id === matchState.player1Id) || null);
        setPlayer2Profile(data.find((p) => p.id === matchState.player2Id) || null);
      }
    };
    loadProfiles();
  }, [matchState?.player1Id, matchState?.player2Id]);

  // Reset round start time when round changes
  useEffect(() => {
    if (matchState) {
      roundStartRef.current = Date.now();
    }
  }, [matchState?.currentRound]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col">
        <img src="/sfondo_game.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-blue-950/70" />
        <div className="relative z-10 flex flex-col items-center justify-center flex-1 gap-4">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-blue-200 text-sm font-bold">Loading...</span>
        </div>
      </div>
    );
  }

  if (matchState && (matchState.status === "completed" || matchState.status === "abandoned")) {
    return (
      <QuizResult
        matchState={matchState}
        userId={userId}
        questions={questions}
        myAnswers={myAnswers}
        opponentAnswers={opponentAnswers}
        player1Profile={player1Profile}
        player2Profile={player2Profile}
        onPlayAgain={onPlayAgain}
        onBack={onBack}
      />
    );
  }

  if (!matchState || !currentQuestion) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Game background */}
      <img src="/sfondo_game.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-blue-950/60 via-blue-900/50 to-blue-950/80" />

      {/* Score bar at top */}
      <div className="relative z-10 px-3 pt-4 pb-1">
        <QuizScoreBar
          player1={player1Profile || { id: matchState.player1Id }}
          player2={player2Profile || { id: matchState.player2Id }}
          player1Score={matchState.player1Score}
          player2Score={matchState.player2Score}
          currentRound={matchState.currentRound}
          userId={userId}
        />
      </div>

      {/* Spacer */}
      <div className="relative z-10 flex-1 min-h-0" />

      {/* Timer — big, right above question */}
      <div className="relative z-10 flex justify-center pb-3">
        {hasAnsweredCurrentRound ? (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-bold text-blue-300">{t("quiz.waitingOpponent")}</span>
          </div>
        ) : (
          <QuizTimerRing timeRemaining={timeRemaining} size={70} />
        )}
      </div>

      {/* Question area at bottom */}
      <div className="relative z-10 px-4 pb-4">
        <QuizQuestionComponent
          key={matchState.currentRound}
          question={currentQuestion}
          onAnswer={submitAnswer}
          disabled={hasAnsweredCurrentRound}
          roundStartTime={roundStartRef.current}
        />

        {/* Forfeit */}
        <div className="mt-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="w-full text-center text-blue-400/40 text-sm font-bold py-2 active:text-blue-300/60 transition-colors">
                <Flag className="w-3.5 h-3.5 inline mr-1" />
                {t("quiz.forfeit")}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("quiz.forfeit")}</AlertDialogTitle>
                <AlertDialogDescription>{t("quiz.forfeitConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("quiz.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => { playButtonSound(); forfeit(); }} className="bg-red-500 hover:bg-red-600">
                  {t("quiz.forfeitYes")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
};

export default QuizMatch;
