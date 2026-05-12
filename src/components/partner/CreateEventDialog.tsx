import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Image, Video, X, Loader2, MapPin, Euro, Globe2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useInvalidateEvents } from "@/hooks/useEvents";

interface CreateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  partnerCity?: string;
  partnerCountry?: string;
  partnerName?: string;
  // "social"   → opened from partner dashboard. Event lands in Home Social
  //              by default; the toggle is the opt-in to Calendar.
  // "calendar" → opened from admin Calendar Management. Event lands in
  //              Calendar by default; the toggle is the opt-in to Home Social.
  mode?: "social" | "calendar";
  event?: {
    id: string;
    title: string;
    description: string | null;
    image_url: string | null;
    video_url: string | null;
    media_type: string;
    start_date: string;
    end_date: string;
    discount_percentage: number | null;
    daily_scan_limit?: number;
    event_category?: string | null;
    location_name?: string | null;
    price?: number | null;
    show_in_social_feed?: boolean | null;
    show_in_calendar?: boolean | null;
  } | null;
  onSuccess: () => void;
}

const CreateEventDialog = ({
  open,
  onOpenChange,
  partnerId,
  partnerCity,
  partnerCountry,
  partnerName,
  mode = "social",
  event,
  onSuccess,
}: CreateEventDialogProps) => {
  const isCalendarMode = mode === "calendar";
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateEvents();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [discount, setDiscount] = useState("0");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [mediaPreview, setMediaPreview] = useState("");
  const [dailyScanLimit, setDailyScanLimit] = useState(1);
  const [dailyScanInput, setDailyScanInput] = useState("1");
  const [eventCategory, setEventCategory] = useState<"party" | "dinner">("party");
  const [locationName, setLocationName] = useState("");
  const [price, setPrice] = useState("");
  // Defaults flip based on the entry point: partner dashboard publishes
  // to Home Social by default, admin Calendar Management to Calendar.
  // The user only sees one switch (the *other* destination as opt-in).
  const [showInSocialFeed, setShowInSocialFeed] = useState(!isCalendarMode);
  const [showInCalendar, setShowInCalendar] = useState(isCalendarMode);

  const isEditing = !!event;

  // Converte un timestamp ISO (UTC dal DB) nella stringa "YYYY-MM-DDTHH:MM"
  // attesa da <input type="datetime-local">, espressa in ora locale.
  // Senza questa conversione l'input mostra l'ora UTC come fosse locale, e
  // al submit `new Date(...).toISOString()` reapplica l'offset → shift di N ore
  // ad ogni save anche se l'utente non tocca le date.
  const toLocalInputValue = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const offsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (open && event) {
      setTitle(event.title || "");
      setDescription(event.description || "");
      setStartDate(toLocalInputValue(event.start_date));
      setEndDate(toLocalInputValue(event.end_date));
      setDiscount(event.discount_percentage?.toString() || "0");
      setMediaUrl(event.image_url || event.video_url || "");
      setMediaType((event.media_type as "image" | "video") || "image");
      setMediaPreview(event.image_url || event.video_url || "");
      setDailyScanLimit(event.daily_scan_limit || 1);
      setDailyScanInput(String(event.daily_scan_limit || 1));
      setEventCategory((event.event_category as "party" | "dinner") || "party");
      setLocationName(event.location_name || "");
      setPrice(event.price != null ? String(event.price) : "");
      setShowInSocialFeed(!!event.show_in_social_feed);
      setShowInCalendar(!!event.show_in_calendar);
    } else if (open && !event) {
      resetForm();
    }
  }, [open, event]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const maxSize = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;

    if (file.size > maxSize) {
      toast({
        title: t("common.error"),
        description: isVideo
          ? t("events.videoTooLarge")
          : t("events.imageTooLarge"),
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setMediaType(isVideo ? "video" : "image");

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${partnerId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("posts")
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("posts")
        .getPublicUrl(fileName);

      setMediaUrl(urlData.publicUrl);
      setMediaPreview(urlData.publicUrl);

      toast({
        title: t("common.success"),
        description: t("events.mediaUploaded"),
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: t("common.error"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !startDate || !endDate) {
      toast({
        title: t("common.error"),
        description: t("events.fillRequired"),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const parsedPrice = price.trim() ? parseFloat(price.replace(",", ".")) : null;
      const eventData = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        discount_percentage: parseInt(discount) || 0,
        image_url: mediaType === "image" ? mediaUrl || null : null,
        video_url: mediaType === "video" ? mediaUrl || null : null,
        media_type: mediaUrl ? mediaType : null,
        partner_id: partnerId,
        is_active: true,
        qr_enabled: true,
        daily_scan_limit: dailyScanLimit,
        type: 'event',
        event_category: eventCategory,
        city: partnerCity || 'Valladolid',
        country: partnerCountry || localStorage.getItem("selectedCountry") || 'ES',
        location_name: locationName.trim() || null,
        price: parsedPrice != null && !isNaN(parsedPrice) ? parsedPrice : null,
        show_in_social_feed: showInSocialFeed,
        show_in_calendar: showInCalendar,
      };

      if (isEditing) {
        const { error } = await supabase
          .from("events")
          .update(eventData)
          .eq("id", event.id)
          .select();

        if (error) throw error;

        toast({
          title: t("common.success"),
          description: t("events.eventUpdated"),
        });
      } else {
        const { error } = await supabase.from("events").insert(eventData).select();

        if (error) throw error;

        // Push notification only when the event is published to Home Social.
        // Calendar-only events are silent (visible in /calendar but no broadcast).
        if (showInSocialFeed && partnerCity && partnerName) {
          // Fire-and-forget: don't block UI waiting for 300+ notifications
          supabase.functions.invoke('send-city-notification', {
            body: {
              city: partnerCity,
              country: partnerCountry || localStorage.getItem("selectedCountry") || 'ES',
              partnerName: partnerName,
              partnerId: partnerId,
              type: 'event',
              title: title.trim(),
              language: i18n.language,
            }
          }).catch(() => {});
        }

        toast({
          title: t("common.success"),
          description: t("events.eventCreated"),
        });
      }

      invalidateAll();
      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error("Error saving event:", error);
      toast({
        title: t("common.error"),
        description: error?.message || error?.code || "Errore sconosciuto",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setStartDate("");
    setEndDate("");
    setDiscount("0");
    setMediaUrl("");
    setMediaPreview("");
    setMediaType("image");
    setDailyScanLimit(1);
    setDailyScanInput("1");
    setEventCategory("party");
    setLocationName("");
    setPrice("");
    setShowInSocialFeed(!isCalendarMode);
    setShowInCalendar(isCalendarMode);
  };

  const removeMedia = () => {
    setMediaUrl("");
    setMediaPreview("");
  };

  // Lock body scroll while the full-screen dialog is open so we don't get
  // double scrollbars on web nor stuck-behind-nav layouts on mobile.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  // Render via portal to escape any parent that creates a containing block
  // (framer-motion's PageTransitions wraps Routes in a transformed div, which
  // otherwise traps `position: fixed` inside the page region).
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background animate-in slide-in-from-right duration-200"
      style={{
        // Force above the admin/client bottom nav (which sits at z-50) and
        // any sticky sheets. Use viewport height to prevent the bottom from
        // collapsing on mobile browsers.
        height: "100dvh",
        width: "100vw",
      }}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
           style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={handleClose}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-lg font-bold flex-1">
          {isEditing ? t("events.editEvent") : t("events.createEvent")}
        </h1>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <form
          onSubmit={handleSubmit}
          className="p-4 space-y-4"
          style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Media Upload */}
          <div className="space-y-2">
            <Label>{t("events.photoOrVideo")}</Label>
            {mediaPreview ? (
              <div className="relative rounded-xl overflow-hidden">
                {mediaType === "video" ? (
                  <video
                    src={mediaPreview}
                    className="w-full aspect-video object-cover"
                    controls
                  />
                ) : (
                  <img
                    src={mediaPreview}
                    alt="Preview"
                    className="w-full aspect-video object-cover"
                  />
                )}
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 rounded-full"
                  onClick={removeMedia}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary transition-colors"
              >
                {uploading ? (
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <div className="flex justify-center gap-2 mb-2">
                      <Image className="w-8 h-8 text-muted-foreground" />
                      <Video className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("events.clickToUpload")}
                    </p>
                  </>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Event Category */}
          <div className="space-y-2">
            <Label>{t("events.eventCategory")}</Label>
            <Select value={eventCategory} onValueChange={(val) => setEventCategory(val as "party" | "dinner")}>
              <SelectTrigger className="ios-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="party">{t("events.party")}</SelectItem>
                <SelectItem value="dinner">{t("events.dinner")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">{t("events.eventTitle")} *</Label>
            <Input
              id="title"
              className="ios-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("events.eventTitle")}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("events.description")}</Label>
            <Textarea
              id="description"
              className="ios-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("events.description")}
              rows={3}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">{t("events.start")} *</Label>
              <Input
                id="startDate"
                className="ios-input"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">{t("events.end")} *</Label>
              <Input
                id="endDate"
                className="ios-input"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Discount */}
          <div className="space-y-2">
            <Label htmlFor="discount">{t("events.discountOptional")}</Label>
            <Input
              id="discount"
              className="ios-input"
              type="number"
              min="0"
              max="100"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0"
            />
          </div>

          {/* Daily Scan Limit */}
          <div className="space-y-2">
            <Label htmlFor="event-daily-scan-limit" className="flex flex-col gap-1">
              <span>{t("eventManager.dailyScanLimit")}</span>
              <span className="text-xs text-muted-foreground">
                {t("eventManager.dailyScanLimitDescription")}
              </span>
            </Label>
            <Input
              id="event-daily-scan-limit"
              className="ios-input"
              type="number"
              min="1"
              max="10"
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

          {/* Location name */}
          <div className="space-y-2">
            <Label htmlFor="locationName" className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              {t("events.locationName", "Lugar")}
            </Label>
            <Input
              id="locationName"
              className="ios-input"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder={t("events.locationNamePlaceholder", "Ej. Sala Bagueta")}
            />
          </div>

          {/* Price */}
          <div className="space-y-2">
            <Label htmlFor="price" className="flex items-center gap-2">
              <Euro className="w-4 h-4 text-muted-foreground" />
              {t("events.priceOptional", "Precio (opcional)")}
            </Label>
            <Input
              id="price"
              className="ios-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>

          {/* Cross-publish toggle. Label and target flag depend on entry point:
              - In "social" mode the event already lands in Home Social, so we
                only ask whether to also publish it to the Calendar.
              - In "calendar" mode the event already lands in the Calendar, so
                we ask whether to also broadcast it via Home Social. */}
          <div className="flex items-start gap-3 rounded-2xl border bg-muted/30 p-4">
            <Globe2 className="w-5 h-5 mt-0.5 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {isCalendarMode ? (
                <>
                  <Label htmlFor="cross-publish-toggle" className="text-sm font-semibold leading-tight">
                    {t("events.showInSocial", "Mostrar también en Home Social")}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">
                    {t(
                      "events.showInSocialDescription",
                      "Si está activado, el evento aparece en el feed social y envía una notificación a la ciudad. Si está desactivado, solo aparece en el Calendar."
                    )}
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="cross-publish-toggle" className="text-sm font-semibold leading-tight">
                    {t("events.showInCalendar", "Mostrar también en el Calendar")}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">
                    {t(
                      "events.showInCalendarDescription",
                      "Si está activado, el evento aparece también en el Calendar de la ciudad. Si está desactivado, solo se publica en la Home Social."
                    )}
                  </p>
                </>
              )}
            </div>
            <Switch
              id="cross-publish-toggle"
              checked={isCalendarMode ? showInSocialFeed : showInCalendar}
              onCheckedChange={isCalendarMode ? setShowInSocialFeed : setShowInCalendar}
              className="mt-0.5"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="flex-1 ios-button" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isEditing ? (
                t("common.save")
              ) : (
                t("events.createEvent")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default CreateEventDialog;
