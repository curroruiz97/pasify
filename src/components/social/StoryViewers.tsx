import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerOverlay,
} from "@/components/ui/drawer";
import { Eye } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface StoryViewersProps {
  storyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Viewer {
  id: string;
  viewer_id: string;
  viewed_at: string;
  profiles: {
    first_name?: string;
    last_name?: string;
    business_name?: string;
    profile_image_url?: string;
  };
}

const StoryViewers = ({ storyId, open, onOpenChange }: StoryViewersProps) => {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && storyId) {
      loadViewers();
      subscribeToViewers();
    }
  }, [open, storyId]);

  const loadViewers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("story_views")
      .select(`
        id,
        viewer_id,
        viewed_at,
        profiles!inner(
          first_name,
          last_name,
          business_name,
          profile_image_url
        )
      `)
      .eq("story_id", storyId)
      .order("viewed_at", { ascending: false });

    if (data) {
      setViewers(data);
    }
    setLoading(false);
  };

  const subscribeToViewers = () => {
    const channel = supabase
      .channel(`story-views-${storyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "story_views",
          filter: `story_id=eq.${storyId}`,
        },
        () => {
          loadViewers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const getDisplayName = (viewer: Viewer) => {
    const profile = viewer.profiles;
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || "Usuario";
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerOverlay className="bg-black/40 backdrop-blur-sm" />
      <DrawerContent className="h-[70vh] bg-card rounded-t-[24px] shadow-2xl border border-border/50" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <DrawerHeader className="border-b border-border/50">
          <DrawerTitle className="text-center font-semibold">Visualizaciones</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 bg-card">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : viewers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Eye className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm">Todavía nadie ha visto esta historia</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {viewers.map((viewer) => {
                const displayName = getDisplayName(viewer);

                return (
                  <div
                    key={viewer.id}
                    className="flex items-center justify-between py-2.5 px-2 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-11 w-11 border border-border/50">
                        <AvatarImage src={viewer.profiles?.profile_image_url} />
                        <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-primary-foreground text-sm font-medium">
                          {displayName[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm text-foreground">
                          {displayName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(viewer.viewed_at), {
                            addSuffix: true,
                            locale: es,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default StoryViewers;