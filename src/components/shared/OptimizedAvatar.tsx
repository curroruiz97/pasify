import { useState, useEffect, memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getAvatarUrl } from "@/lib/imageUtils";

interface OptimizedAvatarProps {
  src?: string | null;
  fallback: string;
  size?: "small" | "medium" | "large";
  className?: string;
  fallbackClassName?: string;
  onClick?: () => void;
}

/**
 * Avatar ottimizzato con:
 * - Ridimensionamento Supabase server-side
 * - Lazy loading nativo
 * - Placeholder durante caricamento
 * - Cache browser
 * - Memo per evitare re-render
 */
const OptimizedAvatar = memo(({
  src,
  fallback,
  size = "medium",
  className,
  fallbackClassName,
  onClick,
}: OptimizedAvatarProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Ottimizza URL con Supabase transforms
  const optimizedSrc = src ? getAvatarUrl(src, size) : undefined;

  // Reset states quando cambia src
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [src]);

  // Size classes
  const sizeClasses = {
    small: "h-10 w-10",
    medium: "h-14 w-14",
    large: "h-24 w-24",
  };

  return (
    <Avatar
      className={cn(sizeClasses[size], className)}
      onClick={onClick}
    >
      {optimizedSrc && !hasError && (
        <AvatarImage
          src={optimizedSrc}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          className={cn(
            "transition-opacity duration-200",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
      <AvatarFallback
        className={cn(
          "bg-primary text-primary-foreground transition-opacity duration-200",
          fallbackClassName,
          isLoaded && !hasError ? "opacity-0" : "opacity-100"
        )}
      >
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
});

OptimizedAvatar.displayName = "OptimizedAvatar";

export default OptimizedAvatar;
