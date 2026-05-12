import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getOptimizedImageUrl, ImageSizes } from "@/lib/imageUtils";

type ImageSize = 'thumbnail' | 'card' | 'medium' | 'large' | 'avatarSmall' | 'avatarMedium' | 'avatarLarge';

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  onClick?: () => void;
  eager?: boolean; // Carica subito senza lazy loading
  size?: ImageSize; // Dimensione preimpostata per ottimizzazione
}

/**
 * Componente immagine ottimizzato con:
 * - Lazy loading nativo del browser
 * - Placeholder durante il caricamento
 * - Fade-in animation
 * - Ridimensionamento automatico tramite Supabase
 * - Cache del browser
 */
const OptimizedImage = ({
  src,
  alt,
  className,
  placeholderClassName,
  onClick,
  eager = false,
  size = 'card',
}: OptimizedImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Ottieni URL ottimizzata
  const optimizedSrc = getOptimizedImageUrl(src, ImageSizes[size]);

  // Check se l'immagine è già in cache
  useEffect(() => {
    if (imgRef.current?.complete) {
      setIsLoaded(true);
    }
  }, [optimizedSrc]);

  // Reset state quando cambia src
  useEffect(() => {
    setIsLoaded(false);
    setError(false);
  }, [src]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setError(true);
    setIsLoaded(true);
  };

  if (error) {
    return (
      <div
        className={cn(
          "bg-muted flex items-center justify-center",
          className,
          placeholderClassName
        )}
      >
        <span className="text-muted-foreground text-sm">Immagine non disponibile</span>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)} onClick={onClick}>
      {/* Placeholder skeleton */}
      {!isLoaded && (
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 animate-pulse",
            placeholderClassName
          )}
        />
      )}

      {/* Immagine */}
      <img
        ref={imgRef}
        src={optimizedSrc}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
};

export default OptimizedImage;
