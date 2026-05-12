import { Calendar, Share2, Loader2, Check, Ticket } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { optimizedImage } from "@/lib/image";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "./EventListCard";

interface EventPosterCardProps {
  event: CalendarEvent;
  isParticipant?: boolean;
  participating?: boolean;
  isAuthed?: boolean;
  highlighted?: boolean;
  onParticipate?: (event: CalendarEvent) => void;
}

const formatRange = (startIso: string, endIso: string) => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const fmtTime = (d: Date) => format(d, "HH:mm");
  return sameDay
    ? `${fmtTime(start)} → ${fmtTime(end)}`
    : `${format(start, "d MMM HH:mm", { locale: es })} → ${format(end, "d MMM HH:mm", { locale: es })}`;
};

// Self-contained event card — name + day + time + Participar button
// inline so the user never needs to drill into a separate detail screen.
const EventPosterCard = ({
  event,
  isParticipant,
  participating,
  isAuthed,
  highlighted,
  onParticipate,
}: EventPosterCardProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const dateChip = format(new Date(event.start_date), "EEE d 'de' MMMM", { locale: es });
  const timeRange = formatRange(event.start_date, event.end_date);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = window.location.origin + `/e/${event.id}`;
    const text = "¿Y tú qué haces? ¿No te unes? 🎉";
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: event.title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("common.copied", "Enlace copiado") });
      }
    } catch {
      // user dismissed
    }
  };

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
        {event.media_type === "video" && event.video_url ? (
          <video
            src={event.video_url}
            className="h-full w-full object-contain"
            muted
            playsInline
            preload="metadata"
          />
        ) : event.image_url ? (
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

      {/* Footer info — name + day chip + time + Participar */}
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

        {event.price != null && (
          <p className="text-sm font-semibold text-foreground">
            {Number(event.price).toFixed(2)} €
          </p>
        )}

        <Button
          type="button"
          onClick={() => onParticipate?.(event)}
          disabled={participating}
          size="sm"
          className="mt-auto h-9 w-full rounded-full text-xs font-semibold"
          variant={isParticipant ? "outline" : "default"}
        >
          {participating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isParticipant ? (
            <>
              <Ticket className="mr-1.5 h-3.5 w-3.5" />
              {t("calendar.viewMyTicket", "Mi entrada")}
            </>
          ) : (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {t("events.participate", "Participar")}
            </>
          )}
        </Button>
      </div>
    </article>
  );
};

export default EventPosterCard;
