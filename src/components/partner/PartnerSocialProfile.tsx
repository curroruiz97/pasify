import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Camera, Pencil, Edit2, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import UploadSheet from "@/components/shared/UploadSheet";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { compressAvatar, compressPostImage } from "@/lib/imageUtils";

interface PartnerSocialProfileProps {
  profile: any;
  userId: string;
  onUpdate: () => void;
  onSwitchToBusiness: () => void;
}

const PartnerSocialProfile = ({ profile, userId, onUpdate, onSwitchToBusiness }: PartnerSocialProfileProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [posts, setPosts] = useState<any[]>([]);
  const [savedPosts, setSavedPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"posts" | "saved">("posts");
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [postDetailOpen, setPostDetailOpen] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [totalLikes, setTotalLikes] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioText, setBioText] = useState("");
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCoverImage(profile?.cover_image_url || null);
    setBioText(profile?.business_description || "");
    loadUserContent();
  }, [userId]);

  const handleBioSave = async () => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ business_description: bioText.trim() })
        .eq('id', userId);

      if (error) throw error;

      setIsEditingBio(false);
      onUpdate();
      toast({ title: t('success.profileUpdated') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: "destructive" });
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Comprimi cover
      const compressedFile = await compressPostImage(file);
      const filePath = `${userId}/cover-${Date.now()}.jpg`;

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
        .eq('id', userId);

      if (updateError) throw updateError;

      setCoverImage(publicUrl);
      onUpdate();
      toast({ title: t('success.profileUpdated') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: "destructive" });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Comprimi avatar
      const compressedFile = await compressAvatar(file);
      const filePath = `${userId}/avatar-${Date.now()}.jpg`;

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
        .eq('id', userId);

      if (updateError) throw updateError;

      onUpdate();
      toast({ title: t('success.profileUpdated') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: "destructive" });
    }
  };

  const loadUserContent = async () => {
    setLoading(true);

    // Load posts
    const { data: postsData } = await supabase
      .from("posts")
      .select(`
        *,
        likes(id, user_id),
        profiles!posts_user_id_fkey(first_name, last_name, profile_image_url, business_name)
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    setPosts(postsData || []);

    // Count total likes on user's posts
    if (postsData) {
      const likes = postsData.reduce((acc, post) => acc + (post.likes?.length || 0), 0);
      setTotalLikes(likes);
    }

    // Count total views on user's posts
    if (postsData && postsData.length > 0) {
      const postIds = postsData.map(post => post.id);
      const { count: viewsTotal } = await supabase
        .from("post_views")
        .select("*", { count: "exact", head: true })
        .in("post_id", postIds);
      setTotalViews(viewsTotal || 0);
    }

    // Load saved posts
    const { data: savedPostsData } = await supabase
      .from("saved_posts")
      .select(`
        post_id,
        posts(
          *,
          likes(id, user_id),
          profiles!posts_user_id_fkey(first_name, last_name, profile_image_url, business_name)
        )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    setSavedPosts(savedPostsData?.map(sp => sp.posts).filter(Boolean) || []);

    setLoading(false);
  };

  const getDisplayName = () => {
    if (profile?.first_name) {
      return `${profile.first_name} ${profile.last_name || ""}`.trim();
    }
    return profile?.business_name || "Utente";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Floating Add Button */}
      <button
        onClick={() => setUploadSheetOpen(true)}
        className="fixed bottom-28 right-6 z-50 bg-gradient-to-br from-primary to-primary/80 rounded-full p-4 shadow-lg hover:scale-105 transition-transform"
      >
        <Plus className="w-6 h-6 text-white" />
      </button>

      {/* Profile Header */}
      <div className="relative">
        {/* Cover Image */}
        <div 
          className="h-32 bg-gradient-to-br from-primary to-primary/60 relative group cursor-pointer"
          style={coverImage ? { backgroundImage: `url(${coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
          onClick={() => coverInputRef.current?.click()}
        >
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera className="w-8 h-8 text-white" />
          </div>
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUpload}
        />
        
        {/* Avatar and Info */}
        <div className="px-4 -mt-12 text-center">
          <div className="relative inline-block mb-3">
            <Avatar className="h-28 w-28 border-4 border-background">
              <AvatarImage src={profile?.profile_image_url} />
              <AvatarFallback className="bg-primary text-primary-foreground text-3xl">
                {getDisplayName()[0]}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2.5 rounded-full hover:bg-primary/90 transition-colors shadow-lg"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />

          <h2 className="text-2xl font-bold mb-1">{getDisplayName()}</h2>
          
          {profile?.university && (
            <p className="text-sm text-muted-foreground mb-2">{profile.university}</p>
          )}

          {/* Bio */}
          <div className="max-w-sm mx-auto mb-3 px-4">
            {isEditingBio ? (
              <div className="space-y-2">
                <Textarea
                  value={bioText}
                  onChange={(e) => setBioText(e.target.value)}
                  placeholder={t('profile.bio')}
                  className="resize-none text-sm"
                  rows={3}
                  maxLength={150}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleBioSave}>{t('profile.saveBio')}</Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setIsEditingBio(false);
                    setBioText(profile?.business_description || "");
                  }}>{t('profile.cancel')}</Button>
                </div>
              </div>
            ) : (
              <div className="relative group">
                {profile?.business_description ? (
                  <p className="text-sm text-foreground/80 leading-relaxed">{profile.business_description}</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">{t('profile.editBio')}</p>
                )}
                <button
                  onClick={() => setIsEditingBio(true)}
                  className="absolute -right-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Edit2 className="w-4 h-4 text-muted-foreground hover:text-primary" />
                </button>
              </div>
            )}
          </div>

          {/* Switch to Business Profile Button */}
          <div className="px-4 mb-4 flex justify-center">
            <Button
              onClick={onSwitchToBusiness}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Edit2 className="w-4 h-4" />
              {t('profile.businessProfile')}
            </Button>
          </div>

          {/* Stats */}
          <div className="flex justify-center gap-8 py-4 border-y border-border/50 mb-4">
            <div className="text-center">
              <p className="text-xl font-bold">{posts.length}</p>
              <p className="text-xs text-muted-foreground">{t('profile.posts')}</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold">{totalLikes}</p>
              <p className="text-xs text-muted-foreground">{t('profile.likes')}</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold">{totalViews}</p>
              <p className="text-xs text-muted-foreground">{t('profile.views')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content Tabs */}
      <div className="mt-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="px-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="posts" className="gap-2">
              {t('profile.posts')}
            </TabsTrigger>
            <TabsTrigger value="saved" className="gap-2">
              {t('profile.savedPosts')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4">
            {posts.length === 0 ? (
              <div className="text-center py-12 ios-card">
                <p className="text-muted-foreground">{t('post.noPosts')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="aspect-square bg-card rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                    onClick={() => {
                      // disabled for now
                    }}
                  >
                    {(() => {
                      const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                      if (post.media_type === 'video' && (post.video_url || post.image_url)) {
                        const videoSrc = post.video_url || post.image_url;
                        return (
                          <>
                            <video
                              src={videoSrc}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              poster=""
                              onLoadedMetadata={(e) => {
                                const video = e.currentTarget;
                                video.currentTime = 0.1;
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-background/80 rounded-full p-3 backdrop-blur-sm">
                                <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            </div>
                          </>
                        );
                      }
                      if (post.image_url) {
                        if (isVideoUrl(post.image_url)) {
                          return (
                            <>
                              <video
                                src={post.image_url}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                                poster=""
                                onLoadedMetadata={(e) => {
                                  const video = e.currentTarget;
                                  video.currentTime = 0.1;
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="bg-background/80 rounded-full p-3 backdrop-blur-sm">
                                  <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                            </>
                          );
                        }
                        return (
                          <img
                            src={post.image_url}
                            alt="Post"
                            className="w-full h-full object-cover"
                          />
                        );
                      }
                      return (
                        <div className="w-full h-full flex items-center justify-center bg-muted p-2">
                          <p className="text-xs text-muted-foreground line-clamp-3 text-center">
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

          <TabsContent value="saved" className="mt-4">
            {savedPosts.length === 0 ? (
              <div className="text-center py-12 ios-card">
                <p className="text-muted-foreground">{t('post.noPosts')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {savedPosts.map((post: any) => (
                  <div
                    key={post.id}
                    className="aspect-square bg-card rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative group"
                    onClick={() => {
                      // disabled for now
                    }}
                  >
                    {(() => {
                      const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
                      if (post.media_type === 'video' && (post.video_url || post.image_url)) {
                        const videoSrc = post.video_url || post.image_url;
                        return (
                          <>
                            <video
                              src={videoSrc}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              poster=""
                              onLoadedMetadata={(e) => {
                                const video = e.currentTarget;
                                video.currentTime = 0.1;
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="bg-background/80 rounded-full p-3 backdrop-blur-sm">
                                <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            </div>
                          </>
                        );
                      }
                      if (post.image_url) {
                        if (isVideoUrl(post.image_url)) {
                          return (
                            <>
                              <video
                                src={post.image_url}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                                poster=""
                                onLoadedMetadata={(e) => {
                                  const video = e.currentTarget;
                                  video.currentTime = 0.1;
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="bg-background/80 rounded-full p-3 backdrop-blur-sm">
                                  <svg className="w-6 h-6 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                              </div>
                              </div>
                            </>
                          );
                        }
                        return (
                          <img
                            src={post.image_url}
                            alt="Post"
                            className="w-full h-full object-cover"
                          />
                        );
                      }
                      return (
                        <div className="w-full h-full flex items-center justify-center bg-muted p-2">
                          <p className="text-xs text-muted-foreground line-clamp-3 text-center">
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
        </Tabs>
      </div>


      {/* Upload Sheet */}
      <UploadSheet
        open={uploadSheetOpen}
        onOpenChange={setUploadSheetOpen}
        userId={userId}
        onUploadComplete={loadUserContent}
      />
    </div>
  );
};

export default PartnerSocialProfile;
