import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, MapPin, Users, Check, Ticket, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import QRCodeModal from "@/components/client/QRCodeModal";
import PhoneAllergensDialog from "@/components/client/PhoneAllergensDialog";
import { haptic } from "@/lib/haptics";
import { optimizedImage } from "@/lib/image";
import { EmptyState } from "@/components/ui/empty-state";

interface Participant {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
}

interface EventCardProps {
  event: {
    id: string;
    title: string;
    description: string | null;
    image_url: string | null;
    video_url?: string | null;
    media_type?: string;
    start_date: string;
    end_date: string;
    discount_percentage: number | null;
    partner_id: string;
    qr_enabled: boolean;
    event_category?: string | null;
  };
  partner: {
    id: string;
    business_name: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url?: string | null;
  };
  currentUserId: string;
  isPartner?: boolean;
}

/**
 * Descrizione evento espandibile: di default mostra 4 righe e (se
 * il testo è più lungo) compare un toggle "ver más / ver menos".
 * Rispetta i newline (whitespace-pre-line).
 */
const EventDescription = ({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    // Confrontiamo scrollHeight vs clientHeight in modalità collapsed.
    const collapsed = el.classList.contains("line-clamp-4");
    if (collapsed) {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    } else {
      // Fallback: forza un check temporaneo
      el.classList.add("line-clamp-4");
      setOverflows(el.scrollHeight > el.clientHeight + 1);
      el.classList.remove("line-clamp-4");
    }
  }, [text]);

  return (
    <div className="mt-1.5">
      <p
        ref={ref}
        className={`whitespace-pre-line text-sm leading-relaxed text-muted-foreground ${
          expanded ? "" : "line-clamp-4"
        }`}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  );
};

