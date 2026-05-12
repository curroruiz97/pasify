import { Image as ImageIcon } from "lucide-react";
import { usePartnerGallery } from "@/hooks/useGallery";
import OptimizedImage from "@/components/shared/OptimizedImage";

interface PartnerGalleryProps {
  partnerId: string;
}

const PartnerGallery = ({ partnerId }: PartnerGalleryProps) => {
  const { data: images = [], isLoading: loading } = usePartnerGallery(partnerId);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="aspect-square bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="ios-card p-8 text-center">
        <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Nessuna foto disponibile</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {images.map((image, index) => (
        <OptimizedImage
          key={image.id}
          src={image.image_url}
          alt={image.caption || "Gallery image"}
          className="aspect-square rounded-xl ios-card"
          size="thumbnail"
          eager={index < 4} // Prime 4 immagini caricate subito
        />
      ))}
    </div>
  );
};

export default PartnerGallery;
