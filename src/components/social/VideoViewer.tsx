import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Bookmark, ArrowLeft, VolumeX, Volume2, MoreVertical, Send, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import ReportContentDialog from "@/components/moderation/ReportContentDialog";
import BlockUserButton from "@/components/moderation/BlockUserButton";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { it, enUS, es, fr, de } from "date-fns/locale";
import CommentsSheet from "./CommentsSheet";
import SharePostSheet from "./SharePostSheet";
import HeartAnimation from "./HeartAnimation";
import VideoSkeleton from "./VideoSkeleton";

interface VideoViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  currentUserId: string;
  onLikeToggle: (postId: string, isLiked: boolean) => void;
}

const VideoViewer = ({ open, onOpenChange, post, currentUserId, onLikeToggle }: VideoViewerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [likesCount, setLikesCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [sharesCount, setSharesCount] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const lastTapTime = useRef(0);
  const DOUBLE_TAP_DELAY = 300;

  // Reset and reload counters when post changes
  useEffect(() => {
    if (open && post) {
      // Reset video loading state for new post
      setVideoLoading(true);
      setHasStartedPlaying(false);

      // Reset states for new post
      setLikesCount(post?.likes?.length || 0);
      setIsLiked(post?.likes?.some((like: any) => like.user_id === currentUserId) || false);
      setCommentsCount(0);
      setViewsCount(0);
      setIsSaved(false);

      // Load fresh data
      loadCommentsCount();
      loadViewsCount();
      checkIfSaved();
      recordView();
    }
  }, [open, post?.id, currentUserId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => {
      const current = video.currentTime;
      const total = video.duration;
      setCurrentTime(current);
      setDuration(total);
      setProgress((current / total) * 100);
    };

    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('loadedmetadata', updateTime);

    return () => {
      video.removeEventListener('timeupdate', updateTime);
      video.removeEventListener('loadedmetadata', updateTime);
    };
  }, [open]);

  const loadCommentsCount = async () => {
    if (!post?.id) return;
    const { count } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id);
    setCommentsCount(count || 0);
  };

  const loadViewsCount = async () => {
    if (!post?.id) return;
    const { count } = await supabase
      .from("post_views")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id);
    setViewsCount(count || 0);
  };

  const recordView = async () => {
    if (!post?.id || !currentUserId) return;
    // Check if already viewed
    const { data: existing } = await supabase
      .from("post_views")
      .select("id")
      .eq("post_id", post.id)
      .eq("viewer_id", currentUserId)
      .maybeSingle();
    
    if (!existing) {
      await supabase.from("post_views").insert({
        post_id: post.id,
        viewer_id: currentUserId
      });
      setViewsCount(prev => prev + 1);
    }
  };

  const checkIfSaved = async () => {
    if (!post?.id) return;
    const { data } = await supabase
      .from("saved_posts")
      .select("id")
      .eq("post_id", post.id)
      .eq("user_id", currentUserId)
      .limit(1)
      .maybeSingle();
    setIsSaved(!!data);
  };

  const handleLike = async () => {
    if (!post?.id) return;
    setLoading(true);
    try {
      if (isLiked) {
        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);
        if (error) throw error;
        setLikesCount(prev => prev - 1);
        setIsLiked(false);
        onLikeToggle(post.id, false);
      } else {
        const { error } = await supabase
          .from("likes")
          .insert({
            post_id: post.id,
            user_id: currentUserId,
          });
        if (error) throw error;
        setLikesCount(prev => prev + 1);
        setIsLiked(true);
        onLikeToggle(post.id, true);
      }
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToggle = async () => {
    if (!post?.id) return;
    setLoading(true);
    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_posts")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);
        if (error) throw error;
        setIsSaved(false);
      } else {
        const { error } = await supabase
          .from("saved_posts")
          .insert({
            post_id: post.id,
            user_id: currentUserId,
          });
        if (error) throw error;
        setIsSaved(true);
      }
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const handleVideoClick = () => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime.current;
    
    if (timeSinceLastTap < DOUBLE_TAP_DELAY && timeSinceLastTap > 0) {
      // Double tap - like animation
      if (!isLiked) {
        handleLike();
      }
      setShowHeartAnimation(true);
      setTimeout(() => setShowHeartAnimation(false), 1200);
      lastTapTime.current = 0;
    } else {
      // Single tap - toggle play/pause
      lastTapTime.current = now;
      setTimeout(() => {
        if (lastTapTime.current === now) {
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play();
            } else {
              videoRef.current.pause();
            }
          }
        }
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handleShareComplete = () => {
    setSharesCount(prev => prev + 1);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const getDateLocale = () => {
    switch (i18n.language) {
      case 'en': return enUS;
      case 'es': return es;
      case 'fr': return fr;
      case 'de': return de;
      default: return it;
    }
  };

  const displayName = post?.profiles?.first_name
    ? `${post.profiles.first_name} ${post.profiles.last_name || ''}`.trim()
    : post?.profiles?.business_name || t('common.user');

  if (!open || !post) return null;

  const videoSrc = post.video_url || post.image_url;

  return (
    <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/50 to-transparent" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 1rem)', paddingLeft: '1rem', paddingRight: '1rem', paddingBottom: '1rem' }}>
        <div className="flex items-center justify-between text-white">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="text-white hover:bg-white/20 rounded-full"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>

          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={post.profiles?.profile_image_url} />
              <AvatarFallback className="bg-white/20 text-white text-sm">
                {displayName[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-sm">{displayName}</p>
              <p className="text-xs text-white/70">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: getDateLocale() })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleMute}
              className="text-white hover:bg-white/20 rounded-full"
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20 rounded-full"
                >
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-black/90 text-white border-white/20">
                <ReportContentDialog
                  contentId={post.id}
                  contentType="video"
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-white focus:text-white focus:bg-white/20">
                      {t('moderation.reportVideo')}
                    </DropdownMenuItem>
                  }
                />
                <BlockUserButton
                  userId={post.user_id}
                  userName={displayName}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-white focus:text-white focus:bg-white/20">
                      {t('moderation.blockUser')}
                    </DropdownMenuItem>
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Video */}
      <div className="w-full h-full relative" onClick={handleVideoClick}>
        {/* Skeleton solo durante caricamento iniziale */}
        {videoLoading && !hasStartedPlaying && <VideoSkeleton variant="fullscreen" />}

        {/* Mini spinner per buffering dopo che il video ha iniziato */}
        {videoLoading && hasStartedPlaying && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="w-10 h-10 border-3 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        <video
          ref={videoRef}
          src={videoSrc}
          className={`w-full h-full object-contain transition-opacity duration-300 ${videoLoading && !hasStartedPlaying ? 'opacity-0' : 'opacity-100'}`}
          autoPlay
          loop
          muted={isMuted}
          playsInline
          controls={false}
          onCanPlay={() => setVideoLoading(false)}
          onLoadedData={() => setVideoLoading(false)}
          onWaiting={() => setVideoLoading(true)}
          onPlaying={() => {
            setVideoLoading(false);
            setHasStartedPlaying(true);
          }}
        />
        <HeartAnimation show={showHeartAnimation} />
      </div>

      {/* Controls Right Side - ICONE GRANDI STILE INSTAGRAM */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-5 z-10 pointer-events-auto">
        {/* Like Button */}
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 rounded-full h-12 w-12"
            onClick={(e) => {
              e.stopPropagation();
              handleLike();
            }}
            disabled={loading}
          >
            <Heart
              className={`w-8 h-8 ${isLiked ? "fill-red-500 text-red-500" : ""}`}
              style={{ width: '28px', height: '28px' }}
            />
          </Button>
          <span className="text-white text-xs font-bold mt-0.5">{formatCount(likesCount)}</span>
        </div>

        {/* Comment Button */}
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 rounded-full h-12 w-12"
            onClick={(e) => {
              e.stopPropagation();
              setCommentsOpen(true);
            }}
          >
            <MessageCircle style={{ width: '28px', height: '28px' }} />
          </Button>
          <span className="text-white text-xs font-bold mt-0.5">{formatCount(commentsCount)}</span>
        </div>

        {/* Share Button */}
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 rounded-full h-12 w-12"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShareOpen(true);
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShareOpen(true);
            }}
          >
            <Send style={{ width: '26px', height: '26px' }} />
          </Button>
          {sharesCount > 0 && (
            <span className="text-white text-xs font-bold mt-0.5">{formatCount(sharesCount)}</span>
          )}
        </div>

        {/* Save Button */}
        <div className="flex flex-col items-center">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 rounded-full h-12 w-12"
            onClick={(e) => {
              e.stopPropagation();
              handleSaveToggle();
            }}
            disabled={loading}
          >
            <Bookmark
              className={`${isSaved ? "fill-white text-white" : ""}`}
              style={{ width: '28px', height: '28px' }}
            />
          </Button>
        </div>
      </div>

      {/* Progress Bar & Caption */}
      <div className="absolute bottom-0 left-0 right-16 p-4 bg-gradient-to-t from-black/80 to-transparent" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1rem)' }}>
        {/* Views Count */}
        <div className="flex items-center gap-1.5 mb-2">
          <Eye className="w-4 h-4 text-white/80" />
          <span className="text-white/80 text-sm font-medium">{formatCount(viewsCount)} {t('social.views')}</span>
        </div>

        {/* Caption */}
        {post.content && (
          <p className="text-white text-sm mb-3 line-clamp-2">{post.content}</p>
        )}
        
        {/* Progress */}
        <div className="flex items-center gap-3 text-white text-xs">
          <span>{formatTime(currentTime)}</span>
          <div className="flex-1 bg-white/30 rounded-full h-1">
            <div
              className="bg-white rounded-full h-1 transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Comments Sheet */}
      <CommentsSheet
        open={commentsOpen}
        onOpenChange={(open) => {
          setCommentsOpen(open);
          if (!open) loadCommentsCount();
        }}
        postId={post.id}
        currentUserId={currentUserId}
      />

      {/* Share Sheet */}
      <SharePostSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        postId={post.id}
        currentUserId={currentUserId}
        onShareComplete={handleShareComplete}
      />
    </div>
  );
};

export default VideoViewer;