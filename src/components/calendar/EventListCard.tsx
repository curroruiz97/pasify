import { Calendar, MapPin, Share2, Loader2, Check, Ticket } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { optimizedImage } from "@/lib/image";
import { useToast } from "@/hooks/use-toast";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  video_url?: string | null;
  media_type?: string | null;
  start_date: string;
  end_date: string;
  discount_percentage: number | null;
  price?: number | null;
  location_name?: string | null;
  city?: string | null;
  partner_id: string;
  profiles?: {
    id?: string;
    business_name: string | null;
    first_name: string | null;
    last_name: string | null;
    profile_image_url?: string | null;
  } | null;
}

interface EventListCardProps {
  event: CalendarEvent;
  isParticipant?: boolean;
  participating?: boolean;
  isAuthed?: boolean;
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

// Mobile-compact event row — same self-contained layout as EventPosterCard:
// Participar lives on the card itself, no detail-page navigation.
const EventListCard = ({
  event,
  isParticipant,
  participating,
  isAuthed,
  onParticipate,
}: EventListCardProps) => {
  const partner = event.profiles;
  const partnerName =
    partner?.business_name ||
    [partner?.first_name, partner?.last_name].filter(Boolean).join(" ").trim() ||
    "Partner";

  const dateChip = format(new Date(event.start_date), "EEE d 'de' MMMM", { locale: es });
  const timeRange = formatRange(event.start_date, event.end_date);

  const { t } = useTranslation();
  const { toast } = useToast();

  const handleShare = async () => {
    const url = window.location.origin + `/e/${event.id}`;
    const shareText = "¿Y tú qué haces? ¿No te unes? 🎉";
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: event.title, text: shareText, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("common.copied", "Enlace copiado") });
      }
    } catch {
      // dismissed
    }
  };

  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex gap-3 p-3">
        {/* Thumbnail */}
        <div className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-xl bg-black">
          {event.media_type === "video" && event.video_url ? (
            <video
              src={event.video_url}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : event.image_url ? (
            <img
              src={optimizedImage(event.image_url, "feed")}
              alt={event.title}
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 via-primary/10 to-background">
              <Calendar className="h-7 w-7 text-primary/40" />
            </div>
          )}
          {(event.discount_percentage ?? 0) > 0 && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-primary/95 px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground shadow-sm backdrop-blur">
              -{event.discount_percentage}%
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-bold uppercase leading-tight tracking-wide text-foreground sm:text-base">
              {event.title}
            </h3>
            <button
              type="button"
              onClick={handleShare}
              aria-label={t("common.share", "Compartir")}
              className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold capitalize text-foreground">
            <Calendar className="h-2.5 w-2.5" />
            {dateChip}
          </span>

          <p className="text-[11px] tabular-nums text-muted-foreground">{timeRange}</p>

          {(event.location_name || event.price != null) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {event.location_name && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{event.location_name}</span>
                </span>
              )}
              {event.price != null && (
                <span className="font-semibold text-foreground">
                  {Number(event.price).toFixed(2)} €
                </span>
              )}
            </div>
          )}

          <div className="mt-auto flex items-center gap-1.5 pt-1">
            <Avatar className="h-4 w-4">
              <AvatarImage
                src={optimizedImage(partner?.profile_image_url || null, "avatar") || undefined}
              />
              <AvatarFallback className="bg-primary/20 text-[8px] font-bold text-primary">
                {partnerName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-[10px] text-muted-foreground">{partnerName}</span>
          </div>
        </div>
      </div>

      {/* Participar — inline, no detail-page navigation */}
      <div className="px-3 pb-3">
        <Button
          type="button"
          onClick={() => onParticipate?.(event)}
          disabled={participating}
          className="h-10 w-full rounded-full text-sm font-semibold"
          variant={isParticipant ? "outline" : "default"}
        >
          {participating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isParticipant ? (
            <>
              <Ticket className="mr-2 h-4 w-4" />
              {t("calendar.viewMyTicket", "Mi entrada")}
            </>
          ) : !isAuthed ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              {t("calendar.signupToParticipate", "Regístrate para participar")}
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              {t("events.participate", "Participar")}
            </>
          )}
        </Button>
      </div>
    </article>
  );
};

export default EventListCard;
