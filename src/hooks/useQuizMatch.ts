import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface QuizQuestion {
  id: string;
  category: string;
  difficulty: number;
  question: string;
  answers: string[];
  correct_index: number;
}

export interface QuizAnswer {
  round_number: number;
  user_id: string;
  selected_index: number | null;
  is_correct: boolean;
  answer_time_ms: number;
  score: number;
}

export interface QuizMatchState {
  matchId: string;
  player1Id: string;
  player2Id: string;
  currentRound: number;
  player1Score: number;
  player2Score: number;
  status: string;
  winnerId: string | null;
}

interface UseQuizMatchOptions {
  matchId: string;
  userId: string;
  language: string;
}

interface UseQuizMatchReturn {
  questions: QuizQuestion[];
  matchState: QuizMatchState | null;
  currentQuestion: QuizQuestion | null;
  myAnswers: QuizAnswer[];
  opponentAnswers: QuizAnswer[];
  timeRemaining: number;
  isWaitingForOpponent: boolean;
  hasAnsweredCurrentRound: boolean;
  submitAnswer: (selectedIndex: number, timeMs: number) => Promise<void>;
  forfeit: () => Promise<void>;
  loading: boolean;
}

const getQuestionField = (lang: string): string => {
  const map: Record<string, string> = {
    es: "question_es",
    en: "question_en",
    it: "question_it",
    fr: "question_fr",
    de: "question_de",
    pt: "question_pt",
  };
  return map[lang] || "question_en";
};

const getAnswersField = (lang: string): string => {
  const map: Record<string, string> = {
    es: "answers_es",
    en: "answers_en",
    it: "answers_it",
    fr: "answers_fr",
    de: "answers_de",
    pt: "answers_pt",
  };
  return map[lang] || "answers_en";
};

// Shuffle deterministico (entrambi i giocatori vedono lo stesso ordine,
// ma diverso da quello del DB dove il correct_index è quasi sempre lo stesso).
// Seed = matchId + questionId.
const shuffleAnswers = (
  answers: string[],
  correctIndex: number,
  seed: string,
): { answers: string[]; correctIndex: number } => {
  if (!answers || answers.length < 2) return { answers, correctIndex };
  const indices = answers.map((_, i) => i);
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  }
  for (let i = indices.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    answers: indices.map((i) => answers[i]),
    correctIndex: indices.indexOf(correctIndex),
  };
};

