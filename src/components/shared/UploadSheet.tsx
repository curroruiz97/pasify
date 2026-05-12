import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Image, Video, CheckCircle2, Camera, FileText, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CreatePoll from "@/components/social/CreatePoll";

interface UploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onUploadComplete?: () => void;
  // New props for camera/back button control, if needed by the parent component
  enableCamera?: boolean;
  hideBackButton?: boolean;
  uploadType?: "post" | "story"; // Added to allow pre-setting upload type
}

const UploadSheet = ({ open, onOpenChange, userId, onUploadComplete, uploadType: initialUploadType, enableCamera, hideBackButton }: UploadSheetProps) => {
  const { toast } = useToast();
 const [uploadType, setUploadType] = useState<"post" | "story" | null>(initialUploadType || null);
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [success, setSuccess] = useState(false);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  const [pollOpen, setPollOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("profiles")
      .select("id, first_name, last_name, business_name, profile_image_url, business_city")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => setUserProfile(data));
  }, [userId]);

  // Effect to update uploadType if initialUploadType changes
  useEffect(() => {
    if (initialUploadType !== undefined) {
      setUploadType(initialUploadType);
    }
  }, [initialUploadType]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !uploadType) return;

    const isVideo = file.type.startsWith("video/");

    // Supabase Free plan: 50MB max
    if (file.size > 50 * 1024 * 1024) {
      const fileMB = (file.size / (1024 * 1024)).toFixed(0);
      toast({
        title: "Archivo demasiado grande",
        description: `El video pesa ${fileMB}MB. El máximo permitido es 50MB. Intenta grabar en menor calidad o recortar el video.`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setSuccess(false);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // Upload to Supabase Storage
      const bucket = uploadType === "story" ? "stories" : "posts";
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Call moderation AI before publishing
      const { data: moderationData, error: moderationError } = await supabase.functions.invoke(
        'moderate-content',
        {
          body: {
            content: content || '',
            mediaUrl: publicUrl,
            contentType: uploadType === 'story' ? 'story' : 'post'
          }
        }
      );

      // Handle moderation errors
      if (moderationError || moderationData?.error) {
        console.error('Moderation error:', moderationError || moderationData?.error);
        // Continue with pending status if moderation fails
      }

      const moderation = moderationData || { approved: true, score: 0 };

      // Create post or story con media_type corretto e moderazione
      if (uploadType === "story") {
        const { error: storyError } = await supabase
          .from("stories")
          .insert({
            user_id: userId,
            image_url: isVideo ? null : publicUrl,
            video_url: isVideo ? publicUrl : null,
            media_type: isVideo ? 'video' : 'image',
            status: moderation.approved ? 'approved' : 'pending',
            moderation_score: moderation.score || 0,
            moderation_category: moderation.category,
            moderation_reason: moderation.reason,
            auto_moderated: !moderation.approved,
          });

        if (storyError) throw storyError;
      } else {
        const { error: postError } = await supabase
          .from("posts")
          .insert({
            user_id: userId,
            content: content || null,
            image_url: isVideo ? null : publicUrl,
            video_url: isVideo ? publicUrl : null,
            media_type: isVideo ? 'video' : 'image',
            status: moderation.approved ? 'approved' : 'pending',
            moderation_score: moderation.score || 0,
            moderation_category: moderation.category,
            moderation_reason: moderation.reason,
            auto_moderated: !moderation.approved,
          });

        if (postError) throw postError;
      }

      // Show success
      setSuccess(true);
      setTimeout(() => {
        onUploadComplete?.();
        handleClose();
      }, 1500);

      toast({
        title: "Successo! ✨",
        description: `${uploadType === "story" ? "Storia" : "Post"} cargado con éxito`,
      });
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
      setUploading(false);
      setUploadProgress(0);
    }
  };

 const handleClose = () => {
 setUploadType(initialUploadType || null); // Reset alla selezione (Storia/Post/Encuesta)
 setContent("");
 setUploading(false);
 setUploadProgress(0);
 setSuccess(false);
 onOpenChange(false);
 };

  return (
    <>
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent
        className={`bg-white p-0 shadow-2xl ${
          isDesktop
            ? uploadType ? 'h-[350px] max-w-2xl mx-auto' : 'h-[280px] max-w-lg mx-auto'
            : uploadType ? 'h-[45vh]' : 'h-[280px]'
        }`}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>

        {/* Header - SENZA X */}
        <div className="text-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {uploadType ? (uploadType === "story" ? "Nuova Storia" : "Nuevo Post") : "Cosa vuoi condividere?"}
          </h2>
        </div>

        <div className="px-6 py-4">
          {!uploadType ? (
            // Selection screen - STORIA, POST, ENCUESTA
            <div className="grid grid-cols-3 gap-3">
              {/* Storia */}
              <Button
                variant="ghost"
                onClick={() => setUploadType("story")}
                className="h-auto p-4 flex flex-col items-center gap-3 hover:bg-gray-50 transition-all duration-200 rounded-2xl group border border-gray-200"
              >
                <div className="bg-gradient-to-br from-pink-500 to-purple-600 p-3 rounded-2xl shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <Camera className="h-7 w-7 text-white" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm text-gray-900">Storia</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Un momento</p>
                </div>
              </Button>

              {/* Post */}
              <Button
                variant="ghost"
                onClick={() => setUploadType("post")}
                className="h-auto p-4 flex flex-col items-center gap-3 hover:bg-gray-50 transition-all duration-200 rounded-2xl group border border-gray-200"
              >
                <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-3 rounded-2xl shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <FileText className="h-7 w-7 text-white" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm text-gray-900">Post</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Scrivi</p>
                </div>
              </Button>

              {/* Encuesta */}
              <Button
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(() => setPollOpen(true), 100);
                }}
                className="h-auto p-4 flex flex-col items-center gap-3 hover:bg-gray-50 transition-all duration-200 rounded-2xl group border border-gray-200"
              >
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-3 rounded-2xl shadow-lg group-hover:scale-105 transition-transform duration-200">
                  <BarChart3 className="h-7 w-7 text-white" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-sm text-gray-900">Encuesta</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Sondaggio</p>
                </div>
              </Button>
            </div>
          ) : success ? (
            // Success screen
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <CheckCircle2 className="w-24 h-24 text-green-500 animate-pulse" />
              <h3 className="text-2xl font-bold text-green-500">Pubblicato!</h3>
              <p className="text-gray-600 text-center">
                Il tuo {uploadType === "story" ? "storia" : "post"} ha sido cargado con éxito
              </p>
            </div>
          ) : uploading ? (
            // Upload progress screen
            <div className="space-y-6 py-8">
              <div className="flex items-center justify-center">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full border-8 border-blue-100 flex items-center justify-center">
                    <span className="text-3xl font-bold text-blue-600">{uploadProgress}%</span>
                  </div>
                </div>
              </div>
              <Progress value={uploadProgress} className="h-3" />
              <p className="text-center text-gray-600">
                Cargando...
              </p>
            </div>
          ) : (
            // Upload form with Camera and Gallery buttons
            <div className="space-y-3">
              {uploadType === "post" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Descripción</label>
                  <Textarea
                    placeholder="Escribe algo..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="min-h-[80px] resize-none rounded-2xl border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Selecciona del dispositivo</label>
                <div className="grid grid-cols-2 gap-3"> {/* Use grid for two buttons */}
                  {/* Camera Button */}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    capture="user" // Suggest opening front camera
                    onChange={handleFileSelect}
                    className="hidden"
                    id="camera-upload"
                  />
                  <label htmlFor="camera-upload">
                    <Button
                      type="button"
                      className="w-full h-14 flex-col gap-2 bg-blue-500 text-white border-0 rounded-2xl hover:bg-blue-600 transition-all duration-200"
                      asChild
                    >
                      <div className="cursor-pointer flex flex-col items-center justify-center gap-2">
                        <Camera className="w-6 h-6" />
                        <span className="text-sm font-medium">"Cámara</span>
                      </div>
                    </Button>
                  </label>

                  {/* Gallery Button */}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="gallery-upload"
                  />
                  <label htmlFor="gallery-upload">
                    <Button
                      type="button"
                      className="w-full h-14 flex-col gap-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-2xl hover:bg-blue-100 transition-all duration-200"
                      asChild
                    >
                      <div className="cursor-pointer flex flex-col items-center justify-center gap-2">
                        <Image className="w-6 h-6" />
                        <span className="text-sm font-medium">Galería</span>
                      </div>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Removed the "Indietro" button as requested */}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>

    <CreatePoll
      userId={userId}
      userProfile={userProfile}
      open={pollOpen}
      onOpenChange={setPollOpen}
      city={userProfile?.business_city || undefined}
      onPollCreated={() => {
        if (onUploadComplete) onUploadComplete();
      }}
    />
    </>
  );
};

export default UploadSheet;