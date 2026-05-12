import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Volume2, VolumeX, Globe, Check, LogOut } from "lucide-react";
import { playButtonSound } from "@/hooks/useButtonSound";

interface QuizSettingsProps {
  open: boolean;
  onClose: () => void;
  onExit: () => void;
}

const LANGUAGES = [
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
];

const QuizSettings = ({ open, onClose, onExit }: QuizSettingsProps) => {
  const { t, i18n } = useTranslation();
  const [musicOn, setMusicOn] = useState(() => {
    return localStorage.getItem("quiz_music_off") !== "true";
  });
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const toggleMusic = () => {
    playButtonSound();
    const newVal = !musicOn;
    setMusicOn(newVal);
    if (newVal) {
      localStorage.removeItem("quiz_music_off");
    } else {
      localStorage.setItem("quiz_music_off", "true");
    }
    window.dispatchEvent(new CustomEvent("quiz-music-toggle", { detail: { on: newVal } }));
  };

  const changeLanguage = (lang: string) => {
    playButtonSound();
    i18n.changeLanguage(lang);
    localStorage.setItem("appLanguage", lang);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          animating ? "opacity-50" : "opacity-0"
        }`}
        onClick={() => { playButtonSound(); onClose(); }}
      />

      {/* Sheet */}
      <div
        className={`relative w-full max-w-[500px] bg-white rounded-t-3xl transition-transform duration-300 ease-out ${
          animating ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-lg font-black text-gray-800">{t("quiz.settings")}</h2>
          <button
            onClick={() => { playButtonSound(); onClose(); }}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 pb-8 space-y-5">
          {/* Music toggle */}
          <div className="bg-orange-50 rounded-2xl border border-orange-200 p-4">
            <button
              onClick={toggleMusic}
              className="flex items-center justify-between w-full"
            >
              <div className="flex items-center gap-3">
                {musicOn ? (
                  <Volume2 className="w-6 h-6 text-orange-500" />
                ) : (
                  <VolumeX className="w-6 h-6 text-gray-400" />
                )}
                <span className="text-gray-800 font-bold text-sm">{t("quiz.music")}</span>
              </div>
              <div className={`w-12 h-7 rounded-full transition-colors flex items-center px-1 ${
                musicOn ? "bg-orange-500" : "bg-gray-300"
              }`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                  musicOn ? "translate-x-5" : "translate-x-0"
                }`} />
              </div>
            </button>
          </div>

          {/* Language selection */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-5 h-5 text-orange-500" />
              <span className="text-gray-800 font-bold text-sm">{t("settings.language")}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LANGUAGES.map((lang) => {
                const isActive = i18n.language === lang.code;
                return (
                  <button
                    key={lang.code}
                    onClick={() => changeLanguage(lang.code)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all active:scale-95 ${
                      isActive
                        ? "bg-orange-50 border-orange-400"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <span className={`text-sm font-bold flex-1 text-left ${
                      isActive ? "text-orange-600" : "text-gray-700"
                    }`}>
                      {lang.label}
                    </span>
                    {isActive && <Check className="w-4 h-4 text-orange-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Exit game */}
        <div className="px-5 pb-8">
          <button
            onClick={() => { playButtonSound(); onExit(); }}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-red-50 border border-red-200 active:scale-95 transition-transform"
          >
            <LogOut className="w-5 h-5 text-red-500" />
            <span className="text-red-600 font-bold text-sm">{t("quiz.exitGame")}</span>
          </button>
        </div>

        {/* Safe area bottom spacer */}
        <div className="h-6" />
      </div>
    </div>
  );
};

export default QuizSettings;
