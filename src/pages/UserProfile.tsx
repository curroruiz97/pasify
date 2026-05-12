import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { compressAvatar, compressPostImage } from "@/lib/imageUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MessageCircle, Grid, Bookmark, Camera, Pencil, Users, Tag, UserCircle, Plus, Edit2, SlidersHorizontal, Award, Play, Heart } from "lucide-react";
import EditProfileSheet from "@/components/client/EditProfileSheet";
import VideoThumbnail from "@/components/shared/VideoThumbnail";
import SwipeBackWrapper from "@/components/shared/SwipeBackWrapper";
import { useBadges } from "@/hooks/useBadges";
import { BadgeAnimation } from "@/components/gamification/BadgeAnimation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import UploadSheet from "@/components/shared/UploadSheet";
import { Textarea } from "@/components/ui/textarea";
import SettingsSheet from "@/components/partner/SettingsSheet";
import { useTranslation } from "react-i18next";
import LikesSheet from "@/components/social/LikesSheet";
import UserVideoFeed from "@/components/social/UserVideoFeed";
import NotificationBadge from "@/components/chat/NotificationBadge";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { useClientOnboarding } from "@/hooks/useClientOnboarding";
import ClientOnboarding from "@/components/client/ClientOnboarding";

const UserProfile = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [savedPosts, setSavedPosts] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"posts" | "saved">("posts");
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [videoFeedOpen, setVideoFeedOpen] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [totalLikes, setTotalLikes] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [likesSheetOpen, setLikesSheetOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const totalUnread = useUnreadMessages(currentUser?.id); // Initialize useUnreadMessages
  const unreadNotifications = useUnreadNotifications(currentUser?.id); // Initialize useUnreadNotifications

  const { badges, newBadge, setNewBadge, loadUserStats } = useBadges(
    userId || currentUser?.id,
    userRole
  );

  // Client onboarding for own profile
  const isOwnProfileForOnboarding = !userId || userId === currentUser?.id;
  const {
    isOnboardingActive,
    getCurrentStep,
    getProgress,
    totalSteps,
    currentStep,
    nextStep,
    prevStep,
    skipCurrentStep,
    completeOnboarding,
    refreshCompletion,
    canProceed,
  } = useClientOnboarding(isOwnProfileForOnboarding && userRole === "client" ? currentUser?.id : undefined);

  // Refresh completion when profile photos change
  useEffect(() => {
    if (isOwnProfileForOnboarding && profile) {
      refreshCompletion();
    }
  }, [profile?.profile_image_url, profile?.cover_image_url, isOwnProfileForOnboarding, refreshCompletion]);

  useEffect(() => {
    checkAuth();
  }, [userId]);

  // Handle openPost query parameter to auto-open video
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const openPostId = searchParams.get('openPost');
    
    if (openPostId && posts.length > 0 && !loading) {
      const postToOpen = posts.find(p => p.id === openPostId);
      if (postToOpen) {
        setSelectedPost(postToOpen);
        setVideoFeedOpen(true);
        // Clean up URL
        window.history.replaceState({}, '', location.pathname);
      }
    }
  }, [location.search, posts, loading]);

  useEffect(() => {
    if (currentUser && location.pathname.startsWith('/profile')) {
      loadUserContent(userId || currentUser.id);
    }
  }, [location.pathname, currentUser, userId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentUser) {
        loadUserContent(userId || currentUser.id);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentUser, userId]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      navigate("/login");
      return;
    }

    setCurrentUser(user);

    const { data: roleData } = await supabase.rpc('get_user_role', { _user_id: user.id });
    setUserRole(roleData);

    await loadProfile(userId || user.id);
    await loadUserContent(userId || user.id);

    if (!userId || userId === user.id) {
      await trackAccess(user.id);
    }
  };

  const trackAccess = async (userId: string) => {
    try {
      const { data: stats } = await supabase
        .from('user_stats')
        .select('total_accesses')
        .eq('user_id', userId)
        .single();

      if (stats) {
        await supabase
          .from('user_stats')
          .update({ total_accesses: (stats.total_accesses || 0) + 1 })
          .eq('user_id', userId);
      } else {
        await supabase
          .from('user_stats')
          .insert({ user_id: userId, total_accesses: 1 });
      }

      await loadUserStats();
    } catch (error) {
      console.error('Error tracking access:', error);
    }
  };

  const loadProfile = async (id: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    setProfile(data);
    setCoverImage(data?.cover_image_url || null);
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    try {
      // Comprimi immagine cover (max 1200px)
      const compressedFile = await compressPostImage(file);
      const filePath = `${currentUser.id}/cover-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedFile, { cacheControl: '31536000' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ cover_image_url: publicUrl })
        .eq('id', currentUser.id);

      if (updateError) throw updateError;

      setCoverImage(publicUrl);
      setProfile((prev: any) => ({ ...prev, cover_image_url: publicUrl }));
      toast({ title: "Copertina aggiornata" });
      
      // Trigger onboarding refresh after upload
      setTimeout(() => refreshCompletion(), 500);
    } catch (error: any) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    try {
      // Comprimi avatar (max 200px)
      const compressedFile = await compressAvatar(file);
      const filePath = `${currentUser.id}/avatar-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedFile, { cacheControl: '31536000' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_image_url: publicUrl })
        .eq('id', currentUser.id);

      if (updateError) throw updateError;

      setProfile((prev: any) => ({ ...prev, profile_image_url: publicUrl }));
      toast({ title: "Immagine profilo aggiornata" });
      
      // Trigger onboarding refresh after upload
      setTimeout(() => refreshCompletion(), 500);
    } catch (error: any) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    }
  };

  const loadUserContent = async (id: string) => {
    setLoading(true);

    // If viewing own profile, show all posts. If viewing someone else's, show only approved
    const isOwnProfile = id === currentUser?.id;
    
    let postsQuery = supabase
      .from("posts")
      .select(
        `
        *,
        thumbnail_url,
        likes(id, user_id),
        profiles!posts_user_id_fkey(first_name, last_name, profile_image_url, business_name)
        `
      )
      .eq("user_id", id);
    
    if (!isOwnProfile) {
      postsQuery = postsQuery.eq("status", "approved");
    }
    
    const { data: postsData } = await postsQuery.order("created_at", { ascending: false });

    setPosts(postsData || []);

    if (postsData) {
      const likes = postsData.reduce((acc, post) => acc + (post.likes?.length || 0), 0);
      setTotalLikes(likes);
    }

    if (postsData && postsData.length > 0) {
      const postIds = postsData.map(post => post.id);
      const { count: viewsTotal } = await supabase
        .from("post_views")
        .select("*", { count: "exact", head: true })
        .in("post_id", postIds);
      setTotalViews(viewsTotal || 0);
    }

    if (id === currentUser?.id) {
      const { data: savedPostsData } = await supabase
        .from("saved_posts")
        .select(
          `
          post_id,
          posts(
            *,
            thumbnail_url,
            likes(id, user_id),
            profiles(first_name, last_name, profile_image_url, business_name)
          )
          `
        )
        .eq("user_id", id)
        .order("created_at", { ascending: false });

      setSavedPosts(savedPostsData?.map(sp => sp.posts).filter(Boolean) || []);
    }

    const { data: storiesData } = await supabase
      .from("stories")
      .select("*")
      .eq("user_id", id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    setStories(storiesData || []);

    setLoading(false);
  };

  const handleStartChat = async () => {
    if (!currentUser || !userId) return;

    try {
      const { data: existingConv } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", currentUser.id);

      if (existingConv && existingConv.length > 0) {
        for (const conv of existingConv) {
          const { data: otherParticipant } = await supabase
            .from("conversation_participants")
            .select("user_id")
            .eq("conversation_id", conv.conversation_id)
            .eq("user_id", userId)
            .single();

          if (otherParticipant) {
            navigate(`/chat/${conv.conversation_id}`);
            return;
          }
        }
      }

      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({
          user1_id: currentUser.id,
          user2_id: userId
        })
        .select()
        .single();

      if (convError) throw convError;

      const { error: participantsError } = await supabase
        .from("conversation_participants")
        .insert([
          { conversation_id: newConv.id, user_id: currentUser.id },
          { conversation_id: newConv.id, user_id: userId },
        ]);

      if (participantsError) throw participantsError;

      navigate(`/chat/${newConv.id}`);
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleLikeToggle = (postId: string, isLiked: boolean) => {
    setPosts(prevPosts =>
      prevPosts.map(post => {
        if (post.id === postId) {
          const currentLikes = post.likes || [];
          if (isLiked) {
            return {
              ...post,
              likes: [...currentLikes, { user_id: currentUser?.id }]
            };
          } else {
            return {
              ...post,
              likes: currentLikes.filter((like: any) => like.user_id !== currentUser?.id)
            };
          }
        }
        return post;
      })
    );
  };

  const getDisplayName = () => {
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || "Utente";
  };

  const isOwnProfile = currentUser?.id === (userId || currentUser?.id);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <SwipeBackWrapper>
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24">
      {/* Profile Header */}
      <div className="relative">
        {/* Cover Image - taller with gradient overlay */}
        <div
          className="h-44 bg-gradient-to-br from-blue-500 via-blue-400 to-cyan-400 relative group cursor-pointer"
          style={coverImage ? {
            backgroundImage: `url(${coverImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          } : {}}
          onClick={() => isOwnProfile && coverInputRef.current?.click()}
          data-onboarding="cover-photo"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          {isOwnProfile && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-8 h-8 text-white" />
            </div>
          )}
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />

        {/* Profile Card - overlapping cover */}
        <div className="relative -mt-16 mx-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl p-5 pt-0">
            {/* Avatar */}
            <div className="flex justify-center -mt-12 mb-3">
              <div
                className={`relative ${isOnboardingActive && getCurrentStep()?.id === "profile-photo" ? "cursor-pointer" : ""}`}
                data-onboarding="profile-avatar"
                onClick={() => {
                  if (isOnboardingActive && getCurrentStep()?.id === "profile-photo") {
                    avatarInputRef.current?.click();
                  }
                }}
              >
                <Avatar className="h-24 w-24 border-4 border-white dark:border-gray-900 shadow-xl ring-2 ring-blue-500/20">
                  <AvatarImage src={profile?.profile_image_url} />
                  <AvatarFallback className="bg-gradient-to-br from-cyan-400 to-blue-500 text-white text-2xl font-bold">
                    {getDisplayName()[0]}
                  </AvatarFallback>
                </Avatar>
                {isOwnProfile && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      avatarInputRef.current?.click();
                    }}
                    className="absolute bottom-0 right-0 bg-blue-500 text-white p-2 rounded-full hover:bg-blue-600 transition-all shadow-lg ring-2 ring-white dark:ring-gray-900"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />

            {/* Name + Badge */}
            <div className="text-center mb-1">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{getDisplayName()}</h2>
                {isOwnProfile && (
                  <button
                    onClick={() => navigate('/badges')}
                    className="relative"
                  >
                    <Award className="w-5 h-5 text-blue-500" />
                    {badges.filter(b => b.earned).length > 0 && (
                      <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                        {badges.filter(b => b.earned).length}
                      </div>
                    )}
                  </button>
                )}
              </div>
              {profile?.university && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{profile.university}</p>
              )}
            </div>

            {/* Bio */}
            <div className="text-center mt-2 mb-4">
              {profile?.business_description ? (
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed max-w-xs mx-auto">{profile.business_description}</p>
              ) : isOwnProfile ? (
                <p className="text-xs text-gray-400 italic">{t('profile.addBio')}</p>
              ) : null}
            </div>

            {/* Stats Row */}
            <div className="flex justify-around py-3 mb-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
              <div className="text-center px-3">
                <p className="text-lg font-bold text-gray-900 dark:text-white">{posts.length}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{t('profile.posts')}</p>
              </div>
              <div className="w-px bg-gray-200 dark:bg-gray-700" />
              <button
                onClick={() => setLikesSheetOpen(true)}
                className="text-center px-3 hover:opacity-70 transition-opacity"
              >
                <p className="text-lg font-bold text-gray-900 dark:text-white">{totalLikes}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{t('profile.likes')}</p>
              </button>
              <div className="w-px bg-gray-200 dark:bg-gray-700" />
              <div className="text-center px-3">
                <p className="text-lg font-bold text-gray-900 dark:text-white">{totalViews}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{t('profile.views')}</p>
              </div>
            </div>

            {/* Action Buttons */}
            {isOwnProfile ? (
              <div className="flex gap-2">
                <Button
                  onClick={() => setSettingsSheetOpen(true)}
                  variant="outline"
                  className="flex-1 rounded-xl h-10 font-semibold border-gray-200 dark:border-gray-700"
                >
                  <SlidersHorizontal className="w-4 h-4 mr-1.5" />
                  {t('settings.title')}
                </Button>
                <Button
                  onClick={() => setEditProfileOpen(true)}
                  variant="outline"
                  className="flex-1 rounded-xl h-10 font-semibold border-gray-200 dark:border-gray-700"
                >
                  <Edit2 className="w-4 h-4 mr-1.5" />
                  {t('common.edit')}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleStartChat}
                className="w-full rounded-xl h-11 gap-2 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-white font-semibold shadow-lg shadow-blue-500/25"
              >
                <MessageCircle className="w-4 h-4" />
                {t('chat.newMessage')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content Tabs */}
      <div className="mt-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="px-4">
          <TabsList className="grid grid-cols-2 w-full rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
            <TabsTrigger value="posts" className="gap-2 rounded-lg data-[state=active]:shadow-md">
              <Grid className="w-4 h-4" />
              {t('profile.posts')}
            </TabsTrigger>
            {isOwnProfile && (
              <TabsTrigger value="saved" className="gap-2 rounded-lg data-[state=active]:shadow-md">
                <Bookmark className="w-4 h-4" />
                {t('profile.savedPosts')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="posts" className="mt-4">
            {posts.length === 0 ? (
              <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-2xl shadow-sm">
                <Grid className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">{t('post.noPosts')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5 rounded-2xl overflow-hidden">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="aspect-square bg-white rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                    onClick={() => {
                      const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                      const isVideo = post.media_type === 'video' || isVideoUrl(post.image_url);

                      if (isVideo) {
                        setSelectedPost(post);
                        setVideoFeedOpen(true);
                      }
                    }}
                  >
                    {(() => {
                      const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                      const videoSrc = post.video_url || (isVideoUrl(post.image_url) ? post.image_url : null);

                      if (post.media_type === 'video' || videoSrc) {
                        return (
                          <VideoThumbnail
                            videoUrl={videoSrc || post.image_url}
                            thumbnailUrl={post.thumbnail_url}
                            className="w-full h-full"
                            showPlayIcon={true}
                          />
                        );
                      }
                      if (post.image_url) {
                        return (
                          <img
                            src={post.image_url}
                            alt="Post"
                            className="w-full h-full object-cover"
                          />
                        );
                      }
                      return (
                        <div className="w-full h-full flex items-center justify-center bg-gray-100 p-2">
                          <p className="text-xs text-gray-600 line-clamp-3 text-center">
                            {post.content}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {isOwnProfile && (
            <TabsContent value="saved" className="mt-4">
              {savedPosts.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-2xl shadow-sm">
                  <Bookmark className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                  <p className="text-gray-500 dark:text-gray-400 font-medium">{t('profile.savedPosts')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-0.5 rounded-2xl overflow-hidden">
                  {savedPosts.map((post: any) => (
                    <div
                      key={post.id}
                      className="aspect-square bg-white rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                      onClick={() => {
                        const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                        const isVideo = post.media_type === 'video' || isVideoUrl(post.image_url);

                        if (isVideo) {
                          setSelectedPost(post);
                          setVideoFeedOpen(true);
                        }
                      }}
                    >
                      {(() => {
                        const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                        const videoSrc = post.video_url || (isVideoUrl(post.image_url) ? post.image_url : null);

                        if (post.media_type === 'video' || videoSrc) {
                          return (
                            <VideoThumbnail
                              videoUrl={videoSrc || post.image_url}
                              thumbnailUrl={post.thumbnail_url}
                              className="w-full h-full"
                              showPlayIcon={true}
                            />
                          );
                        }
                        if (post.image_url) {
                          return (
                            <img
                              src={post.image_url}
                              alt="Post"
                              className="w-full h-full object-cover"
                            />
                          );
                        }
                        return (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100 p-2">
                            <p className="text-xs text-gray-600 line-clamp-3 text-center">
                              {post.content}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* User Video Feed - SOLO VIDEO DI QUESTO UTENTE */}
      <UserVideoFeed
        open={videoFeedOpen}
        onOpenChange={setVideoFeedOpen}
        initialPost={selectedPost}
        userId={userId || currentUser?.id || ""}
        currentUserId={currentUser?.id || ""}
        onLikeToggle={handleLikeToggle}
      />

      {/* Likes Sheet */}
      <LikesSheet
        open={likesSheetOpen}
        onOpenChange={setLikesSheetOpen}
        postIds={posts.map(p => p.id)}
      />

      {/* Bottom Navigation - Compact Glovo Style (same as ClientDashboard) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-gray-100 shadow-2xl z-50">
        <div className="flex items-center justify-around h-16 px-2 max-w-md mx-auto">
          <button
            onClick={() => navigate("/client-dashboard?tab=social")}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl transition-all duration-300 text-gray-400 hover:text-cyan-600 hover:bg-cyan-50"
          >
            <Users className="w-5 h-5" />
            <span className="text-[9px] font-semibold">{t('navigation.social')}</span>
          </button>

          <button
            onClick={() => navigate("/client-dashboard?tab=partners")}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl transition-all duration-300 text-gray-400 hover:text-cyan-600 hover:bg-cyan-50"
          >
            <Tag className="w-5 h-5" />
            <span className="text-[9px] font-semibold">{t('navigation.discounts')}</span>
          </button>

          {/* Central Upload Button - Compact */}
          <button
            onClick={() => setUploadSheetOpen(true)}
            className="relative -mt-5 h-12 w-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-white shadow-lg shadow-cyan-300/50 flex items-center justify-center hover:shadow-xl hover:scale-105 transition-all duration-300"
          >
            <Plus className="w-6 h-6" />
          </button>

          <button
            onClick={() => setLikesSheetOpen(true)}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl transition-all duration-300 text-gray-400 relative hover:text-cyan-600 hover:bg-cyan-50"
          >
            <div className="relative">
              <Heart className="w-5 h-5" />
              <NotificationBadge count={unreadNotifications} />
            </div>
            <span className="text-[9px] font-semibold">{t('navigation.notifications')}</span>
          </button>

          <button
            onClick={() => navigate("/chats")}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl transition-all duration-300 relative text-gray-400 hover:text-cyan-600 hover:bg-cyan-50"
          >
            <div className="relative">
              <MessageCircle className="w-5 h-5" />
              <NotificationBadge count={totalUnread} />
            </div>
            <span className="text-[9px] font-semibold">{t('navigation.chat')}</span>
          </button>
        </div>
      </div>

      {/* Upload Sheet */}
      <UploadSheet
        open={uploadSheetOpen}
        onOpenChange={setUploadSheetOpen}
        userId={currentUser?.id || ""}
        onUploadComplete={() => {
          loadUserContent(userId || currentUser?.id || "");
        }}
      />

      {/* Edit Profile Sheet */}
      <EditProfileSheet
        open={editProfileOpen}
        onOpenChange={setEditProfileOpen}
        profile={profile}
        onSaved={() => loadProfile(currentUser?.id)}
      />

      {/* Settings Sheet */}
      <SettingsSheet
        open={settingsSheetOpen}
        onOpenChange={setSettingsSheetOpen}
      />

      {/* Badge Animation */}
      <BadgeAnimation badge={newBadge} onClose={() => setNewBadge(null)} />

      {/* Client Onboarding Tutorial - Only for own profile */}
      {isOwnProfileForOnboarding && userRole === "client" && isOnboardingActive && (
        <ClientOnboarding
          currentStep={currentStep}
          totalSteps={totalSteps}
          step={getCurrentStep()}
          progress={getProgress()}
          onNext={nextStep}
          onPrev={prevStep}
          onSkip={skipCurrentStep}
          onComplete={completeOnboarding}
          onNavigateTab={(tab) => {
            // Navigate back to dashboard with specified tab
            navigate(`/client-dashboard?tab=${tab}`);
          }}
          canProceed={canProceed()}
        />
      )}
    </div>
    </SwipeBackWrapper>
  );
};

export default UserProfile;
