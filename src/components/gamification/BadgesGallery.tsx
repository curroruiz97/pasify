import { Award } from "lucide-react";
import { Badge } from "@/hooks/useBadges";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "react-i18next";

interface BadgesGalleryProps {
  badges: Badge[];
  loading: boolean;
}

export const BadgesGallery = ({ badges, loading }: BadgesGalleryProps) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const earnedBadges = badges.filter(b => b.earned);
  const lockedBadges = badges.filter(b => !b.earned);

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-8 p-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Award className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold">{t('badges.yourBadges')}</h1>
            <Award className="w-8 h-8 text-primary" />
          </div>
          <p className="text-muted-foreground">
            {t('badges.progress', { earned: earnedBadges.length, total: badges.length })}
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500 animate-pulse"
            style={{ width: `${(earnedBadges.length / badges.length) * 100}%` }}
          />
        </div>

        {/* Earned Badges */}
        {earnedBadges.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">🏆</span>
              {t('badges.earnedBadges')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {earnedBadges.map((badge) => (
                <div
                  key={badge.id}
                  className="relative group cursor-pointer transform transition-all duration-300 hover:scale-110 animate-fade-in"
                >
                  <div 
                    className="aspect-square rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg border-4 border-white relative overflow-hidden"
                    style={{ backgroundColor: badge.color }}
                  >
                    {/* Shine effect */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    
                    <div className="text-5xl mb-2 relative z-10 drop-shadow-lg">
                      {badge.icon}
                    </div>
                    <div className="text-sm font-bold text-white drop-shadow relative z-10">
                      {badge.name}
                    </div>
                  </div>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none">
                    {badge.description}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black/90" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Locked Badges */}
        {lockedBadges.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">🔒</span>
              {t('badges.lockedBadges')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {lockedBadges.map((badge) => (
                <div
                  key={badge.id}
                  className="relative group cursor-pointer transform transition-all duration-300 hover:scale-105"
                >
                  <div className="aspect-square rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg border-4 border-muted bg-muted/50 relative overflow-hidden backdrop-blur-sm">
                    <div className="text-5xl mb-2 grayscale opacity-30">
                      {badge.icon}
                    </div>
                    <div className="text-sm font-bold text-muted-foreground">
                      {badge.name}
                    </div>
                    
                    {/* Lock icon */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-4xl opacity-50">🔒</div>
                    </div>
                  </div>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none z-50">
                    {badge.description}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-black/90" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};
