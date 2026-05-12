import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Share2, CheckCircle2, MapPin, Clock } from "lucide-react";
import QRCodeLib from "qrcode";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export type Ticket = {
  id: string;
  event_id: string;
  qr_token: string;
  status: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_email: string;
  amount_paid_cents: number;
  used_at: string | null;
};

export type TicketEventInfo = {
  title: string;
  date_start: string;
  city: string;
  venue_name: string | null;
  image_url: string | null;
  partner_name?: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  ticket: Ticket | null;
  event: TicketEventInfo | null;
}

export const TicketQRModal = ({ open, onClose, ticket, event }: Props) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !ticket) {
      setQrDataUrl(null);
      return;
    }
    QRCodeLib.toDataURL(ticket.qr_token, {
      width: 360,
      margin: 2,
      color: { dark: "#0F0F0F", light: "#F4EEE2" },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [open, ticket]);

  if (!ticket || !event) return null;

  const buyer =
    `${ticket.buyer_first_name ?? ""} ${ticket.buyer_last_name ?? ""}`.trim() || ticket.buyer_email;
  const date = new Date(event.date_start);
  const isUsed = ticket.status === "used";

  const downloadQR = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `pasify-ticket-${ticket.id.slice(0, 8)}.png`;
    a.click();
  };

  const shareQR = async () => {
    if (!qrDataUrl) return;
    try {
      const blob = await (await fetch(qrDataUrl)).blob();
      const file = new File([blob], `pasify-ticket.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: event.title,
          text: `Mi ticket para ${event.title}`,
          files: [file],
        });
      } else {
        downloadQR();
      }
    } catch (e) {
      console.error("share fail:", e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Ticket {event.title}</DialogTitle>
        </DialogHeader>

        {/* Hero terracota */}
        <div
          className="relative px-6 pt-6 pb-4 text-center"
          style={{
            background:
              "linear-gradient(160deg, #E8542A 0%, #B8381A 70%, #0F0F0F 130%)",
            color: "#F4EEE2",
          }}
        >
          {/* Status pill */}
          <div className="mb-3 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider backdrop-blur"
              style={{
                background: isUsed ? "rgba(10,10,10,0.4)" : "rgba(244,238,226,0.18)",
              }}
            >
              {isUsed ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Usado
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Válido
                </>
              )}
            </span>
          </div>

          <h2 className="text-xl font-bold leading-tight">{event.title}</h2>
          {event.partner_name && (
            <p className="mt-0.5 text-sm text-white/85">{event.partner_name}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/90">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(date, "EEE d MMM · HH:mm", { locale: es })}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {event.venue_name ?? event.city}
            </span>
          </div>
        </div>

        {/* QR */}
        <div
          className="relative flex flex-col items-center px-6 py-6"
          style={{ background: "#F4EEE2" }}
        >
          {/* Ticket notch decoration */}
          <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-card" />
          <div className="absolute -right-3 top-0 h-6 w-6 rounded-full bg-card" />

          {qrDataUrl ? (
            <div className="relative">
              <img
                src={qrDataUrl}
                alt="QR del ticket"
                className="h-72 w-72 rounded-2xl shadow-lg"
                style={{ filter: isUsed ? "grayscale(0.7) opacity(0.55)" : undefined }}
                draggable={false}
              />
              {isUsed && (
                <div
                  className="absolute inset-0 flex items-center justify-center rounded-2xl"
                  style={{ background: "rgba(0,0,0,0.25)" }}
                >
                  <div
                    className="rotate-[-12deg] rounded-md border-4 px-4 py-1 text-2xl font-black uppercase"
                    style={{ borderColor: "#B8381A", color: "#B8381A" }}
                  >
                    Usado
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-72 w-72 animate-pulse rounded-2xl bg-black/10" />
          )}

          <p className="mt-4 text-center text-sm font-medium" style={{ color: "#0F0F0F" }}>
            {buyer}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider opacity-50" style={{ color: "#0F0F0F" }}>
            ID · {ticket.qr_token.slice(0, 8)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-border bg-card p-3">
          <Button variant="outline" className="flex-1" onClick={downloadQR} disabled={!qrDataUrl}>
            <Download className="mr-2 h-4 w-4" />
            Descargar
          </Button>
          <Button className="flex-1" onClick={shareQR} disabled={!qrDataUrl}>
            <Share2 className="mr-2 h-4 w-4" />
            Compartir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TicketQRModal;