const EventCard = ({ event, partner, currentUserId, isPartner = false }: EventCardProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isParticipating, setIsParticipating] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [profilePhone, setProfilePhone] = useState("");
  const [profileAllergens, setProfileAllergens] = useState<string[]>([]);
  const [showParticipantsDialog, setShowParticipantsDialog] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);

  const fetchParticipants = async () => {
    if (participants.length > 0 || participantsLoading) return;
    setParticipantsLoading(true);
    try {
      const { data, error } = await supabase
        .from("event_participants")
        .select("user_id, profiles:user_id(id, first_name, last_name, profile_image_url)")
        .eq("event_id", event.id);
      if (error) throw error;
      const list: Participant[] = (data || [])
        .map((r: any) => r.profiles)
        .filter(Boolean);
      setParticipants(list);
    } catch (err) {
      console.error("[EventCard] fetch participants error:", err);
    } finally {
      setParticipantsLoading(false);
    }
  };

  const openParticipantsDialog = () => {
    setShowParticipantsDialog(true);
    fetchParticipants();
  };

  useEffect(() => {
    checkParticipation();
    fetchParticipantsCount();
  }, [event.id, currentUserId]);

  const checkParticipation = async () => {
    try {
      const { data, error: participantError } = await supabase
        .from("event_participants")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (participantError) {
        console.error("[EventCard] Error checking participation:", participantError);
        return;
      }

      if (data) {
        setIsParticipating(true);
        console.log("[EventCard] User is participating in event:", event.id);

        // Carica il QR code salvato nel wallet
        const { data: qrData, error: qrError } = await supabase
          .from("qr_codes")
          .select("code")
          .eq("event_id", event.id)
          .eq("client_id", currentUserId)
          .maybeSingle();

        if (qrError) {
          console.error("[EventCard] Error loading QR from wallet:", qrError);
        }

        if (qrData?.code) {
          console.log("[EventCard] Found QR in wallet:", qrData.code);
          setQrCode(qrData.code);
        } else {
          // Fallback: genera e salva un nuovo QR se non esiste
          console.log("[EventCard] No QR found, generating new one...");
          const newCode = `EVT-${event.id.substring(0, 8)}-${Date.now().toString(36)}`.toUpperCase();

          const { error: insertError } = await supabase.from("qr_codes").insert({
            event_id: event.id,
            client_id: currentUserId,
            code: newCode,
          });

          if (insertError) {
            console.error("[EventCard] Error saving QR to wallet:", insertError);
          } else {
            console.log("[EventCard] QR saved to wallet:", newCode);
          }

          // Sempre imposta il QR code localmente per permettere la visualizzazione
          setQrCode(newCode);
        }
      }
    } catch (err) {
      console.error("[EventCard] Unexpected error in checkParticipation:", err);
    }
  };

  const fetchParticipantsCount = async () => {
    const { count } = await supabase
      .from("event_participants")
      .select("*", { count: "exact", head: true })
      .eq("event_id", event.id);

    setParticipantsCount(count || 0);
  };

  const doParticipate = async () => {
    setLoading(true);
    try {
      // Genera QR code (prova RPC, altrimenti fallback locale)
      let newCode: string;
      const { data: rpcCode, error: qrError } = await supabase.rpc("generate_qr_code");

      if (qrError || !rpcCode) {
        // Fallback: genera codice localmente
        newCode = `EVT-${event.id.substring(0, 8)}-${Date.now().toString(36)}`.toUpperCase();
        console.log("[EventCard] Using fallback QR generation:", newCode);
      } else {
        newCode = rpcCode;
        console.log("[EventCard] QR generated via RPC:", newCode);
      }

      // Inserisci partecipazione
      const { error: participantError } = await supabase
        .from("event_participants")
        .insert({
          event_id: event.id,
          user_id: currentUserId,
        });

      if (participantError) throw participantError;
      console.log("[EventCard] Participation registered");

      // Salva QR nel wallet (sezione eventi)
      const { error: qrInsertError } = await supabase.from("qr_codes").insert({
        event_id: event.id,
        client_id: currentUserId,
        code: newCode,
      });

      if (qrInsertError) {
        console.error("[EventCard] Error saving QR to wallet:", qrInsertError);
      } else {
        console.log("[EventCard] QR saved to wallet successfully");
      }

      setIsParticipating(true);
      setQrCode(newCode);
      setParticipantsCount(prev => prev + 1);
      haptic.success();
      setShowQR(true);

      // Invia email di conferma con QR (fire-and-forget)
      supabase
        .from("profiles")
        .select("email, first_name")
        .eq("id", currentUserId)
        .single()
        .then(({ data: profileData }) => {
          if (profileData?.email) {
            supabase.functions.invoke('send-event-confirmation', {
              body: {
                user_email: profileData.email,
                user_name: profileData.first_name || 'Estudiante',
                event_title: event.title,
                event_date: event.start_date,
                partner_name: displayName,
                discount_percentage: event.discount_percentage,
                qr_code: newCode,
              }
            }).catch(err => console.error("[EventCard] Error sending confirmation email:", err));
          }
        })
        .catch(err => console.error("[EventCard] Error fetching profile for confirmation email:", err));

      toast({
        title: t("events.participationSuccess"),
        description: t("events.qrSavedInWallet"),
      });
    } catch (error: any) {
      console.error("[EventCard] Error participating:", error);
      toast({
        title: t("common.error") || "Errore",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleParticipate = async () => {
    // Se già partecipa, mostra il QR (o ricaricalo se non disponibile)
    if (isParticipating) {
      if (qrCode) {
        setShowQR(true);
      } else {
        // QR non caricato, ricarica
        console.log("[EventCard] QR not loaded, reloading...");
        await checkParticipation();
        setShowQR(true);
      }
      return;
    }

    // Controlla se il profilo ha telefono e (per cene) allergeni
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("phone, allergens")
        .eq("id", currentUserId)
        .single();

      if (profileError) {
        console.error("[EventCard] Error fetching profile:", profileError);
      }

      const needsPhone = !profile?.phone || profile.phone.trim() === "";
      const isDinner = event.event_category === "dinner";
      // null/undefined = never asked → show dialog. [] = "no allergies" (valid). ["x"] = has allergens (valid)
      const needsAllergens = isDinner && (profile?.allergens === null || profile?.allergens === undefined);

      if (needsPhone || needsAllergens) {
        // Pre-popola con i dati già esistenti
        setProfilePhone(profile?.phone || "");
        setProfileAllergens(Array.isArray(profile?.allergens) ? profile.allergens : []);
        setShowProfileDialog(true);
        return;
      }
    } catch (err) {
      console.error("[EventCard] Error checking profile:", err);
    }

    await doParticipate();
  };

  const displayName = partner.business_name ||
    `${partner.first_name || ""} ${partner.last_name || ""}`.trim() ||
    "Partner";

  const formattedDate = format(new Date(event.start_date), "d MMM yyyy, HH:mm", { locale: it });

  return (
    <>
      <div className="bg-card rounded-2xl overflow-hidden shadow-sm border">
        {/* Header con info partner */}
        <div className="flex items-center gap-3 p-4">
          <Avatar className="h-10 w-10">
            <AvatarImage src={optimizedImage(partner.avatar_url, "avatar") || undefined} />
            <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-semibold text-sm">{displayName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formattedDate}
            </p>
          </div>
          {(event.discount_percentage ?? 0) > 0 && (
            <div className="bg-primary text-primary-foreground px-2 py-1 rounded-full text-xs font-bold">
              -{event.discount_percentage}%
            </div>
          )}
        </div>

        {/* Media */}
        {event.media_type === "video" && event.video_url ? (
          <div className="relative aspect-video bg-black">
            {videoLoading && (
              <div className="absolute inset-0 bg-muted animate-pulse" />
            )}
            <video
              src={event.video_url}
              className="w-full h-full object-cover"
              controls
              playsInline
              muted
              onLoadedData={() => setVideoLoading(false)}
            />
          </div>
        ) : event.image_url ? (
          <div className="relative aspect-video">
            <img
              src={optimizedImage(event.image_url, "feed")}
              alt={event.title}
              className="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <Calendar className="w-16 h-16 text-primary/40" />
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-3">
          <div>
            <h3 className="font-bold text-lg">{event.title}</h3>
            {event.description && (
              <EventDescription text={event.description} />
            )}
          </div>

          {/* Stats — click to open participants list */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={openParticipantsDialog}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Users className="w-4 h-4" />
              <span>{participantsCount} {t("events.participants")}</span>
            </button>
          </div>

          {/* Action Buttons */}
          {!isPartner && (
            <div className="flex gap-2">
              <Button
                onClick={handleParticipate}
                disabled={loading}
                className="flex-1"
                variant={isParticipating ? "outline" : "default"}
              >
                {loading ? (
                  <span className="animate-spin">⏳</span>
                ) : isParticipating ? (
                  <>
                    <Ticket className="w-4 h-4 mr-2" />
                    {t("events.viewTicket")}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {t("events.participate")}
                  </>
                )}
              </Button>
              <Button
                onClick={openParticipantsDialog}
                variant="outline"
                size="icon"
                title={t("events.viewParticipants") || "Vedi partecipanti"}
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Participants Bottom Sheet */}
      <Sheet open={showParticipantsDialog} onOpenChange={setShowParticipantsDialog}>
        <SheetContent side="bottom" className="max-h-[85vh]">
          <div className="flex-shrink-0 px-5 pt-2 pb-3">
            <SheetHeader>
              <SheetTitle className="text-left text-xl font-bold tracking-tight flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                {t("events.participants") || "Partecipanti"}
                <span className="ml-1 inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-bold text-primary tabular-nums">
                  {participantsCount}
                </span>
              </SheetTitle>
              <SheetDescription className="text-left truncate">
                {event.title}
              </SheetDescription>
            </SheetHeader>
          </div>

          <div className="mx-5 h-px flex-shrink-0 bg-border" />

          <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
            {participantsLoading && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {t("common.loading") || "Caricamento..."}
              </div>
            )}
            {!participantsLoading && participants.length === 0 && (
              <EmptyState
                icon={Users}
                title={t("events.noParticipantsYet") || "Nessun partecipante ancora."}
                variant="primary"
              />
            )}
            {!participantsLoading && participants.length > 0 && (
              <ul className="space-y-2">
                {participants.map((p, index) => {
                  const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ") || "Usuario";
                  const initials = [p.first_name, p.last_name]
                    .filter(Boolean)
                    .map((s) => (s as string).charAt(0).toUpperCase())
                    .join("") || "?";
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-muted/40"
                    >
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold tabular-nums text-primary">
                        {index + 1}
                      </span>
                      <Avatar className="h-12 w-12 flex-shrink-0 ring-2 ring-border ring-offset-2 ring-offset-background">
                        <AvatarImage src={optimizedImage(p.profile_image_url, "avatar") || undefined} alt={fullName} />
                        <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-tight">{fullName}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* QR Code Modal */}
      {qrCode && (
        <QRCodeModal
          isOpen={showQR}
          onClose={() => setShowQR(false)}
          code={qrCode}
          eventTitle={event.title}
          partnerName={displayName}
          discount={event.discount_percentage || 0}
          validUntil={event.end_date}
        />
      )}

      {/* Phone & Allergens Dialog */}
      <PhoneAllergensDialog
        open={showProfileDialog}
        currentUserId={currentUserId}
        initialPhone={profilePhone}
        initialAllergens={profileAllergens}
        requireAllergens={event.event_category === "dinner"}
        onConfirm={() => {
          setShowProfileDialog(false);
          doParticipate();
        }}
      />
    </>
  );
};

export default EventCard;
