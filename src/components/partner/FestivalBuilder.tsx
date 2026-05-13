import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Loader2,
  MapPin,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  TicketTiersBuilder,
  createEmptyTier,
  type TierDraft,
} from "@/components/partner/TicketTiersBuilder";
import {
  composeIsoStartEnd,
  type DateTimeValue,
} from "@/components/partner/EventDateTimeSection";

/**
 * FestivalBuilder — wizard pro de festival multi-día con persistencia real.
 *
 * Modelo de datos (post-migration 20260513180000):
 *   - Un evento PADRE con `is_festival = true`, date_start = primer día,
 *     date_end = último día. Contiene info común (nombre, ciudad, venue,
 *     dirección, póster, descripción) + ticket_tier "Pase completo".
 *   - Un evento HIJO por cada día del festival con
 *     `festival_parent_id = <parent.id>`, date_start = ese día con su hora,
 *     y su propio conjunto de ticket_tiers (early bird, VIP, etc.).
 *
 * El partner controla la puerta de cada día como cualquier evento Pasify
 * (sección Asistentes filtra por event_id). El cliente compra:
 *   - tickets por día → ticket_tiers del evento hijo
 *   - "Pase completo" → ticket_tier del evento padre (un único ticket que
 *     da acceso a todos los días — la validación en puerta usa el qr del
 *     padre y el partner ve "acceso pase completo" en Asistentes).
 *
 * Si la creación de algún día o tier falla, hacemos rollback manual
 * eliminando el padre (ON DELETE CASCADE en festival_parent_id limpia los
 * hijos). TODO: migrar a una RPC `create_festival_with_days` atómica.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

interface City {
  id: string;
  name: string;
  slug: string;
}

interface FestivalDayDraft {
  _key: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:mm
  endTime: string;    // HH:mm
  title: string;
  headliner: string;
  tiers: TierDraft[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  defaultCity?: string;
  defaultVenueName?: string;
  cities: City[];
  onCreated?: () => void;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const emptyDay = (date = "", num = 1): FestivalDayDraft => ({
  _key: newKey(),
  date,
  startTime: "23:30",
  endTime: "06:00",
  title: `Día ${num}`,
  headliner: "",
  tiers: [createEmptyTier("Entrada del día", "20.00")],
});

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDays = (iso: string, n: number): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

export const FestivalBuilder = ({
  open,
  onOpenChange,
  partnerId,
  defaultCity = "",
  defaultVenueName = "",
  cities,
  onCreated,
}: Props) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Estado
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState(defaultCity);
  const [venueName, setVenueName] = useState(defaultVenueName);
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [days, setDays] = useState<FestivalDayDraft[]>([emptyDay(todayIso(), 1)]);
  const [passTiers, setPassTiers] = useState<TierDraft[]>([
    createEmptyTier("Pase completo", "120.00"),
  ]);
  const [willPublish, setWillPublish] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      // Reset al abrir (no persiste entre aperturas)
      setName("");
      setDescription("");
      setCity(defaultCity);
      setVenueName(defaultVenueName);
      setAddress("");
      setImageUrl("");
      setDays([emptyDay(todayIso(), 1)]);
      setPassTiers([createEmptyTier("Pase completo", "120.00")]);
      setWillPublish(false);
    }
  }, [open, defaultCity, defaultVenueName]);

  const totalActiveTickets = useMemo(() => {
    const dayCount = days.reduce(
      (acc, d) => acc + d.tiers.filter((t) => t.active).length,
      0
    );
    return dayCount + passTiers.filter((t) => t.active).length;
  }, [days, passTiers]);

  const minPriceEur = useMemo(() => {
    const all = [
      ...days.flatMap((d) => d.tiers),
      ...passTiers,
    ]
      .filter((t) => t.active)
      .map((t) => parseFloat(t.priceEur))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return all.length > 0 ? Math.min(...all) : null;
  }, [days, passTiers]);

  // Día handlers
  const updateDay = (key: string, patch: Partial<FestivalDayDraft>) => {
    setDays((curr) => curr.map((d) => (d._key === key ? { ...d, ...patch } : d)));
  };
  const removeDay = (key: string) => {
    if (days.length <= 1) return;
    setDays((curr) => curr.filter((d) => d._key !== key));
  };
  const addDay = () => {
    const last = days[days.length - 1];
    const nextDate = last?.date ? addDays(last.date, 1) : todayIso();
    setDays((curr) => [...curr, emptyDay(nextDate, curr.length + 1)]);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "Máximo 8 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${partnerId}/festival-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("event-images")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("event-images").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "No se pudo subir la imagen.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const validateAll = (status: "draft" | "published"): string | null => {
    if (!name.trim()) return "El festival necesita un nombre";
    if (!city.trim()) return "Selecciona la ciudad del festival";
    if (!address.trim()) return "Añade la dirección exacta";
    if (days.length === 0) return "Añade al menos un día";
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d.date) return `Falta la fecha del Día ${i + 1}`;
      if (!d.startTime) return `Falta la hora de inicio del Día ${i + 1}`;
      if (status === "published" && d.tiers.filter((t) => t.active).length === 0) {
        return `Día ${i + 1} sin tickets activos — añade al menos uno`;
      }
      for (const t of d.tiers) {
        if (!t.name.trim()) return `Día ${i + 1}: hay un ticket sin nombre`;
        const p = parseFloat(t.priceEur);
        if (!Number.isFinite(p) || p < 0)
          return `Día ${i + 1}: el precio de "${t.name}" no es válido`;
      }
    }
    for (const t of passTiers) {
      if (!t.name.trim()) return "El pase completo necesita un nombre";
      const p = parseFloat(t.priceEur);
      if (!Number.isFinite(p) || p < 0)
        return `Pase completo: el precio de "${t.name}" no es válido`;
    }
    return null;
  };

  const submit = async (status: "draft" | "published") => {
    const err = validateAll(status);
    if (err) {
      toast({ title: "Faltan datos", description: err, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    let parentId: string | null = null;
    try {
      // Compute parent date_start (primer día start) y date_end (último día end)
      const firstDay = days[0];
      const lastDay = days[days.length - 1];
      const firstDt: DateTimeValue = {
        date: firstDay.date,
        startTime: firstDay.startTime,
        endTime: firstDay.endTime,
      };
      const lastDt: DateTimeValue = {
        date: lastDay.date,
        startTime: lastDay.startTime,
        endTime: lastDay.endTime,
      };
      const firstCompose = composeIsoStartEnd(firstDt);
      const lastCompose = composeIsoStartEnd(lastDt);

      // Min price aggregator para columna legacy
      const allActiveTierPrices = [
        ...days.flatMap((d) => d.tiers),
        ...passTiers,
      ]
        .filter((t) => t.active)
        .map((t) => Math.round(parseFloat(t.priceEur || "0") * 100));
      const minPriceCents =
        allActiveTierPrices.length > 0 ? Math.min(...allActiveTierPrices) : 0;

      // 1) INSERT parent festival event
      const { data: parent, error: parentErr } = await supabase
        .from("events")
        .insert({
          partner_id: partnerId,
          title: name.trim(),
          description: description.trim() || null,
          city: city.trim(),
          venue_name: venueName.trim() || null,
          address: address.trim() || null,
          date_start: firstCompose.startIso,
          date_end: lastCompose.endIso ?? lastCompose.startIso,
          price_cents: minPriceCents,
          capacity: null,
          image_url: imageUrl || null,
          status,
          is_festival: true,
          metadata: { kind: "festival_parent", day_count: days.length },
        })
        .select("id")
        .single();
      if (parentErr || !parent) throw parentErr ?? new Error("No se pudo crear el festival");
      parentId = parent.id;

      // 2) INSERT pase completo tiers en el padre
      if (passTiers.length > 0) {
        const passTierRows = passTiers.map((t, idx) => ({
          event_id: parent.id,
          name: t.name.trim(),
          description: t.description.trim() || "Acceso a todos los días del festival",
          price_cents: Math.round(parseFloat(t.priceEur || "0") * 100),
          currency: "EUR",
          capacity: t.capacity ? parseInt(t.capacity, 10) : null,
          per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
          status: t.active ? "active" : "hidden",
          sort_order: idx,
          metadata: { is_full_pass: true },
        }));
        const { error: passErr } = await supabase
          .from("ticket_tiers")
          .insert(passTierRows);
        if (passErr) throw passErr;
      }

      // 3) INSERT child events (uno por día) + tiers de cada día
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        const dt: DateTimeValue = {
          date: d.date,
          startTime: d.startTime,
          endTime: d.endTime,
        };
        const compose = composeIsoStartEnd(dt);
        const dayActive = d.tiers.filter((t) => t.active);
        const dayMin =
          dayActive.length > 0
            ? Math.min(
                ...dayActive.map((t) =>
                  Math.round(parseFloat(t.priceEur || "0") * 100)
                )
              )
            : 0;

        const { data: child, error: childErr } = await supabase
          .from("events")
          .insert({
            partner_id: partnerId,
            title: `${name.trim()} · ${d.title || `Día ${i + 1}`}`,
            description: d.headliner
              ? `Headliner: ${d.headliner}${description ? "\n\n" + description : ""}`
              : description.trim() || null,
            city: city.trim(),
            venue_name: venueName.trim() || null,
            address: address.trim() || null,
            date_start: compose.startIso,
            date_end: compose.endIso,
            price_cents: dayMin,
            capacity: null,
            image_url: imageUrl || null,
            status,
            festival_parent_id: parent.id,
            metadata: {
              kind: "festival_day",
              day_index: i,
              day_title: d.title,
              headliner: d.headliner || null,
            },
          })
          .select("id")
          .single();
        if (childErr || !child) throw childErr ?? new Error(`Fallo creando Día ${i + 1}`);

        const dayTierRows = d.tiers.map((t, idx) => ({
          event_id: child.id,
          name: t.name.trim(),
          description: t.description.trim() || null,
          price_cents: Math.round(parseFloat(t.priceEur || "0") * 100),
          currency: "EUR",
          capacity: t.capacity ? parseInt(t.capacity, 10) : null,
          per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
          status: t.active ? "active" : "hidden",
          sort_order: idx,
        }));
        const { error: dayTierErr } = await supabase
          .from("ticket_tiers")
          .insert(dayTierRows);
        if (dayTierErr) throw dayTierErr;
      }

      setSubmitting(false);
      toast({
        title: status === "published" ? "Festival publicado" : "Festival guardado",
        description: `${days.length} día${days.length === 1 ? "" : "s"} · ${totalActiveTickets} tipos de ticket en total.`,
      });
      onCreated?.();
      onOpenChange(false);
    } catch (e: any) {
      // Rollback manual: si fallamos parte del proceso eliminamos el padre.
      // CASCADE limpia hijos por festival_parent_id ON DELETE CASCADE.
      if (parentId) {
        await supabase.from("events").delete().eq("id", parentId);
      }
      setSubmitting(false);
      toast({
        title: "Error al crear festival",
        description: e?.message ?? "Algo falló y se ha descartado todo. Vuelve a intentarlo.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-4xl lg:max-w-5xl">
        <DialogHeader>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Festival multi-día
          </div>
          <DialogTitle className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
            Monta tu{" "}
            <span style={serif} className="text-orange-500">
              festival
            </span>{" "}
            día a día
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Info básica */}
          <FestivalSection
            number="01"
            title="Información del festival"
            subtitle="Nombre, descripción y póster son comunes a todos los días."
          >
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Nombre del festival *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pasify Summer · Ibiza 2026"
                  disabled={submitting}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-xs">Descripción</Label>
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Concepto del festival, line-up general, edad mínima…"
                  disabled={submitting}
                  className="mt-1.5"
                />
              </div>
            </div>
          </FestivalSection>

          {/* Ubicación */}
          <FestivalSection
            number="02"
            title="Ubicación"
            subtitle="Misma ubicación para todos los días."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Ciudad *</Label>
                <Select value={city} onValueChange={setCity} disabled={submitting}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Madrid" />
                  </SelectTrigger>
                  <SelectContent>
                    {cities.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Nombre del recinto</Label>
                <Input
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="Recinto Ifema"
                  disabled={submitting}
                  className="mt-1.5"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-orange-500" />
                  Ubicación exacta *
                </Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. Partenón, 5, 28042 Madrid"
                  disabled={submitting}
                  className="mt-1.5"
                />
              </div>
            </div>
          </FestivalSection>

          {/* Días */}
          <FestivalSection
            number="03"
            title={`Días del festival · ${days.length}`}
            subtitle="Cada día se crea como un evento hijo independiente con sus propios tickets."
          >
            <div className="space-y-4">
              {days.map((day, idx) => (
                <article
                  key={day._key}
                  className="rounded-2xl border border-border bg-card/40 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold"
                        style={{
                          ...mono,
                          background:
                            "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
                          color: "#FFC9B0",
                        }}
                      >
                        D{idx + 1}
                      </div>
                      <Input
                        value={day.title}
                        onChange={(e) => updateDay(day._key, { title: e.target.value })}
                        placeholder={`Día ${idx + 1}`}
                        disabled={submitting}
                        className="h-9 max-w-[200px] text-sm font-medium"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDay(day._key)}
                      disabled={submitting || days.length <= 1}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-40"
                      aria-label="Eliminar día"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="text-xs flex items-center gap-1.5">
                        <CalendarDays className="h-3 w-3 text-orange-500" />
                        Fecha *
                      </Label>
                      <Input
                        type="date"
                        value={day.date}
                        onChange={(e) => updateDay(day._key, { date: e.target.value })}
                        disabled={submitting}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Inicio *</Label>
                      <Input
                        type="time"
                        value={day.startTime}
                        onChange={(e) => updateDay(day._key, { startTime: e.target.value })}
                        disabled={submitting}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Fin</Label>
                      <Input
                        type="time"
                        value={day.endTime}
                        onChange={(e) => updateDay(day._key, { endTime: e.target.value })}
                        disabled={submitting}
                        className="mt-1.5"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Music className="h-3 w-3 text-orange-500" />
                        Headliner / artista principal
                      </Label>
                      <Input
                        value={day.headliner}
                        onChange={(e) => updateDay(day._key, { headliner: e.target.value })}
                        placeholder="DJ Snake b2b Carl Cox"
                        disabled={submitting}
                        className="mt-1.5"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <div
                      className="mb-2 text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.18em" }}
                    >
                      Tickets del día
                    </div>
                    <TicketTiersBuilder
                      tiers={day.tiers}
                      onChange={(t) => updateDay(day._key, { tiers: t })}
                      disabled={submitting}
                    />
                  </div>
                </article>
              ))}

              <button
                type="button"
                onClick={addDay}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/30 px-4 py-4 text-sm font-medium text-muted-foreground transition hover:border-orange-500/50 hover:text-orange-500 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Añadir día
              </button>
            </div>
          </FestivalSection>

          {/* Pase completo */}
          <FestivalSection
            number="04"
            title="Pase completo"
            subtitle="Ticket que da acceso a todos los días del festival. Se vende como un único QR."
          >
            <TicketTiersBuilder
              tiers={passTiers}
              onChange={setPassTiers}
              disabled={submitting}
            />
          </FestivalSection>

          {/* Imagen */}
          <FestivalSection
            number="05"
            title="Póster del festival"
            subtitle="La misma imagen 16:9 se usa para el festival completo y todos los días."
          >
            {imageUrl ? (
              <div className="relative overflow-hidden rounded-2xl border border-border">
                <img
                  src={imageUrl}
                  alt="Póster"
                  className="aspect-[16/9] w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                  aria-label="Quitar imagen"
                  disabled={submitting}
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || submitting}
                className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-sm text-muted-foreground transition hover:border-orange-500/50 hover:bg-muted/40 disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                    Subiendo imagen…
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-orange-500" />
                    <span className="font-medium text-foreground">Subir póster</span>
                    <span className="text-[11px]" style={mono}>
                      JPG · PNG · WEBP · máx. 8 MB
                    </span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleFileSelect}
            />
          </FestivalSection>

          {/* Publicación */}
          <FestivalSection
            number="06"
            title="Publicación"
            subtitle="Borrador o publicación inmediata."
          >
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={willPublish}
                  onCheckedChange={setWillPublish}
                  disabled={submitting}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {willPublish ? "Publicar al guardar" : "Guardar como borrador"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {willPublish
                      ? "Festival y todos los días serán visibles y comprables."
                      : "Festival privado hasta que lo publiques."}
                  </div>
                </div>
              </div>

              {/* Mini-stats */}
              <div
                className="flex items-center gap-3 text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                <span className="inline-flex items-center gap-1">
                  <CalendarPlus className="h-3 w-3 text-orange-500" />
                  {days.length} días
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-orange-500" />
                  {totalActiveTickets} tickets
                </span>
                {minPriceEur != null && (
                  <>
                    <span>·</span>
                    <span>Desde {minPriceEur.toFixed(2)}€</span>
                  </>
                )}
              </div>
            </div>
          </FestivalSection>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => submit("draft")}
            className="h-12 sm:w-auto"
          >
            Guardar borrador
          </Button>
          <Button
            disabled={submitting}
            onClick={() => submit(willPublish ? "published" : "draft")}
            className="h-12 sm:w-auto"
            style={{
              background: submitting
                ? undefined
                : "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
              boxShadow: submitting
                ? undefined
                : "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
              color: "#fff",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando festival…
              </>
            ) : willPublish ? (
              "Publicar festival"
            ) : (
              "Guardar borrador"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FestivalSection = ({
  number,
  title,
  subtitle,
  children,
}: {
  number: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-border bg-card/30 p-4 md:p-5">
    <div className="mb-4 flex items-start gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
        style={{
          ...mono,
          background:
            "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
          color: "#FFC9B0",
          letterSpacing: "0.05em",
        }}
      >
        {number}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-tight tracking-tight text-foreground md:text-lg">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {children}
  </section>
);

export default FestivalBuilder;
