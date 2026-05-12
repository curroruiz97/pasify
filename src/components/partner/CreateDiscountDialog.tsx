import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import ImageUpload from "@/components/shared/ImageUpload";

interface CreateDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  partnerName?: string;
  partnerCity?: string;
  partnerCountry?: string;
  discount?: {
    id: string;
    title: string;
    description: string | null;
    discount_percentage: number;
    start_date: string;
    end_date: string;
    image_url: string | null;
    link_url: string | null;
    qr_enabled: boolean;
    daily_scan_limit?: number;
    no_expiry?: boolean;
    allowed_days?: string[] | null;
  } | null;
  onSuccess: () => void;
}

const DAY_LABELS = ["D", "L", "M", "X", "J", "V", "S"];
const DAY_VALUES = ["0", "1", "2", "3", "4", "5", "6"];

const CreateDiscountDialog = ({
  open,
  onOpenChange,
  partnerId,
  partnerName,
  partnerCity,
  partnerCountry,
  discount,
  onSuccess,
}: CreateDiscountDialogProps) => {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState(10);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [qrEnabled, setQrEnabled] = useState(true);
  const [dailyScanLimit, setDailyScanLimit] = useState(1);
  const [dailyScanInput, setDailyScanInput] = useState("1");
  const [noExpiry, setNoExpiry] = useState(false);
  const [allowedDays, setAllowedDays] = useState<string[]>([]);

  const isEditing = !!discount;

  // Reset form when dialog opens/closes or discount changes
  useEffect(() => {
    if (open && discount) {
      setTitle(discount.title || "");
      setDescription(discount.description || "");
      setDiscountPercentage(discount.discount_percentage || 10);
      setStartDate(discount.start_date ? discount.start_date.split("T")[0] : "");
      setEndDate(discount.end_date ? discount.end_date.split("T")[0] : "");
      setImageUrl(discount.image_url || "");
      setLinkUrl(discount.link_url || "");
      setQrEnabled(discount.qr_enabled ?? true);
      setDailyScanLimit(discount.daily_scan_limit || 1);
      setDailyScanInput(String(discount.daily_scan_limit || 1));
      setNoExpiry(discount.no_expiry ?? false);
      setAllowedDays(discount.allowed_days || []);
    } else if (open && !discount) {
      resetForm();
    }
  }, [open, discount]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDiscountPercentage(10);
    setStartDate("");
    setEndDate("");
    setImageUrl("");
    setLinkUrl("");
    setQrEnabled(true);
    setDailyScanLimit(1);
    setDailyScanInput("1");
    setNoExpiry(false);
    setAllowedDays([]);
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !startDate || (!noExpiry && !endDate)) {
      toast({
        title: t("common.error"),
        description: t("eventManager.fillRequired") || "Compila tutti i campi obbligatori",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const effectiveEndDate = noExpiry ? "2099-12-31" : endDate;
      const discountData = {
        title: title.trim(),
        description: description.trim() || null,
        discount_percentage: discountPercentage,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(effectiveEndDate).toISOString(),
        image_url: imageUrl || null,
        link_url: linkUrl || null,
        qr_enabled: qrEnabled,
        daily_scan_limit: dailyScanLimit,
        no_expiry: noExpiry,
        allowed_days: allowedDays.length > 0 ? allowedDays : null,
        partner_id: partnerId,
        is_active: true,
      };

      if (isEditing && discount) {
        const { error } = await supabase
          .from("discounts")
          .update(discountData)
          .eq("id", discount.id);

        if (error) throw error;

        toast({
          title: t("eventManager.eventUpdated"),
          description: t("eventManager.eventUpdatedDesc"),
        });
      } else {
        const { error } = await supabase.from("discounts").insert(discountData);

        if (error) throw error;

        // Fire-and-forget: don't block UI waiting for notifications
        if (partnerCity && partnerName) {
          supabase.functions.invoke('send-city-notification', {
            body: {
              city: partnerCity,
              country: partnerCountry || localStorage.getItem("selectedCountry") || 'ES',
              partnerName: partnerName,
              partnerId: partnerId,
              type: 'discount',
              title: title.trim(),
              discountPercentage: discountPercentage,
              language: i18n.language,
            }
          }).catch(() => {});
        }

        toast({
          title: t("eventManager.eventCreated"),
          description: t("eventManager.eventVisible"),
        });
      }

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error("Error saving discount:", error);
      toast({
        title: t("common.error"),
        description: error?.message || "Errore durante il salvataggio",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={handleClose}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold flex-1">
          {isEditing ? t("eventManager.editEvent") : t("eventManager.newEvent")}
        </h1>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-4 space-y-4 pb-6">
          <div className="space-y-2">
            <Label>{t("eventManager.titleRequired")}</Label>
            <Input
              required
              className="ios-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es. Sconto Studenti 20%"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("eventManager.description")}</Label>
            <Textarea
              className="ios-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrizione dello sconto..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("eventManager.eventImage")}</Label>
            <ImageUpload
              bucket="gallery"
              userId={partnerId}
              onImageUploaded={(url) => setImageUrl(url)}
              showPreview
            />
            {imageUrl && (
              <div className="mt-2">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-32 object-cover rounded-lg"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("eventManager.imageUploaded")}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("eventManager.externalLink")}</Label>
            <Input
              type="url"
              placeholder="https://..."
              className="ios-input"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("eventManager.discountRequired")}</Label>
            <Input
              type="number"
              required
              min="0"
              max="100"
              className="ios-input"
              value={discountPercentage}
              onChange={(e) => setDiscountPercentage(parseInt(e.target.value) || 0)}
            />
          </div>

          <div className="ios-card p-4 flex items-center justify-between">
            <Label htmlFor="no-expiry" className="flex flex-col gap-1">
              <span className="font-semibold">{t("eventManager.noExpiry")}</span>
              <span className="text-xs text-muted-foreground">
                {t("eventManager.noExpiryDescription")}
              </span>
            </Label>
            <Switch
              id="no-expiry"
              checked={noExpiry}
              onCheckedChange={setNoExpiry}
            />
          </div>

          <div className={`grid ${noExpiry ? "grid-cols-1" : "grid-cols-2"} gap-4`}>
            <div className="space-y-2">
              <Label>{t("eventManager.startDateRequired")}</Label>
              <Input
                type="date"
                required
                className="ios-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {!noExpiry && (
              <div className="space-y-2">
                <Label>{t("eventManager.endDateRequired")}</Label>
                <Input
                  type="date"
                  required
                  className="ios-input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex flex-col gap-1">
              <span>{t("eventManager.allowedDays")}</span>
              <span className="text-xs text-muted-foreground">
                {t("eventManager.allowedDaysDescription")}
              </span>
            </Label>
            <div className="flex gap-2">
              {DAY_LABELS.map((label, index) => {
                const dayValue = DAY_VALUES[index];
                const isSelected = allowedDays.includes(dayValue);
                return (
                  <button
                    key={dayValue}
                    type="button"
                    onClick={() => {
                      setAllowedDays(prev =>
                        isSelected
                          ? prev.filter(d => d !== dayValue)
                          : [...prev, dayValue]
                      );
                    }}
                    className={`
                      w-10 h-10 rounded-full text-sm font-semibold transition-all duration-200
                      ${isSelected
                        ? "bg-primary text-white shadow-md"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }
                    `}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {allowedDays.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("eventManager.allDays")}</p>
            )}
          </div>

          <div className="ios-card p-4 flex items-center justify-between">
            <Label htmlFor="qr-enabled" className="flex flex-col gap-1">
              <span className="font-semibold">{t("eventManager.enableQR")}</span>
              <span className="text-xs text-muted-foreground">
                {t("eventManager.qrDescription")}
              </span>
            </Label>
            <Switch
              id="qr-enabled"
              checked={qrEnabled}
              onCheckedChange={setQrEnabled}
            />
          </div>

          {qrEnabled && (
            <div className="space-y-2">
              <Label htmlFor="daily-scan-limit" className="flex flex-col gap-1">
                <span>{t("eventManager.dailyScanLimit")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("eventManager.dailyScanLimitDescription")}
                </span>
              </Label>
              <Input
                id="daily-scan-limit"
                type="number"
                min="1"
                max="10"
                className="ios-input"
                value={dailyScanInput}
                onChange={(e) => setDailyScanInput(e.target.value)}
                onBlur={() => {
                  const num = parseInt(dailyScanInput);
                  const clamped = isNaN(num) ? 1 : Math.min(10, Math.max(1, num));
                  setDailyScanLimit(clamped);
                  setDailyScanInput(String(clamped));
                }}
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleClose}
            >
              {t("common.cancel") || "Annulla"}
            </Button>
            <Button type="submit" className="flex-1 ios-button" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isEditing ? (
                t("eventManager.saveChanges")
              ) : (
                t("eventManager.createEvent")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateDiscountDialog;
