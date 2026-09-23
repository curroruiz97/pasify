import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PrivacyScreen } from "@capacitor-community/privacy-screen";
import QRCodeLib from "qrcode";
import { CheckCircle2, Clock, MapPin, Sun } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  formatEventDateTime,
  formatMomentLong,
  ticketDoorCode,
  ticketHolderName,
} from "@/components/tickets/ticketUtils";

/**
 * Pasify · QR de una entrada de la cartera.
 *
 * - Mientras está abierto activa PrivacyScreen en nativo (bloquea capturas y
 *   oculta el QR en el selector de apps), igual que QRCodeModal.
 * - Sin "compartir" ni "descargar" a propósito: la entrada se enseña desde
 *   la app (o desde el enlace del email). Un PNG suelto del QR es justo lo
 *   que PrivacyScreen intenta evitar: copias que se revenden varias veces.
 * - Fecha y hora siempre en la hora del evento (Europe/Madrid), no en la del
 *   móvil.
 */

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
  /** Titular actual. Tras una transferencia cambia; los `buyer_*` no. */
  holder_first_name?: string | null;
  holder_last_name?: string | null;
  holder_email?: string | null;
  tier_id?: string | null;
  /** Nombre del tipo (General, VIP…). Null si no se ha podido leer. */
  tier_name?: string | null;
  transferred_to_user_id?: string | null;
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
  /** Puede faltar si no se pudo leer el evento: el QR se enseña igual. */
  event: TicketEventInfo | null;
}

const noSelect: React.CSSProperties = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

export const TicketQRModal = ({ open, onClose, ticket, event }: Props) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const qrToken = ticket?.qr_token ?? null;

  useEffect(() => {
    if (!open || !qrToken) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCodeLib.toDataURL(qrToken, {
      width: 360,
      margin: 2,
      color: { dark: "#0F0F0F", light: "#F4EEE2" },
      errorCorrectionLevel: "M",
    })
      .then((url: string) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [open, qrToken]);

  // Anti-capturas mientras el QR está en pantalla.
  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return;
    PrivacyScreen.enable().catch(console.error);
    return () => {
      PrivacyScreen.disable().catch(console.error);
    };
  }, [open]);

  if (!ticket) return null;

  const isUsed = ticket.status === "used";
  const holder = ticketHolderName(ticket);
  const title = event?.title ?? "Evento";
  const when = event ? formatEventDateTime(event.date_start) : "";
  const place = event ? event.venue_name ?? event.city : "";
  const usedAt = isUsed && ticket.used_at ? formatMomentLong(ticket.used_at) : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-sm gap-0 overflow-hidden p-0"
        style={noSelect}
        onContextMenu={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Entrada · {title}</DialogTitle>
          <DialogDescription>
            Código QR de tu entrada. Muéstralo en la puerta del local.
          </DialogDescription>
        </DialogHeader>

        {/* Hero terracota */}
        <div
          className="relative px-6 pb-4 pt-6 text-center"
          style={{
            background: "linear-gradient(160deg, #E8542A 0%, #B8381A 70%, #0F0F0F 130%)",
            color: "#F4EEE2",
          }}
        >
          <div className="mb-3 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider backdrop-blur"
              style={{
                background: isUsed ? "rgba(10,10,10,0.4)" : "rgba(244,238,226,0.18)",
              }}
            >
              {isUsed ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Usada
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Válida
                </>
              )}
            </span>
          </div>

          <h2 className="text-xl font-bold leading-tight">{title}</h2>
          {event?.partner_name && (
            <p className="mt-0.5 text-sm text-white/85">{event.partner_name}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/90">
            {when && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {when}
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {place}
              </span>
            )}
          </div>
        </div>

        {/* QR */}
        <div
          className="relative flex flex-col items-center px-6 py-6"
          style={{ background: "#F4EEE2", color: "#0F0F0F" }}
        >
          {/* Muescas de entrada */}
          <div className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-card" />
          <div className="absolute -right-3 top-0 h-6 w-6 rounded-full bg-card" />

          {qrDataUrl ? (
            <div className="relative">
              <img
                src={qrDataUrl}
                alt="Código QR de la entrada"
                className="h-72 w-72 rounded-2xl shadow-lg"
                style={{
                  ...noSelect,
                  filter: isUsed ? "grayscale(0.7) opacity(0.55)" : undefined,
                }}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
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
                    Usada
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-72 w-72 animate-pulse rounded-2xl bg-black/10" />
          )}

          {holder && <p className="mt-4 text-center text-sm font-semibold">{holder}</p>}
          <p
            className="mt-1 text-center text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "#B8381A" }}
          >
            {ticket.tier_name || "Entrada"}
          </p>
          {!isUsed && ticketDoorCode(qrToken) ? (
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider opacity-60">
              Código <span className="text-sm font-semibold opacity-100">{ticketDoorCode(qrToken)}</span>
            </p>
          ) : (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider opacity-50">
              Ref. {ticket.id.slice(0, 8)}
            </p>
          )}
          {usedAt && (
            <p className="mt-2 text-center text-xs font-medium opacity-70">
              Validada el {usedAt}
            </p>
          )}
        </div>

        {/* Pie */}
        <div className="border-t border-border bg-card p-3">
          {!isUsed && (
            <p className="mb-3 flex items-center justify-center gap-1.5 text-center text-[12px] text-muted-foreground">
              <Sun className="h-3.5 w-3.5 shrink-0" />
              Sube el brillo y muestra el código completo en la puerta.
            </p>
          )}
          <Button variant="outline" className="w-full" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TicketQRModal;
