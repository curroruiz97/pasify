import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BadgesGallery } from "@/components/gamification/BadgesGallery";
import { BadgeAnimation } from "@/components/gamification/BadgeAnimation";
import { useBadges } from "@/hooks/useBadges";
import { useAuth } from "@/hooks/useAuth";
import SwipeBackWrapper from "@/components/shared/SwipeBackWrapper";
import { useTranslation } from "react-i18next";

const Badges = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userRole } = useAuth();
  const { badges, newBadge, setNewBadge, loading } = useBadges(user?.id, userRole);



  return (
    <SwipeBackWrapper>
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container flex items-center justify-between h-16 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">{t('badges.title')}</h1>
          <div className="w-10" />
        </div>
      </div>

      {/* Content */}
      <BadgesGallery badges={badges} loading={loading} />

      {/* Badge Animation */}
      <BadgeAnimation badge={newBadge} onClose={() => setNewBadge(null)} />
    </div>
    </SwipeBackWrapper>
  );
};

export default Badges;
