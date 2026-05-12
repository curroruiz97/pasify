import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import StoryViewer from "./StoryViewer";
import CreateStoryDialog from "./CreateStoryDialog";

interface StoriesCarouselProps {
  currentUserId: string;
}

const StoriesCarousel = ({ currentUserId }: StoriesCarouselProps) => {
  const { toast } = useToast();
  const [stories, setStories] = useState<any[]>([]);
  const [selectedStory, setSelectedStory] = useState<any>(null);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState<number>(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [viewedStories, setViewedStories] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadStories();
    loadViewedStories();
  }, [currentUserId]);

  const loadStories = async () => {
    const { data } = await supabase
      .from("stories")
      .select(`
        *,
        profiles(first_name, last_name, profile_image_url, business_name)
      `)
      .eq("status", "approved")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    // Group stories by user
    const groupedStories: any = {};
    data?.forEach((story) => {
      if (!groupedStories[story.user_id]) {
        groupedStories[story.user_id] = {
          user_id: story.user_id,
          profile: story.profiles,
          stories: []
        };
      }
      groupedStories[story.user_id].stories.push(story);
    });

    // Sort: unviewed stories first, viewed stories last
    const allStories = Object.values(groupedStories);
    const unviewed = allStories.filter((sg: any) => 
      sg.stories.some((story: any) => !viewedStories.has(story.id))
    );
    const viewed = allStories.filter((sg: any) => 
      sg.stories.every((story: any) => viewedStories.has(story.id))
    );

    setStories([...unviewed, ...viewed]);
  };

  const loadViewedStories = async () => {
    const { data } = await supabase
      .from("story_views")
      .select("story_id")
      .eq("viewer_id", currentUserId);
    
    if (data) {
      setViewedStories(new Set(data.map(v => v.story_id)));
    }
  };

  const handleStoryCreated = () => {
    loadStories();
    setShowCreateDialog(false);
  };

  const handleStoryClick = (storyGroup: any, index: number) => {
    setSelectedStory(storyGroup);
    setSelectedStoryIndex(index);
  };

  const handleNextStory = () => {
    if (selectedStoryIndex < stories.length - 1) {
      const nextIndex = selectedStoryIndex + 1;
      setSelectedStory(stories[nextIndex]);
      setSelectedStoryIndex(nextIndex);
    } else {
      setSelectedStory(null);
    }
  };

  const handleCloseStory = () => {
    setSelectedStory(null);
    loadViewedStories(); // Refresh viewed stories
  };

  const isStoryGroupViewed = (storyGroup: any) => {
    return storyGroup.stories.every((story: any) => viewedStories.has(story.id));
  };

  const userHasStory = stories.some(s => s.user_id === currentUserId);

  return (
    <>
      <div className="flex gap-3 px-4 overflow-x-auto pb-2 scrollbar-hide">
        {/* Add Story */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="relative"
          >
            <Avatar className="h-16 w-16 border-2 border-primary">
              <AvatarImage src="" />
              <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-primary-foreground">
                <Plus className="w-6 h-6" />
              </AvatarFallback>
            </Avatar>
          </button>
          <span className="text-xs text-center max-w-[70px] truncate">La tua storia</span>
        </div>

        {/* Stories */}
        {stories.map((storyGroup, index) => {
          const isViewed = isStoryGroupViewed(storyGroup);
          return (
            <div
              key={storyGroup.user_id}
              className="flex flex-col items-center gap-1 flex-shrink-0"
            >
              <button
                onClick={() => handleStoryClick(storyGroup, index)}
                className="relative"
              >
                <div className={`p-[3px] rounded-full ${
                  isViewed 
                    ? 'bg-gradient-to-tr from-muted to-muted-foreground/30 opacity-60' 
                    : 'bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-500'
                }`}>
                  <Avatar className={`h-16 w-16 border-2 border-background ${isViewed ? 'grayscale opacity-80' : ''}`}>
                    <AvatarImage src={storyGroup.profile?.profile_image_url} />
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {storyGroup.profile?.first_name?.[0] || storyGroup.profile?.business_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </button>
              <span className="text-xs text-center max-w-[70px] truncate">
                {storyGroup.profile?.first_name || storyGroup.profile?.business_name}
              </span>
            </div>
          );
        })}
      </div>

      {selectedStory && (
        <StoryViewer
          storyGroup={selectedStory}
          currentUserId={currentUserId}
          onClose={handleCloseStory}
          onNext={handleNextStory}
        />
      )}

      <CreateStoryDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        userId={currentUserId}
        onStoryCreated={handleStoryCreated}
      />
    </>
  );
};

export default StoriesCarousel;
