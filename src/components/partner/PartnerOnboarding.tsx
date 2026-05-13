import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Camera,
  PartyPopper,
  X,
  SkipForward,
  Plus,
  Calendar,
  ScanLine,
  TrendingUp,
  Share2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { OnboardingStep } from "@/hooks/usePartnerOnboarding";
import confetti from "canvas-confetti";

interface PartnerOnboardingProps {
  currentStep: number;
  totalSteps: number;
  step: OnboardingStep | null;
  progress: number;
  canProceed?: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onNavigateTab: (tab: string) => void;
}

const stepIcons: Record<string, React.ReactNode> = {
  welcome: <Sparkles className="w-5 h-5 text-primary" />,
  "profile-photo": <Camera className="w-5 h-5 text-blue-500" />,
  fab: <Plus className="w-5 h-5 text-cyan-500" />,
  events: <Calendar className="w-5 h-5 text-amber-500" />,
  scanner: <ScanLine className="w-5 h-5 text-emerald-500" />,
  stats: <TrendingUp className="w-5 h-5 text-violet-500" />,
  publish: <Share2 className="w-5 h-5 text-rose-500" />,
  complete: <PartyPopper className="w-5 h-5 text-primary" />,
};

const PartnerOnboarding = ({
  currentStep,
  totalSteps,
  step,
  progress,
  canProceed,
  onNext,
  onPrev,
  onSkip,
  onComplete,
  onNavigateTab,
}: PartnerOnboardingProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(true);
  const [showFinalCelebration, setShowFinalCelebration] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    isRectangle: boolean;
  } | null>(null);
  const [prevCanProceed, setPrevCanProceed] = useState(canProceed);

  // Track the highlighted element by data-onboarding=<id> so the
  // spotlight + pulsing arrow follow it through scroll/resize.
  // Also tracks whether we already scrolled to it once for this step
  // (re-scrolling on every poll fights the user).
  const [scrolledForStep, setScrolledForStep] = useState<string | null>(null);
  const updateSpotlightPosition = useCallback(() => {
    if (!step?.highlightElement) {
      setSpotlightRect(null);
      return;
    }
    const el = document.querySelector(
      `[data-onboarding="${step.highlightElement}"]`
    ) as HTMLElement | null;
    if (!el) {
      setSpotlightRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // element hidden / not laid out yet (Suspense fallback still
      // showing) — keep polling, don't draw anything yet.
      setSpotlightRect(null);
      return;
    }
    // Auto-detect: a "rect" target wraps wide UI (button rows, save
    // bars). Use rectangle shape for explicit step.highlightShape="rect"
    // OR when the element is much wider than tall.
    const explicitRect = step.highlightShape === "rect";
    const aspectRatio = rect.width / Math.max(rect.height, 1);
    const isRectangle = explicitRect || aspectRatio > 1.5;
    if (isRectangle) {
      setSpotlightRect({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width + 16,
        height: rect.height + 16,
        isRectangle: true,
      });
    } else {
      const size = Math.min(Math.max(rect.width, rect.height) + 24, 200);
      setSpotlightRect({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: size,
        height: size,
        isRectangle: false,
      });
    }
    // First time we see the element for THIS step → scroll to it
    // (Suspense lazy children may pop in late, so the standalone
    // useEffect below alone wouldn't catch them).
    if (scrolledForStep !== step.id) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setScrolledForStep(step.id);
    }
  }, [step?.highlightElement, step?.highlightShape, step?.id, scrolledForStep]);

  useEffect(() => {
    updateSpotlightPosition();
    const onScrollOrResize = () => updateSpotlightPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    const interval = setInterval(updateSpotlightPosition, 300);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      clearInterval(interval);
    };
  }, [updateSpotlightPosition]);

  // Reset the scroll-tracking flag when the step changes so the next
  // step also gets scrolled into view.
  useEffect(() => {
    if (step?.id && step.id !== scrolledForStep) {
      // step changed — leave scrolledForStep alone, the position
      // updater above will overwrite it.
    }
  }, [step?.id, scrolledForStep]);

  // Auto-advance when a required step transitions to canProceed=true
  // (e.g. the user just uploaded the logo). Also handles the "already
  // done" case at mount: if the partner had already saved the photo
  // before opening the tutorial, canProceed is true from the start —
  // skip past required steps automatically rather than blocking on a
  // task that's already been completed.
  useEffect(() => {
    if (canProceed && step?.required) {
      const delay = prevCanProceed ? 0 : 800; // first poll vs change
      const t = setTimeout(() => onNext(), delay);
      setPrevCanProceed(canProceed);
      return () => clearTimeout(t);
    }
    setPrevCanProceed(canProceed);
  }, [canProceed, prevCanProceed, step?.required, step?.id, onNext]);
  
  const playCelebrationSound = () => {
    const audio = new Audio('data:audio/wav;base64,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');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  };

  const triggerConfetti = () => {
    const duration = 4000;
    const animationEnd = Date.now() + duration;
    
    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval = setInterval(() => {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        clearInterval(interval);
        return;
      }

      const particleCount = 60 * (timeLeft / duration);

      confetti({
        particleCount: Math.floor(particleCount),
        startVelocity: 35,
        spread: 80,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#fbbf24'],
      });

      confetti({
        particleCount: Math.floor(particleCount),
        startVelocity: 35,
        spread: 80,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#fbbf24'],
      });
    }, 200);
  };
  
  // Hooks must run in the same order every render — call BEFORE any early return.
  useEffect(() => {
    if (step?.targetTab) {
      onNavigateTab(step.targetTab);
    }
  }, [step?.targetTab, onNavigateTab]);

  if (!step) return null;

  const isLastStep = step.id === "complete";
  const isFirstStep = currentStep === 0;
  const isWelcome = step.id === "welcome";

  const handleAction = () => {
    if (isLastStep) {
      setShowFinalCelebration(true);
      triggerConfetti();
      playCelebrationSound();
      setTimeout(() => {
        onComplete();
      }, 3000);
      return;
    }
    onNext();
  };

  return (
    <AnimatePresence mode="wait">
      {/* Final celebration overlay */}
      <AnimatePresence>
        {showFinalCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] flex flex-col items-center justify-center bg-gradient-to-br from-primary/90 via-purple-600/90 to-pink-500/90 px-4"
          >
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 150, damping: 12 }}
              className="text-5xl sm:text-8xl mb-4 sm:mb-6"
            >
              🎉
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl sm:text-4xl font-bold text-white text-center mb-3 sm:mb-4"
            >
              {t("partnerOnboarding.celebration.title", "¡Felicidades!")}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="text-base sm:text-xl text-white/90 text-center px-6 sm:px-8"
            >
              {t(
                "partnerOnboarding.celebration.subtitle",
                "Ya conoces todas las herramientas de Pasify Partner"
              )}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, type: "spring" }}
              className="mt-6 sm:mt-8 text-4xl sm:text-6xl"
            >
              🚀✨🎊
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isVisible && !showFinalCelebration && (
        <>
          {/* Plain backdrop only for purely descriptive center steps
              (no highlight). When we have a spotlight target the
              overlay-with-cutout renders below instead. */}
          {step.position === "center" && !spotlightRect && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
              style={{ paddingTop: 'env(safe-area-inset-top)' }}
            />
          )}

          {/* Dark overlay with cutout — uses an inline 9999px boxShadow
              on the spotlight ring to dim everything else, exactly like
              the client onboarding does. */}
          {spotlightRect && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none fixed inset-0 z-[150]"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              <motion.div
                key={step.id + "-spotlight"}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={
                  spotlightRect.isRectangle
                    ? "absolute rounded-2xl"
                    : "absolute rounded-full"
                }
                style={{
                  left: spotlightRect.x - spotlightRect.width / 2,
                  top: spotlightRect.y - spotlightRect.height / 2,
                  width: spotlightRect.width,
                  height: spotlightRect.height,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.7)",
                  border: "3px solid #3b82f6",
                  animation: "spotlight-pulse 2s ease-in-out infinite",
                }}
              />
            </motion.div>
          )}

          {/* Click-blocker over the highlighted element. Only rendered
              for show-and-tell steps (allowInteraction !== true).
              When the user actually has to interact (upload photo,
              press Save) we skip the blocker so the underlying button
              receives the tap normally. */}
          {spotlightRect && !step.allowInteraction && (
            <div
              className="fixed z-[152]"
              onClick={(e) => e.stopPropagation()}
              style={{
                left: spotlightRect.x - spotlightRect.width / 2,
                top: spotlightRect.y - spotlightRect.height / 2,
                width: spotlightRect.width,
                height: spotlightRect.height,
                borderRadius: spotlightRect.isRectangle ? "1rem" : "50%",
              }}
            />
          )}

          {/* Pulsing arrow pointing at the highlighted element */}
          {spotlightRect && step.arrowDirection && (
            <motion.div
              key={step.id + "-arrow"}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: 1,
                scale: 1,
                y: [0, step.arrowDirection === "up" ? -12 : 12, 0],
              }}
              transition={{
                delay: 0.3,
                y: { repeat: Infinity, duration: 0.8, ease: "easeInOut" },
              }}
              className="fixed z-[155]"
              style={{
                left: spotlightRect.x - 20,
                top:
                  step.arrowDirection === "up"
                    ? spotlightRect.y + spotlightRect.height / 2 + 12
                    : spotlightRect.y - spotlightRect.height / 2 - 52,
              }}
            >
              <div className="bg-blue-500 rounded-full p-2 shadow-lg">
                {step.arrowDirection === "up" ? (
                  <ArrowUp className="w-6 h-6 text-white" />
                ) : (
                  <ArrowDown className="w-6 h-6 text-white" />
                )}
              </div>
            </motion.div>
          )}

          {/* Floating tooltip card - fully responsive.
              z-[160] keeps it above the dark overlay (z-[150]) and the
              click-blocker (z-[152]) so it's always reachable. */}
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed z-[160]"
            style={{
              left: '8px',
              right: '8px',
              maxWidth: '400px',
              marginLeft: 'auto',
              marginRight: 'auto',
              top: step.position === 'top' ? '70px' : step.position === 'center' ? '50%' : 'auto',
              bottom: step.position === 'bottom' ? '80px' : 'auto',
              transform: step.position === 'center' ? 'translateY(-50%)' : 'none',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {/* Progress indicator */}
            <div className="mb-1.5 px-0.5">
              <div className="flex items-center justify-between text-[9px] text-white/90 mb-1">
                <span className="bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm font-medium">
                  {currentStep + 1}/{totalSteps}
                </span>
                <span className="bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm font-medium">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress value={progress} className="h-1 bg-white/20" />
            </div>

            {/* Main Card */}
            <div className="bg-background rounded-xl p-2.5 shadow-2xl border border-border/50 relative overflow-hidden">
              {/* Decorative gradient */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-primary/20 to-transparent rounded-bl-full pointer-events-none" />
              
              {/* Close/Skip button */}
              {!isWelcome && !isLastStep && (
                <button
                  onClick={onSkip}
                  className="absolute top-1.5 right-1.5 p-1 rounded-full hover:bg-muted transition-colors z-10"
                  title={t("common.skip", "Saltar")}
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}

              <div className="flex items-start gap-2">
                {/* Icon */}
                <div className="flex-shrink-0 bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-1.5">
                  {stepIcons[step.id] || <Sparkles className="w-5 h-5 text-primary" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pr-5">
                  <h3 className="font-bold text-xs mb-0.5 leading-tight">
                    {t(step.titleKey, step.titleFallback)}
                  </h3>
                  <p className="text-[10px] text-muted-foreground leading-snug line-clamp-3">
                    {t(step.descriptionKey, step.descriptionFallback)}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-1.5 mt-2">
                {!isFirstStep && !isLastStep && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onPrev}
                    className="gap-0.5 text-[10px] px-1.5 h-7"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </Button>
                )}
                
                <div className="flex-1" />

                {!isWelcome && !isLastStep && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSkip}
                    className="gap-0.5 text-muted-foreground text-[10px] px-1.5 h-7"
                  >
                    <SkipForward className="w-3 h-3" />
                  </Button>
                )}

                <Button
                  size="sm"
                  onClick={handleAction}
                  className="gap-0.5 bg-gradient-to-r from-primary to-primary/80 text-[10px] px-2 h-7"
                >
                  {isLastStep ? (
                    <>
                      {t("partnerOnboarding.cta.done", "¡Listo!")}
                      <PartyPopper className="w-3 h-3" />
                    </>
                  ) : isWelcome ? (
                    <>
                      {t("partnerOnboarding.cta.start", "Empezar")}
                      <ChevronRight className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      {t("common.next", "Siguiente")}
                      <ChevronRight className="w-3 h-3" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Arrow pointer for non-center positions */}
            {step.position === "top" && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-background border-r border-b border-border/50 rotate-45" />
            )}
            {step.position === "bottom" && (
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-background border-l border-t border-border/50 rotate-45" />
            )}
          </motion.div>
        </>
      )}

      {/* Show minimized button when tooltip is hidden */}
      {!isVisible && !isLastStep && !showFinalCelebration && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => setIsVisible(true)}
          className="fixed bottom-24 right-3 z-[100] bg-primary text-primary-foreground rounded-full p-2.5 shadow-lg hover:scale-105 transition-transform"
        >
          <Sparkles className="w-5 h-5" />
        </motion.button>
      )}

      {/* Spotlight pulse keyframes (same as ClientOnboarding). Mounted
          inline so the animation works whichever onboarding is active. */}
      <style>{`
        @keyframes spotlight-pulse {
          0%, 100% {
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.7), 0 0 0 0 rgba(59, 130, 246, 0.6);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.7), 0 0 20px 8px rgba(59, 130, 246, 0.3);
            transform: scale(1.02);
          }
        }
      `}</style>
    </AnimatePresence>
  );
};

export default PartnerOnboarding;
