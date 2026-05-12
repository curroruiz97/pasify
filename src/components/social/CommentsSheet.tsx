import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { it, es, enUS, fr, de } from "date-fns/locale";
import { useTranslation } from "react-i18next";
interface CommentsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  postOwnerId?: string;
  currentUserId: string;
  currentUserName?: string;
}

const CommentsSheet = ({ open, onOpenChange, postId, postOwnerId, currentUserId, currentUserName }: CommentsSheetProps) => {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);

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
    if (open) {
      loadComments();
      subscribeToComments();
    }
  }, [open, postId]);

  const loadComments = async () => {
    const { data } = await supabase
      .from("comments")
      .select(`
        *,
        profiles!comments_user_id_fkey(first_name, last_name, profile_image_url, business_name)
      `)
      .eq("post_id", postId)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    setComments(data || []);
  };

  const subscribeToComments = () => {
    const channel = supabase
      .channel(`comments-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `post_id=eq.${postId}`,
        },
        () => {
          loadComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSubmit = async () => {
    if (!newComment.trim() || loading) return;

    setLoading(true);
    try {
      // Call moderation AI for comment
      const { data: moderationData, error: moderationError } = await supabase.functions.invoke(
        'moderate-content',
        {
          body: {
            content: newComment.trim(),
            contentType: 'comment'
          }
        }
      );

      // Handle moderation errors silently for comments
      if (moderationError || moderationData?.error) {
        console.error('Comment moderation error:', moderationError || moderationData?.error);
      }

      const moderation = moderationData || { approved: true, score: 0 };

      const { error } = await supabase.from("comments").insert({
        post_id: postId,
        user_id: currentUserId,
        content: newComment.trim(),
        status: moderation.approved ? 'approved' : 'pending',
        moderation_score: moderation.score || 0,
        moderation_category: moderation.category,
        moderation_reason: moderation.reason,
        auto_moderated: !moderation.approved,
      });

      if (error) throw error;

      // Send push notification to post owner
      if (moderation.approved && postOwnerId && postOwnerId !== currentUserId) {
        try {
          await supabase.functions.invoke('send-social-notification', {
            body: {
              recipientUserId: postOwnerId,
              actorName: currentUserName || 'Alguien',
              actorId: currentUserId,
              type: 'comment',
              postId: postId,
              commentContent: newComment.trim(),
              language: i18n.language,
            }
          });
          console.log('📤 Comment notification sent');
        } catch (notifError) {
          console.warn('Failed to send comment notification:', notifError);
        }
      }

      setNewComment("");

      if (moderation.approved) {
        toast({
          title: t('success.commentPublished') || "Commento pubblicato",
        });
      } else {
        toast({
          title: t('moderation.commentReview') || "Commento en revisión",
          description: t('moderation.commentReviewDesc') || "Tu comentario está siendo revisado antes de publicarse",
        });
      }
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getDisplayName = (profile: any) => {
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || "Utente";
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[80vh] flex flex-col z-[200]">
        <DrawerHeader>
          <DrawerTitle>{t('social.comments')} ({comments.length})</DrawerTitle>
        </DrawerHeader>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto space-y-4 px-4">
          {comments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {t('social.noComments')}
            </div>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarImage src={comment.public_profiles?.profile_image_url} />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getDisplayName(comment.public_profiles)[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                      {getDisplayName(comment.public_profiles)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.created_at), {
                        addSuffix: true,
                        locale: getDateLocale(),
                      })}
                    </span>
                  </div>
                  <p className="text-sm">{comment.content}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Comment Input */}
        <div className="border-t p-4 flex gap-2">
          <Textarea
            placeholder={t('social.writeComment')}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="flex-1 min-h-[50px] max-h-[100px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={!newComment.trim() || loading}
            size="icon"
            className="h-[50px] w-[50px] rounded-full flex-shrink-0"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default CommentsSheet;
