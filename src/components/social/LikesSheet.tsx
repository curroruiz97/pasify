import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface LikesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId?: string;
  postIds?: string[]; // For showing all likes from multiple posts (profile view)
  // NUOVA PROP: Funzione per marcare le notifiche come lette
  onMarkAsRead?: () => void;
}

const LikesSheet = ({ open, onOpenChange, postId, postIds, onMarkAsRead }: LikesSheetProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [likes, setLikes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadLikes();
      // Chiama la funzione per marcare le notifiche come lette quando il pannello si apre
      if (onMarkAsRead) {
        onMarkAsRead();
      }
    }
  }, [open, postId, postIds, onMarkAsRead]); // Aggiunto onMarkAsRead alle dipendenze

  const loadLikes = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("likes")
        .select(`
          id,
          user_id,
          created_at,
          profiles:user_id (
            id,
            first_name,
            last_name,
            business_name,
            profile_image_url
          )
        `)
        .order("created_at", { ascending: false });

      if (postId) {
        query = query.eq("post_id", postId);
      } else if (postIds && postIds.length > 0) {
        query = query.in("post_id", postIds);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Remove duplicates by user_id when showing multiple posts
      const uniqueLikes = postIds
        ? data?.filter((like, index, self) =>
            index === self.findIndex(l => l.user_id === like.user_id)
          )
        : data;

      setLikes(uniqueLikes || []);
    } catch (error) {
      console.error("Error loading likes:", error);
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

  const handleProfileClick = (userId: string) => {
    onOpenChange(false);
    navigate(`/profile/${userId}`);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[70vh]">
        <DrawerHeader className="pb-4 border-b">
          <DrawerTitle className="flex items-center gap-2 justify-center">
            <Heart className="w-5 h-5 text-primary fill-primary" />
            <span className="text-lg font-bold">{likes.length} {t("post.likes")}</span>
          </DrawerTitle>
        </DrawerHeader>

        <ScrollArea className="h-[calc(70vh-80px)] mt-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : likes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">{t("post.noLikesYet")}</p>
            </div>
          ) : (
            <div className="space-y-3 pb-4">
              {likes.map((like) => (
                <div
                  key={like.id}
                  onClick={() => handleProfileClick(like.user_id)}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <Avatar className="h-12 w-12 border-2 border-border">
                    <AvatarImage src={like.profiles?.profile_image_url} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {getDisplayName(like.profiles)[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">
                      {getDisplayName(like.profiles)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
};

export default LikesSheet;