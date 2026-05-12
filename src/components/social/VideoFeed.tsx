import { useState, useEffect, useRef, useCallback } from "react";
import VideoViewer from "./VideoViewer";
import VideoSkeleton from "./VideoSkeleton";
import { motion, AnimatePresence } from "framer-motion";
import { useVideoPosts } from "@/hooks/usePosts";

interface VideoFeedProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPost: any;
  currentUserId: string;
  onLikeToggle: (postId: string, isLiked: boolean) => void;
  city?: string;
}

const SWIPE_THRESHOLD = 30;
const SWIPE_VELOCITY_THRESHOLD = 0.2;
const HORIZONTAL_SWIPE_THRESHOLD = 80;

const VideoFeed = ({ open, onOpenChange, initialPost, currentUserId, onLikeToggle, city }: VideoFeedProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [direction, setDirection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Usa React Query per caching - filtrato per città
  const { data: posts = [], isLoading: loading } = useVideoPosts(open, city);

  // Touch tracking
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTime = useRef(0);
  const touchCurrentY = useRef(0);
  const touchCurrentX = useRef(0);
  const isSwiping = useRef(false);
  const swipeHandled = useRef(false);
  const touchStartTarget = useRef<EventTarget | null>(null);

  // Imposta l'indice iniziale quando i post sono caricati
  useEffect(() => {
    if (open && initialPost && posts.length > 0) {
      const initialIndex = posts.findIndex(post => post.id === initialPost.id);
      setCurrentIndex(initialIndex >= 0 ? initialIndex : 0);
    }
  }, [open, initialPost, posts]);

  const goToNext = useCallback(() => {
    if (currentIndex < posts.length - 1 && !isTransitioning) {
      setIsTransitioning(true);
      setDirection(1);
      setCurrentIndex(prev => prev + 1);
      setTimeout(() => setIsTransitioning(false), 400);
    }
  }, [currentIndex, posts.length, isTransitioning]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0 && !isTransitioning) {
      setIsTransitioning(true);
      setDirection(-1);
      setCurrentIndex(prev => prev - 1);
      setTimeout(() => setIsTransitioning(false), 400);
    }
  }, [currentIndex, isTransitioning]);

  const isInteractiveElement = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;

    // Check if target or any parent is an interactive element or sheet
    const interactiveSelectors = 'button, [role="button"], input, textarea, a, [data-radix-collection-item], [data-radix-dialog-content], [data-state="open"]';
    return target.closest(interactiveSelectors) !== null;
  };

  // Check for open sheet/modal inline (lightweight)
  const isSheetOpen = useCallback(() => {
    return !!document.querySelector('[data-state="open"][role="dialog"]');
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't handle swipes when sheet is open
    if (isSheetOpen()) {
      isSwiping.current = false;
      return;
    }

    touchStartTarget.current = e.target;

    // Don't interfere with touches on interactive elements
    if (isInteractiveElement(e.target)) {
      isSwiping.current = false;
      return;
    }

    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchStartTime.current = Date.now();
    touchCurrentY.current = e.touches[0].clientY;
    touchCurrentX.current = e.touches[0].clientX;
    isSwiping.current = true;
    swipeHandled.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping.current || swipeHandled.current || isSheetOpen()) return;
    if (isInteractiveElement(touchStartTarget.current)) return;

    touchCurrentY.current = e.touches[0].clientY;
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || swipeHandled.current) return;
    if (isInteractiveElement(touchStartTarget.current)) {
      isSwiping.current = false;
      return;
    }

    // Block swipes when sheet is open
    if (isSheetOpen()) {
      isSwiping.current = false;
      return;
    }

    isSwiping.current = false;

    const deltaY = touchStartY.current - touchCurrentY.current;
    const deltaX = touchStartX.current - touchCurrentX.current;
    const deltaTime = Date.now() - touchStartTime.current;
    const velocityY = Math.abs(deltaY) / deltaTime;

    // Check for horizontal swipe left to exit (positive deltaX means swipe left)
    if (deltaX > HORIZONTAL_SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      swipeHandled.current = true;
      onOpenChange(false);
      return;
    }

    // Vertical swipe for video change
    if (Math.abs(deltaY) > SWIPE_THRESHOLD || velocityY > SWIPE_VELOCITY_THRESHOLD) {
      swipeHandled.current = true;
      if (deltaY > 0) {
        goToNext();
      } else {
        goToPrev();
      }
    }
  };

  // Handle wheel with non-passive event listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !open) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isTransitioning) return;

      if (e.deltaY > 30) {
        goToNext();
      } else if (e.deltaY < -30) {
        goToPrev();
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [open, isTransitioning, goToNext, goToPrev]);

  // Mostra skeleton se sta caricando
  if (!open) return null;

  if (loading || posts.length === 0) {
    return (
      <div className="fixed inset-0 bg-black z-[100]">
        <VideoSkeleton variant="fullscreen" />
      </div>
    );
  }

  const currentPost = posts[currentIndex];

  const slideVariants = {
    enter: (dir: number) => ({
      y: dir > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      y: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      y: dir > 0 ? '-100%' : '100%',
      opacity: 0,
    }),
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black z-[100] overflow-hidden touch-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Current video with animation */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={currentPost.id}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            y: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 },
          }}
          className="absolute inset-0"
        >
          <VideoViewer
            open={true}
            onOpenChange={onOpenChange}
            post={currentPost}
            currentUserId={currentUserId}
            onLikeToggle={onLikeToggle}
          />
        </motion.div>
      </AnimatePresence>

      {/* Subtle scroll indicators */}
      {currentIndex > 0 && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 pointer-events-none z-[110]">
          <div className="w-8 h-1 bg-white/20 rounded-full" />
        </div>
      )}

      {currentIndex < posts.length - 1 && (
        <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 pointer-events-none z-[110]">
          <div className="w-8 h-1 bg-white/20 rounded-full animate-pulse" />
        </div>
      )}
    </div>
  );
};

export default VideoFeed;
