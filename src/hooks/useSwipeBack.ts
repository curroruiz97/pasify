import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const SWIPE_THRESHOLD = 100; // pixels to trigger back
const EDGE_WIDTH = 30; // pixels from left edge to start swipe

interface UseSwipeBackOptions {
  enabled?: boolean;
  onBack?: () => void;
}

export const useSwipeBack = (options: UseSwipeBackOptions = {}) => {
  const { enabled = true, onBack } = options;
  const navigate = useNavigate();

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const isSwiping = useRef(false);
  const startedFromEdge = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;

    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    touchCurrentX.current = touch.clientX;

    // Only trigger if started from left edge
    startedFromEdge.current = touch.clientX <= EDGE_WIDTH;
    isSwiping.current = startedFromEdge.current;
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || !isSwiping.current || !startedFromEdge.current) return;

    const touch = e.touches[0];
    touchCurrentX.current = touch.clientX;

    // Check if swiping more horizontally than vertically
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = Math.abs(touch.clientY - touchStartY.current);

    if (deltaY > Math.abs(deltaX)) {
      isSwiping.current = false;
    }
  }, [enabled]);

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isSwiping.current || !startedFromEdge.current) {
      isSwiping.current = false;
      startedFromEdge.current = false;
      return;
    }

    const deltaX = touchCurrentX.current - touchStartX.current;

    if (deltaX > SWIPE_THRESHOLD) {
      if (onBack) {
        onBack();
      } else {
        navigate(-1);
      }
    }

    isSwiping.current = false;
    startedFromEdge.current = false;
  }, [enabled, navigate, onBack]);

  return {
    swipeHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
};

export default useSwipeBack;
