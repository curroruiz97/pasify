import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Eye, MoreHorizontal, Trash2, ChevronUp } from "lucide-react";
import StoryViewers from "./StoryViewers";
import { useToast } from "@/hooks/use-toast";

interface StoryViewerProps {
  storyGroup: {
    user_id: string;
    profile: any;
    stories: any[];
  };
  currentUserId: string;
  onClose: () => void;
  onNext?: () => void;
  onStoryDeleted?: (storyId: string) => void; // Made onStoryDeleted optional to prevent "is not a function" error if not provided
}

const StoryViewer = ({ storyGroup, currentUserId, onClose, onNext, onStoryDeleted }: StoryViewerProps) => {
  const { toast } = useToast();
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isViewersSheetOpen, setIsViewersSheetOpen] = useState(false);
  const [viewsCount, setViewsCount] = useState(0);
  const [viewers, setViewers] = useState<any[]>([]);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);
  const [touchEndY, setTouchEndY] = useState(0);
  const touchStartTimeRef = useRef<number>(0);

  const [savedProgress, setSavedProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const storyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const currentStory = storyGroup.stories[currentStoryIndex];
  const STORY_DURATION = 5000;
  const MAX_VIDEO_DURATION = 25000; // 25 secondi massimo
  const isOwnStory = storyGroup.user_id === currentUserId;
  const isVideo = currentStory?.media_type === 'video' || currentStory?.video_url;

  const getStoryDuration = () => {
    if (!isVideo) return STORY_DURATION;
    if (videoDuration > 0) {
      return Math.min(videoDuration * 1000, MAX_VIDEO_DURATION);
    }
    return MAX_VIDEO_DURATION;
  };

  useEffect(() => {
    const checkIsDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkIsDesktop();
    window.addEventListener('resize', checkIsDesktop);
    return () => window.removeEventListener('resize', checkIsDesktop);
  }, []);

  useEffect(() => {
    if (currentStory) {
      if (!isOwnStory) markStoryAsViewed(currentStory.id);
      loadViewsCount(currentStory.id);
      loadViewers(currentStory.id);
    }
  }, [currentStory, currentUserId, isOwnStory]);

  // Pause when opening sheet; resume and restart timers when closing
  useEffect(() => {
    if (isViewersSheetOpen) {
      if (!isPaused) setIsPaused(true);
      const duration = getStoryDuration();
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, duration - elapsed);
      setSavedProgress(progress);
      setRemainingTime(remaining);
      return;
    }
    // Closed: recompute remaining based on current progress and continue
    const duration = getStoryDuration();
    const remaining = Math.max(0, Math.round(duration * (1 - progress / 100)));
    setSavedProgress(progress);
    setRemainingTime(remaining);
    if (isPaused) setIsPaused(false);
  }, [isViewersSheetOpen]);

  useEffect(() => {
    if (!videoRef.current) return;

    if (isPaused || isViewersSheetOpen || showDeleteConfirm) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }, [isPaused, isViewersSheetOpen, showDeleteConfirm]);

  useEffect(() => {
    const duration = getStoryDuration();

    if (isPaused || isViewersSheetOpen || showDeleteConfirm) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (storyTimeoutRef.current) {
        clearTimeout(storyTimeoutRef.current);
        storyTimeoutRef.current = null;
      }

      setSavedProgress(progress);
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, duration - elapsed);
      setRemainingTime(remaining);

      return;
    }

    let startProgress = progress;
    let effectiveDuration = duration;

    if (savedProgress > 0 && remainingTime > 0) {
      startProgress = savedProgress;
      effectiveDuration = remainingTime;
    } else {
      startProgress = 0;
      effectiveDuration = duration;
      setProgress(0);
    }

    startTimeRef.current = Date.now();

    progressIntervalRef.current = setInterval(() => {
      setProgress(prev => {
        const elapsed = Date.now() - startTimeRef.current;
        const totalProgress = startProgress + (elapsed / effectiveDuration) * (100 - startProgress);
        return totalProgress >= 100 ? 100 : totalProgress;
      });
    }, 50);

    storyTimeoutRef.current = setTimeout(() => {
      handleNextStory();
    }, effectiveDuration);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (storyTimeoutRef.current) {
        clearTimeout(storyTimeoutRef.current);
        storyTimeoutRef.current = null;
      }
    };
  }, [currentStoryIndex, isPaused, isViewersSheetOpen, showDeleteConfirm, savedProgress, remainingTime, videoDuration]);

  useEffect(() => {
    setSavedProgress(0);
    setRemainingTime(0);
    setProgress(0);
  }, [currentStoryIndex]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': handlePrevStory(); break;
        case 'ArrowRight': handleNextStory(); break;
        case ' ': e.preventDefault(); setIsPaused(!isPaused); break;
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPaused]);

  const markStoryAsViewed = async (storyId: string) => {
    try {
      await supabase.from("story_views").upsert({
        story_id: storyId,
        viewer_id: currentUserId,
        viewed_at: new Date().toISOString()
      }, { onConflict: "story_id,viewer_id" });
    } catch (error) {
      console.error("Error tracking story view:", error);
    }
  };

  const loadViewsCount = async (storyId: string) => {
    const { count } = await supabase
      .from("story_views")
      .select("*", { count: "exact", head: true })
      .eq("story_id", storyId);
    setViewsCount(count || 0);
  };

  const loadViewers = async (storyId: string) => {
    const { data } = await supabase
      .from("story_views")
      .select(
        `
        id,
        viewer_id,
        viewed_at,
        profiles!inner(
          first_name,
          last_name,
          business_name,
          profile_image_url
        )
        `
      )
      .eq("story_id", storyId)
      .order("viewed_at", { ascending: false })
      .limit(3);

    setViewers(data || []);
  };

  const handleNextStory = useCallback(() => {
    setSavedProgress(0);
    setRemainingTime(0);

    if (currentStoryIndex < storyGroup.stories.length - 1) {
      setCurrentStoryIndex(prev => prev + 1);
    } else {
      onNext ? onNext() : onClose();
    }
  }, [currentStoryIndex, storyGroup.stories.length, onNext, onClose]);

  const handlePrevStory = useCallback(() => {
    setSavedProgress(0);
    setRemainingTime(0);

    if (currentStoryIndex > 0) {
      setCurrentStoryIndex(prev => prev - 1);
    }
  }, [currentStoryIndex]);

  const handleMouseDown = (side: 'left' | 'right') => {
    side === 'left' ? handlePrevStory() : handleNextStory();
  };

  // Handle swipe up gesture to open viewers (Instagram style)
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.targetTouches[0];
    setTouchStartX(touch.clientX);
    setTouchStartY(touch.clientY);
    setTouchEndX(touch.clientX);
    setTouchEndY(touch.clientY);
    touchStartTimeRef.current = Date.now();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.targetTouches[0];
    setTouchEndX(touch.clientX);
    setTouchEndY(touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchStartY - touchEndY; // positivo quando swipe-up
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const swipeUp = deltaY > 50 && absY > absX;
    const swipeHorizontal = absX > 40 && absX > absY;

    // reset stato touch
    setTouchStartX(0);
    setTouchStartY(0);
    setTouchEndX(0);
    setTouchEndY(0);

    if (swipeUp && isOwnStory) {
      setIsPaused(true);
      setIsViewersSheetOpen(true);
      return;
    }

    if (swipeHorizontal) {
      if (deltaX < 0) {
        handleNextStory();
      } else {
        handlePrevStory();
      }
      return;
    }

    // Tap: sinistra = precedente, destra = successiva
    const width = (e.currentTarget as HTMLElement).clientWidth;
    const tapX = e.changedTouches[0]?.clientX ?? touchStartX;
    if (tapX < width / 2) {
      handlePrevStory();
    } else {
      handleNextStory();
    }
  };

  const handleDeleteStory = async () => {
    if (!currentStory || !isOwnStory) return;

    setShowDeleteConfirm(false);

    try {
      const { error } = await supabase
        .from('stories')
        .delete()
        .eq('id', currentStory.id);

      if (error) throw error;

      toast({
        title: "Storia eliminata",
        description: "La tua storia è stata eliminata con successo.",
        variant: "default",
      });

      // Safely call onStoryDeleted if it's a function
      if (onStoryDeleted && typeof onStoryDeleted === 'function') {
        onStoryDeleted(currentStory.id);
      } else {
        console.warn("onStoryDeleted prop is not a function or is undefined.");
      }
      onClose();
    } catch (error: any) {
      toast({
        title: "Errore",
        description: `Impossibile eliminare la storia: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  const getDisplayName = (viewer: any) => {
    const profile = viewer.profiles;
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || "Utente";
  };

  const displayName = storyGroup.profile?.first_name
    ? `${storyGroup.profile.first_name} ${storyGroup.profile.last_name || ''}`.trim()
    : storyGroup.profile?.business_name || "Utente";

  if (!currentStory) return null;

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {isDesktop ? (
        <div className="relative w-full max-w-md h-full max-h-[90vh] bg-black rounded-lg overflow-hidden">
          {/* Progress bars */}
          <div className="absolute left-4 right-4 z-20 flex gap-1" style={{ top: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
            {storyGroup.stories.map((_: any, index: number) => (
              <div key={index} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-100 ease-linear"
                  style={{
                    width: index < currentStoryIndex ? '100%' :
                           index === currentStoryIndex ? `${progress}%` : '0%'
                  }}
                />
              </div>
            ))}
          </div>

          {/* Header */}
          <div className="absolute left-4 right-4 z-20 flex items-center justify-between" style={{ top: 'calc(env(safe-area-inset-top) + 2rem)' }}>
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8 border border-white">
                <AvatarImage src={storyGroup.profile?.profile_image_url} />
                <AvatarFallback className="text-xs bg-gradient-to-br from-primary to-secondary">
                  {displayName[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-white">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs opacity-70">
                  {new Date(currentStory.created_at).toLocaleTimeString('es-ES', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsPaused(!isPaused)} className="text-white hover:bg-white/20 p-2">
                {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </Button>
              {isOwnStory && (
                <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(true)} className="text-white hover:bg-white/20 p-2">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/20 p-2">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Story Content */}
          <div className="relative w-full h-full">
            {isVideo ? (
              <video
                ref={videoRef}
                src={currentStory.video_url}
                className="w-full h-full object-cover"
                autoPlay
                muted={isMuted}
                playsInline
                onLoadedMetadata={(e) => {
                  const video = e.target as HTMLVideoElement;
                  setVideoDuration(video.duration);
                }}
              />
            ) : (
              <img
                src={currentStory.image_url}
                alt="Story"
                className="w-full h-full object-cover"
              />
            )}

            <div className="absolute inset-0 flex">
              <div className="flex-1 cursor-pointer" onClick={() => handleMouseDown('left')} />
              <div className="flex-1 cursor-pointer" onClick={() => handleMouseDown('right')} />
            </div>

            {/* Controllo volume per video */}
            {isVideo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMuted(!isMuted)}
                className="absolute bottom-4 right-4 text-white hover:bg-white/20 p-2 z-10"
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
            )}
          </div>

          {/* Navigation arrows */}
          {currentStoryIndex > 0 && (
            <Button variant="ghost" size="sm" onClick={handlePrevStory}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 p-2">
              <ChevronLeft className="h-6 w-6" />
            </Button>
          )}

          {currentStoryIndex < storyGroup.stories.length - 1 && (
            <Button variant="ghost" size="sm" onClick={handleNextStory}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 p-2">
              <ChevronRight className="h-6 w-6" />
            </Button>
          )}

          {/* Bottom actions - INSTAGRAM STYLE VIEWERS */}
          {isOwnStory && (
            <div className="absolute bottom-8 left-0 right-0 z-20 flex flex-col items-center justify-center">
              <Button
                variant="ghost"
                onClick={() => {
                  setIsPaused(true);
                  setIsViewersSheetOpen(true);
                }}
                className="flex flex-col items-center gap-2 text-white hover:bg-transparent p-3 group"
              >
                <ChevronUp className="h-6 w-6 text-white drop-shadow-lg group-hover:translate-y-[-4px] transition-transform animate-bounce" strokeWidth={2.5} />
                <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-4 py-2">
                  <Eye className="h-4 w-4 text-white" />
                  <span className="text-white text-sm font-medium">{viewsCount}</span>
                </div>
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Mobile Layout */
        <div className="relative w-full h-full bg-black">
          <div className="absolute left-4 right-4 z-20 flex gap-1" style={{ top: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
            {storyGroup.stories.map((_: any, index: number) => (
              <div key={index} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-100 ease-linear"
                  style={{
                    width: index < currentStoryIndex ? '100%' :
                           index === currentStoryIndex ? `${progress}%` : '0%'
                  }}
                />
              </div>
            ))}
          </div>

          <div className="absolute left-4 right-4 z-20 flex items-center justify-between" style={{ top: 'calc(env(safe-area-inset-top) + 2rem)' }}>
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8 border border-white">
                <AvatarImage src={storyGroup.profile?.profile_image_url} />
                <AvatarFallback className="text-xs bg-gradient-to-br from-primary to-secondary">
                  {displayName[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="text-white">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs opacity-70">
                  {new Date(currentStory.created_at).toLocaleTimeString('es-ES', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isOwnStory && (
                <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(true)} className="text-white hover:bg-white/20 p-2">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white hover:bg-white/20 p-2">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div 
            className="relative w-full h-full"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {isVideo ? (
              <video
                ref={videoRef}
                src={currentStory.video_url}
                className="w-full h-full object-cover"
                autoPlay
                muted={isMuted}
                playsInline
                onLoadedMetadata={(e) => {
                  const video = e.target as HTMLVideoElement;
                  setVideoDuration(video.duration);
                }}
              />
            ) : (
              <img
                src={currentStory.image_url}
                alt="Story"
                className="w-full h-full object-cover"
              />
            )}

            <div className="absolute inset-0" />

            {/* Controllo volume per video */}
            {isVideo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMuted(!isMuted)}
                className="absolute bottom-20 right-4 text-white hover:bg-white/20 p-2 z-10 rounded-full bg-black/20 backdrop-blur-sm"
              >
                {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </Button>
            )}
          </div>

          {/* Bottom viewers indicator for mobile - INSTAGRAM STYLE */}
          {isOwnStory && (
            <div className="absolute left-0 right-0 z-20 flex flex-col items-center justify-center" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}>
              <div className="flex flex-col items-center gap-2 animate-bounce pointer-events-auto">
                <ChevronUp className="h-6 w-6 text-white drop-shadow-lg" strokeWidth={2.5} />
                <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-4 py-2">
                  <Eye className="h-4 w-4 text-white" />
                  <span className="text-white text-sm font-medium">{viewsCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Story Viewers Sheet */}
      {isOwnStory && (
        <StoryViewers
          storyId={currentStory.id}
          open={isViewersSheetOpen}
          onOpenChange={setIsViewersSheetOpen}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center">
          <div className="bg-background p-6 rounded-lg shadow-xl text-center max-w-sm mx-auto">
            <h3 className="text-lg font-semibold mb-4">¿Eliminar esta historia?</h3>
            <p className="text-sm text-muted-foreground mb-6">Esta acción no se puede deshacer.</p>
            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDeleteStory}>Eliminar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryViewer;
