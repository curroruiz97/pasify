import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Camera, Image, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { compressAvatar, compressPostImage } from "@/lib/imageUtils";

interface ImageUploadProps {
  bucket: "avatars" | "stories" | "posts" | "gallery";
  userId: string;
  onImageUploaded: (url: string, type?: 'image' | 'video', thumbnailUrl?: string) => void;
  accept?: string;
  maxSizeMB?: number;
  showPreview?: boolean;
}

// Helper function to generate video thumbnail
const generateVideoThumbnail = (file: File): Promise<Blob | null> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const objectUrl = URL.createObjectURL(file);
    let resolved = false;
    let attempts = 0;
    const maxAttempts = 3;

    const tryCapture = () => {
      if (resolved) return;
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 568;
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Detect black frame by sampling center pixels
        const imageData = ctx.getImageData(
          Math.floor(canvas.width * 0.25), Math.floor(canvas.height * 0.25),
          Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.5)
        );
        const pixels = imageData.data;
        let nonBlack = 0;
        for (let i = 0; i < pixels.length; i += 160) {
          if (pixels[i] > 15 || pixels[i + 1] > 15 || pixels[i + 2] > 15) nonBlack++;
        }
        const total = Math.floor(pixels.length / 160);
        const isValidFrame = total > 0 && (nonBlack / total) > 0.05;

        if (isValidFrame) {
          resolved = true;
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(objectUrl);
            resolve(blob);
          }, 'image/jpeg', 0.8);
          return;
        }
      }

      attempts++;
      if (attempts >= maxAttempts) {
        // Even a black thumbnail is better than none — save the last attempt
        resolved = true;
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);
          resolve(blob);
        }, 'image/jpeg', 0.8);
      } else {
        video.currentTime = attempts * 1.5;
      }
    };

    video.onloadedmetadata = () => {
      // Seek to 1s or 10% of duration
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = tryCapture;

    video.onerror = () => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    };

    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    }, 8000);

    video.src = objectUrl;
  });
};

const ImageUpload = ({ 
  bucket, 
  userId, 
  onImageUploaded, 
  accept = "image/*,video/*",
  maxSizeMB = 10,
  showPreview = true
}: ImageUploadProps) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'image' | 'video' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    // Check file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast({
        title: "File troppo grande",
        description: `Il file deve essere inferiore a ${maxSizeMB}MB`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      const fileType = file.type.startsWith('video/') ? 'video' : 'image';
      const timestamp = Date.now();

      // Comprimi immagine se necessario
      let fileToUpload: File | Blob = file;
      let finalExt = file.name.split('.').pop();

      if (fileType === 'image') {
        try {
          if (bucket === 'avatars') {
            // Avatar: comprimi a 200x200px
            fileToUpload = await compressAvatar(file);
            finalExt = 'jpg';
          } else {
            // Post/Gallery: comprimi a 1200x1200px
            fileToUpload = await compressPostImage(file);
            finalExt = 'jpg';
          }
          console.log(`Image compressed: ${file.size} -> ${fileToUpload.size} bytes`);
        } catch (compressError) {
          console.warn('Compression failed, using original:', compressError);
          // Usa file originale se compressione fallisce
        }
      }

      // Create unique file name
      const fileName = `${userId}/${timestamp}.${finalExt}`;

      // Upload main file to storage
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(fileName, fileToUpload, {
          cacheControl: '31536000', // 1 anno di cache
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      let thumbnailUrl: string | undefined;

      // Generate and upload thumbnail for videos
      if (fileType === 'video') {
        try {
          const thumbnailBlob = await generateVideoThumbnail(file);
          if (thumbnailBlob) {
            const thumbnailFileName = `${userId}/${timestamp}_thumb.jpg`;
            const { data: thumbData, error: thumbError } = await supabase.storage
              .from(bucket)
              .upload(thumbnailFileName, thumbnailBlob, {
                cacheControl: '3600',
                upsert: false,
                contentType: 'image/jpeg'
              });

            if (!thumbError && thumbData) {
              const { data: { publicUrl: thumbPublicUrl } } = supabase.storage
                .from(bucket)
                .getPublicUrl(thumbData.path);
              thumbnailUrl = thumbPublicUrl;
              console.log('Thumbnail uploaded:', thumbnailUrl);
            }
          }
        } catch (thumbErr) {
          console.log('Could not generate thumbnail:', thumbErr);
          // Continue without thumbnail
        }
      }

      toast({
        title: "Upload completato!",
        description: fileType === 'video' ? "Video caricato con successo" : "Immagine caricata con successo",
      });

      onImageUploaded(publicUrl, fileType, thumbnailUrl);

      if (showPreview) {
        setPreview(publicUrl);
        setPreviewType(fileType);
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Errore upload",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const clearPreview = () => {
    setPreview(null);
    setPreviewType(null);
  };

  return (
    <div className="space-y-3">
      {showPreview && preview && (
        <div className="relative">
          {previewType === 'video' ? (
            <video 
              src={preview} 
              className="w-full h-48 object-cover rounded-lg"
              controls
              preload="metadata"
            />
          ) : (
            <img 
              src={preview} 
              alt="Preview" 
              className="w-full h-48 object-cover rounded-lg"
            />
          )}
          <Button
            size="icon"
            variant="destructive"
            className="absolute top-2 right-2"
            onClick={clearPreview}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}
      
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Caricamento...
            </>
          ) : (
            <>
              <Image className="w-4 h-4" />
              Galleria
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="flex-1 gap-2"
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="w-4 h-4" />
          Fotocamera
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />

      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
};

export default ImageUpload;
