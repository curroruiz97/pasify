import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, MapPin, Phone, Star, Percent } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import PartnerGallery from "@/components/client/PartnerGallery";
import PartnerDiscounts from "@/components/client/PartnerDiscounts";
import PartnerReviews from "@/components/client/PartnerReviews";
import SwipeBackWrapper from "@/components/shared/SwipeBackWrapper";
import { usePartner, useInvalidatePartners } from "@/hooks/usePartners";

const PartnerDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Usa hook cached per il partner
  const { data: partner, isLoading: loading, error } = usePartner(id);
  const { invalidatePartner } = useInvalidatePartners();

  useEffect(() => {
    if (id) {
      trackPartnerView();
    }
  }, [id]);

  useEffect(() => {
    if (error) {
      toast({
        title: t("common.error"),
        description: t("errors.fillAllFields"),
        variant: "destructive",
      });
      navigate("/client-dashboard");
    }
  }, [error, toast, t, navigate]);

  const trackPartnerView = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !id) return;

    // Track this view
    await supabase
      .from("partner_views")
      .insert({
        client_id: user.id,
        partner_id: id,
      });
  };

  const handleReviewAdded = () => {
    // Invalida la cache per ricaricare le recensioni
    if (id) invalidatePartner(id);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!partner) return null;

  return (
    <SwipeBackWrapper>
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary pb-8">
      {/* Header */}
      <div className="ios-card mx-4 mt-4 p-4">
        <button
          onClick={() => navigate("/client-dashboard")}
          className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-semibold">{t("partner.back")}</span>
        </button>

        <div className="flex gap-4 items-start">
          <Avatar className="w-24 h-24 border-4 border-primary">
            <AvatarImage src={partner.profile_image_url} />
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
              {partner.business_name?.[0]}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-2">{partner.business_name}</h1>
            
            <div className="flex items-center gap-1 mb-3">
              <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
              <span className="font-bold text-lg">{partner.avgRating}</span>
              <span className="text-sm text-muted-foreground">
                ({partner.reviewCount} {t("partner.reviews").toLowerCase()})
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">
                  {partner.business_address}, {partner.business_city}
                </span>
              </div>

              {partner.business_phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-4 h-4" />
                  <a
                    href={`tel:${partner.business_phone}`}
                    className="text-sm hover:text-primary transition-colors"
                  >
                    {partner.business_phone}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        {partner.business_description && (
          <p className="mt-4 text-muted-foreground">{partner.business_description}</p>
        )}
      </div>

      {/* Eventos — calendar mensile con tutti gli eventi del partner */}
      {partnerEvents.length > 0 && (
        <div className="mt-6 px-4">
          <h2 className="mb-4 text-xl font-bold">
            {t("partner.events", "Eventos")}
          </h2>
          <MonthCalendarView
            events={partnerEvents as unknown as CalendarEvent[]}
            onEventClick={handleEventClick}
          />
        </div>
      )}

      {/* Gallery */}
      <div className="mt-6 px-4">
        <h2 className="text-xl font-bold mb-4">{t("partner.gallery")}</h2>
        <PartnerGallery partnerId={id!} />
      </div>

      {/* Discounts */}
      <div className="mt-6 px-4">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Percent className="w-5 h-5 text-primary" />
          {t("partner.activeDiscounts") || "Sconti Attivi"}
        </h2>
        <PartnerDiscounts partnerId={id!} />
      </div>

      {/* Map */}
      <div className="mt-6 px-4">
        <h2 className="text-xl font-bold mb-4">{t("partner.location")}</h2>
        <div className="ios-card p-4">
          <div className="aspect-video bg-muted rounded-xl overflow-hidden">
            <iframe
              width="100%"
              height="100%"
              style={{ border: 0 }}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${encodeURIComponent(`${partner.business_address}, ${partner.business_city}`)}`}
            />
          </div>
          <div className="mt-4 flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <p className="text-sm flex-1">
              {partner.business_address}, {partner.business_city}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const address = `${partner.business_address}, ${partner.business_city}`;
                window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
              }}
            >
              {t("partner.openInMaps")}
            </Button>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div className="mt-6 px-4">
        <h2 className="text-xl font-bold mb-4">{t("partner.reviews")}</h2>
        <PartnerReviews partnerId={id!} reviews={partner.reviews || []} onReviewAdded={handleReviewAdded} />
      </div>
    </div>
    </SwipeBackWrapper>
  );
};

export default PartnerDetails;
