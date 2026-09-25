import { Calendar, Share2, Loader2, Plus, Ticket } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { optimizedImage } from "@/lib/image";
import { shareEventLink } from "@/lib/eventLinks";
import { Button } from "@/components/ui/button";
import { eventPriceLabel, isEventOver } from "@/components/tickets/ticketUtils";
import type { CalendarEvent } from "@/hooks/useEvents";

interface EventPosterCardProps {
  event: CalendarEvent;
  /** Ya tiene entrada de este evento: "Mi entrada" y, debajo, "Comprar más". */
  isParticipant?: boolean;
  /** Compra en curso: spinner en el botón de comprar. */
  participating?: boolean;
  highlighted?: boolean;
  /** Abre el selector de entradas (tipo y cantidad). */
  onBuy?: (event: CalendarEvent) => void;
  /** Abre la entrada de este evento en la cartera. */
  onViewTicket?: (event: CalendarEvent) => void;
}

/**
 * "23:30" o, si el evento tiene hora de fin, "23:30 → 06:00". Sin hora de fin
 * (es opcional) no se inventa ninguna.
 */
const formatRange = (startIso: string, endIso: string | null) => {
  const start = new Date(startIso);
  const fmtTime = (d: Date) => format(d, "HH:mm");
  if (!endIso) return fmtTime(start);
  const end = new Date(endIso);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return sameDay
    ? `${fmtTime(start)} → ${fmtTime(end)}`
    : `${format(start, "d MMM HH:mm", { locale: es })} → ${format(end, "d MMM HH:mm", { locale: es })}`;
};

// Self-contained event card — name + day + time + Comprar button
// inline so the user never needs to drill into a separate detail screen.
const EventPosterCard = ({
  event,
  isParticipant,
  participating,
  highlighted,
  onBuy,
  onViewTicket,
}: EventPosterCardProps) => {
  const { t } = useTranslation();

  const dateChip = format(new Date(event.start_date), "EEE d 'de' MMMM", { locale: es });
  const timeRange = formatRange(event.date_start, event.date_end);
  // `price` (euros) = `events.price_cents` / 100, el mínimo de sus tipos de
  // entrada: "Desde X €", o "Gratis".
  const priceLabel =
    event.price != null ? eventPriceLabel(Math.round(Number(event.price) * 100)) : null;
  // Misma regla que el servidor para dejar de vender (ver isEventOver).
  const over = isEventOver(event);

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Enlace de la web pública (también desde la app nativa), con vista previa.
    void shareEventLink(event.id, event.title);
  };

  const buyContent = participating ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : isParticipant ? (
    <>
      <Plus className="mr-1.5 h-3.5 w-3.5" />
      {t("calendar.buyMore", "Comprar más")}
    </>
  ) : (
    <>
      <Ticket className="mr-1.5 h-3.5 w-3.5" />
      {t("calendar.buyTickets", "Comprar entradas")}
    </>
  );

  return (
    <article
      id={`event-card-${event.id}`}
      className={`group relative flex flex-col overflow-hidden rounded-3xl border bg-card shadow-sm transition-all duration-300 hover:shadow-xl ${
        highlighted
          ? "border-primary ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
          : "border-border/40"
      }`}
    >
      {/* Poster — object-contain so the entire flyer is always visible
          (vertical posters get small black bands on the sides; better
          than cropping a face/title off-frame). */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-black">
        {event.image_url ? (
          <img
            src={optimizedImage(event.image_url, "feed")}
            alt={event.title}
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-background">
            <Calendar className="h-16 w-16 text-primary/40" />
          </div>
        )}

        {/* Discount chip */}
        {(event.discount_percentage ?? 0) > 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground shadow-lg">
            -{event.discount_percentage}%
          </span>
        )}

        {/* Share button — glassy */}
        <button
          type="button"
          onClick={handleShare}
          aria-label={t("common.share", "Compartir")}
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      {/* Footer info — name + day chip + time + comprar */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="break-words text-sm font-bold uppercase leading-tight tracking-wide text-foreground sm:text-base">
          {event.title}
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold capitalize text-foreground">
            <Calendar className="h-3 w-3" />
            {dateChip}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {timeRange}
          </span>
        </div>

        {priceLabel && (
          <p className="text-sm font-semibold text-foreground">{priceLabel}</p>
        )}

        {isParticipant ? (
          // Ya tiene entrada: la ve en la cartera y puede comprar más (u otro tipo).
          <div className="mt-auto flex flex-col gap-1.5">
            <Button
              type="button"
              onClick={() => onViewTicket?.(event)}
              size="sm"
              className="h-9 w-full rounded-full text-xs font-semibold"
              variant="outline"
            >
              <Ticket className="mr-1.5 h-3.5 w-3.5" />
              {t("calendar.viewMyTicket", "Mi entrada")}
            </Button>
            {!over && (
              <Button
                type="button"
                onClick={() => onBuy?.(event)}
                disabled={participating}
                size="sm"
                className="h-8 w-full rounded-full text-xs font-semibold"
                variant="ghost"
              >
                {buyContent}
              </Button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => onBuy?.(event)}
            disabled={participating || over}
            size="sm"
            className="mt-auto h-9 w-full rounded-full text-xs font-semibold"
            variant="default"
          >
            {over ? t("calendar.eventOver", "Evento terminado") : buyContent}
          </Button>
        )}
      </div>
    </article>
  );
};

export default EventPosterCard;
