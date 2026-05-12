import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  Percent,
  Plus,
  Trash2,
  BarChart,
  Pencil,
  Users,
  Play,
  PartyPopper,
  Tag,
  Clock,
  QrCode,
  TrendingUp,
  Sparkles
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMediaCleanup } from "@/hooks/useMediaCleanup";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import LoyaltyCardConfig from "./LoyaltyCardConfig";
import CreateEventDialog from "./CreateEventDialog";
import CreateDiscountDialog from "./CreateDiscountDialog";
import EventParticipants from "./EventParticipants";
import { format } from "date-fns";
import { es, it, enUS, fr, de } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";

const dateLocales: Record<string, any> = {
  es: es,
  it: it,
  en: enUS,
  fr: fr,
  de: de,
};

interface PartnerEventsManagerProps {
  partnerId: string;
  partnerCity?: string;
  partnerCountry?: string;
  partnerName?: string;
}

interface DiscountFormData {
  title: string;
  description: string;
  discount_percentage: number;
  start_date: string;
  end_date: string;
  image_url: string;
  link_url: string;
  qr_enabled: boolean;
}

const initialDiscountFormData: DiscountFormData = {
  title: "",
  description: "",
  discount_percentage: 10,
  start_date: "",
  end_date: "",
  image_url: "",
  link_url: "",
  qr_enabled: true,
};

