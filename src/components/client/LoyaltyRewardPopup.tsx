import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Gift, Sparkles, PartyPopper } from "lucide-react";
import { useTranslation } from "react-i18next";
import confetti from "canvas-confetti";

interface LoyaltyRewardPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerName: string;
  reward: string;
}

const LoyaltyRewardPopup = ({ open, onOpenChange, partnerName, reward }: LoyaltyRewardPopupProps) => {
  const { t } = useTranslation();
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (open) {
      // Trigger confetti
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) {
          clearInterval(interval);
          return;
        }

        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ["#3b82f6", "#06b6d4", "#fbbf24", "#f97316"],
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ["#3b82f6", "#06b6d4", "#fbbf24", "#f97316"],
        });
      }, 100);

      // Animate content
      setTimeout(() => setShowContent(true), 300);

      return () => clearInterval(interval);
    } else {
      setShowContent(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl border-0 bg-transparent shadow-none p-0 overflow-visible">
        <div 
          className={`relative bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 rounded-3xl p-8 text-white text-center transform transition-all duration-500 ${
            showContent ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
        >
          {/* Decorative sparkles */}
          <div className="absolute -top-6 -left-6 animate-bounce">
            <Sparkles className="w-12 h-12 text-yellow-300" />
          </div>
          <div className="absolute -top-4 -right-4 animate-bounce delay-150">
            <PartyPopper className="w-10 h-10 text-yellow-300" />
          </div>
          <div className="absolute -bottom-4 -left-4 animate-bounce delay-300">
            <PartyPopper className="w-8 h-8 text-yellow-300 rotate-45" />
          </div>
          <div className="absolute -bottom-6 -right-6 animate-bounce delay-500">
            <Sparkles className="w-10 h-10 text-yellow-300" />
          </div>

          {/* Main content */}
          <div className="relative z-10">
            <div 
              className={`transform transition-all duration-700 delay-200 ${
                showContent ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              }`}
            >
              <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <Gift className="w-12 h-12 text-white" />
              </div>

              <h2 className="text-3xl font-extrabold mb-2 animate-pulse">
                🎉 ¡FELICIDADES! 🎉
              </h2>
              
              <p className="text-lg font-semibold text-white/90 mb-4">
                {t("loyaltyCard.youWon")}
              </p>

              <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 mb-4">
                <p className="text-2xl font-bold">
                  {reward}
                </p>
              </div>

              <p className="text-white/80 text-sm">
                {t("loyaltyCard.from")} <strong>{partnerName}</strong>
              </p>
            </div>

            <button
              onClick={() => onOpenChange(false)}
              className={`mt-6 bg-white text-orange-500 font-bold px-8 py-3 rounded-full text-lg hover:scale-105 transition-all transform ${
                showContent ? "translate-y-0 opacity-100 delay-500" : "translate-y-4 opacity-0"
              }`}
            >
              {t("loyaltyCard.awesome")} 🙌
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoyaltyRewardPopup;
