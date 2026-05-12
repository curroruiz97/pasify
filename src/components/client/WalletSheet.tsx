import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, QrCode, Trash2 } from "lucide-react";
import QRCodeModal from "./QRCodeModal";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface WalletSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** When set, after fetching the QR list we auto-open the QR card
   *  matching this event_id (and switch the tab to "events"). Used by
   *  the Calendar's "Mi entrada" button to drop the user straight into
   *  the relevant ticket. */
  focusEventId?: string | null;
  onFocusConsumed?: () => void;
}

const WalletSheet = ({
  open,
  onOpenChange,
  userId,
  focusEventId,
  onFocusConsumed,
}: WalletSheetProps) => {
  const { t } = useTranslation();
  const [qrCodes, setQrCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showQRModal, setShowQRModal] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [qrToDelete, setQrToDelete] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"discounts" | "events">("discounts");

  useEffect(() => {
    if (open) {
      fetchQRCodes();
    }
  }, [open, userId]);

  const fetchQRCodes = async () => {
    setLoading(true);

    // Fetch all QR codes for user
    const { data } = await supabase
      .from("qr_codes")
      .select("*")
      .eq("client_id", userId)
      .order("created_at", { ascending: false });

    if (data) {
      // Process each QR code to get event/discount info
      const qrCodesWithDetails = await Promise.all(
        data.map(async (qr) => {
          let itemData = null;
          let partnerId = null;

          // Check if it's a discount QR code
          if (qr.discount_id) {
            const { data: discount } = await supabase
              .from("discounts")
              .select("id, title, description, image_url, start_date, end_date, discount_percentage, partner_id")
              .eq("id", qr.discount_id)
              .single();

            if (discount) {
              itemData = {
                id: discount.id,
                title: discount.title,
                description: discount.description,
                image_url: discount.image_url,
                start_date: discount.start_date,
                end_date: discount.end_date,
                discount_percentage: discount.discount_percentage,
                partner_id: discount.partner_id,
                type: 'discount'
              };
              partnerId = discount.partner_id;
            }
          }
          // Check if it's an event QR code
          else if (qr.event_id) {
            const { data: event } = await supabase
              .from("events")
              .select("id, title, description, image_url, start_date, end_date, discount_percentage, partner_id")
              .eq("id", qr.event_id)
              .single();

            if (event) {
              itemData = {
                id: event.id,
                title: event.title,
                description: event.description,
                image_url: event.image_url,
                start_date: event.start_date,
                end_date: event.end_date,
                discount_percentage: event.discount_percentage,
                partner_id: event.partner_id,
                type: 'event'
              };
              partnerId = event.partner_id;
            }
          }

          // If no valid data found, skip this QR
          if (!itemData || !partnerId) {
            return null;
          }

          // Fetch partner profile
          const { data: partnerProfile } = await supabase
            .from("profiles")
            .select("business_name, profile_image_url")
            .eq("id", partnerId)
            .single();

          return {
            ...qr,
            events: itemData, // Keep same structure for compatibility
            partnerProfile,
          };
        })
      );

      // Filter out null entries and expired events
      const now = new Date();
      const validQrCodes = qrCodesWithDetails.filter(qr => {
        if (qr === null) return false;
        // Check if expired
        const endDate = new Date(qr.events.end_date);
        return endDate > now;
      });
      setQrCodes(validQrCodes);

      // Caller asked us to focus a specific event QR (e.g. "Mi entrada"
      // tap from Calendar) — switch to the events tab and open the QR
      // modal automatically.
      if (focusEventId) {
        const target = validQrCodes.find(
          (qr) => qr.events?.type === "event" && qr.event_id === focusEventId
        );
        if (target) {
          setActiveTab("events");
          setSelectedEvent({ ...target.events, qrCode: target });
          setShowQRModal(true);
        }
        onFocusConsumed?.();
      }
    }
    setLoading(false);
  };

  const handleQRClick = (qrCode: any) => {
    setSelectedEvent({
      ...qrCode.events,
      qrCode,
    });
    setShowQRModal(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, qr: any) => {
    e.stopPropagation();
    setQrToDelete(qr);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!qrToDelete) return;
    
    const { error } = await supabase
      .from("qr_codes")
      .delete()
      .eq("id", qrToDelete.id)
      .eq("client_id", userId);

    if (error) {
      toast.error(t("wallet.deleteError"));
    } else {
      toast.success(t("wallet.deleteSuccess"));
      setQrCodes(qrCodes.filter(qr => qr.id !== qrToDelete.id));
    }
    
    setDeleteDialogOpen(false);
    setQrToDelete(null);
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[85vh] bg-gradient-to-b from-background to-blue-50/30">
          <DrawerHeader className="mb-2">
            <div className="flex items-center justify-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <QrCode className="w-6 h-6 text-white" />
              </div>
              <DrawerTitle className="text-2xl font-bold">
                {t("wallet.title")}
              </DrawerTitle>
            </div>
          </DrawerHeader>

          {/* Tab Navigation */}
          <div className="flex gap-2 px-4 mb-4">
            <button
              onClick={() => setActiveTab("discounts")}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all ${
                activeTab === "discounts"
                  ? "bg-blue-500 text-white shadow-lg shadow-blue-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Descuentos
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === "discounts" ? "bg-white/20" : "bg-gray-200"
              }`}>
                {qrCodes.filter(qr => qr.events.type === 'discount').length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("events")}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all ${
                activeTab === "events"
                  ? "bg-red-500 text-white shadow-lg shadow-red-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Eventos
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                activeTab === "events" ? "bg-white/20" : "bg-gray-200"
              }`}>
                {qrCodes.filter(qr => qr.events.type === 'event').length}
              </span>
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto h-[calc(85vh-200px)] px-1">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : qrCodes.filter(qr => activeTab === "discounts" ? qr.events.type === 'discount' : qr.events.type === 'event').length === 0 ? (
              <div className="text-center py-12 ios-card">
                <QrCode className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{t("wallet.empty")}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t("wallet.emptyHint")}
                </p>
              </div>
            ) : (
              qrCodes
                .filter(qr => activeTab === "discounts" ? qr.events.type === 'discount' : qr.events.type === 'event')
                .map((qr) => {
                const isEvent = qr.events.type === 'event';
                const formatDateTime = (dateStr: string) => {
                  const date = new Date(dateStr);
                  return date.toLocaleDateString("es-ES", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  });
                };

                return (
                  <div
                    key={qr.id}
                    className={`w-full bg-card rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-all border ${
                      isEvent ? "border-red-200 hover:border-red-300" : "border-border/50 hover:border-blue-200"
                    }`}
                  >
                    <button
                      onClick={() => handleQRClick(qr)}
                      className="flex items-center gap-4 flex-1"
                    >
                      <div className="relative">
                        <Avatar className={`h-16 w-16 ring-2 ${isEvent ? "ring-red-400/30" : "ring-blue-400/30"}`}>
                          <AvatarImage src={qr.partnerProfile?.profile_image_url} />
                          <AvatarFallback className={`text-white text-lg font-bold ${
                            isEvent
                              ? "bg-gradient-to-br from-red-500 to-red-600"
                              : "bg-gradient-to-br from-blue-500 to-blue-600"
                          }`}>
                            {qr.partnerProfile?.business_name?.[0] || "P"}
                          </AvatarFallback>
                        </Avatar>
                        <div className={`absolute -bottom-1 -right-1 h-6 w-6 rounded-full flex items-center justify-center ${
                          isEvent
                            ? "bg-gradient-to-br from-red-500 to-red-600"
                            : "bg-gradient-to-br from-blue-500 to-blue-600"
                        }`}>
                          <QrCode className="w-3.5 h-3.5 text-white" />
                        </div>
                      </div>

                      <div className="flex-1 text-left">
                        <h4 className="font-bold text-base">{qr.events.title}</h4>
                        <p className="text-sm text-muted-foreground font-medium">
                          {qr.partnerProfile?.business_name}
                        </p>

                        {/* Date info - different for events vs discounts */}
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {isEvent ? (
                            <span>
                              Válido de {formatDateTime(qr.events.start_date)} a {formatDateTime(qr.events.end_date)}
                            </span>
                          ) : (
                            <span>
                              {t("wallet.validUntil")}{" "}
                              {new Date(qr.events.end_date).toLocaleDateString("es-ES")}
                            </span>
                          )}
                        </div>

                        {!!qr.events.discount_percentage && (
                          <div className={`inline-block mt-1.5 px-2 py-0.5 text-xs font-bold rounded-full ${
                            isEvent
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                          }`}>
                            -{qr.events.discount_percentage}%
                          </div>
                        )}
                      </div>

                      <div className={isEvent ? "text-red-500" : "text-blue-500"}>
                        →
                      </div>
                    </button>

                    <button
                      onClick={(e) => handleDeleteClick(e, qr)}
                      className="p-2 rounded-full hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-5 h-5 text-destructive" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("wallet.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("wallet.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedEvent && (
        <QRCodeModal
          event={selectedEvent}
          open={showQRModal}
          onClose={() => {
            setShowQRModal(false);
            setSelectedEvent(null);
          }}
        />
      )}
    </>
  );
};

export default WalletSheet;
