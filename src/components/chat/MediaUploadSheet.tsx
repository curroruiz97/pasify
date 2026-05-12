import { useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ImageIcon, Video, File, Camera, Mic } from "lucide-react";
import { Camera as CapacitorCamera } from '@capacitor/camera';
import { CameraResultType, CameraSource } from '@capacitor/camera';
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface MediaUploadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMediaSelect: (file: File, type: 'image' | 'video' | 'file') => void;
  onCameraCapture: (imageUrl: string) => void;
  onVoiceRecord: () => void;
  uploading: boolean;
}

const MediaUploadSheet = ({
  open,
  onOpenChange,
  onMediaSelect,
  onCameraCapture,
  onVoiceRecord,
  uploading
}: MediaUploadSheetProps) => {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleCameraCapture = async () => {
    try {
      setLoading(true);
      const image = await CapacitorCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        // Fetch the image and convert to File
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        
        // Create a File object from blob
        const file = Object.assign(blob, {
          lastModified: Date.now(),
          name: `photo_${Date.now()}.jpg`
        }) as File;
        
        onMediaSelect(file, 'image');
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      if (error.message !== 'User cancelled photos app') {
        toast.error(t('chatMedia.errorCapture'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGallerySelect = async () => {
    try {
      setLoading(true);
      const image = await CapacitorCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        
        // Create a File object from blob
        const file = Object.assign(blob, {
          lastModified: Date.now(),
          name: `photo_${Date.now()}.jpg`
        }) as File;
        
        onMediaSelect(file, 'image');
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error('Gallery error:', error);
      if (error.message !== 'User cancelled photos app') {
        toast.error(t('chatMedia.errorSelect'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceRecord = () => {
    onOpenChange(false);
    onVoiceRecord();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-6">
        <DrawerHeader>
          <DrawerTitle>{t('chatMedia.attachContent')}</DrawerTitle>
        </DrawerHeader>
        <div className="grid grid-cols-3 gap-4 mt-6 pb-4">
          <button
            onClick={handleCameraCapture}
            disabled={loading || uploading}
            className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Camera className="w-7 h-7 text-blue-500" />
            </div>
            <span className="text-sm font-medium">{t('chatMedia.camera')}</span>
          </button>

          <button
            onClick={handleGallerySelect}
            disabled={loading || uploading}
            className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
              <ImageIcon className="w-7 h-7 text-green-500" />
            </div>
            <span className="text-sm font-medium">{t('chatMedia.gallery')}</span>
          </button>

          <label className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors cursor-pointer">
            <div className="w-14 h-14 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Video className="w-7 h-7 text-purple-500" />
            </div>
            <span className="text-sm font-medium">{t('chatMedia.video')}</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onMediaSelect(file, 'video');
                  onOpenChange(false);
                }
              }}
            />
          </label>

          <label className="flex flex-col items-center gap-2 p-4 rounded-lg hover:bg-muted transition-colors cursor-pointer">
            <div className="w-14 h-14 rounded-full bg-orange-500/10 flex items-center justify-center">
              <File className="w-7 h-7 text-orange-500" />
            </div>
            <span className="text-sm font-medium">{t('chatMedia.file')}</span>
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onMediaSelect(file, 'file');
                  onOpenChange(false);
                }
              }}
            />
          </label>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default MediaUploadSheet;
