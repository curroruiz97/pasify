import { useState, useEffect } from "react";

interface QuizLoadingScreenProps {
  onComplete: () => void;
}

const QuizLoadingScreen = ({ onComplete }: QuizLoadingScreenProps) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const duration = 1200;
    const steps = 30;
    const stepTime = duration / steps;
    let step = 0;

    const interval = setInterval(() => {
      step++;
      // Ease-out curve for smooth progress
      const t = step / steps;
      setProgress(Math.min(100, Math.round(100 * (1 - Math.pow(1 - t, 3)))));

      if (step >= steps) {
        clearInterval(interval);
        setTimeout(onComplete, 200);
      }
    }, stepTime);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Background image full */}
      <img
        src="/quiz_duello.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      {/* Loading bar at bottom */}
      <div className="relative z-10 mt-auto px-8 pb-20">
        <p className="text-white/80 text-sm font-bold text-center mb-3 tracking-wide">
          Loading...
        </p>

        {/* Bar container */}
        <div className="w-full h-3 bg-white/15 rounded-full overflow-hidden backdrop-blur-sm">
          {/* Animated fill */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-400 via-orange-500 to-amber-400 transition-all duration-100 ease-out relative overflow-hidden"
            style={{ width: `${progress}%` }}
          >
            {/* Shine sweep on the bar */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent quiz-btn-shine" />
          </div>
        </div>

        <p className="text-white/40 text-xs text-center mt-2 font-medium">
          {progress}%
        </p>
      </div>
    </div>
  );
};

export default QuizLoadingScreen;
