import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Music,
  Plus,
  Send,
  Sparkles,
  Ticket as TicketIcon,
  Trash2,
  Upload,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
 * FestivalBuilder — wizard por fases para festival multi-día.
 *
 * Reemplaza el formulario antiguo "long-scroll" con un stepper de 6 fases:
 *   01 Datos del festival
 *   02 Ubicación
 *   03 Días del festival (con TicketTiersBuilder por día)
 *   04 Pase completo
 *   05 Póster
 *   06 Resumen + publicación
 *
 * Modelo de datos (post-migration 20260513180000):
 *   - 1 evento PADRE con `is_festival = true`, date_start = primer día,
 *     date_end = último día. Contiene info común (nombre, ciudad, venue,
 *     dirección, póster, descripción) + ticket_tier "Pase completo".
 *   - 1 evento HIJO por día con `festival_parent_id = <parent.id>`,
 *     date_start = ese día con su hora, y su propio conjunto de ticket_tiers.
 *
 * Rollback manual: si falla cualquier insert, DELETE padre →
 * CASCADE limpia hijos via festival_parent_id ON DELETE CASCADE.
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

interface StepDef {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  { id: "info", label: "Festival", icon: <TicketIcon className="h-3.5 w-3.5" /> },
  { id: "location", label: "Ubicación", icon: <MapPin className="h-3.5 w-3.5" /> },
  { id: "days", label: "Días", icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { id: "pass", label: "Pase completo", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "media", label: "Póster", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: "review", label: "Resumen", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
];

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

  const [step, setStep] = useState(0);
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
      setStep(0);
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo subir la imagen.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Per-step validation
  const validateStep = (idx: number, statusForFinal: "draft" | "published" = "draft"): string | null => {
    if (idx === 0) {
      if (!name.trim()) return "El festival necesita un nombre";
    }
    if (idx === 1) {
      if (!city.trim()) return "Selecciona la ciudad del festival";
      if (!address.trim()) return "Añade la dirección exacta";
    }
    if (idx === 2) {
      if (days.length === 0) return "Añade al menos un día";
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        if (!d.date) return `Falta la fecha del Día ${i + 1}`;
        if (!d.startTime) return `Falta la hora de inicio del Día ${i + 1}`;
        if (statusForFinal === "published" && d.tiers.filter((t) => t.active).length === 0) {
          return `Día ${i + 1} sin tickets activos — añade al menos uno`;
        }
        for (const t of d.tiers) {
          if (!t.name.trim()) return `Día ${i + 1}: hay un ticket sin nombre`;
          const p = parseFloat(t.priceEur);
          if (!Number.isFinite(p) || p < 0)
            return `Día ${i + 1}: el precio de "${t.name}" no es válido`;
        }
      }
    }
    if (idx === 3) {
      for (const t of passTiers) {
        if (!t.name.trim()) return "El pase completo necesita un nombre";
        const p = parseFloat(t.priceEur);
        if (!Number.isFinite(p) || p < 0)
          return `Pase completo: el precio de "${t.name}" no es válido`;
      }
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast({ title: "Falta algo", description: err, variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  const submit = async (status: "draft" | "published") => {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i, status);
      if (err) {
        toast({ title: "Faltan datos", description: err, variant: "destructive" });
        setStep(i);
        return;
      }
    }
    setSubmitting(true);
    let parentId: string | null = null;
    try {
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

      const allActiveTierPrices = [
        ...days.flatMap((d) => d.tiers),
        ...passTiers,
      ]
        .filter((t) => t.active)
        .map((t) => Math.round(parseFloat(t.priceEur || "0") * 100));
      const minPriceCents =
        allActiveTierPrices.length > 0 ? Math.min(...allActiveTierPrices) : 0;

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
    } catch (e: unknown) {
      if (parentId) {
        await supabase.from("events").delete().eq("id", parentId);
      }
      setSubmitting(false);
      const msg = e instanceof Error ? e.message : "Algo falló y se ha descartado todo.";
      toast({
        title: "Error al crear festival",
        description: msg,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-4xl lg:max-w-6xl"
        style={{
          maxHeight: "calc(100dvh - 32px)",
          height: "min(880px, calc(100dvh - 32px))",
        }}
      >
        <DialogTitle className="sr-only">Festival multi-día</DialogTitle>

        <div className="flex h-full flex-col">
          {/* Header */}
          <header className="border-b border-border bg-card/60 px-5 py-4 md:px-7 md:py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <span className="inline-block h-px w-5 bg-orange-500/70" />
                  Festival multi-día
                </div>
                <h2 className="truncate text-xl font-bold leading-tight tracking-tight md:text-2xl">
                  Monta tu{" "}
                  <span style={serif} className="text-orange-500">
                    festival
                  </span>{" "}
                  día a día
                </h2>
              </div>
              <div
                className="hidden shrink-0 rounded-full border border-border bg-card px-3 py-1 text-[10px] uppercase text-muted-foreground sm:inline-flex"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                Paso {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
              </div>
            </div>

            {/* Stepper */}
            <ol className="mt-4 flex items-center gap-1.5 overflow-x-auto">
              {STEPS.map((s, i) => {
                const done = i < step;
                const current = i === step;
                return (
                  <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (i <= step) {
                          setStep(i);
                          return;
                        }
                        for (let k = step; k < i; k++) {
                          const err = validateStep(k);
                          if (err) {
                            toast({ title: "Completa el paso", description: err, variant: "destructive" });
                            return;
                          }
                        }
                        setStep(i);
                      }}
                      className={`group inline-flex min-w-0 flex-1 items-center gap-2 rounded-full border px-2.5 py-1 text-left transition ${
                        current
                          ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                          : done
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                          : "border-border bg-card/50 text-muted-foreground hover:border-orange-500/30"
                      }`}
                      aria-current={current ? "step" : undefined}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          current
                            ? "bg-orange-500/30"
                            : done
                            ? "bg-emerald-500/30"
                            : "bg-muted"
                        }`}
                        style={mono}
                      >
                        {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                      </span>
                      <span
                        className={`truncate text-[10px] uppercase ${current ? "font-semibold" : "font-medium"}`}
                        style={{ ...mono, letterSpacing: "0.18em" }}
                      >
                        {s.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </header>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-8">
            {step === 0 && (
              <StepShell
                eyebrow="Paso 01"
                title={<>Cuéntanos qué <span style={serif} className="text-orange-500">festival</span> es.</>}
                subtitle="El nombre y la descripción son comunes a todos los días del festival."
              >
                <div className="mx-auto max-w-2xl space-y-5">
                  <div>
                    <Label className="text-xs">Nombre del festival *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Pasify Summer · Ibiza 2026"
                      disabled={submitting}
                      className="mt-1.5 h-11"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Descripción</Label>
                    <Textarea
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Concepto del festival, line-up general, edad mínima…"
                      disabled={submitting}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </StepShell>
            )}

            {step === 1 && (
              <StepShell
                eyebrow="Paso 02"
                title={<>¿Dónde es el <span style={serif} className="text-orange-500">festival</span>?</>}
                subtitle="Misma ubicación para todos los días."
              >
                <div className="mx-auto max-w-2xl">
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
                      <Label className="flex items-center gap-2 text-xs">
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
                </div>
              </StepShell>
            )}

            {step === 2 && (
              <StepShell
                eyebrow="Paso 03"
                title={<>Días del <span style={serif} className="text-orange-500">festival</span>.</>}
                subtitle="Cada día se crea como un evento hijo independiente con sus propios tickets."
              >
                <div className="mx-auto max-w-4xl space-y-4">
                  {days.map((day, idx) => (
                    <article
                      key={day._key}
                      className="rounded-2xl border border-border bg-card/40 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
                          <Label className="flex items-center gap-1.5 text-xs">
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
                          <Label className="flex items-center gap-1.5 text-xs">
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
              </StepShell>
            )}

            {step === 3 && (
              <StepShell
                eyebrow="Paso 04"
                title={<>Pase <span style={serif} className="text-orange-500">completo</span>.</>}
                subtitle="Tickets que dan acceso a todos los días del festival. Se venden como un único QR por comprador."
              >
                <div className="mx-auto max-w-3xl">
                  <TicketTiersBuilder
                    tiers={passTiers}
                    onChange={setPassTiers}
                    disabled={submitting}
                  />
                </div>
              </StepShell>
            )}

            {step === 4 && (
              <StepShell
                eyebrow="Paso 05"
                title={<>Póster del <span style={serif} className="text-orange-500">festival</span>.</>}
                subtitle="La misma imagen 16:9 se usa para el festival completo y para cada día. JPG, PNG o WEBP."
              >
                <div className="mx-auto max-w-3xl">
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
                        className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
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
                          <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
                          Subiendo imagen…
                        </>
                      ) : (
                        <>
                          <Upload className="h-7 w-7 text-orange-500" />
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
                </div>
              </StepShell>
            )}

            {step === 5 && (
              <StepShell
                eyebrow="Paso 06"
                title={<>Revisa antes de <span style={serif} className="text-orange-500">publicar</span>.</>}
                subtitle="Comprueba que toda la información del festival es correcta antes de guardar o publicar."
              >
                <div className="mx-auto max-w-3xl space-y-5">
                  <ReviewRow label="Nombre" value={name || "—"} />
                  <ReviewRow
                    label="Días"
                    value={`${days.length} ${days.length === 1 ? "día" : "días"}`}
                  />
                  <ReviewRow label="Ubicación" value={[venueName, address, city].filter(Boolean).join(" · ") || "—"} />
                  <ReviewRow
                    label="Tickets activos"
                    value={`${totalActiveTickets}${minPriceEur != null ? ` · desde ${minPriceEur.toFixed(2)}€` : ""}`}
                  />
                  <ReviewRow
                    label="Pase completo"
                    value={`${passTiers.filter((t) => t.active).length} tipo${passTiers.filter((t) => t.active).length === 1 ? "" : "s"}`}
                  />

                  <div className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-start gap-3">
                      <Switch
                        checked={willPublish}
                        onCheckedChange={setWillPublish}
                        disabled={submitting}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          {willPublish ? (
                            <>
                              <Eye className="h-4 w-4 text-orange-500" />
                              Publicar al guardar
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                              Guardar como borrador
                            </>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          {willPublish
                            ? "Festival y todos los días serán visibles y comprables."
                            : "Festival privado hasta que lo publiques manualmente."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-start gap-2 rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 text-[11px] leading-relaxed text-orange-200"
                  >
                    <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-orange-500" />
                    <span>
                      Al guardar se crearán {days.length + 1} eventos en
                      Supabase (1 festival padre + {days.length}{" "}
                      día{days.length === 1 ? "" : "s"} hijo) y{" "}
                      {totalActiveTickets} tipo{totalActiveTickets === 1 ? "" : "s"} de
                      ticket. Si algo falla se hace rollback automático.
                    </span>
                  </div>
                </div>
              </StepShell>
            )}
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between gap-2 border-t border-border bg-card/60 px-5 py-3 md:px-7">
            <Button
              variant="ghost"
              type="button"
              onClick={goPrev}
              disabled={submitting || step === 0}
              className="h-10"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Anterior
            </Button>

            <div className="flex items-center gap-2">
              {step < STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={submitting}
                  className="h-10"
                  style={{
                    background:
                      "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 16px -6px rgba(232,84,42,0.5)",
                    color: "#fff",
                  }}
                >
                  Siguiente
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={submitting}
                    onClick={() => submit("draft")}
                    className="h-10"
                  >
                    {submitting ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : null}
                    Guardar borrador
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => submit(willPublish ? "published" : "draft")}
                    className="h-10"
                    style={{
                      background:
                        "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 30px -10px rgba(232,84,42,0.55)",
                      color: "#fff",
                    }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        Creando festival…
                      </>
                    ) : willPublish ? (
                      <>
                        <Send className="mr-1.5 h-4 w-4" />
                        Publicar festival
                      </>
                    ) : (
                      <>
                        <CalendarPlus className="mr-1.5 h-4 w-4" />
                        Guardar borrador
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =================================================================
// Sub-componentes
// =================================================================

const StepShell = ({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-6">
    <header className="mx-auto max-w-3xl text-center md:text-left">
      <div
        className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        <span className="inline-block h-px w-5 bg-orange-500/70" />
        {eyebrow}
      </div>
      <h3 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-[15px]">
        {subtitle}
      </p>
    </header>
    {children}
  </div>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start gap-4 border-b border-border/60 pb-4">
    <div
      className="w-32 shrink-0 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="flex-1 text-sm font-medium text-foreground">{value}</div>
  </div>
);

export default FestivalBuilder;
