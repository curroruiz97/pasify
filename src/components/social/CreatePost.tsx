import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Send, X, Camera, Video, Image as ImageIcon, Play, BarChart3 } from "lucide-react";
import CreatePoll from "./CreatePoll";
import { useToast } from "@/hooks/use-toast";
import ImageUpload from "@/components/shared/ImageUpload";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface CreatePostProps {
  userId: string;
  userProfile: any;
  onPostCreated: () => void;
  city?: string;
  country?: string;
}

const CreatePost = ({ userId, userProfile, onPostCreated, city, country }: CreatePostProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMediaUpload, setShowMediaUpload] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim() && !mediaUrl) {
      toast({
        title: t('common.error'),
        description: t('errors.fillAllFields'),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Call moderation AI before publishing
      const { data: moderationData, error: moderationError } = await supabase.functions.invoke(
        'moderate-content',
        {
          body: {
            content: content.trim(),
            mediaUrl: mediaUrl || undefined,
            contentType: 'post'
          }
        }
      );

      // Handle function invocation errors
      if (moderationError) {
        console.error('Moderation function error:', moderationError);
        toast({
          title: "Error de moderación",
          description: "No se pudo verificar el contenido. Inténtalo de nuevo.",
          variant: "destructive",
        });
        return;
      }

      // Check if moderation returned an error in the response body (rate limits, etc.)
      if (moderationData?.error) {
        console.error('Moderation API error:', moderationData.error);
        toast({
          title: "Servicio temporalmente no disponible",
          description: moderationData.error === 'Rate limit exceeded. Please try again later.' 
            ? "Demasiadas solicitudes. Por favor, espera un momento."
            : "Error al verificar el contenido. Inténtalo más tarde.",
          variant: "destructive",
        });
        return;
      }

      const moderation = moderationData || { approved: true, score: 0 };

      const { error } = await supabase
        .from("posts")
        .insert({
          user_id: userId,
          content: content.trim(),
          image_url: mediaType === 'image' ? mediaUrl : null,
          video_url: mediaType === 'video' ? mediaUrl : null,
          thumbnail_url: mediaType === 'video' ? thumbnailUrl : null,
          media_type: mediaType,
          status: moderation.approved ? 'approved' : 'pending',
          moderation_score: moderation.score || 0,
          moderation_category: moderation.category,
          moderation_reason: moderation.reason,
          auto_moderated: !moderation.approved,
          // Partner: usa sempre la sua business_city
          // Cliente: usa la città selezionata nel filtro
          city: (userProfile?.business_city || city || 'Valladolid').trim(),
          country: userProfile?.business_country || country || localStorage.getItem("selectedCountry") || 'ES',
        });

      if (error) throw error;

      if (moderation.approved) {
        toast({
          title: "¡Post publicado!",
          description: "Tu post ha sido compartido con éxito",
        });
      } else {
        toast({
          title: "Post en revisión",
          description: "Tu post está siendo revisado por nuestro equipo de moderación",
          variant: "default",
        });
      }

      setContent("");
      setMediaUrl(null);
      setMediaType(null);
      setShowMediaUpload(false);
      setSheetOpen(false);
      onPostCreated();
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

  const handleMediaUploaded = (url: string, type?: 'image' | 'video', thumbUrl?: string) => {
    setMediaUrl(url);
    setThumbnailUrl(thumbUrl || null);
    // Infer mediaType if not provided
    let inferredType = type;
    if (!inferredType && url) {
      const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov']; // Added .mov
      const fileExtension = url.substring(url.lastIndexOf('.')).toLowerCase();
      if (videoExtensions.some(ext => fileExtension.includes(ext))) {
        inferredType = 'video';
      } else {
        inferredType = 'image';
      }
    }
    setMediaType(inferredType || 'image'); // Fallback to 'image' if still undetermined
    setShowMediaUpload(false);
  };

  const removeMedia = () => {
    setMediaUrl(null);
    setMediaType(null);
    setThumbnailUrl(null);
  };

  const getDisplayName = () => {
    if (userProfile?.first_name) {
      return `${userProfile.first_name} ${userProfile.last_name || ""}`.trim();
    }
    return userProfile?.business_name || "Usuario";
  };

  return (
    <>
      {/* Vista compatta iniziale, stile iOS moderno */}
      <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-4">
        {/* Header compatto */}
        <div className="flex items-center gap-3 mb-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={userProfile?.profile_image_url} />
            <AvatarFallback className="bg-blue-500 text-white font-semibold">
              {getDisplayName()[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <button
            onClick={() => setSheetOpen(true)}
            className="flex-1 text-left px-4 py-3 bg-blue-50 rounded-full text-blue-600 hover:bg-blue-100 transition-all duration-200 font-medium placeholder:text-blue-400"
          >
            ¿Qué estás pensando?
          </button>
        </div>

        {/* Pulsanti azioni moderni e compatti */}
        <div className="flex items-center gap-2"> {/* Ridotto il gap per maggiore compattezza */}
          <button
            onClick={() => {
              setShowMediaUpload(true);
              setSheetOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-all duration-200 shadow-sm text-sm font-medium" // Rounded-full, testo più piccolo, padding leggermente ridotto
          >
            <Camera className="w-4 h-4" /> {/* Icona leggermente più piccola */}
            <span>Foto</span>
          </button>

          <button
            onClick={() => {
              setShowMediaUpload(true);
              setSheetOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-all duration-200 text-sm font-medium" // Rounded-full, testo più piccolo, padding leggermente ridotto
          >
            <Video className="w-4 h-4" /> {/* Icona leggermente più piccola */}
            <span>Video</span>
          </button>

          <button
            onClick={() => {
              setShowMediaUpload(true);
              setSheetOpen(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-all duration-200 text-sm font-medium"
          >
            <ImageIcon className="w-4 h-4" />
            <span>Galleria</span>
          </button>

          <button
            onClick={() => setPollOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-full bg-gradient-to-r from-blue-500 to-sky-500 text-white hover:from-blue-600 hover:to-sky-600 transition-all duration-200 shadow-sm text-sm font-medium"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Encuesta</span>
          </button>
        </div>
      </div>

      <CreatePoll
        userId={userId}
        userProfile={userProfile}
        onPollCreated={onPostCreated}
        open={pollOpen}
        onOpenChange={setPollOpen}
        city={city}
      />

      {/* Bottom Sheet moderno stile iOS */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="h-[80vh] bg-white p-6">
          <DrawerHeader className="pb-4">
            <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
            <DrawerTitle className="text-center text-xl font-bold text-gray-900">
              Crea un nuovo post
            </DrawerTitle>
          </DrawerHeader>

          <form onSubmit={handleSubmit} className="h-full flex flex-col">
            {/* Header con avatar */}
            <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
              <Avatar className="h-12 w-12">
                <AvatarImage src={userProfile?.profile_image_url} />
                <AvatarFallback className="bg-blue-500 text-white font-semibold">
                  {getDisplayName()[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-gray-900">{getDisplayName()}</p>
                <p className="text-sm text-gray-500">Pubblico</p>
              </div>
            </div>

            {/* Textarea */}
            <div className="flex-1 py-4">
              <Textarea
                placeholder="¿Qué estás pensando?"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[120px] resize-none border-none bg-transparent text-lg placeholder:text-gray-400 focus-visible:ring-0 p-0"
                disabled={loading}
              />

              {/* Publish button - Moved higher up */}
              <Button
                type="submit"
                className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-full py-3 font-semibold text-lg shadow-md flex items-center justify-center gap-2 mt-4" // Added mt-4 for spacing
                disabled={loading || (!content.trim() && !mediaUrl)}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Publicando...
                  </div>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    <span>Publicar</span>
                  </>
                )}
              </Button>

              {/* Media Preview */}
              {mediaUrl && (
                <div className="relative mt-4">
                  {mediaType === 'image' ? (
                    <img src={mediaUrl} alt="Preview" className="w-full h-48 object-cover rounded-xl" />
                  ) : (
                    <div className="relative w-full h-48 rounded-xl overflow-hidden"> {/* Wrapper for video and play icon */}
                      <video
                        src={mediaUrl}
                        className="w-full h-full object-cover"
                        controls
                        preload="metadata"
                        onLoadedData={(e) => {
                          // Genera thumbnail automaticamente al secondo 1
                          const video = e.currentTarget;
                          video.currentTime = 1;
                        }}
                      />
                      {/* Play icon overlay */}
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
                        <div className="bg-white/90 rounded-full p-2">
                          <Play className="w-5 h-5 text-blue-500" />
                        </div>
                      </div>
                    </div>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="absolute top-3 right-3 rounded-full h-8 w-8 bg-black/50 hover:bg-black/70 text-white"
                    onClick={removeMedia}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}

              {/* Media Upload */}
              {showMediaUpload && !mediaUrl && (
                <div className="mt-4">
                  <ImageUpload
                    bucket="posts"
                    userId={userId}
                    onImageUploaded={handleMediaUploaded}
                    accept="image/*,video/*"
                    maxSizeMB={50}
                    showPreview={false}
                  />
                </div>
              )}
            </div>

            {/* Bottom Actions - Fotocamera and Galleria buttons */}
            <div className="border-t border-gray-100 pt-4"> {/* Rimosso pb-6 */}
              <div className="flex items-center gap-4 mb-4">
                {/* Fotocamera Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="gap-2 text-blue-600 hover:bg-blue-50 rounded-full px-6 py-3 font-medium"
                  onClick={() => setShowMediaUpload(!showMediaUpload)}
                  disabled={loading || !!mediaUrl}
                >
                  <Camera className="w-5 h-5" />
                  Fotocamera
                </Button>

                {/* Galleria Button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="gap-2 text-blue-600 hover:bg-blue-50 rounded-full px-6 py-3 font-medium"
                  onClick={() => setShowMediaUpload(!showMediaUpload)}
                  disabled={loading || !!mediaUrl}
                >
                  <ImageIcon className="w-5 h-5" />
                  Galleria
                </Button>
              </div>
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default CreatePost;
