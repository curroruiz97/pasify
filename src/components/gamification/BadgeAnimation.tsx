import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/hooks/useBadges";
import { useTranslation } from "react-i18next";

interface BadgeAnimationProps {
  badge: Badge | null;
  onClose: () => void;
}

export const BadgeAnimation = ({ badge, onClose }: BadgeAnimationProps) => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (badge) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(onClose, 500);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [badge, onClose]);

  if (!badge) return null;

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogContent className="sm:max-w-md border-none bg-transparent shadow-none">
        <div className="flex flex-col items-center justify-center p-8 relative">
          {/* Animated background glow */}
          <div 
            className="absolute inset-0 rounded-full animate-pulse opacity-50 blur-3xl"
            style={{ backgroundColor: badge.color }}
          />
          
          {/* Badge container */}
          <div className="relative z-10 animate-scale-in">
            {/* Sparkles */}
            <div className="absolute -top-8 -left-8 text-4xl animate-bounce">✨</div>
            <div className="absolute -top-8 -right-8 text-4xl animate-bounce delay-100">✨</div>
            <div className="absolute -bottom-8 -left-8 text-4xl animate-bounce delay-200">✨</div>
            <div className="absolute -bottom-8 -right-8 text-4xl animate-bounce delay-300">✨</div>
            
            {/* Main badge */}
            <div 
              className="w-40 h-40 rounded-full flex items-center justify-center text-7xl shadow-2xl animate-scale-in border-4 border-white"
              style={{ backgroundColor: badge.color }}
            >
              {badge.icon}
            </div>
          </div>

          {/* Text */}
          <div className="mt-8 text-center space-y-2 animate-fade-in relative z-10">
            <h2 className="text-3xl font-bold text-white drop-shadow-lg">
              🎉 {t('badges.newBadge')} 🎉
            </h2>
            <h3 className="text-2xl font-semibold text-white drop-shadow-md">
              {badge.name}
            </h3>
            <p className="text-lg text-white/90 drop-shadow">
              {badge.description}
            </p>
          </div>

          {/* Confetti effect */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute text-2xl animate-float"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `-10%`,
                  animationDelay: `${Math.random() * 2}s`,
                  animationDuration: `${2 + Math.random() * 2}s`
                }}
              >
                {['🎊', '🎉', '⭐', '✨', '🌟'][Math.floor(Math.random() * 5)]}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
