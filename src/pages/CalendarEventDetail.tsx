import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  MapPin,
  Ticket,
  Check,
  Loader2,
  Tag,
  Share2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { optimizedImage } from "@/lib/image";
import { haptic } from "@/lib/haptics";

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  video_url: string | null;
  media_type: string | null;
  start_date: string;
  end_date: string;
  discount_percentage: number | null;
  price: number | null;
  location_name: string | null;
  city: string | null;
  country: string | null;
  partner_id: string;
  qr_enabled: boolean;
  event_category: string | null;
  is_active: boolean;
  profiles?: {
    id: string;
    business_name: string | null;
    first_name: string | null;
    last_name: string | null;
    profile_image_url: string | null;
  } | null;
}

const CalendarEventDetail = () => {
  const { id } = useParams<{ city: string; id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [participating, setParticipating] = useState(false);
  const [isParticipant, setIsParticipant] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (cancelled) return;
      setAuthedUserId(uid);

      // Public read: events RLS already allows everyone to view active events.
      const { data: ev, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle();

      if (cancelled) return;
      if (error || !ev) {
        setEvent(null);
        setLoading(false);
        return;
      }

      const { data: partner } = await supabase
        .from("profiles")
        .select("id, business_name, first_name, last_name, profile_image_url")
        .eq("id", ev.partner_id)
        .maybeSingle();

      if (cancelled) return;
      setEvent({ ...(ev as any), profiles: partner ?? null });

      if (uid) {
        const { data: existing } = await supabase
          .from("event_participants")
          .select("id")
          .eq("event_id", id)
          .eq("user_id", uid)
          .maybeSingle();
        if (!cancelled) setIsParticipant(!!existing);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const partner = event?.profiles;
  const partnerName =
    partner?.business_name ||
    [partner?.first_name, partner?.last_name].filter(Boolean).join(" ").trim() ||
    "Partner";

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(authedUserId ? "/calendar" : "/home");
  };

  const handleShare = async () => {
    // Short shareable link → /api/e/:id renders OG meta for WhatsApp/Telegram
    // and bounces real users to /calendar/:city/:id.
    const url = window.location.origin + `/e/${event?.id || ""}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: event?.title,
          text: "¿Y tú qué haces? ¿No te unes? 🎉",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("common.copied", "Enlace copiado") });
      }
    } catch {
      /* user dismissed */
    }
  };

  const handleParticipate = async () => {
    if (!event) return;
    // Public web user → redirect to register, then come back here.
    if (!authedUserId) {
      const next = `/calendar/${event.city || ""}/${event.id}`;
      navigate(`/register-client?next=${encodeURIComponent(next)}`);
      return;
    }
    if (isParticipant) {
      // For participating users we route back to the dashboard wallet,
      // where the QR ticket lives.
      navigate("/client-dashboard");
      return;
    }

    setParticipating(true);
    try {
      const newCode = `EVT-${event.id.substring(0, 8)}-${Date.now().toString(36)}`.toUpperCase();
      const { error: partErr } = await supabase
        .from("event_participants")
        .insert({ event_id: event.id, user_id: authedUserId });
      if (partErr) throw partErr;
      await supabase.from("qr_codes").insert({
        event_id: event.id,
        client_id: authedUserId,
        code: newCode,
      });
      setIsParticipant(true);
      haptic.success();
      toast({
        title: t("events.participationSuccess", "¡Participación confirmada!"),
        description: t("events.qrSavedInWallet", "Encuentra tu QR en el wallet."),
      });
    } catch (e: any) {
      console.error("[CalendarEventDetail] participate error:", e);
      toast({
        title: t("common.error", "Error"),
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setParticipating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <CalendarIcon className="h-12 w-12 text-muted-foreground mb-3" />
        <h1 className="text-lg font-bold">
          {t("calendar.notFoundTitle", "Evento no encontrado")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "calendar.notFoundDescription",
            "Este evento puede haber finalizado o no existe."
          )}
        </p>
        <Button onClick={handleBack} className="mt-5 rounded-full">
          {t("common.back", "Volver")}
        </Button>
      </div>
    );
  }

  const dateStr = format(new Date(event.start_date), "EEEE d 'de' MMMM", { locale: es });
  const timeStr = `${format(new Date(event.start_date), "HH:mm")} → ${format(new Date(event.end_date), "HH:mm")}`;

  const ctaContent = participating ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : !authedUserId ? (
    <>
      <Check className="mr-2 h-4 w-4" />
      {t("calendar.signupToParticipate", "Regístrate para participar")}
    </>
  ) : isParticipant ? (
    <>
      <Ticket className="mr-2 h-4 w-4" />
      {t("calendar.viewMyTicket", "Ver mi entrada")}
    </>
  ) : (
    <>
      <Check className="mr-2 h-4 w-4" />
      {t("events.participate", "Participar")}
    </>
  );

  // Reusable poster block — black canvas + object-contain so the entire
  // flyer is always visible, no matter the source aspect ratio.
  const Poster = ({ rounded = false }: { rounded?: boolean }) => (
    <div
      className={`relative aspect-[4/5] w-full overflow-hidden bg-black ${
        rounded ? "rounded-3xl border border-border/40 shadow-lg" : ""
      }`}
    >
      {event.media_type === "video" && event.video_url ? (
        <video
          src={event.video_url}
          className="h-full w-full object-contain"
          autoPlay
          muted
          playsInline
          loop
        />
      ) : event.image_url ? (
        <img
          src={optimizedImage(event.image_url, "feed")}
          alt={event.title}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-primary/5">
          <CalendarIcon className="h-20 w-20 text-primary/40" />
        </div>
      )}
      {!rounded && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />
      )}
    </div>
  );

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Sticky top bar — solid on desktop, glass-on-hero on mobile */}
      <div
        className="sticky top-0 z-30 border-b border-border/40 bg-background/85 backdrop-blur-xl"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0.5rem))" }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={handleBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="flex-1 truncate text-sm font-semibold">
            {event.title}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            onClick={handleShare}
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mobile hero — full bleed */}
      <div className="lg:hidden">
        <Poster />
      </div>

      {/* Content — single column on mobile, 2-up on desktop */}
      <main className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:py-10 lg:pb-16">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
          {/* Desktop poster column (sticky so it stays in view while scrolling info) */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <Poster rounded />
            </div>
          </div>

          {/* Info column */}
          <div className="-mt-6 lg:mt-0">
            {/* Partner card */}
            <button
              type="button"
              onClick={() =>
                partner?.id ? navigate(`/p/${partner.id}`) : undefined
              }
              className="flex w-full items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
            >
              <Avatar className="h-12 w-12 ring-2 ring-border">
                <AvatarImage
                  src={
                    optimizedImage(partner?.profile_image_url || null, "avatar") ||
                    undefined
                  }
                />
                <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                  {partnerName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("calendar.organizedBy", "Organizado por")}
                </p>
                <p className="truncate text-sm font-semibold text-foreground">
                  {partnerName}
                </p>
              </div>
            </button>

            {/* Title + meta */}
            <h1 className="mt-5 text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
              {event.title}
            </h1>

            <div className="mt-4 space-y-2 text-sm sm:text-base">
              <div className="flex items-center gap-2 text-foreground">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <span className="capitalize">{dateStr}</span>
                <span className="text-muted-foreground tabular-nums">· {timeStr}</span>
              </div>
              {event.location_name && (
                <div className="flex items-center gap-2 text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>{event.location_name}</span>
                  {event.city && (
                    <span className="text-muted-foreground">· {event.city}</span>
                  )}
                </div>
              )}
              {(event.discount_percentage ?? 0) > 0 && (
                <div className="flex items-center gap-2 text-foreground">
                  <Tag className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-primary">
                    -{event.discount_percentage}%
                  </span>
                  <span className="text-muted-foreground">
                    {t("calendar.studentDiscount", "Descuento para estudiantes")}
                  </span>
                </div>
              )}
              {event.price != null && (
                <div className="flex items-center gap-2 text-foreground">
                  <Ticket className="h-4 w-4 text-primary" />
                  <span className="font-semibold">
                    {Number(event.price).toFixed(2)} €
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            {event.description && (
              <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
                {event.description}
              </div>
            )}

            {/* Desktop inline CTA */}
            <Button
              onClick={handleParticipate}
              disabled={participating}
              className="mt-8 hidden h-12 w-full rounded-full text-sm font-semibold lg:flex"
              size="lg"
            >
              {ctaContent}
            </Button>
          </div>
        </div>
      </main>

      {/* Mobile sticky CTA */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/40 bg-background/85 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="px-4 py-3">
          <Button
            onClick={handleParticipate}
            disabled={participating}
            className="w-full rounded-full text-sm font-semibold"
            size="lg"
          >
            {ctaContent}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CalendarEventDetail;
