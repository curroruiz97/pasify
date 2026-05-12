import { useEffect, useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Eye, X, Send, Bookmark, MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import LikesSheet from "./LikesSheet";
import { formatDistanceToNow } from "date-fns";
import { it, enUS, es, fr, de } from "date-fns/locale";
import { useTranslation } from "react-i18next";

interface PostDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  currentUserId: string;
}

const PostDetailModal = ({ open, onOpenChange, post, currentUserId }: PostDetailModalProps) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [likesCount, setLikesCount] = useState(0);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [commentsCount, setCommentsCount] = useState(0);
  const [viewsCount, setViewsCount] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [likesSheetOpen, setLikesSheetOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [likeAnimation, setLikeAnimation] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const getDateLocale = () => {
    switch (i18n.language) {
      case 'en': return enUS;
      case 'es': return es;
      case 'fr': return fr;
      case 'de': return de;
      default: return it;
    }
  };

  useEffect(() => {
    if (open && post) {
      setClosing(false);
      setLikesCount(post?.likes?.length || 0);
      setIsLiked(post?.likes?.some((like: any) => like.user_id === currentUserId) || false);
      loadPostStats();
      trackView();
      checkSaved();
      loadCurrentUserProfile();
    }
  }, [open, post?.id]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      onOpenChange(false);
      setClosing(false);
    }, 200);
  };

  const loadCurrentUserProfile = async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from("profiles")
      .select("first_name, last_name, profile_image_url, business_name")
      .eq("id", currentUserId)
      .single();
    if (data) setCurrentUserProfile(data);
  };

  const loadPostStats = async () => {
    if (!post?.id) return;
    const { data: commentsData } = await supabase
      .from("comments")
      .select("*, profiles!comments_user_id_fkey(first_name, last_name, profile_image_url, business_name)")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });
    setComments(commentsData || []);
    setCommentsCount(commentsData?.length || 0);

    const { count } = await supabase
      .from("post_views")
      .select("*", { count: "exact", head: true })
      .eq("post_id", post.id);
    setViewsCount(count || 0);
  };

  const trackView = async () => {
    if (!post?.id || !currentUserId) return;
    try {
      await supabase.from("post_views").insert({ post_id: post.id, viewer_id: currentUserId });
      const { count } = await supabase.from("post_views").select("*", { count: "exact", head: true }).eq("post_id", post.id);
      setViewsCount(count || 0);
    } catch { /* ignore duplicate */ }
  };

  const checkSaved = async () => {
    if (!post?.id || !currentUserId) return;
    const { data } = await supabase.from("saved_posts").select("id")
      .eq("post_id", post.id).eq("user_id", currentUserId).maybeSingle();
    setIsSaved(!!data);
  };

  const handleLike = async () => {
    if (!post?.id) return;
    try {
      const { data: existing } = await supabase.from("likes").select("id")
        .eq("post_id", post.id).eq("user_id", currentUserId).maybeSingle();
      if (existing) {
        await supabase.from("likes").delete().eq("id", existing.id);
        setLikesCount(p => Math.max(0, p - 1));
        setIsLiked(false);
      } else {
        await supabase.from("likes").insert({ post_id: post.id, user_id: currentUserId });
        setLikesCount(p => p + 1);
        setIsLiked(true);
      }
    } catch (e) { console.error(e); }
  };

  const handleSave = async () => {
    if (!post?.id) return;
    try {
      if (isSaved) {
        await supabase.from("saved_posts").delete().eq("post_id", post.id).eq("user_id", currentUserId);
        setIsSaved(false);
      } else {
        await supabase.from("saved_posts").insert({ post_id: post.id, user_id: currentUserId });
        setIsSaved(true);
      }
    } catch { /* ignore */ }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !post?.id) return;
    setLoading(true);
    try {
      await supabase.from("comments").insert({ post_id: post.id, user_id: currentUserId, content: newComment.trim() });
      setNewComment("");
      await loadPostStats();
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const getDisplayName = (profile?: any) => {
    const prof = profile || post?.profiles;
    if (prof?.business_name) return prof.business_name;
    if (prof?.first_name || prof?.last_name) return `${prof.first_name || ""} ${prof.last_name || ""}`.trim();
    return t('common.user');
  };

  const getCurrentUserInitial = () => {
    if (currentUserProfile?.first_name) return currentUserProfile.first_name[0].toUpperCase();
    if (currentUserProfile?.business_name) return currentUserProfile.business_name[0].toUpperCase();
    return "U";
  };

  const handleDoubleTap = (() => {
    let lastTap = 0;
    return () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        if (!isLiked) handleLike();
        setLikeAnimation(true);
        setTimeout(() => setLikeAnimation(false), 800);
      }
      lastTap = now;
    };
  })();

  if (!post || !open) return null;

  const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
  const hasVideo = post.media_type === 'video' || isVideoUrl(post.video_url) || isVideoUrl(post.image_url);
  const videoSrc = post.video_url || (isVideoUrl(post.image_url) ? post.image_url : undefined);
  const hasMedia = post.image_url || hasVideo;

  return (
    <>
      <div className={`fixed inset-0 z-[60] bg-white dark:bg-black transition-all duration-200 ${closing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>

        {/* ===== HEADER BAR - Instagram style ===== */}
        <div
          className="flex items-center px-4 h-11 border-b border-gray-200/60 dark:border-gray-800 bg-white dark:bg-black flex-shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <button onClick={handleClose} className="p-1 -ml-1 active:scale-90 transition-transform">
            <X className="w-6 h-6 text-gray-900 dark:text-white" />
          </button>
          <h1 className="flex-1 text-center font-semibold text-base text-gray-900 dark:text-white">
            {t('post.comments')}
          </h1>
          <div className="w-6" />
        </div>

        {/* ===== SCROLLABLE CONTENT ===== */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          style={{ height: 'calc(100vh - env(safe-area-inset-top) - 44px - 56px - env(safe-area-inset-bottom))' }}
        >
          {/* IMAGE / VIDEO */}
          {hasMedia && (
            <div className="relative bg-black" onClick={handleDoubleTap}>
              {hasVideo && videoSrc ? (
                <video
                  src={videoSrc}
                  className="w-full max-h-[55vh] object-contain bg-black"
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                />
              ) : (
                <img src={post.image_url} alt="" className="w-full max-h-[55vh] object-contain bg-black" />
              )}

              {/* Double tap heart */}
              {likeAnimation && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Heart className="w-24 h-24 text-white fill-white drop-shadow-2xl" style={{
                    animation: 'heartPop 0.6s ease-out forwards'
                  }} />
                </div>
              )}
            </div>
          )}

          {/* ACTION BAR */}
          <div className="flex items-center px-3 pt-2 pb-1 bg-white dark:bg-black">
            {/* Left actions */}
            <div className="flex items-center gap-0">
              <button onClick={handleLike} className="p-2 active:scale-75 transition-transform">
                <Heart className={`w-[26px] h-[26px] ${isLiked ? 'text-red-500 fill-red-500' : 'text-gray-900 dark:text-white'}`} />
              </button>
              <button onClick={() => inputRef.current?.focus()} className="p-2 active:scale-75 transition-transform">
                <MessageCircle className="w-[26px] h-[26px] text-gray-900 dark:text-white" />
              </button>
            </div>

            <div className="flex-1" />

            {/* Right actions */}
            <button onClick={handleSave} className="p-2 active:scale-75 transition-transform">
              <Bookmark className={`w-[26px] h-[26px] ${isSaved ? 'text-gray-900 dark:text-white fill-current' : 'text-gray-900 dark:text-white'}`} />
            </button>
          </div>

          {/* LIKES */}
          <div className="px-4 pb-1 bg-white dark:bg-black">
            {likesCount > 0 ? (
              <button onClick={() => setLikesSheetOpen(true)}>
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  {likesCount} {t('post.likes')}
                </p>
              </button>
            ) : null}
          </div>

          {/* CAPTION */}
          {post.content && (
            <div className="px-4 pb-2 bg-white dark:bg-black">
              <p className="text-sm text-gray-900 dark:text-white leading-relaxed">
                <span
                  className="font-bold mr-1.5 cursor-pointer"
                  onClick={() => { handleClose(); setTimeout(() => navigate(`/profile/${post.user_id}`), 200); }}
                >{getDisplayName()}</span>
                {post.content}
              </p>
            </div>
          )}

          {/* VIEWS + TIME */}
          <div className="px-4 pb-3 bg-white dark:bg-black">
            {viewsCount > 0 && (
              <p className="text-[11px] text-gray-400 mb-0.5">{viewsCount} {t('profile.views').toLowerCase()}</p>
            )}
            <p className="text-[11px] text-gray-400">
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: getDateLocale() })}
            </p>
          </div>

          {/* COMMENTS */}
          <div className="bg-white dark:bg-black">
            {comments.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-gray-400">{t('post.noComments')}</p>
              </div>
            ) : (
              <div className="px-4 space-y-4 pb-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <Avatar
                      className="w-8 h-8 flex-shrink-0 cursor-pointer mt-0.5"
                      onClick={() => { handleClose(); setTimeout(() => navigate(`/profile/${comment.user_id}`), 200); }}
                    >
                      <AvatarImage src={comment.profiles?.profile_image_url} />
                      <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-500 text-[10px] font-semibold">
                        {getDisplayName(comment.profiles).charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-white leading-relaxed">
                        <span
                          className="font-bold mr-1.5 cursor-pointer"
                          onClick={() => { handleClose(); setTimeout(() => navigate(`/profile/${comment.user_id}`), 200); }}
                        >{getDisplayName(comment.profiles)}</span>
                        {comment.content}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: getDateLocale() })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* ===== COMMENT INPUT BAR - fixed at bottom ===== */}
        <div
          className="border-t border-gray-200/60 dark:border-gray-800 bg-white dark:bg-black px-4 py-2 flex-shrink-0"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <form onSubmit={handleSubmitComment} className="flex items-center gap-3">
            <Avatar className="w-8 h-8 flex-shrink-0">
              <AvatarImage src={currentUserProfile?.profile_image_url} />
              <AvatarFallback className="bg-gray-200 dark:bg-gray-700 text-gray-500 text-xs font-semibold">
                {getCurrentUserInitial()}
              </AvatarFallback>
            </Avatar>
            <textarea
              ref={inputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={t('post.writeComment')}
              className="flex-1 bg-transparent text-sm resize-none max-h-20 outline-none placeholder:text-gray-400 text-gray-900 dark:text-white py-1.5"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitComment(e);
                }
              }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 80) + 'px';
              }}
            />
            {newComment.trim() ? (
              <button
                type="submit"
                disabled={loading}
                className="text-blue-500 font-semibold text-sm disabled:opacity-40 active:opacity-60"
              >
                {t('post.publish')}
              </button>
            ) : null}
          </form>
        </div>
      </div>

      {/* Keyframe for heart animation */}
      <style>{`
        @keyframes heartPop {
          0% { transform: scale(0); opacity: 1; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>

      <LikesSheet open={likesSheetOpen} onOpenChange={setLikesSheetOpen} postId={post?.id} />
    </>
  );
};

export default PostDetailModal;
