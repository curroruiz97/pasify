import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera, Image as ImageIcon, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImageUploaderProps {
  bucket: string;
  userId: string;
  onUploadComplete: (url: string) => void;
  acceptVideo?: boolean;
  maxSizeMB?: number;
}

const ImageUploader = ({ 
  bucket, 
  userId, 
  onUploadComplete, 
  acceptVideo = false,
  maxSizeMB = 10 
}: ImageUploaderProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      toast({
        title: "File troppo grande",
        description: `Il file deve essere massimo ${maxSizeMB}MB`,
        variant: "destructive",
      });
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    setUploading(true);

    try {
      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError, data } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      onUploadComplete(publicUrl);
      
      toast({
        title: "Upload completato!",
        description: "L'immagine è stata caricata con successo",
      });
    } catch (error: any) {
      toast({
        title: "Errore durante l'upload",
        description: error.message,
        variant: "destructive",
      });
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleGalleryClick = () => {
    fileInputRef.current?.click();
  };

  const handleCameraClick = () => {
    cameraInputRef.current?.click();
  };

  const handleRemovePreview = () => {
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const accept = acceptVideo 
    ? "image/*,video/*" 
    : "image/*";

  return (
    <div className="space-y-3">
      {preview && (
        <div className="relative">
          <img 
            src={preview} 
            alt="Preview" 
            className="w-full rounded-lg max-h-64 object-cover"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleRemovePreview}
            disabled={uploading}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
          className="hidden"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={accept}
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
          }}
          className="hidden"
        />
        
        <Button
          type="button"
          variant="outline"
          onClick={handleGalleryClick}
          disabled={uploading}
          className="flex-1 gap-2"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          Galleria
        </Button>
        
        <Button
          type="button"
          variant="outline"
          onClick={handleCameraClick}
          disabled={uploading}
          className="flex-1 gap-2"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          Fotocamera
        </Button>
      </div>
    </div>
  );
};

export default ImageUploader;
