import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuizLeaderboard } from "@/hooks/useQuizLeaderboard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Trophy, Crown, Medal } from "lucide-react";
import { playButtonSound } from "@/hooks/useButtonSound";
import { COUNTRIES, getCitiesForCountry } from "@/constants/countries";

interface QuizLeaderboardProps {
  userId: string;
  defaultCountry?: string;
  defaultCity?: string;
  onBack: () => void;
}

const QuizLeaderboard = ({
  userId,
  defaultCountry,
  defaultCity,
  onBack,
}: QuizLeaderboardProps) => {
  const { t } = useTranslation();
  const [country, setCountry] = useState(defaultCountry || "all");
  const [city, setCity] = useState(defaultCity || "all");

  const { data: leaderboard, isLoading } = useQuizLeaderboard(
    country === "all" ? null : country,
    city === "all" ? null : city
  );

  const cities = country !== "all" ? getCitiesForCountry(country) : [];

  const getName = (entry: any) =>
    entry.first_name ? `${entry.first_name}`.trim() : "Anonymous";

  const top3 = leaderboard?.slice(0, 3) || [];
  const rest = leaderboard?.slice(3) || [];

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gradient-to-b from-orange-50 to-white">
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Header */}
        <div className="relative bg-gradient-to-r from-orange-500 to-orange-600 px-4 pt-4 pb-5 shadow-[0_4px_20px_rgba(249,115,22,0.4)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { playButtonSound(); onBack(); }}
              className="text-white active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-black text-white tracking-wide">{t("quiz.leaderboard")}</h1>
          </div>

          {/* Filters inside header */}
          <div className="flex gap-2 mt-3">
            <select
              value={country}
              onChange={(e) => { playButtonSound(); setCountry(e.target.value); setCity("all"); }}
              className="flex-1 bg-white/20 text-white border border-white/30 rounded-xl px-3 py-2 text-xs font-bold appearance-none placeholder:text-white/60 backdrop-blur-sm"
            >
              <option value="all" className="text-gray-800 bg-white">{t("quiz.allCountries")}</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code} className="text-gray-800 bg-white">
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
            {country !== "all" && (
              <select
                value={city}
                onChange={(e) => { playButtonSound(); setCity(e.target.value); }}
                className="flex-1 bg-white/20 text-white border border-white/30 rounded-xl px-3 py-2 text-xs font-bold appearance-none backdrop-blur-sm"
              >
                <option value="all" className="text-gray-800 bg-white">{t("quiz.allCities")}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.name} className="text-gray-800 bg-white">
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto pb-24">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-orange-100 flex items-center justify-center">
                <Trophy className="w-10 h-10 text-orange-300" />
              </div>
              <p className="font-bold text-orange-400 text-sm">{t("quiz.noMatches")}</p>
            </div>
          ) : (
            <>
              {/* Podium - Top 3 */}
              {top3.length > 0 && (
                <div className="flex items-end justify-center gap-3 pt-6 pb-4 px-4">
                  {/* 2nd place */}
                  {top3[1] && (
                    <div className="flex flex-col items-center quiz-fade-in-up" style={{ animationDelay: "0.1s" }}>
                      <Avatar className="h-14 w-14 ring-[3px] ring-gray-300 shadow-lg">
                        <AvatarImage src={top3[1].profile_image_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-gray-400 to-gray-500 text-white font-black text-base">
                          {getName(top3[1])[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="text-xs font-bold text-gray-700 mt-1.5 max-w-[80px] truncate text-center">{getName(top3[1])}</p>
                      <p className="text-[10px] text-gray-400 font-bold">{top3[1].total_wins} pts</p>
                      <div className="w-16 h-16 mt-1 rounded-t-xl bg-gradient-to-t from-gray-200 to-gray-100 flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.1)] border border-gray-200">
                        <span className="text-2xl font-black text-gray-400">2</span>
                      </div>
                    </div>
                  )}

                  {/* 1st place */}
                  {top3[0] && (
                    <div className="flex flex-col items-center quiz-fade-in-up -mt-4" style={{ animationDelay: "0s" }}>
                      <div className="relative">
                        <Crown className="w-7 h-7 text-yellow-500 mx-auto mb-0.5 drop-shadow-md" />
                        <Avatar className="h-[70px] w-[70px] ring-[3px] ring-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.4)]">
                          <AvatarImage src={top3[0].profile_image_url || undefined} />
                          <AvatarFallback className="bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-black text-xl">
                            {getName(top3[0])[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <p className="text-sm font-black text-gray-800 mt-1.5 max-w-[90px] truncate text-center">{getName(top3[0])}</p>
                      <p className="text-[10px] text-orange-500 font-bold">{top3[0].total_wins} pts</p>
                      <div className="w-16 h-20 mt-1 rounded-t-xl bg-gradient-to-t from-yellow-400 to-yellow-200 flex items-center justify-center shadow-[0_4px_16px_rgba(250,204,21,0.3)] border border-yellow-300">
                        <span className="text-3xl font-black text-yellow-700">1</span>
                      </div>
                    </div>
                  )}

                  {/* 3rd place */}
                  {top3[2] && (
                    <div className="flex flex-col items-center quiz-fade-in-up" style={{ animationDelay: "0.2s" }}>
                      <Avatar className="h-12 w-12 ring-[3px] ring-orange-300 shadow-lg">
                        <AvatarImage src={top3[2].profile_image_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-orange-400 to-orange-500 text-white font-black text-sm">
                          {getName(top3[2])[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="text-xs font-bold text-gray-700 mt-1.5 max-w-[80px] truncate text-center">{getName(top3[2])}</p>
                      <p className="text-[10px] text-gray-400 font-bold">{top3[2].total_wins} pts</p>
                      <div className="w-16 h-12 mt-1 rounded-t-xl bg-gradient-to-t from-orange-300 to-orange-100 flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.1)] border border-orange-200">
                        <span className="text-2xl font-black text-orange-500">3</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Divider */}
              {rest.length > 0 && (
                <div className="mx-4 h-px bg-gradient-to-r from-transparent via-orange-200 to-transparent my-2" />
              )}

              {/* 4th+ */}
              <div className="px-4 space-y-2 pt-1">
                {rest.map((entry, index) => {
                  const rank = index + 4;
                  const isMe = entry.user_id === userId;

                  return (
                    <div
                      key={entry.user_id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl quiz-fade-in-up transition-all ${
                        isMe
                          ? "bg-gradient-to-r from-orange-100 to-orange-50 border-2 border-orange-400 shadow-[0_4px_16px_rgba(249,115,22,0.15)]"
                          : "bg-white border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                      }`}
                      style={{ animationDelay: `${(index + 3) * 0.04}s` }}
                    >
                      <div className="w-8 flex-shrink-0 flex items-center justify-center">
                        <span className={`text-sm font-black ${isMe ? "text-orange-500" : "text-gray-300"}`}>
                          {rank}
                        </span>
                      </div>

                      <Avatar className={`h-10 w-10 ring-2 ${isMe ? "ring-orange-400" : "ring-gray-200"} shadow-sm`}>
                        <AvatarImage src={entry.profile_image_url || undefined} />
                        <AvatarFallback className="bg-gradient-to-br from-orange-400 to-orange-500 text-white font-bold text-sm">
                          {getName(entry)[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-sm truncate ${isMe ? "text-orange-700" : "text-gray-800"}`}>
                          {getName(entry)} {isMe && `(${t("quiz.you")})`}
                        </p>
                        <p className="text-[10px] text-gray-400 font-medium">
                          {entry.total_wins}W / {entry.total_matches} {t("quiz.matches")}
                        </p>
                      </div>

                      <div className="flex flex-col items-end">
                        <span className={`text-lg font-black ${isMe ? "text-orange-600" : "text-orange-500"}`}>
                          {entry.total_wins}
                        </span>
                        <span className="text-[9px] text-gray-400 font-bold">{t("quiz.points")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizLeaderboard;
