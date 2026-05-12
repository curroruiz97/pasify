import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";
import { useQuizMatchmaking } from "@/hooks/useQuizMatchmaking";
import { useQuizMusic } from "@/hooks/useQuizMusic";
import { playButtonSound } from "@/hooks/useButtonSound";
import QuizMatchmaking from "./QuizMatchmaking";
import QuizMatch from "./QuizMatch";
import QuizLeaderboard from "./QuizLeaderboard";
import QuizLoadingScreen from "./QuizLoadingScreen";
import QuizRecentMatches from "./QuizRecentMatches";
import QuizSettings from "./QuizSettings";

interface QuizLobbyProps {
  userId: string;
  userProfile: any;
  country?: string;
  city?: string;
  onExit?: () => void;
}

type LobbyView = "lobby" | "matchmaking" | "match" | "leaderboard" | "recent";

const QuizLobby = ({ userId, userProfile, country, city, onExit }: QuizLobbyProps) => {
  const { t, i18n } = useTranslation();
  useQuizMusic();
  const [showLoading, setShowLoading] = useState(true);
  const [view, setView] = useState<LobbyView>("lobby");
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    isSearching,
    matchId,
    opponentId,
    error: matchmakingError,
    startSearching,
    cancelSearch,
  } = useQuizMatchmaking({ userId, country, city });

  useEffect(() => {
    localStorage.setItem("quiz_seen", "true");
  }, []);

  useEffect(() => {
    if (view === "matchmaking" && !isSearching && !matchId && matchmakingError && matchmakingError !== "timeout") {
      setView("lobby");
    }
  }, [view, isSearching, matchId, matchmakingError]);

  const handleFindOpponent = () => {
    playButtonSound();
    setView("matchmaking");
    startSearching();
  };

  const handleMatchReady = () => {
    if (matchId) {
      setActiveMatchId(matchId);
      setView("match");
    }
  };

  const handlePlayAgain = () => {
    playButtonSound();
    setActiveMatchId(null);
    setView("matchmaking");
    startSearching();
  };

  const handleBackToLobby = () => {
    playButtonSound();
    setActiveMatchId(null);
    setView("lobby");
  };

  if (showLoading) {
    return <QuizLoadingScreen onComplete={() => setShowLoading(false)} />;
  }

  if (view === "matchmaking" && !activeMatchId) {
    return (
      <QuizMatchmaking
        userId={userId}
        userProfile={userProfile}
        isSearching={isSearching}
        opponentId={opponentId}
        matchId={matchId}
        error={matchmakingError}
        onCancel={() => {
          playButtonSound();
          cancelSearch();
          setView("lobby");
        }}
        onMatchReady={handleMatchReady}
      />
    );
  }

  if (view === "match" && activeMatchId) {
    return (
      <QuizMatch
        matchId={activeMatchId}
        userId={userId}
        language={i18n.language}
        onBack={handleBackToLobby}
        onPlayAgain={handlePlayAgain}
      />
    );
  }

  if (view === "leaderboard") {
    return (
      <QuizLeaderboard
        userId={userId}
        defaultCountry={country}
        defaultCity={city}
        onBack={() => { playButtonSound(); setView("lobby"); }}
      />
    );
  }

  if (view === "recent") {
    return (
      <QuizRecentMatches
        userId={userId}
        onBack={() => { playButtonSound(); setView("lobby"); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col">
      <img
        src="/quiz_duello.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />

      <div className="relative z-10 flex flex-col justify-end flex-1">
        <div className="w-full max-w-[470px] mx-auto px-5 pb-24 pt-4">

          {/* 3 Icon Buttons — no labels, animated, big */}
          <div className="flex items-center justify-center gap-5 mb-8">
            {/* Clasificación */}
            <button
              onClick={() => { playButtonSound(); setView("leaderboard"); }}
              className="active:scale-90 transition-transform quiz-fade-in-up"
              style={{ animationDelay: "0s" }}
            >
              <img
                src="/clasificacion.PNG"
                alt=""
                className="rounded-2xl object-cover shadow-[0_6px_20px_rgba(0,0,0,0.5)] animate-[quiz-icon-float_3s_ease-in-out_infinite]"
                style={{ width: 100, height: 100 }}
              />
            </button>

            {/* Partidas Recientes */}
            <button
              onClick={() => { playButtonSound(); setView("recent"); }}
              className="active:scale-90 transition-transform quiz-fade-in-up"
              style={{ animationDelay: "0.07s" }}
            >
              <img
                src="/partidas_recientes.PNG"
                alt=""
                className="rounded-2xl object-cover shadow-[0_6px_20px_rgba(0,0,0,0.5)] animate-[quiz-icon-float_3s_ease-in-out_infinite_0.5s]"
                style={{ width: 100, height: 100 }}
              />
            </button>

            {/* Ajustes */}
            <button
              onClick={() => { playButtonSound(); setSettingsOpen(true); }}
              className="active:scale-90 transition-transform quiz-fade-in-up"
              style={{ animationDelay: "0.14s" }}
            >
              <img
                src="/ajustes.PNG"
                alt=""
                className="rounded-2xl object-cover shadow-[0_6px_20px_rgba(0,0,0,0.5)] animate-[quiz-icon-float_3s_ease-in-out_infinite_1s]"
                style={{ width: 100, height: 100 }}
              />
            </button>
          </div>

          {matchmakingError && (
            <p className="text-yellow-300 text-sm font-medium mb-3 text-center">
              {matchmakingError === "timeout" ? t("quiz.timeout") : matchmakingError}
            </p>
          )}

          {/* Find Opponent — rounder */}
          <button
            onClick={handleFindOpponent}
            className="relative w-full h-14 rounded-full bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white font-black text-base tracking-wide shadow-[0_0_25px_rgba(251,146,60,0.5)] active:scale-95 transition-transform overflow-hidden quiz-fade-in-up"
            style={{ animationDelay: "0.2s" }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent quiz-btn-shine" />
            <div className="relative flex items-center justify-center gap-2">
              <Zap className="w-5 h-5" fill="currentColor" />
              {t("quiz.findOpponent")}
            </div>
          </button>
        </div>
      </div>

      {/* Settings bottom sheet */}
      <QuizSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onExit={() => { setSettingsOpen(false); onExit?.(); }} />
    </div>
  );
};

export default QuizLobby;
