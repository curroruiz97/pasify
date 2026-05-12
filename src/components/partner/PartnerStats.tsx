import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, Download, Calendar, Star, Users, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { es, it, enUS, fr, de, pt } from "date-fns/locale";

const dateLocales: Record<string, Locale> = { es, it, en: enUS, fr, de, pt };
import EventParticipants from "./EventParticipants";

interface PartnerStatsProps {
  partnerId: string;
}

const PartnerStats = ({ partnerId }: PartnerStatsProps) => {
  const { t, i18n } = useTranslation();
  const currentLocale = dateLocales[i18n.language] || es;
  const [stats, setStats] = useState({
    totalEvents: 0,
    activeEvents: 0,
    totalQRDownloads: 0,
    totalQRUsed: 0,
    averageRating: 0,
    totalReviews: 0,
    totalParticipants: 0,
  });
  const [eventsWithParticipants, setEventsWithParticipants] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    const now = new Date();

    // Get discounts stats (tabella discounts)
    const { data: discounts } = await supabase
      .from("discounts")
      .select("id, is_active, end_date")
      .eq("partner_id", partnerId);

    const totalDiscounts = discounts?.length || 0;
    const activeDiscounts = discounts?.filter(
      (d) => d.is_active && new Date(d.end_date) > now
    ).length || 0;

    // Get social events stats (type = 'event')
    const { data: socialEvents } = await supabase
      .from("events")
      .select("id, title, is_active, end_date, start_date, image_url, video_url, media_type, discount_percentage")
      .eq("partner_id", partnerId)
      .eq("type", "event")
      .order("start_date", { ascending: false });

    const totalEvents = socialEvents?.length || 0;
    const activeEvents = socialEvents?.filter(
      (e) => e.is_active && new Date(e.end_date) > now
    ).length || 0;

    // Fetch participant counts for each event
    let totalParticipants = 0;
    let eventsWithCounts: any[] = [];

    if (socialEvents && socialEvents.length > 0) {
      eventsWithCounts = await Promise.all(
        socialEvents.map(async (event) => {
          const { count } = await supabase
            .from("event_participants")
            .select("*", { count: "exact", head: true })
            .eq("event_id", event.id);
          const participantCount = count || 0;
          totalParticipants += participantCount;
          return { ...event, participants_count: participantCount };
        })
      );
    }

    setEventsWithParticipants(eventsWithCounts);

    // Get QR codes stats - from both discounts and events
    let totalQRDownloads = 0;
    let totalQRUsed = 0;

    // QR codes from discounts. NOTA: lo scanner aggiorna `used_at`
    // (timestamp ultima scansione), non `is_used`. Quindi il "QR usato"
    // è un QR con `used_at IS NOT NULL` — più affidabile di is_used
    // che resta sempre false anche dopo le scansioni.
    if (discounts && discounts.length > 0) {
      const discountIds = discounts.map(d => d.id);
      const { data: discountQRCodes } = await supabase
        .from("qr_codes")
        .select("id, used_at")
        .in("discount_id", discountIds);

      totalQRDownloads += discountQRCodes?.length || 0;
      totalQRUsed += discountQRCodes?.filter((qr) => qr.used_at).length || 0;
    }

    // QR codes from events
    if (socialEvents && socialEvents.length > 0) {
      const eventIds = socialEvents.map(e => e.id);
      const { data: eventQRCodes } = await supabase
        .from("qr_codes")
        .select("id, used_at")
        .in("event_id", eventIds);

      totalQRDownloads += eventQRCodes?.length || 0;
      totalQRUsed += eventQRCodes?.filter((qr) => qr.used_at).length || 0;
    }

    // Get reviews stats
    const { data: reviews } = await supabase
      .from("reviews")
      .select("rating")
      .eq("partner_id", partnerId);

    const totalReviews = reviews?.length || 0;
    const averageRating = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
      : 0;

    setStats({
      totalEvents,
      activeEvents,
      totalQRDownloads,
      totalQRUsed,
      averageRating: parseFloat(averageRating.toFixed(1)),
      totalReviews,
      totalParticipants,
    });

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="ios-card p-4 animate-pulse">
            <div className="h-12 bg-muted rounded mb-2" />
            <div className="h-6 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      icon: Calendar,
      label: t("stats.activeEvents"),
      value: `${stats.activeEvents}/${stats.totalEvents}`,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      icon: Users,
      label: t("stats.totalParticipants"),
      value: stats.totalParticipants,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      icon: Download,
      label: t("stats.qrDownloaded"),
      value: stats.totalQRDownloads,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      icon: BarChart3,
      label: t("stats.qrUsed"),
      value: stats.totalQRUsed,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    {
      icon: Star,
      label: t("stats.averageRating"),
      value: `${stats.averageRating} (${stats.totalReviews})`,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="ios-card p-6 text-center">
        <h2 className="text-2xl font-bold mb-2">{t("stats.title")}</h2>
        <p className="text-muted-foreground">
          {t("stats.description")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {statCards.map((stat, index) => (
          <div key={index} className="ios-card p-4">
            <div className={`w-12 h-12 rounded-xl ${stat.bgColor} flex items-center justify-center mb-3`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
            <p className="text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="ios-card p-6">
        <h3 className="font-bold mb-4">{t("stats.usageRate")}</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>{t("stats.qrUsed")}</span>
              <span className="font-semibold">
                {stats.totalQRDownloads > 0
                  ? Math.round((stats.totalQRUsed / stats.totalQRDownloads) * 100)
                  : 0}%
              </span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 rounded-full"
                style={{
                  width: `${
                    stats.totalQRDownloads > 0
                      ? (stats.totalQRUsed / stats.totalQRDownloads) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Events with Participants */}
      {eventsWithParticipants.length > 0 && (
        <div className="ios-card p-6">
          <h3 className="font-bold mb-4">{t("stats.yourEvents")}</h3>
          <div className="space-y-4">
            {eventsWithParticipants.map((event) => {
              const participantsCount = event.participants_count || 0;
              const isActive = event.is_active && new Date(event.end_date) > new Date();

              return (
                <div
                  key={event.id}
                  className="bg-muted/50 rounded-xl overflow-hidden cursor-pointer hover:bg-muted/70 transition-colors"
                  onClick={() => setSelectedEvent(event)}
                >
                  {/* Media Preview */}
                  <div className="flex">
                    <div className="w-24 h-24 flex-shrink-0 relative">
                      {event.media_type === "video" && event.video_url ? (
                        <div className="relative w-full h-full bg-black">
                          <video
                            src={event.video_url}
                            className="w-full h-full object-cover"
                            muted
                            playsInline
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Play className="w-8 h-8 text-white" />
                          </div>
                        </div>
                      ) : event.image_url ? (
                        <img
                          src={event.image_url}
                          alt={event.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                          <Calendar className="w-8 h-8 text-primary/40" />
                        </div>
                      )}
                    </div>

                    {/* Event Info */}
                    <div className="flex-1 p-3 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm line-clamp-1">{event.title}</h4>
                          {isActive ? (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                              {t("stats.eventActive")}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">
                              {t("stats.eventEnded")}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(event.start_date), "d MMM yyyy", { locale: currentLocale })}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="w-4 h-4 text-primary" />
                          <span className="font-semibold">{participantsCount}</span>
                          <span className="text-muted-foreground text-xs">{t("stats.participants")}</span>
                        </div>
                        {event.discount_percentage > 0 && (
                          <span className="text-xs font-bold text-primary">
                            -{event.discount_percentage}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event Participants Sheet */}
      {selectedEvent && (
        <EventParticipants
          open={!!selectedEvent}
          onOpenChange={(open) => !open && setSelectedEvent(null)}
          event={selectedEvent}
        />
      )}
    </div>
  );
};

export default PartnerStats;
