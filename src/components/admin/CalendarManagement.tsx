import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Calendar as CalendarIcon,
  MapPin,
  Plus,
  Search,
  Pencil,
  Trash2,
  Globe2,
  EyeOff,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { COUNTRIES, getCitiesForCountry, DEFAULT_COUNTRY } from "@/constants/countries";
import { DEFAULT_CITY } from "@/constants/spanishCities";
import CreateEventDialog from "@/components/partner/CreateEventDialog";
import { useInvalidateEvents } from "@/hooks/useEvents";
import { optimizedImage } from "@/lib/image";

interface PartnerLite {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  city: string | null;
  country: string | null;
}

interface AdminEventRow {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  video_url: string | null;
  media_type: string | null;
  start_date: string;
  end_date: string;
  discount_percentage: number | null;
  daily_scan_limit: number | null;
  event_category: string | null;
  partner_id: string;
  city: string | null;
  country: string | null;
  location_name: string | null;
  price: number | null;
  show_in_social_feed: boolean;
  show_in_calendar: boolean;
  is_active: boolean;
  partner?: PartnerLite | null;
}

const CalendarManagement = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateEvents();

  const [country, setCountry] = useState<string>(
    () => localStorage.getItem("admin_calendar_country") || DEFAULT_COUNTRY
  );
  const [city, setCity] = useState<string>(
    () => localStorage.getItem("admin_calendar_city") || DEFAULT_CITY
  );
  const [partnerSearch, setPartnerSearch] = useState("");

  const [partners, setPartners] = useState<PartnerLite[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogPartner, setDialogPartner] = useState<PartnerLite | null>(null);
  const [editingEvent, setEditingEvent] = useState<AdminEventRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminEventRow | null>(null);

  const cities = useMemo(() => getCitiesForCountry(country), [country]);

  useEffect(() => {
    localStorage.setItem("admin_calendar_country", country);
  }, [country]);
  useEffect(() => {
    localStorage.setItem("admin_calendar_city", city);
  }, [city]);

  // Load partners filtered by selected city/country.
  // Two-step query (avoids relying on PostgREST relation embedding between
  // profiles and user_roles, which sometimes isn't in the schema cache).
  // Note: profiles.city/.country = client's residence (used by the
  // user signup flow). Partners populate business_city/business_country
  // during onboarding and may leave city/country null. We filter and
  // alias on the business_* pair so newly onboarded partners appear.
  const loadPartners = async () => {
    setPartnersLoading(true);
    try {
      const { data: roleRows, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "partner");
      if (rolesErr) throw rolesErr;

      const partnerIds = [...new Set((roleRows ?? []).map((r) => r.user_id))];
      if (partnerIds.length === 0) {
        setPartners([]);
        return;
      }

      let query = supabase
        .from("profiles")
        .select(
          "id, business_name, first_name, last_name, profile_image_url, city:business_city, country:business_country"
        )
        .in("id", partnerIds)
        .order("business_name", { ascending: true })
        .limit(200);

      if (city) query = query.filter("business_city", "ilike", city);
      if (country) query = query.filter("business_country", "eq", country);

      const { data, error } = await query;
      if (error) throw error;
      setPartners((data ?? []) as unknown as PartnerLite[]);
    } catch (e: any) {
      toast({
        title: t("common.error", "Error"),
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setPartnersLoading(false);
    }
  };

  useEffect(() => {
    loadPartners();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country]);

  // Realtime: when a new partner is registered (user_roles insert) or
  // when an existing partner updates their business city, re-fetch the
  // list so the admin sees them immediately without needing a refresh.
  useEffect(() => {
    const channel = supabase
      .channel("admin-calendar-partners")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: "role=eq.partner" },
        () => loadPartners()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => loadPartners()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country]);

  // Load active events for the selected city.
  const reloadEvents = async () => {
    setEventsLoading(true);
    try {
      const now = new Date().toISOString();
      let query = supabase
        .from("events")
        .select("*")
        .eq("type", "event")
        .eq("is_active", true)
        .gte("end_date", now)
        .order("start_date", { ascending: true });
      if (city) query = query.filter("city", "ilike", city);
      if (country) query = query.filter("country", "eq", country);

      const { data: eventsData, error } = await query;
      if (error) throw error;

      const list = (eventsData ?? []) as AdminEventRow[];
      const partnerIds = [...new Set(list.map((e) => e.partner_id))];
      let profilesMap = new Map<string, PartnerLite>();
      if (partnerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, business_name, first_name, last_name, profile_image_url, city, country")
          .in("id", partnerIds);
        profilesMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      }
      setEvents(list.map((e) => ({ ...e, partner: profilesMap.get(e.partner_id) ?? null })));
    } catch (e: any) {
      toast({ title: t("common.error", "Error"), description: e?.message, variant: "destructive" });
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    reloadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country]);

  // Realtime: any event change refreshes the list.
  useEffect(() => {
    const channel = supabase
      .channel("admin-calendar-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        reloadEvents();
        invalidateAll();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country]);

  const partnerName = (p: PartnerLite | null | undefined) =>
    p?.business_name ||
    [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ||
    "Partner";

  const filteredPartners = partners.filter((p) => {
    const q = partnerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.business_name ?? "").toLowerCase().includes(q) ||
      (p.first_name ?? "").toLowerCase().includes(q) ||
      (p.last_name ?? "").toLowerCase().includes(q)
    );
  });

  const openCreateForPartner = (p: PartnerLite) => {
    setDialogPartner(p);
    setEditingEvent(null);
    setDialogOpen(true);
  };

  const openEdit = (ev: AdminEventRow) => {
    setDialogPartner(ev.partner ?? null);
    setEditingEvent(ev);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from("events").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast({ title: t("common.success", "OK"), description: t("events.deleted", "Evento eliminado") });
      setDeleteTarget(null);
      reloadEvents();
      invalidateAll();
    } catch (e: any) {
      toast({ title: t("common.error", "Error"), description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      {/* Quick-link al Calendar pubblico — vediamo subito la pagina
          come la vedono gli utenti senza dover scrivere l'URL. */}
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between rounded-2xl"
        onClick={() => navigate("/calendar")}
      >
        <span className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          {t("admin.calendar.openPublic", "Abrir Calendar público")}
        </span>
        <ExternalLink className="h-4 w-4 text-muted-foreground" />
      </Button>

      {/* Country + City selector */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-primary" />
          {t("admin.calendar.cityPickerTitle", "Selecciona ciudad")}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              const list = getCitiesForCountry(e.target.value);
              if (list.length > 0 && !list.some((c) => c.name === city)) {
                setCity(list[0].name);
              }
            }}
            className="ios-input h-10 rounded-xl border bg-background px-3 text-sm"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="ios-input h-10 rounded-xl border bg-background px-3 text-sm"
          >
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Partners section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">
            {t("admin.calendar.partnersTitle", "Partners en {{city}}", { city })}
          </h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {partners.length}
          </span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={partnerSearch}
            onChange={(e) => setPartnerSearch(e.target.value)}
            placeholder={t("admin.calendar.searchPartner", "Buscar partner...")}
            className="ios-input pl-9"
          />
        </div>

        {partnersLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredPartners.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t("admin.calendar.noPartners", "No hay partners en esta ciudad.")}
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredPartners.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm"
              >
                <Avatar className="h-11 w-11 ring-2 ring-border">
                  <AvatarImage
                    src={optimizedImage(p.profile_image_url, "avatar") || undefined}
                  />
                  <AvatarFallback className="bg-primary/10 text-sm font-bold text-primary">
                    {partnerName(p).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{partnerName(p)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.city || "—"} · {p.country || "—"}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => openCreateForPartner(p)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("admin.calendar.newEvent", "Evento")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Events section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <CalendarIcon className="h-4 w-4 text-primary" />
            {t("admin.calendar.eventsTitle", "Próximos eventos en {{city}}", { city })}
          </h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {events.length}
          </span>
        </div>

        {eventsLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            {t("admin.calendar.noEvents", "Aún no hay eventos activos en esta ciudad.")}
          </div>
        ) : (
          <ul className="space-y-3">
            {events.map((ev) => {
              const startStr = format(new Date(ev.start_date), "EEE d MMM, HH:mm", { locale: es });
              const endStr = format(new Date(ev.end_date), "HH:mm");
              return (
                <li
                  key={ev.id}
                  className="flex items-start gap-3 rounded-2xl border bg-card p-3 shadow-sm"
                >
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-muted">
                    {ev.image_url ? (
                      <img
                        src={optimizedImage(ev.image_url, "feed")}
                        alt={ev.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold leading-tight">{ev.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {partnerName(ev.partner)}
                    </p>
                    <p className="mt-1 text-xs capitalize text-foreground">
                      {startStr} → {endStr}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {ev.show_in_social_feed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                          <Globe2 className="h-3 w-3" />
                          {t("admin.calendar.inSocial", "En Home Social")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
                          <EyeOff className="h-3 w-3" />
                          {t("admin.calendar.calendarOnly", "Solo Calendar")}
                        </span>
                      )}
                      {(ev.discount_percentage ?? 0) > 0 && (
                        <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-600">
                          -{ev.discount_percentage}%
                        </span>
                      )}
                      {ev.location_name && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {ev.location_name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full"
                      onClick={() => openEdit(ev)}
                      title={t("common.edit", "Editar")}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(ev)}
                      title={t("common.delete", "Eliminar")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create / edit dialog — admin acts on behalf of selected partner */}
      {dialogPartner && (
        <CreateEventDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setDialogPartner(null);
              setEditingEvent(null);
            }
          }}
          partnerId={dialogPartner.id}
          partnerCity={dialogPartner.city ?? city}
          partnerCountry={dialogPartner.country ?? country}
          partnerName={partnerName(dialogPartner)}
          mode="calendar"
          event={editingEvent as any}
          onSuccess={() => {
            reloadEvents();
            invalidateAll();
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.calendar.deleteTitle", "¿Eliminar este evento?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "admin.calendar.deleteDescription",
                "Desaparecerá del Calendar y del feed social. Esta acción no se puede deshacer."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              {t("common.delete", "Eliminar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CalendarManagement;