const PartnerEventsManager = ({ partnerId, partnerCity, partnerCountry, partnerName }: PartnerEventsManagerProps) => {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const currentLocale = dateLocales[i18n.language] || es;
  const { deleteEvent: deleteEventWithMedia, deleteDiscount: deleteDiscountWithMedia } = useMediaCleanup();

  // Sconti (tabella discounts)
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [loadingDiscounts, setLoadingDiscounts] = useState(true);
  const [showDiscountDialog, setShowDiscountDialog] = useState(false);
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [discountFormData, setDiscountFormData] = useState<DiscountFormData>(initialDiscountFormData);

  // Eventi (tabella events con type='event')
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showCreateEventDialog, setShowCreateEventDialog] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [participantsEvent, setParticipantsEvent] = useState<any>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<"discounts" | "events">("discounts");

  useEffect(() => {
    fetchDiscounts();
    fetchEvents();
  }, []);

  // ============ SCONTI (Discounts) ============
  const fetchDiscounts = async () => {
    const { data } = await supabase
      .from("discounts")
      .select("*")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      const discountsWithCounts = await Promise.all(
        data.map(async (discount) => {
          const { count } = await supabase
            .from("qr_codes")
            .select("*", { count: "exact", head: true })
            .eq("discount_id", discount.id);
          return { ...discount, qr_count: count || 0 };
        })
      );
      setDiscounts(discountsWithCounts);
    } else {
      setDiscounts([]);
    }
    setLoadingDiscounts(false);
  };

  const handleOpenCreateDiscount = () => {
    setEditingDiscountId(null);
    setShowDiscountDialog(true);
  };

  const handleOpenEditDiscount = (discount: any) => {
    setEditingDiscountId(discount.id);
    setShowDiscountDialog(true);
  };

  const handleDeleteDiscount = async (id: string) => {
    const success = await deleteDiscountWithMedia(id);

    if (!success) {
      toast({
        title: t("eventManager.error"),
        description: t("eventManager.cannotDelete"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("eventManager.discountDeleted"),
    });

    fetchDiscounts();
  };

  const handleCloseDiscountDialog = (open: boolean) => {
    if (!open) {
      setEditingDiscountId(null);
      setDiscountFormData(initialDiscountFormData);
    }
    setShowDiscountDialog(open);
  };

  // ============ EVENTI (Social Events) ============
  const fetchEvents = async () => {
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("partner_id", partnerId)
      .eq("type", "event")
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      const eventsWithCounts = await Promise.all(
        data.map(async (event) => {
          const { count } = await supabase
            .from("event_participants")
            .select("*", { count: "exact", head: true })
            .eq("event_id", event.id);
          return { ...event, participants_count: count || 0 };
        })
      );
      setEvents(eventsWithCounts);
    } else {
      setEvents([]);
    }
    setLoadingEvents(false);
  };

  const handleOpenCreateEvent = () => {
    setEditingEvent(null);
    setShowCreateEventDialog(true);
  };

  const handleOpenEditEvent = (event: any) => {
    setEditingEvent(event);
    setShowCreateEventDialog(true);
  };

  const handleDeleteEvent = async (id: string) => {
    const success = await deleteEventWithMedia(id);

    if (!success) {
      toast({
        title: t("eventManager.error"),
        description: t("eventManager.cannotDelete"),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: t("eventManager.eventDeleted"),
    });

    fetchEvents();
  };

  const handleEventSuccess = () => {
    fetchEvents();
  };

  const isDiscountActive = (discount: any) => {
    const now = new Date();
    const start = new Date(discount.start_date);
    if (now < start) return false;
    if (discount.no_expiry) return true;
    const end = new Date(discount.end_date);
    return now <= end;
  };

  const isEventActive = (event: any) => {
    const now = new Date();
    const end = new Date(event.end_date);
    return now <= end;
  };

  return (
    <div className="space-y-6">
      {/* Loyalty Card Config */}
      <LoyaltyCardConfig partnerId={partnerId} />

      {/* Modern Tab Selector */}
      <div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-2xl p-1">
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={() => setActiveTab("discounts")}
            className={`
              relative flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold transition-all duration-300
              ${activeTab === "discounts"
                ? "bg-white dark:bg-gray-800 text-primary shadow-lg"
                : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            <Tag className="w-5 h-5" />
            <span>{t("eventManager.discountsTab")}</span>
            {discounts.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-[20px] px-1.5 text-xs">
                {discounts.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`
              relative flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl font-semibold transition-all duration-300
              ${activeTab === "events"
                ? "bg-white dark:bg-gray-800 text-primary shadow-lg"
                : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            <PartyPopper className="w-5 h-5" />
            <span>{t("eventManager.eventsTab")}</span>
            {events.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-[20px] px-1.5 text-xs">
                {events.length}
              </Badge>
            )}
          </button>
        </div>
      </div>

      {/* ============ DESCUENTOS SECTION ============ */}
      {activeTab === "discounts" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-left-2 duration-300">
          {/* Header with Create Button */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Percent className="w-5 h-5 text-primary" />
                {t("eventManager.discountsTab")}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("eventManager.discountsDescription") || "Ofertas y promociones para tus clientes"}
              </p>
            </div>
            <Button
              onClick={handleOpenCreateDiscount}
              className="rounded-full h-10 px-4 bg-primary hover:bg-primary/90 shadow-lg"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("common.create") || "Crear"}
            </Button>
          </div>

          {/* Discounts List */}
          {loadingDiscounts ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="bg-card rounded-2xl p-4 animate-pulse border">
                  <div className="h-5 bg-muted rounded w-2/3 mb-3" />
                  <div className="h-4 bg-muted rounded w-full mb-2" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : discounts.length === 0 ? (
            <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl p-8 text-center border border-dashed border-primary/20">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Tag className="w-8 h-8 text-primary" />
              </div>
              <h4 className="font-semibold text-lg mb-2">{t("eventManager.noDiscountsYet")}</h4>
              <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
                {t("eventManager.noDiscountsDescription") || "Crea tu primer descuento para atraer más clientes"}
              </p>
              <Button onClick={handleOpenCreateDiscount} className="rounded-full">
                <Plus className="w-4 h-4 mr-2" />
                {t("eventManager.createNewDiscount")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {discounts.map((discount) => {
                const qrCount = discount.qr_count || 0;
                const active = isDiscountActive(discount);

                return (
                  <div
                    key={discount.id}
                    className={`
                      bg-card rounded-2xl border overflow-hidden transition-all duration-200
                      ${active ? "border-primary/20 shadow-md" : "border-border opacity-75"}
                    `}
                  >
                    {/* Discount Header */}
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        {/* Percentage Badge */}
                        <div className={`
                          flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center
                          ${active
                            ? "bg-gradient-to-br from-primary to-primary/80 text-white"
                            : "bg-muted text-muted-foreground"
                          }
                        `}>
                          <span className="text-xl font-bold leading-none">{discount.discount_percentage}</span>
                          <span className="text-xs font-medium">%</span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="font-semibold text-base leading-tight">{discount.title}</h4>
                              {discount.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                                  {discount.description}
                                </p>
                              )}
                            </div>
                            <Badge variant={active ? "default" : "secondary"} className="flex-shrink-0">
                              {active ? (t("events.active") || "Activo") : (t("events.expired") || "Expirado")}
                            </Badge>
                          </div>

                          {/* Date */}
                          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>
                              {format(new Date(discount.start_date), "d MMM", { locale: currentLocale })}
                              {discount.no_expiry
                                ? ` - ${t("eventManager.noExpiry")}`
                                : ` - ${format(new Date(discount.end_date), "d MMM yyyy", { locale: currentLocale })}`
                              }
                            </span>
                          </div>

                          {/* Allowed Days Badges */}
                          {discount.allowed_days && discount.allowed_days.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                              {["0","1","2","3","4","5","6"].map((dayVal) => {
                                const labels = ["D","L","M","X","J","V","S"];
                                const isAllowed = discount.allowed_days.includes(dayVal);
                                return (
                                  <span
                                    key={dayVal}
                                    className={`
                                      w-6 h-6 rounded-full text-[10px] font-semibold flex items-center justify-center
                                      ${isAllowed
                                        ? "bg-primary/15 text-primary"
                                        : "bg-muted/50 text-muted-foreground/40"
                                      }
                                    `}
                                  >
                                    {labels[parseInt(dayVal)]}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Stats Row */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t">
                        {/* QR Toggle */}
                        <div className="flex items-center gap-2 flex-1">
                          <QrCode className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{t("eventManager.qrCodeEnabled")}</span>
                          <Switch
                            checked={discount.qr_enabled}
                            onCheckedChange={async (checked) => {
                              const { error } = await supabase
                                .from("discounts")
                                .update({ qr_enabled: checked })
                                .eq("id", discount.id);

                              if (error) {
                                toast({
                                  title: t("eventManager.error"),
                                  description: t("eventManager.cannotUpdate"),
                                  variant: "destructive",
                                });
                              } else {
                                toast({
                                  title: checked ? t("eventManager.qrEnabled") : t("eventManager.qrDisabled"),
                                });
                                fetchDiscounts();
                              }
                            }}
                          />
                        </div>

                        {/* QR Downloads */}
                        {discount.qr_enabled && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-full">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <span className="font-semibold text-primary">{qrCount}</span>
                            <span className="text-xs text-primary/70">QR</span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={() => handleOpenEditDiscount(discount)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                            onClick={() => handleDeleteDiscount(discount.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Create/Edit Discount Dialog */}
          <CreateDiscountDialog
            open={showDiscountDialog}
            onOpenChange={handleCloseDiscountDialog}
            partnerId={partnerId}
            partnerName={partnerName}
            partnerCity={partnerCity}
            partnerCountry={partnerCountry}
            discount={editingDiscountId ? discounts.find(d => d.id === editingDiscountId) : null}
            onSuccess={fetchDiscounts}
          />
        </div>
      )}

      {/* ============ EVENTOS SECTION ============ */}
      {activeTab === "events" && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
          {/* Header with Create Button */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <PartyPopper className="w-5 h-5 text-primary" />
                {t("eventManager.eventsTab")}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("eventManager.eventsDescription") || "Eventos especiales y fiestas"}
              </p>
            </div>
            <Button
              data-onboarding="partner-create-event"
              onClick={handleOpenCreateEvent}
              className="rounded-full h-10 px-4 bg-primary hover:bg-primary/90 shadow-lg"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t("common.create") || "Crear"}
            </Button>
          </div>

          {/* Events List */}
          {loadingEvents ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="bg-card rounded-2xl animate-pulse border overflow-hidden">
                  <div className="aspect-video bg-muted" />
                  <div className="p-4">
                    <div className="h-5 bg-muted rounded w-2/3 mb-2" />
                    <div className="h-4 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl p-8 text-center border border-dashed border-primary/20">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h4 className="font-semibold text-lg mb-2">{t("eventManager.noEventsYet")}</h4>
              <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
                {t("eventManager.noEventsDescription") || "Crea tu primer evento y compártelo en el social"}
              </p>
              <Button onClick={handleOpenCreateEvent} className="rounded-full">
                <Plus className="w-4 h-4 mr-2" />
                {t("eventManager.createNewEvent")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event) => {
                const participantsCount = event.participants_count || 0;
                const active = isEventActive(event);

                return (
                  <div
                    key={event.id}
                    className={`
                      bg-card rounded-2xl border overflow-hidden transition-all duration-200
                      ${active ? "border-primary/20 shadow-md" : "border-border opacity-75"}
                    `}
                  >
                    {/* Media Preview */}
                    {event.media_type === "video" && event.video_url ? (
                      <div className="relative aspect-video bg-black">
                        <video
                          src={event.video_url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                            <Play className="w-7 h-7 text-white ml-1" />
                          </div>
                        </div>
                        <Badge
                          variant={active ? "default" : "secondary"}
                          className="absolute top-3 right-3"
                        >
                          {active ? (t("events.active") || "Activo") : (t("events.expired") || "Expirado")}
                        </Badge>
                      </div>
                    ) : event.image_url ? (
                      <div className="relative aspect-video">
                        <img
                          src={event.image_url}
                          alt={event.title}
                          className="w-full h-full object-cover"
                        />
                        <Badge
                          variant={active ? "default" : "secondary"}
                          className="absolute top-3 right-3"
                        >
                          {active ? (t("events.active") || "Activo") : (t("events.expired") || "Expirado")}
                        </Badge>
                      </div>
                    ) : (
                      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative">
                        <PartyPopper className="w-16 h-16 text-primary/30" />
                        <Badge
                          variant={active ? "default" : "secondary"}
                          className="absolute top-3 right-3"
                        >
                          {active ? (t("events.active") || "Activo") : (t("events.expired") || "Expirado")}
                        </Badge>
                      </div>
                    )}

                    {/* Event Content */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold text-lg leading-tight">{event.title}</h4>
                          {event.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {event.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full"
                            onClick={() => handleOpenEditEvent(event)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                            onClick={() => handleDeleteEvent(event.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Event Info */}
                      <div className="flex flex-wrap items-center gap-3 mb-4">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {format(new Date(event.start_date), "d MMM yyyy, HH:mm", { locale: currentLocale })}
                          </span>
                        </div>

                        {event.discount_percentage > 0 && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 rounded-full">
                            <Percent className="w-3.5 h-3.5 text-primary" />
                            <span className="text-sm font-semibold text-primary">
                              {event.discount_percentage}%
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Participants Button */}
                      <Button
                        variant="outline"
                        className="w-full rounded-xl h-11"
                        onClick={() => setParticipantsEvent(event)}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        <span className="font-semibold">{participantsCount}</span>
                        <span className="ml-1">{t("eventManager.participants")}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Create/Edit Event Dialog */}
          <CreateEventDialog
            open={showCreateEventDialog}
            onOpenChange={setShowCreateEventDialog}
            partnerId={partnerId}
            partnerCity={partnerCity}
            partnerCountry={partnerCountry}
            partnerName={partnerName}
            mode="social"
            event={editingEvent}
            onSuccess={handleEventSuccess}
          />

          {/* Participants Sheet */}
          {participantsEvent && (
            <EventParticipants
              open={!!participantsEvent}
              onOpenChange={(open) => !open && setParticipantsEvent(null)}
              event={participantsEvent}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default PartnerEventsManager;