export const useQuizMatch = ({
  matchId,
  userId,
  language,
}: UseQuizMatchOptions): UseQuizMatchReturn => {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [matchState, setMatchState] = useState<QuizMatchState | null>(null);
  const [myAnswers, setMyAnswers] = useState<QuizAnswer[]>([]);
  const [opponentAnswers, setOpponentAnswers] = useState<QuizAnswer[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(10000);
  const [isWaitingForOpponent, setIsWaitingForOpponent] = useState(false);
  const [hasAnsweredCurrentRound, setHasAnsweredCurrentRound] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundStartRef = useRef<number>(Date.now());
  const autoSubmittedRef = useRef(false);
  const answeredRef = useRef(false); // mirror of hasAnsweredCurrentRound for use in interval

  // Refs for latest values (avoid stale closures in timer interval)
  const matchStateRef = useRef(matchState);
  const questionsRef = useRef(questions);
  matchStateRef.current = matchState;
  questionsRef.current = questions;

  // Load match data and questions
  useEffect(() => {
    const loadMatch = async () => {
      try {
        const { data: match } = await supabase
          .from("quiz_matches")
          .select("*")
          .eq("id", matchId)
          .single();

        if (!match) return;

        setMatchState({
          matchId: match.id,
          player1Id: match.player1_id,
          player2Id: match.player2_id,
          currentRound: match.current_round,
          player1Score: match.player1_score,
          player2Score: match.player2_score,
          status: match.status,
          winnerId: match.winner_id,
        });

        const qField = getQuestionField(language);
        const aField = getAnswersField(language);
        const questionIds = match.question_ids as string[];

        const { data: qData } = await supabase
          .from("quiz_questions")
          .select("*")
          .in("id", questionIds);

        if (qData) {
          const ordered = questionIds
            .map((qid) => qData.find((q) => q.id === qid))
            .filter(Boolean)
            .map((q: any) => {
              const sh = shuffleAnswers(q[aField], q.correct_index, `${matchId}-${q.id}`);
              return {
                id: q.id,
                category: q.category,
                difficulty: q.difficulty,
                question: q[qField],
                answers: sh.answers,
                correct_index: sh.correctIndex,
              };
            });
          setQuestions(ordered);
        }

        const { data: answers } = await supabase
          .from("quiz_answers")
          .select("*")
          .eq("match_id", matchId);

        if (answers) {
          setMyAnswers(answers.filter((a) => a.user_id === userId));
          setOpponentAnswers(answers.filter((a) => a.user_id !== userId));
        }

        setLoading(false);
      } catch (err) {
        console.error("Error loading quiz match:", err);
        setLoading(false);
      }
    };

    loadMatch();
  }, [matchId, userId, language]);

  // Subscribe to match changes
  useEffect(() => {
    const channel = supabase
      .channel(`quiz-match-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "quiz_matches",
          filter: `id=eq.${matchId}`,
        },
        (payload: any) => {
          const m = payload.new;
          setMatchState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              currentRound: m.current_round,
              player1Score: m.player1_score,
              player2Score: m.player2_score,
              status: m.status,
              winnerId: m.winner_id,
            };
          });

          if (m.status === "completed") {
            if (timerRef.current) clearInterval(timerRef.current);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "quiz_answers",
          filter: `match_id=eq.${matchId}`,
        },
        (payload: any) => {
          const answer = payload.new;
          if (answer.user_id === userId) {
            setMyAnswers((prev) => [...prev, answer]);
          } else {
            setOpponentAnswers((prev) => [...prev, answer]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, userId]);

  // Auto-submit timeout answer (uses refs to avoid stale closures)
  const doAutoSubmit = useCallback(async (round: number) => {
    const ms = matchStateRef.current;
    const qs = questionsRef.current;
    if (!ms || answeredRef.current) return;

    const currentQ = qs[round - 1];
    if (!currentQ) return;

    answeredRef.current = true;
    setHasAnsweredCurrentRound(true);
    setIsWaitingForOpponent(true);

    try {
      await supabase.from("quiz_answers").insert({
        match_id: matchId,
        round_number: round,
        user_id: userId,
        selected_index: -1,
        is_correct: false,
        answer_time_ms: 10000,
        score: 0,
      });
    } catch (err) {
      console.error("Auto-submit error:", err);
    }
  }, [matchId, userId]);

  // Timer management per round
  useEffect(() => {
    if (!matchState || matchState.status !== "in_progress" || matchState.currentRound > 10) return;

    const currentRound = matchState.currentRound;

    // Reset everything for the new round
    setTimeRemaining(10000);
    setHasAnsweredCurrentRound(false);
    setIsWaitingForOpponent(false);
    autoSubmittedRef.current = false;
    answeredRef.current = false;
    roundStartRef.current = Date.now();

    // Check if already answered this round (e.g., reconnection)
    const alreadyAnswered = myAnswers.some(
      (a) => a.round_number === currentRound
    );
    if (alreadyAnswered) {
      setHasAnsweredCurrentRound(true);
      setIsWaitingForOpponent(true);
      answeredRef.current = true;
      return;
    }

    // Start countdown timer
    const interval = setInterval(() => {
      const elapsed = Date.now() - roundStartRef.current;
      const remaining = Math.max(0, 10000 - elapsed);
      setTimeRemaining(remaining);

      if (remaining <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        clearInterval(interval);
        doAutoSubmit(currentRound);
      }
    }, 50);

    timerRef.current = interval;
    return () => clearInterval(interval);
  }, [matchState?.currentRound, matchState?.status, doAutoSubmit]);

  const submitAnswer = useCallback(
    async (selectedIndex: number, timeMs: number) => {
      if (!matchState || hasAnsweredCurrentRound || answeredRef.current) return;

      const currentQ = questions[matchState.currentRound - 1];
      if (!currentQ) return;

      const isCorrect =
        selectedIndex >= 0 && selectedIndex === currentQ.correct_index;
      const score = isCorrect ? 1 : 0;

      answeredRef.current = true;
      setHasAnsweredCurrentRound(true);
      setIsWaitingForOpponent(true);

      // Stop the timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      try {
        await supabase.from("quiz_answers").insert({
          match_id: matchId,
          round_number: matchState.currentRound,
          user_id: userId,
          selected_index: selectedIndex,
          is_correct: isCorrect,
          answer_time_ms: timeMs,
          score,
        });
      } catch (err) {
        console.error("Error submitting answer:", err);
        try {
          await supabase.from("quiz_answers").insert({
            match_id: matchId,
            round_number: matchState.currentRound,
            user_id: userId,
            selected_index: selectedIndex,
            is_correct: isCorrect,
            answer_time_ms: timeMs,
            score,
          });
        } catch (retryErr) {
          console.error("Retry failed:", retryErr);
        }
      }
    },
    [matchState, questions, hasAnsweredCurrentRound, matchId, userId]
  );

  const forfeit = useCallback(async () => {
    if (!matchState) return;
    try {
      await supabase
        .from("quiz_matches")
        .update({
          status: "abandoned",
          winner_id:
            matchState.player1Id === userId
              ? matchState.player2Id
              : matchState.player1Id,
        })
        .eq("id", matchId);
    } catch (err) {
      console.error("Error forfeiting:", err);
    }
  }, [matchState, matchId, userId]);

  const currentQuestion =
    matchState && matchState.currentRound <= 10
      ? questions[matchState.currentRound - 1] || null
      : null;

  return {
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
  };
};
