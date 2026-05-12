import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Heart, MessageCircle, QrCode, CalendarCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { it, enUS, es, fr, de } from "date-fns/locale";
import VideoThumbnail from "@/components/shared/VideoThumbnail";
import { useTranslation } from "react-i18next";

interface NotificationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userRole?: string;
}

type Notification = {
  id: string;
  type: "like" | "comment" | "qr_code" | "event_participation";
  created_at: string;
  user_id: string;
  post_id?: string;
  event_id?: string;
  comment_content?: string;
  profiles: any;
  posts?: any;
  events?: any;
};

const NotificationsSheet = ({ open, onOpenChange, userId, userRole }: NotificationsSheetProps) => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

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
      loadNotifications();
    }
  }, [open, userId]);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const allNotifications: Notification[] = [];

      // Get user posts
      const { data: userPosts } = await supabase
        .from("posts")
        .select("id")
        .eq("user_id", userId);

      const postIds = userPosts?.map(p => p.id) || [];

      // Get likes
      if (postIds.length > 0) {
        const { data: likesData } = await supabase
          .from("likes")
          .select(`
            id,
            user_id,
            created_at,
            post_id,
            posts:post_id (
              image_url,
              video_url,
              thumbnail_url,
              content
            ),
            profiles:user_id (
              id,
              first_name,
              last_name,
              business_name,
              profile_image_url
            )
          `)
          .in("post_id", postIds)
          .neq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (likesData) {
          allNotifications.push(...likesData.map(like => ({
            ...like,
            type: "like" as const
          })));
        }
      }

      // Get comments
      if (postIds.length > 0) {
        const { data: commentsData } = await supabase
          .from("comments")
          .select(`
            id,
            user_id,
            created_at,
            post_id,
            content,
            posts:post_id (
              image_url,
              video_url,
              thumbnail_url,
              content
            ),
            profiles:user_id (
              id,
              first_name,
              last_name,
              business_name,
              profile_image_url
            )
          `)
          .in("post_id", postIds)
          .neq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (commentsData) {
          allNotifications.push(...commentsData.map(comment => ({
            ...comment,
            type: "comment" as const,
            comment_content: comment.content
          })));
        }
      }

      // Get notifications for partners (event participations and discount QR codes)
      if (userRole === "partner") {
        // Get events
        const { data: partnerEvents } = await supabase
          .from("events")
          .select("id, title, image_url")
          .eq("partner_id", userId)
          .eq("type", "event");

        const eventIds = partnerEvents?.map(e => e.id) || [];

        // Get event participants (people who joined the event)
        if (eventIds.length > 0) {
          const { data: participantsData } = await supabase
            .from("event_participants")
            .select(`
              id,
              user_id,
              created_at,
              event_id,
              events:event_id (
                title,
                image_url
              ),
              profiles:user_id (
                id,
                first_name,
                last_name,
                business_name,
                profile_image_url
              )
            `)
            .in("event_id", eventIds)
            .order("created_at", { ascending: false })
            .limit(50);

          if (participantsData) {
            allNotifications.push(...participantsData.map(p => ({
              id: p.id,
              type: "event_participation" as const,
              created_at: p.created_at,
              user_id: p.user_id,
              event_id: p.event_id,
              profiles: p.profiles,
              events: p.events
            })));
          }
        }

        // Get discounts
        const { data: partnerDiscounts } = await supabase
          .from("discounts")
          .select("id, title, image_url")
          .eq("partner_id", userId);

        const discountIds = partnerDiscounts?.map(d => d.id) || [];

        // Get QR codes from discounts
        if (discountIds.length > 0) {
          const { data: discountQRCodesData } = await supabase
            .from("qr_codes")
            .select(`
              id,
              client_id,
              created_at,
              discount_id,
              discounts:discount_id (
                title,
                image_url
              ),
              profiles:client_id (
                id,
                first_name,
                last_name,
                business_name,
                profile_image_url
              )
            `)
            .in("discount_id", discountIds)
            .order("created_at", { ascending: false })
            .limit(50);

          if (discountQRCodesData) {
            allNotifications.push(...discountQRCodesData.map(qr => ({
              id: qr.id,
              type: "qr_code" as const,
              created_at: qr.created_at,
              user_id: qr.client_id,
              event_id: qr.discount_id, // Use same field for compatibility
              profiles: qr.profiles,
              events: qr.discounts // Use same field for compatibility
            })));
          }
        }
      }

      // Sort all notifications by created_at
      allNotifications.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setNotifications(allNotifications);
    } catch (error) {
      console.error("Error loading notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const getDisplayName = (profile: any) => {
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || t('common.user');
  };

  const handleProfileClick = (profileUserId: string) => {
    onOpenChange(false);
    navigate(`/profile/${profileUserId}`);
  };

  const handlePostClick = (postId: string) => {
    onOpenChange(false);
    // Navigate to post if needed
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "like":
        return <Heart className="w-5 h-5 text-primary fill-primary" />;
      case "comment":
        return <MessageCircle className="w-5 h-5 text-primary" />;
      case "qr_code":
        return <QrCode className="w-5 h-5 text-primary" />;
      case "event_participation":
        return <CalendarCheck className="w-5 h-5 text-green-500" />;
      default:
        return null;
    }
  };

  const getNotificationText = (notification: Notification) => {
    switch (notification.type) {
      case "like":
        return ` ${t('notifications.likedYourPost')}`;
      case "comment":
        return ` ${t('notifications.commentedYourPost')}`;
      case "qr_code":
        return ` ${t('notifications.downloadedQrFor')} ${notification.events?.title || t('notifications.yourEvent')}`;
      case "event_participation":
        return ` ${t('notifications.joinedEvent')} ${notification.events?.title || t('notifications.yourEvent')}`;
      default:
        return "";
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[70vh]">
        <DrawerHeader className="pb-4 border-b">
          <DrawerTitle className="flex items-center gap-2 justify-center">
            <Heart className="w-5 h-5 text-primary fill-primary" />
            <span className="text-lg font-bold">{t('notifications.title')}</span>
          </DrawerTitle>
        </DrawerHeader>

        <ScrollArea className="h-[calc(70vh-80px)] mt-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <Heart className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">{t('notifications.empty')}</p>
            </div>
          ) : (
            <div className="space-y-1 pb-4">
              {notifications.map((notification) => (
                <div
                  key={`${notification.type}-${notification.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div
                    onClick={() => handleProfileClick(notification.user_id)}
                    className="cursor-pointer"
                  >
                    <Avatar className="h-12 w-12 border-2 border-border">
                      <AvatarImage src={notification.profiles?.profile_image_url} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {getDisplayName(notification.profiles)[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm flex items-center gap-2">
                      {getNotificationIcon(notification.type)}
                      <span
                        className="font-semibold cursor-pointer hover:underline"
                        onClick={() => handleProfileClick(notification.user_id)}
                      >
                        {getDisplayName(notification.profiles)}
                      </span>
                      <span className="text-muted-foreground">{getNotificationText(notification)}</span>
                    </p>
                    {notification.type === "comment" && notification.comment_content && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        "{notification.comment_content}"
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: getDateLocale() })}
                    </p>
                  </div>
                  {(() => {
                    const post = notification.posts;
                    if (post) {
                      const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
                      const videoSrc = post.video_url || (isVideoUrl(post.image_url) ? post.image_url : null);
                      if (videoSrc) {
                        return (
                          <VideoThumbnail
                            videoUrl={videoSrc}
                            thumbnailUrl={post.thumbnail_url}
                            className="w-12 h-12 rounded cursor-pointer"
                            showPlayIcon={true}
                            onClick={() => notification.post_id && handlePostClick(notification.post_id)}
                          />
                        );
                      }
                      if (post.image_url) {
                        return (
                          <div
                            onClick={() => notification.post_id && handlePostClick(notification.post_id)}
                            className="cursor-pointer"
                          >
                            <img
                              src={post.image_url}
                              alt="Post"
                              className="w-12 h-12 rounded object-cover"
                            />
                          </div>
                        );
                      }
                    }
                    if (notification.events?.image_url) {
                      return (
                        <div className="cursor-pointer">
                          <img
                            src={notification.events.image_url}
                            alt="Event"
                            className="w-12 h-12 rounded object-cover"
                          />
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
};

export default NotificationsSheet;
