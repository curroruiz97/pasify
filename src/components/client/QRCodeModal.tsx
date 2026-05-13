import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import QRCodeLib from "qrcode";
import { Capacitor } from "@capacitor/core";
import { PrivacyScreen } from "@capacitor-community/privacy-screen";

interface QRCodeModalProps {
  // New interface (from EventCard)
  isOpen?: boolean;
  code?: string;
  eventTitle?: string;
  partnerName?: string;
  discount?: number;
  validUntil?: string;
  // Old interface (from WalletSheet, PartnerEvents, PartnerDiscounts)
  event?: any;
  open?: boolean;
  onClose: () => void;
}

const QRCodeModal = (props: QRCodeModalProps) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Normalize props to handle both interfaces
  const isOpen = props.isOpen ?? props.open ?? false;
  const qrCode = props.code ?? props.event?.qrCode?.code;
  const title = props.eventTitle ?? props.event?.title ?? "";
  const endDate = props.validUntil ?? props.event?.end_date;
  const discountPercentage = props.discount ?? props.event?.discount_percentage;
  const isEvent = props.event?.type === 'event';
  const startDate = props.event?.start_date;

  useEffect(() => {
    if (isOpen && qrCode) {
      generateQRCode();
    }
  }, [isOpen, qrCode]);

  // Prevent screenshots and context menu
  useEffect(() => {
    if (isOpen) {
      // Enable screenshot protection on native platforms
      if (Capacitor.isNativePlatform()) {
        PrivacyScreen.enable().catch(console.error);
      }

      const preventScreenshot = (e: KeyboardEvent) => {
        // Block Print Screen key
        if (e.key === 'PrintScreen') {
          e.preventDefault();
        }
        // Block Ctrl+P, Ctrl+S, Ctrl+Shift+S
        if (e.ctrlKey && (e.key === 'p' || e.key === 's' || e.key === 'P' || e.key === 'S')) {
          e.preventDefault();
        }
      };

      const preventContextMenu = (e: MouseEvent) => {
        e.preventDefault();
      };

      document.addEventListener('keydown', preventScreenshot);
      document.addEventListener('keyup', preventScreenshot);
      document.addEventListener('contextmenu', preventContextMenu);

      return () => {
        // Disable screenshot protection when modal closes
        if (Capacitor.isNativePlatform()) {
          PrivacyScreen.disable().catch(console.error);
        }
        document.removeEventListener('keydown', preventScreenshot);
        document.removeEventListener('keyup', preventScreenshot);
        document.removeEventListener('contextmenu', preventContextMenu);
      };
    }
  }, [isOpen]);

  const generateQRCode = async () => {
    if (!qrCode) return;
    try {
      const url = await QRCodeLib.toDataURL(qrCode, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
      setQrDataUrl(url);
    } catch (err) {
      console.error("Errore generazione QR:", err);
    }
  };

  if (!qrCode) return null;

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
    <Dialog open={isOpen} onOpenChange={props.onClose}>
      <DialogContent
        className="ios-card max-w-sm"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Type Badge */}
          {isEvent ? (
            <div className="flex justify-center">
              <span className="px-4 py-1 bg-red-500 text-white text-sm font-bold rounded-full">
                EVENTO
              </span>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className="px-4 py-1 bg-blue-500 text-white text-sm font-bold rounded-full">
                DESCUENTO
              </span>
            </div>
          )}

          {/* QR Code Display - Protected */}
          <div
            className="bg-white p-6 rounded-2xl flex flex-col items-center relative"
            style={{
              userSelect: 'none',
              WebkitUserSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-full max-w-[300px] h-auto"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  pointerEvents: 'none',
                }}
              />
            ) : (
              <canvas
                ref={canvasRef}
                className="w-full max-w-[300px] h-auto"
                style={{ display: 'block', pointerEvents: 'none' }}
              />
            )}
            <p
              className="text-center mt-4 text-lg font-bold font-mono tracking-wider"
              style={{ userSelect: 'none' }}
            >
              {qrCode}
            </p>

            {/* Watermark overlay */}
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5"
              style={{ userSelect: 'none' }}
            >
              <span className="text-4xl font-bold text-gray-500 rotate-[-30deg]">
                PASIFY
              </span>
            </div>
          </div>

          {/* Status */}
          <div className={`ios-card p-4 flex items-center gap-3 ${isEvent ? 'bg-red-50' : 'bg-primary/10'}`}>
            <CheckCircle2 className={`w-6 h-6 ${isEvent ? 'text-red-500' : 'text-primary'}`} />
            <div>
              <p className={`font-semibold ${isEvent ? 'text-red-600' : 'text-primary'}`}>
                {t("events.qrCodeValid")}
              </p>
              {isEvent && startDate && endDate ? (
                <p className="text-sm text-muted-foreground">
                  Válido de {formatDateTime(startDate)} a {formatDateTime(endDate)}
                </p>
              ) : endDate && (
                <p className="text-sm text-muted-foreground">
                  Válido hasta {new Date(endDate).toLocaleDateString("es-ES")}
                </p>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="text-center text-sm text-muted-foreground">
            <p>Muestra este QR al socio para usar tu descuento</p>
            <p className="text-xs mt-1 text-red-500 font-medium">
              Este código solo puede ser usado dentro de la app
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QRCodeModal;
