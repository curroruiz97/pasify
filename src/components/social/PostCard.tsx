import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/lib/haptics";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Bookmark, Trash2, VolumeX, Volume2, Maximize, MoreVertical, Send } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useMediaCleanup } from "@/hooks/useMediaCleanup";
import ReportContentDialog from "@/components/moderation/ReportContentDialog";
import BlockUserButton from "@/components/moderation/BlockUserButton";
import { formatDistanceToNow } from "date-fns";
import { it, enUS, es, fr, de } from "date-fns/locale";
import CommentsSheet from "./CommentsSheet";
import ImageViewer from "./ImageViewer";
import LikesSheet from "./LikesSheet";
import SharePostSheet from "./SharePostSheet";
import { useTranslation } from "react-i18next";
import VideoFeed from "./VideoFeed";
import HeartAnimation from "./HeartAnimation";
import VideoSkeleton from "./VideoSkeleton";
import { getCardImage, getAvatarUrl } from "@/lib/imageUtils";

interface PostCardProps {
  post: any;
  currentUserId: string;
  currentUserName?: string;
  onDelete: (postId: string) => void;
  onLikeToggle: (postId: string, isLiked: boolean) => void;
  city?: string;
  isAdmin?: boolean;
}

const PostCard = ({ post, currentUserId, currentUserName, onDelete, onLikeToggle, city, isAdmin }: PostCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const { deletePost } = useMediaCleanup();
  const [loading, setLoading] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [likesSheetOpen, setLikesSheetOpen] = useState(false);
  const [commentsCount, setCommentsCount] = useState(0);
  const [sharesCount, setSharesCount] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [videoFeedOpen, setVideoFeedOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const lastTapRef = useRef<number>(0);

  // Stati per la gestione del video
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [videoLoading, setVideoLoading] = useState(true);
  const [hasVideoStarted, setHasVideoStarted] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    // Reset loading states quando il post cambia
    setVideoLoading(true);
    setHasVideoStarted(false);
    setImageLoading(true);

    loadCommentsCount();
    loadSharesCount();
    checkIfSaved();
  }, [post.id]);

  // IntersectionObserver: play/pause video based on visibility
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const video = videoRef.current;
        if (!video) return;
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  });

  const singleTapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleTap = (isVideo: boolean = false) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected - cancel single tap action and trigger like
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      
      setShowHeartAnimation(true);
      setTimeout(() => setShowHeartAnimation(false), 1000);
      
      // Like the post if not already liked
      if (!isLiked && !loading) {
        haptic.medium();
        (async () => {
          try {
            const { error } = await supabase
              .from("likes")
              .insert({
                post_id: post.id,
                user_id: currentUserId,
              });

            if (!error) {
              onLikeToggle(post.id, true);
              sendLikeNotification(); // Send push notification
            }
          } catch (error) {
            console.error("Error liking post:", error);
          }
        })();
      }
      lastTapRef.current = 0; // Reset to prevent triple-tap issues
    } else {
      // Single tap - wait to see if it's a double tap
      lastTapRef.current = now;
      
      if (isVideo) {
        singleTapTimerRef.current = setTimeout(() => {
          // Single tap confirmed - open video feed
          setVideoFeedOpen(true);
          singleTapTimerRef.current = null;
        }, DOUBLE_TAP_DELAY);
      } else {
        // For images, single tap opens image viewer
        singleTapTimerRef.current = setTimeout(() => {
          setImageViewerOpen(true);
          singleTapTimerRef.current = null;
        }, DOUBLE_TAP_DELAY);
      }
    }
  };

  // Logica per gestire il mute/unmute
  const handleToggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  // Logica per gestire lo schermo intero
  const handleToggleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      } else if ((videoRef.current as any).webkitEnterFullscreen) {
        (videoRef.current as any).webkitEnterFullscreen();
      } else if ((videoRef.current as any).mozRequestFullScreen) {
        (videoRef.current as any).mozRequestFullScreen();
      } else if ((videoRef.current as any).msRequestFullscreen) {
        (videoRef.current as any).msRequestFullscreen();
      }
    }
  };

  const handleVideoClick = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  const checkIfSaved = async () => {
    const { data } = await supabase
      .from("saved_posts")
      .select("id")
      .eq("post_id", post.id)
      .eq("user_id", currentUserId)
      .limit(1)
      .maybeSingle();

    setIsSaved(!!data);
  };

  const loadCommentsCount = async () => {
    const { count } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id);

    setCommentsCount(count || 0);
  };

  const loadSharesCount = async () => {
    const { count } = await supabase
      .from("post_shares")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id);

    setSharesCount(count || 0);
  };

  const handleShareComplete = async () => {
    // Reload shares count after sharing
    loadSharesCount();
  };

  const isLiked = post.likes?.some((like: any) => like.user_id === currentUserId);
  const likesCount = post.likes?.length || 0;
  const isOwner = post.user_id === currentUserId;

  // Send push notification for like
  const sendLikeNotification = async () => {
    if (post.user_id === currentUserId) return; // Don't notify yourself

    try {
      await supabase.functions.invoke('send-social-notification', {
        body: {
          recipientUserId: post.user_id,
          actorName: currentUserName || 'Alguien',
          actorId: currentUserId,
          type: 'like',
          postId: post.id,
          language: i18n.language,
        }
      });
      console.log('📤 Like notification sent');
    } catch (error) {
      console.warn('Failed to send like notification:', error);
    }
  };

  const handleLike = async () => {
    setLoading(true);
    haptic.light();
    try {
      if (isLiked) {
        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);

        if (error) throw error;
        onLikeToggle(post.id, false);
      } else {
        const { error } = await supabase
          .from("likes")
          .insert({
            post_id: post.id,
            user_id: currentUserId,
          });

        if (error) throw error;
        onLikeToggle(post.id, true);
        sendLikeNotification(); // Send push notification
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

  const handleDelete = async () => {
    if (!confirm(t('post.delete') + "?")) return;

    setLoading(true);
    try {
      // Use cleanup hook to delete post and associated media
      const success = await deletePost(post.id);

      if (!success) {
        throw new Error("Failed to delete post");
      }

      toast({
        title: t('success.postDeleted'),
        description: t('success.postDeleted'),
      });

      onDelete(post.id);
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
        toast({
          title: t('success.postDeleted'),
        });
      } else {
        const { error } = await supabase
          .from("saved_posts")
          .insert({
            post_id: post.id,
            user_id: currentUserId,
          });

        if (error) throw error;
        setIsSaved(true);
        toast({
          title: t('success.postCreated'),
        });
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

  const displayName = post.profiles?.first_name
    ? `${post.profiles.first_name} ${post.profiles.last_name || ''}`.trim()
    : post.profiles?.business_name || t('common.user');

  const getDateLocale = () => {
    switch (i18n.language) {
      case 'en': return enUS;
      case 'es': return es;
      case 'fr': return fr;
      case 'de': return de;
      default: return it;
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-3 max-w-[470px] mx-auto">
      {/* Header - More compact */}
      <div className="p-3 flex items-center justify-between">
        <button
          onClick={() => navigate(`/profile/${post.user_id}`)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <Avatar className="h-9 w-9">
            <AvatarImage src={getAvatarUrl(post.profiles?.profile_image_url, 'small')} />
            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-sm">
              {displayName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-gray-900 text-sm">{displayName}</p>
            <p className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: getDateLocale() })}
            </p>
          </div>
        </button>
        {(isOwner || isAdmin) ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={loading}
            className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <ReportContentDialog
                contentId={post.id}
                contentType="post"
                trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  {t('moderation.reportPost')}
                </DropdownMenuItem>
                }
              />
              <BlockUserButton
                userId={post.user_id}
                userName={displayName}
                trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  {t('moderation.blockUser')}
                </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Content - More compact */}
      {post.content && (
        <div className="px-3 pb-2">
          <p className="whitespace-pre-wrap text-gray-800 text-sm">{post.content}</p>
        </div>
      )}

      {/* Media Content */}
      {(() => {
        const isVideoUrl = (url?: string) => !!url && /(\.mp4|\.webm|\.ogg)(\?.*)?$/i.test(url);

     if (post.media_type === 'video' && (post.video_url || post.image_url)) {
       const src = post.video_url || post.image_url;
       return (
         <div ref={videoContainerRef} className="relative cursor-pointer min-h-[200px]" onClick={() => handleTap(true)}>
           {/* Skeleton solo durante caricamento iniziale */}
           {videoLoading && !hasVideoStarted && (
             <VideoSkeleton variant="card" className="absolute inset-0 w-full h-full" />
           )}

           {/* Mini spinner per buffering */}
           {videoLoading && hasVideoStarted && (
             <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none bg-black/20">
               <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
             </div>
           )}

           <video
             ref={videoRef}
             src={src}
             className={`w-full max-h-96 object-cover transition-opacity duration-300 ${videoLoading && !hasVideoStarted ? 'opacity-0' : 'opacity-100'}`}
             loop
             muted={isMuted}
             playsInline
             preload="none"
             poster={post.thumbnail_url || undefined}
             onCanPlay={() => setVideoLoading(false)}
             onLoadedData={() => setVideoLoading(false)}
             onWaiting={() => setVideoLoading(true)}
             onPlaying={() => {
               setVideoLoading(false);
               setHasVideoStarted(true);
             }}
           >
             Il tuo browser non supporta i video.
           </video>
           <HeartAnimation show={showHeartAnimation} />
           {!videoLoading && (
             <div className="absolute bottom-3 right-3 flex gap-2">
               <Button
                 variant="ghost"
                 size="icon"
                 className="bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm rounded-full h-8 w-8"
                 onClick={(e) => {
                   e.stopPropagation();
                   handleToggleMute();
                 }}
               >
                 {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
               </Button>
             </div>
           )}
         </div>
       );
     }

        if (post.media_type === 'image' && post.image_url) {
          return (
            <div
              className="relative cursor-pointer min-h-[150px]"
              onClick={() => handleTap(false)}
            >
              {/* Skeleton mentre l'immagine carica */}
              {imageLoading && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 animate-pulse flex items-center justify-center">
                  <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-400 rounded-full animate-spin" />
                </div>
              )}
              <img
                src={getCardImage(post.image_url)}
                alt="Post"
                loading="lazy"
                className={`w-full max-h-96 object-cover transition-opacity duration-300 ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />
              <HeartAnimation show={showHeartAnimation} />
            </div>
          );
        }

        if (post.image_url) {
          if (isVideoUrl(post.image_url)) {
            return (
              <div ref={videoContainerRef} className="relative cursor-pointer min-h-[200px]" onClick={() => handleTap(true)}>
                {/* Skeleton mentre il video carica */}
                {videoLoading && <VideoSkeleton variant="card" className="absolute inset-0 w-full h-full" />}

                <video
                  ref={videoRef}
                  src={post.image_url}
                  className={`w-full max-h-96 object-cover transition-opacity duration-300 ${videoLoading ? 'opacity-0' : 'opacity-100'}`}
                  loop
                  muted={isMuted}
                  playsInline
                  preload="none"
                  poster={post.thumbnail_url || undefined}
                  onCanPlay={() => setVideoLoading(false)}
                  onLoadedData={() => setVideoLoading(false)}
                  onWaiting={() => setVideoLoading(true)}
                  onPlaying={() => setVideoLoading(false)}
                />
                <HeartAnimation show={showHeartAnimation} />
                {!videoLoading && (
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm rounded-full h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}
                    >
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm rounded-full h-8 w-8"
                      onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}
                    >
                      <Maximize className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div
              className="relative cursor-pointer min-h-[150px]"
              onClick={() => handleTap(false)}
            >
              {/* Skeleton mentre l'immagine carica */}
              {imageLoading && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 animate-pulse flex items-center justify-center">
                  <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-400 rounded-full animate-spin" />
                </div>
              )}
              <img
                src={getCardImage(post.image_url)}
                alt="Post"
                loading="lazy"
                className={`w-full max-h-96 object-cover transition-opacity duration-300 ${imageLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />
              <HeartAnimation show={showHeartAnimation} />
            </div>
          );
        }
        return null;
      })()}

      {/* Actions - Instagram style with counters */}
      <div className="px-3 py-2 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleLike}
                disabled={loading}
                className="text-gray-700 hover:text-red-500 transition-colors"
              >
                <Heart
                  className={`w-6 h-6 ${isLiked ? "fill-red-500 text-red-500" : ""}`}
                />
              </button>
              {likesCount > 0 && (
                <button 
                  onClick={() => setLikesSheetOpen(true)}
                  className="text-sm font-medium text-gray-700 hover:text-gray-500 transition-colors"
                >
                  {likesCount}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCommentsOpen(true)}
                className="text-gray-700 hover:text-blue-500 transition-colors"
              >
                <MessageCircle className="w-6 h-6" />
              </button>
              {commentsCount > 0 && (
                <button 
                  onClick={() => setCommentsOpen(true)}
                  className="text-sm font-medium text-gray-700 hover:text-gray-500 transition-colors"
                >
                  {commentsCount}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShareSheetOpen(true)}
                className="text-gray-700 hover:text-green-500 transition-colors"
              >
                <Send className="w-6 h-6" />
              </button>
              {sharesCount > 0 && (
                <span className="text-sm font-medium text-gray-700">{sharesCount}</span>
              )}
            </div>
          </div>
          <button
            onClick={handleSaveToggle}
            disabled={loading}
            className="text-gray-700 hover:text-yellow-500 transition-colors"
          >
            <Bookmark className={`w-6 h-6 ${isSaved ? "fill-yellow-500 text-yellow-500" : ""}`} />
          </button>
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
              postOwnerId={post.user_id}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
            />

            {/* Image Viewer - Solo per immagini */}
            {(post.media_type === 'image' || !post.media_type) && post.image_url && (
              <ImageViewer
                open={imageViewerOpen}
                onOpenChange={setImageViewerOpen}
                imageUrl={post.image_url}
              />
            )}

            {/* Likes Sheet */}
            <LikesSheet
              open={likesSheetOpen}
              onOpenChange={setLikesSheetOpen}
              postId={post.id}
              />

             {/* Video Feed */}
             <VideoFeed
               open={videoFeedOpen}
               onOpenChange={setVideoFeedOpen}
               initialPost={post}
               currentUserId={currentUserId}
               onLikeToggle={onLikeToggle}
               city={city}
             />

             {/* Share Sheet */}
             <SharePostSheet
               open={shareSheetOpen}
               onOpenChange={setShareSheetOpen}
               postId={post.id}
               currentUserId={currentUserId}
               onShareComplete={handleShareComplete}
             />
          </div>
        );
      };

export default PostCard;