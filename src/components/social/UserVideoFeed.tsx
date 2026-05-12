import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import VideoViewer from "./VideoViewer";

interface UserVideoFeedProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPost: any;
  userId: string; // ID dell'utente di cui vedere i video
  currentUserId: string;
  onLikeToggle: (postId: string, isLiked: boolean) => void;
}

const UserVideoFeed = ({ open, onOpenChange, initialPost, userId, currentUserId, onLikeToggle }: UserVideoFeedProps) => {
  const [posts, setPosts] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    if (open && initialPost && userId) {
      loadUserVideos();
    }
  }, [open, initialPost, userId]);

  const loadUserVideos = async () => {
    setLoading(true);
    try {
      // Carica SOLO i video di questo utente specifico
      const { data, error } = await supabase
        .from("posts")
        .select(`
          *,
          public_profiles(*),
          likes(*)
        `)
        .eq("user_id", userId) // FILTRA PER UTENTE SPECIFICO
        .eq("media_type", "video")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Trova l'indice del post iniziale
      const initialIndex = data.findIndex(post => post.id === initialPost.id);

      setPosts(data);
      setCurrentIndex(initialIndex >= 0 ? initialIndex : 0);
    } catch (error) {
      console.error("Error loading user videos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    currentY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    const deltaY = startY.current - currentY.current;
    const threshold = 50;

    if (Math.abs(deltaY) > threshold) {
      if (deltaY > 0 && currentIndex < posts.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else if (deltaY < 0 && currentIndex > 0) {
        setCurrentIndex(prev => prev - 1);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const deltaY = e.deltaY;
    const threshold = 50;

    if (Math.abs(deltaY) > threshold) {
      if (deltaY > 0 && currentIndex < posts.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else if (deltaY < 0 && currentIndex > 0) {
        setCurrentIndex(prev => prev - 1);
      }
    }
  };

  if (!open || posts.length === 0) return null;

  const currentPost = posts[currentIndex];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black z-[100]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Video corrente - fullscreen senza barra */}
      <VideoViewer
        open={true}
        onOpenChange={onOpenChange}
        post={currentPost}
        currentUserId={currentUserId}
        onLikeToggle={onLikeToggle}
      />
    </div>
  );
};

export default UserVideoFeed;