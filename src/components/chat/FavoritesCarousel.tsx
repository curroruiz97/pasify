import { Star } from "lucide-react";
import OptimizedAvatar from "@/components/shared/OptimizedAvatar";

interface Favorite {
  id: string;
  profile_image_url?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
}

interface FavoritesCarouselProps {
  favorites: Favorite[];
  onFavoriteClick: (userId: string) => void;
  onRemoveFavorite: (userId: string) => void;
}

const FavoritesCarousel = ({ favorites, onFavoriteClick, onRemoveFavorite }: FavoritesCarouselProps) => {
  const getDisplayName = (user: Favorite) => {
    if (user.first_name) {
      return `${user.first_name} ${user.last_name || ""}`.trim();
    }
    return user.business_name || "Utente";
  };

  if (favorites.length === 0) {
    return null;
  }

  return (
    <div className="ios-card mx-4 p-4">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">PREFERITI</h3>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        {favorites.map((favorite) => (
          <div key={favorite.id} className="flex flex-col items-center gap-2 min-w-[70px]">
            <div className="relative group">
              <OptimizedAvatar
                src={favorite.profile_image_url}
                fallback={getDisplayName(favorite)[0]}
                size="medium"
                className="h-16 w-16 border-2 border-primary cursor-pointer"
                onClick={() => onFavoriteClick(favorite.id)}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFavorite(favorite.id);
                }}
                className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Star className="w-3 h-3 fill-current" />
              </button>
            </div>
            <span className="text-xs text-center truncate w-full">{getDisplayName(favorite).split(' ')[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FavoritesCarousel;