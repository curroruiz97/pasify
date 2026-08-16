import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Download, Users, Calendar, FileText, Loader2, CheckCircle2, Phone, AlertTriangle } from "lucide-react";
import { ParticipantSkeleton, SkeletonList } from "@/components/ui/skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es, it, enUS, fr, de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";

const dateLocales: Record<string, any> = {
  es: es,
  it: it,
  en: enUS,
  fr: fr,
  de: de,
};

interface Participant {
  id: string;
  created_at: string;
  user_id: string;
  scanned: boolean;
  scan_count: number;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    profile_image_url: string | null;
    phone: string | null;
    allergens: string[] | null;
  };
}

interface EventParticipantsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: {
    id: string;
    title: string;
    start_date: string;
    end_date: string;
    event_category?: string | null;
  };
}

const EventParticipants = ({ open, onOpenChange, event }: EventParticipantsProps) => {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const currentLocale = dateLocales[i18n.language] || es;

  useEffect(() => {
    if (open) {
      fetchParticipants();
    }
  }, [open, event.id]);

  const fetchParticipants = async () => {
    setLoading(true);
    try {
      const { data: participantsData, error } = await supabase
        .from("event_participants")
        .select("id, created_at, user_id")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (participantsData && participantsData.length > 0) {
        // Fetch profiles separately
        const userIds = participantsData.map(p => p.user_id);
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email, profile_image_url, phone, allergens")
          .in("id", userIds);

        // Read daily scan limit so we only count valid scans (cap per day)
        const { data: eventMeta } = await supabase
          .from("events")
          .select("daily_scan_limit")
          .eq("id", event.id)
          .single();
        const dailyLimit = Math.max(1, (eventMeta as any)?.daily_scan_limit || 1);

        // Fetch all scan rows; we'll cap per-day at dailyLimit so
        // extra/duplicate rows (errori) non vengono contati
        const { data: scansData } = await supabase
          .from("discount_scans")
          .select("client_id, scanned_at")
          .eq("event_id", event.id);

        const perClientPerDay = new Map<string, Map<string, number>>();
        (scansData || []).forEach((s: any) => {
          const day = (s.scanned_at as string).slice(0, 10); // YYYY-MM-DD
          let days = perClientPerDay.get(s.client_id);
          if (!days) {
            days = new Map<string, number>();
            perClientPerDay.set(s.client_id, days);
          }
          days.set(day, (days.get(day) || 0) + 1);
        });

        const scanCountMap = new Map<string, number>();
        perClientPerDay.forEach((days, clientId) => {
          let validTotal = 0;
          days.forEach((count) => {
            validTotal += Math.min(count, dailyLimit);
          });
          scanCountMap.set(clientId, validTotal);
        });

        const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
        const participantsWithProfiles = participantsData.map(p => {
          const count = scanCountMap.get(p.user_id) || 0;
          return {
            ...p,
            profiles: profilesMap.get(p.user_id) || null,
            scanned: count > 0,
            scan_count: count,
          };
        });
        setParticipants(participantsWithProfiles as any);
      } else {
        setParticipants([]);
      }
    } catch (error: any) {
      console.error("Error fetching participants:", error);
      toast({
        title: t("common.error"),
        description: t("participants.cannotLoadParticipants"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const exportToPDF = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF();

      // Header
      doc.setFontSize(20);
      doc.text(event.title, 14, 22);

      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(
        `${format(new Date(event.start_date), "d MMMM yyyy, HH:mm", { locale: currentLocale })}`,
        14,
        32
      );
      const scannedTotal = participants.filter((p) => p.scanned).length;
      doc.text(
        `${t("participants.totalParticipants")}: ${participants.length}    ${t("participants.checkedIn")}: ${scannedTotal} / ${participants.length}`,
        14,
        40
      );

      // Table
      const isDinner = event.event_category === "dinner";
      const tableData = participants.map((p, index) => {
        const checkCell = p.scanned
          ? p.scan_count > 1
            ? `V x${p.scan_count}`
            : "V"
          : "-";
        const row = [
          (index + 1).toString(),
          `${p.profiles?.first_name || ""} ${p.profiles?.last_name || ""}`.trim() || "N/A",
          p.profiles?.email || "N/A",
          p.profiles?.phone || "-",
          format(new Date(p.created_at), "dd/MM/yyyy HH:mm"),
          checkCell,
        ];
        if (isDinner) {
          row.push(
            p.profiles?.allergens?.length
              ? p.profiles.allergens.join(", ")
              : t("participants.noAllergens")
          );
        }
        return row;
      });

      const tableHead = [
        "#",
        t("participants.name"),
        t("participants.email"),
        t("participants.phone"),
        t("participants.registration"),
        t("participants.checkIn"),
      ];
      if (isDinner) {
        tableHead.push(t("participants.allergens"));
      }

      const checkInColIndex = 5;
      autoTable(doc, {
        startY: 50,
        head: [tableHead],
        body: tableData,
        theme: "striped",
        headStyles: {
          fillColor: [79, 70, 229],
          textColor: 255,
        },
        styles: {
          fontSize: 9,
        },
        didParseCell: (data) => {
          if (
            data.section === "body" &&
            data.column.index === checkInColIndex &&
            typeof data.cell.raw === "string" &&
            data.cell.raw.startsWith("V")
          ) {
            data.cell.styles.textColor = [22, 163, 74];
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.halign = "center";
          } else if (
            data.section === "body" &&
            data.column.index === checkInColIndex
          ) {
            data.cell.styles.halign = "center";
            data.cell.styles.textColor = [150, 150, 150];
          } else if (
            data.section === "head" &&
            data.column.index === checkInColIndex
          ) {
            data.cell.styles.halign = "center";
          }
        },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(
          `${t("participants.page")} ${i} ${t("participants.of")} ${pageCount} - ${t("participants.generatedOn")} ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
          14,
          doc.internal.pageSize.height - 10
        );
      }

      const fileName = `partecipanti-${event.title.replace(/\s+/g, "-").toLowerCase()}.pdf`;

      if (Capacitor.isNativePlatform()) {
        // Guardamos en el directorio privado de cache de la app y delegamos en
        // la hoja de compartir del sistema, que deja al usuario mandarlo por
        // WhatsApp/email o guardarlo donde quiera.
        //
        // Antes esto pedia el permiso `publicStorage` y escribia en
        // Directory.ExternalStorage → `Download/`. Desde Android 11 (API 30) el
        // scoped storage bloquea esa ruta salvo con MANAGE_EXTERNAL_STORAGE, un
        // permiso que Google Play restringe severamente y que la app no
        // declara. Resultado: requestPermissions() devolvia denied y la
        // exportacion moria con "Storage permission denied" — un boton que
        // fallaba siempre en el movil. Cache + Share no necesita permisos.
        const pdfBase64 = doc.output("datauristring").split(",")[1];

        await Filesystem.writeFile({
          path: fileName,
          data: pdfBase64,
          directory: Directory.Cache,
          recursive: true,
        });

        const { uri } = await Filesystem.getUri({
          path: fileName,
          directory: Directory.Cache,
        });

        await Share.share({
          title: fileName,
          files: [uri],
        });

        toast({
          title: t("participants.pdfGenerated"),
        });
      } else {
        // On web, use the standard save method
        doc.save(fileName);
        toast({
          title: t("participants.pdfGenerated"),
          description: t("participants.pdfDownloaded"),
        });
      }
    } catch (error: any) {
      console.error("Error exporting PDF:", error);
      toast({
        title: t("common.error"),
        description: t("participants.cannotGeneratePDF"),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const getDisplayName = (p: Participant) => {
    const name = `${p.profiles?.first_name || ""} ${p.profiles?.last_name || ""}`.trim();
    return name || p.profiles?.email || t("participants.user");
  };

  const getInitials = (p: Participant) => {
    const first = p.profiles?.first_name?.charAt(0) || "";
    const last = p.profiles?.last_name?.charAt(0) || "";
    return (first + last).toUpperCase() || "U";
  };

  const checkedInCount = participants.filter((p) => p.scanned).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] h-[92vh]">
        {/* Sticky header */}
        <div className="flex-shrink-0 px-5 pt-2 pb-4">
          <SheetHeader>
            <SheetTitle className="text-left text-xl font-bold tracking-tight">
              {t("participants.title")}
            </SheetTitle>
          </SheetHeader>

          {/* Event meta */}
          <div className="mt-2 flex items-start gap-2">
            <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(event.start_date), "d MMM yyyy, HH:mm", { locale: currentLocale })}
              </p>
            </div>
          </div>

          {/* Stat cards */}
          {!loading && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">
                    {t("participants.totalParticipants")}
                  </span>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">{participants.length}</p>
              </div>
              <div className="rounded-2xl border border-green-200 bg-green-50 p-3 dark:border-green-900/40 dark:bg-green-950/30">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">
                    {t("participants.checkedIn")}
                  </span>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-green-700 dark:text-green-400">
                  {checkedInCount}
                  <span className="ml-1 text-sm font-medium text-green-600/70 dark:text-green-500/70">
                    / {participants.length}
                  </span>
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={exportToPDF}
            disabled={exporting || participants.length === 0}
            variant="outline"
            size="sm"
            className="mt-3 w-full rounded-xl"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {t("participants.exportPDF")}
          </Button>
        </div>

        <div className="mx-5 h-px flex-shrink-0 bg-border" />

        {/* Participants list */}
        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {loading ? (
            <SkeletonList count={5} Component={ParticipantSkeleton} />
          ) : participants.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("participants.noParticipantsYet")}
              variant="primary"
            />
          ) : (
            <ul className="space-y-2">
              {participants.map((p, index) => (
                <li
                  key={p.id}
                  className="rounded-2xl border bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center gap-3">
                    {/* Index pill */}
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold tabular-nums text-primary">
                      {index + 1}
                    </span>

                    {/* Avatar */}
                    <Avatar
                      className={`h-12 w-12 flex-shrink-0 ring-2 ring-offset-2 ring-offset-background ${
                        p.scanned ? "ring-green-500/60" : "ring-border"
                      }`}
                    >
                      <AvatarImage src={p.profiles?.profile_image_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                        {getInitials(p)}
                      </AvatarFallback>
                    </Avatar>

                    {/* Name + meta */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight">
                        {getDisplayName(p)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(p.created_at), "d MMM, HH:mm", { locale: currentLocale })}
                        </span>
                        {p.profiles?.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {p.profiles.phone}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    {p.scanned ? (
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-green-500/15 px-2.5 text-[11px] font-semibold text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {p.scan_count > 1 ? `×${p.scan_count}` : t("participants.checkIn")}
                        </span>
                      </div>
                    ) : (
                      <span className="flex-shrink-0 rounded-full border border-dashed px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                        —
                      </span>
                    )}
                  </div>

                  {/* Allergens (dinner only) */}
                  {event.event_category === "dinner" && (
                    <div className="mt-2.5 pl-[68px]">
                      {p.profiles?.allergens && p.profiles.allergens.length > 0 ? (
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-destructive" />
                          <div className="flex flex-wrap gap-1">
                            {p.profiles.allergens.map((allergen) => (
                              <Badge
                                key={allergen}
                                variant="destructive"
                                className="px-2 py-0 text-[10px] font-medium"
                              >
                                {allergen}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] italic text-muted-foreground">
                          {t("participants.noAllergens")}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default EventParticipants;
