import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar, Percent, Download, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import QRCodeModal from "./QRCodeModal";
import { usePartnerDiscounts } from "@/hooks/useDiscounts";

interface PartnerDiscountsProps {
  partnerId: string;
}

const PartnerDiscounts = ({ partnerId }: PartnerDiscountsProps) => {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [selectedDiscount, setSelectedDiscount] = useState<any>(null);
  const [showQRModal, setShowQRModal] = useState(false);

  // Usa hook cached per gli sconti
  const { data: discounts = [], isLoading: loading } = usePartnerDiscounts(partnerId);

  const handleDownloadQR = async (discount: any) => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      toast({
        title: t("common.error"),
        description: t("discounts.mustBeAuthenticated"),
        variant: "destructive",
      });
      return;
    }

    // Check if user already has a QR code for this discount
    const { data: existingQR } = await supabase
      .from("qr_codes")
      .select("*")
      .eq("discount_id", discount.id)
      .eq("client_id", user.id)
      .maybeSingle();

    if (existingQR) {
      toast({
        title: t("discounts.qrAlreadyDownloaded"),
        description: t("discounts.qrAlreadyDownloadedDesc"),
        variant: "destructive",
      });
      return;
    }

    // Generate new QR code
    const { data: qrData, error } = await supabase.rpc("generate_qr_code");

    if (error || !qrData) {
      toast({
        title: t("common.error"),
        description: t("discounts.cannotGenerateQR"),
        variant: "destructive",
      });
      return;
    }

    // Save QR code with discount_id
    const { data: newQR, error: insertError } = await supabase
      .from("qr_codes")
      .insert({
        discount_id: discount.id,
        client_id: user.id,
        code: qrData,
      })
      .select()
      .single();

    if (insertError || !newQR) {
      toast({
        title: t("common.error"),
        description: t("discounts.cannotSaveQR"),
        variant: "destructive",
      });
      return;
    }

    // Create event-like object for QRCodeModal compatibility
    setSelectedDiscount({
      ...discount,
      qrCode: newQR,
    });
    setShowQRModal(true);

    toast({
      title: t("discounts.qrGenerated"),
      description: t("discounts.qrGeneratedDesc"),
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="ios-card p-4 animate-pulse">
            <div className="h-6 bg-muted rounded w-3/4 mb-2" />
            <div className="h-4 bg-muted rounded w-full mb-2" />
            <div className="h-10 bg-muted rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (discounts.length === 0) {
    return (
      <div className="ios-card p-8 text-center">
        <Percent className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">{t("discounts.noDiscountsAvailable")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {discounts.map((discount) => (
          <div key={discount.id} className="ios-card p-4">
            {discount.image_url && (
              <img
                src={discount.image_url}
                alt={discount.title}
                className="w-full h-48 object-cover rounded-xl mb-4"
              />
            )}

            <h3 className="font-bold text-lg mb-2">{discount.title}</h3>

            {discount.description && (
              <p className="text-muted-foreground text-sm mb-3">{discount.description}</p>
            )}

            <div className="flex items-center gap-4 mb-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span>
                  {new Date(discount.start_date).toLocaleDateString("it-IT")} -{" "}
                  {new Date(discount.end_date).toLocaleDateString("it-IT")}
                </span>
              </div>

              {!!discount.discount_percentage && (
                <div className="flex items-center gap-2 text-primary font-bold">
                  <Percent className="w-4 h-4" />
                  <span>{discount.discount_percentage}% {t("discounts.discount")}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {discount.link_url && (
                <Button
                  onClick={() => window.open(discount.link_url, "_blank")}
                  variant="outline"
                  className="w-full ios-button h-12 mb-2"
                >
                  <ExternalLink className="w-5 h-5 mr-2" />
                  {t('partner.visitWebsite')}
                </Button>
              )}

              {discount.qr_enabled && (
                <Button
                  onClick={() => handleDownloadQR(discount)}
                  className="w-full ios-button h-12"
                >
                  <Download className="w-5 h-5 mr-2" />
                  {t('partner.downloadQR')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedDiscount && (
        <QRCodeModal
          event={selectedDiscount}
          open={showQRModal}
          onClose={() => {
            setShowQRModal(false);
            setSelectedDiscount(null);
          }}
        />
      )}
    </>
  );
};

export default PartnerDiscounts;
