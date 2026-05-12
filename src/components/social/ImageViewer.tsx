import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
}

const ImageViewer = ({ open, onOpenChange, imageUrl }: ImageViewerProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black border-0">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4 z-50 text-white hover:bg-white/20 rounded-full"
          onClick={() => onOpenChange(false)}
        >
          <X className="w-6 h-6" />
        </Button>
        <div className="flex items-center justify-center w-full h-full">
          <img
            src={imageUrl}
            alt="Immagine a schermo intero"
            className="max-w-full max-h-[95vh] object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImageViewer;
