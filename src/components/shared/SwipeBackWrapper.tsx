import { ReactNode, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

const SWIPE_THRESHOLD = 80;
const EDGE_WIDTH = 25;

interface SwipeBackWrapperProps {
  children: ReactNode;
  enabled?: boolean;
  onBack?: () => void;
  className?: string;
}

const SwipeBackWrapper = ({
  children,
  enabled = true,
  onBack,
  className = "",
}: SwipeBackWrapperProps) => {
  const navigate = useNavigate();
  const [swipeProgress, setSwipeProgress] = useState(0);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const startedFromEdge = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;

    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;

    startedFromEdge.current = touch.clientX <= EDGE_WIDTH;
    isSwiping.current = startedFromEdge.current;
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || !isSwiping.current || !startedFromEdge.current) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = Math.abs(touch.clientY - touchStartY.current);

    // Cancel if swiping more vertically
    if (deltaY > Math.abs(deltaX) * 0.5) {
      isSwiping.current = false;
      setSwipeProgress(0);
      return;
    }

    if (deltaX > 0) {
      setSwipeProgress(Math.min(deltaX / SWIPE_THRESHOLD, 1));
    }
  }, [enabled]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !startedFromEdge.current) {
      setSwipeProgress(0);
      isSwiping.current = false;
      startedFromEdge.current = false;
      return;
    }

    if (swipeProgress >= 1) {
      if (onBack) {
        onBack();
      } else {
        navigate(-1);
      }
    }

    setSwipeProgress(0);
    isSwiping.current = false;
    startedFromEdge.current = false;
  }, [enabled, navigate, onBack, swipeProgress]);

  return (
    <div
      className={`relative ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe indicator */}
      {swipeProgress > 0 && (
        <div
          className="fixed left-0 top-0 bottom-0 z-[9999] pointer-events-none"
          style={{
            width: `${swipeProgress * 100}px`,
            background: `linear-gradient(to right, rgba(0,0,0,${swipeProgress * 0.15}), transparent)`,
          }}
        >
          <div
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center transition-transform"
            style={{
              transform: `translateY(-50%) scale(${0.5 + swipeProgress * 0.5})`,
              opacity: swipeProgress,
            }}
          >
            <svg
              className="w-5 h-5 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </div>
        </div>
      )}
      {children}
    </div>
  );
};

export default SwipeBackWrapper;
