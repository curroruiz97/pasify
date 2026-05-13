import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  Send,
  Ticket as TicketIcon,
  Upload,
  X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  TicketTiersBuilder,
  createEmptyTier,
  type TierDraft,
  type TierSales,
} from "@/components/partner/TicketTiersBuilder";
import {
  EventDateTimeSection,
  composeIsoStartEnd,
  validateDateTime,
  type DateTimeValue,
} from "@/components/partner/EventDateTimeSection";
import {
  EventLocationSection,
  validateLocation,
  type LocationValue,
} from "@/components/partner/EventLocationSection";
import {
  EventSummaryCard,
  type EventSummary,
} from "@/components/partner/EventSummaryCard";

/**
 * EventEditorWizard — wizard unificado de creación/edición/duplicación de
 * eventos para el partner.
 *
 * Modos:
 *   - "create"    → form vacío, INSERT events + INSERT ticket_tiers
 *   - "edit"      → carga evento existente y sus tiers; respeta candados
 *                   (precio bloqueado si hay ventas, no se pueden borrar
 *                   tiers vendidos, capacity no puede bajar de las ventas)
 *   - "duplicate" → carga evento + tiers como plantilla, shifta fecha +1
 *                   semana, status=draft, sin ventas (es un INSERT nuevo)
 *
 * UX por dispositivo:
 *   - Desktop (≥ lg): cabecera con stepper horizontal · contenido del paso
 *     · sidebar sticky con `EventSummaryCard` · pie con prev/next/guardar.
 *     Sin scroll vertical largo: cada paso vive en su propio pane y se
 *     navega con los botones.
 *   - Móvil: stepper compacto arriba · contenido del paso a full width ·
 *     pie sticky con prev/next. La summary card aparece sólo en el paso
 *     "Resumen" para ahorrar pantalla.
 *
 * Persistencia segura:
 *   - En "edit", al guardar:
 *       UPDATE events (campos seguros + criticos solo si no hay ventas)
 *       UPDATE ticket_tiers existentes (PRICE inmutable si tier vendido,
 *         capacity sólo puede aumentar o quedar ≥ vendidas — el trigger
 *         BD también lo enforce)
 *       INSERT ticket_tiers nuevos
 *       DELETE ticket_tiers eliminados localmente (sólo si no tienen ventas)
 *   - Si la BD rechaza un UPDATE/DELETE por trigger, mostramos el error
 *     legible en un toast sin romper el resto de la transacción manual.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export type EditorMode = "create" | "edit" | "duplicate";

interface City {
  id: string;
  name: string;
  slug: string;
}

interface Props {
  mode: EditorMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  /** Requerido en edit / duplicate */
  eventId?: string;
  cities: City[];
  defaultCity?: string;
  defaultVenueName?: string;
  /** Llamado tras guardar con éxito. */
  onSaved: () => void | Promise<void>;
}

// ============================================================================
// Steps definition — usado para stepper y validación per-step
// ============================================================================

interface StepDef {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  { id: "info", label: "Datos básicos", icon: <TicketIcon className="h-3.5 w-3.5" /> },
  { id: "when_where", label: "Cuándo y dónde", icon: <CalendarIcon className="h-3.5 w-3.5" /> },
  { id: "tickets", label: "Tipos de entrada", icon: <TicketIcon className="h-3.5 w-3.5" /> },
  { id: "media", label: "Imagen", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: "publish", label: "Publicación", icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "review", label: "Resumen", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
];

export const EventEditorWizard = ({
  mode,
  open,
  onOpenChange,
  partnerId,
  eventId,
  cities,
  defaultCity = "",
  defaultVenueName = "",
  onSaved,
}: Props) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // -----------------------------------------------------------------
  // State
  // -----------------------------------------------------------------
  const [step, setStep] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateTime, setDateTime] = useState<DateTimeValue>({
    date: "",
    startTime: "23:30",
    endTime: "06:00",
  });
  const [location, setLocation] = useState<LocationValue>({
    city: defaultCity,
    venueName: defaultVenueName,
    address: "",
  });
  const [tiers, setTiers] = useState<TierDraft[]>([
    createEmptyTier("Entrada General", "15.00"),
  ]);
  const [imageUrl, setImageUrl] = useState("");
  const [willPublish, setWillPublish] = useState(true);

  // Edit-mode: ventas reales por tier para bloqueos UI + tiers eliminados
  const [tierSalesMap, setTierSalesMap] = useState<Record<string, TierSales>>({});
  const [removedTierDbIds, setRemovedTierDbIds] = useState<Set<string>>(new Set());
  const [eventHasSales, setEventHasSales] = useState(false);

  // -----------------------------------------------------------------
  // Reset / load según mode al abrir
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setRemovedTierDbIds(new Set());

    if (mode === "create") {
      setTitle("");
      setDescription("");
      setDateTime({ date: "", startTime: "23:30", endTime: "06:00" });
      setLocation({
        city: defaultCity,
        venueName: defaultVenueName,
        address: "",
      });
      setTiers([createEmptyTier("Entrada General", "15.00")]);
      setImageUrl("");
      setWillPublish(true);
      setTierSalesMap({});
      setEventHasSales(false);
      return;
    }

    if ((mode === "edit" || mode === "duplicate") && eventId) {
      void loadForEdit(eventId, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, eventId]);

  const loadForEdit = async (eid: string, m: EditorMode) => {
    setLoadingInitial(true);
    try {
      // 1) Evento
      const { data: evt, error: evtErr } = await supabase
        .from("events")
        .select(
          "id, title, description, city, venue_name, address, date_start, date_end, image_url, status, capacity, price_cents"
        )
        .eq("id", eid)
        .maybeSingle();
      if (evtErr || !evt) throw evtErr ?? new Error("Evento no encontrado");

      // 2) Tiers
      const { data: t, error: tErr } = await supabase
        .from("ticket_tiers")
        .select("id, name, description, price_cents, capacity, per_user_max, status, sort_order")
        .eq("event_id", eid)
        .order("sort_order", { ascending: true });
      if (tErr) throw tErr;

      // 3) Ventas reales por tier (sólo en modo edit, no en duplicate)
      const salesMap: Record<string, TierSales> = {};
      let hasSales = false;
      if (m === "edit") {
        // Cast hasta que regeneremos los types post-migration.
        const rpcAny = supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>
          ) => Promise<{
            data:
              | Array<{
                  tier_id: string;
                  sold_count: number;
                  used_count: number;
                  pending_count: number;
                  has_sales: boolean;
                }>
              | null;
            error: { message: string } | null;
          }>;
        };
        const { data: stats } = await rpcAny.rpc(
          "partner_event_tier_live_stats",
          { _event_id: eid }
        );
        for (const r of stats ?? []) {
          salesMap[r.tier_id] = {
            sold: r.sold_count ?? 0,
            used: r.used_count ?? 0,
            pending: r.pending_count ?? 0,
            hasSales: !!r.has_sales,
          };
          if (r.has_sales) hasSales = true;
        }
      }

      // 4) Fecha y hora desde date_start (+ end opcional)
      const start = evt.date_start ? new Date(evt.date_start) : null;
      const end = evt.date_end ? new Date(evt.date_end) : null;

      const baseTitle = evt.title ?? "";
      const dt = (() => {
        if (!start) return { date: "", startTime: "23:30", endTime: "06:00" };
        const pad = (n: number) => String(n).padStart(2, "0");
        // Duplicate: +7 días
        const baseStart =
          m === "duplicate"
            ? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
            : start;
        const baseEnd = end
          ? m === "duplicate"
            ? new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000)
            : end
          : null;
        const date = `${baseStart.getFullYear()}-${pad(baseStart.getMonth() + 1)}-${pad(baseStart.getDate())}`;
        const startTime = `${pad(baseStart.getHours())}:${pad(baseStart.getMinutes())}`;
        const endTime = baseEnd
          ? `${pad(baseEnd.getHours())}:${pad(baseEnd.getMinutes())}`
          : "";
        return { date, startTime, endTime };
      })();

      setTitle(m === "duplicate" ? `${baseTitle} (copia)` : baseTitle);
      setDescription(evt.description ?? "");
      setDateTime(dt);
      setLocation({
        city: evt.city ?? defaultCity,
        venueName: evt.venue_name ?? defaultVenueName,
        address: evt.address ?? "",
      });
      setImageUrl(evt.image_url ?? "");
      setWillPublish(m === "edit" ? evt.status === "published" : true);
      setEventHasSales(m === "edit" ? hasSales : false);
      setTierSalesMap(salesMap);

      const draftTiers: TierDraft[] = (t ?? []).map((row, idx) => ({
        _key: `db-${row.id}`,
        dbId: m === "edit" ? row.id : undefined, // duplicate trata como nuevo
        name: row.name ?? "",
        description: row.description ?? "",
        priceEur: ((row.price_cents ?? 0) / 100).toFixed(2),
        capacity: row.capacity != null ? String(row.capacity) : "",
        perUserMax: row.per_user_max != null ? String(row.per_user_max) : "4",
        active: (row.status ?? "active") === "active",
      }));
      setTiers(
        draftTiers.length > 0
          ? draftTiers
          : [createEmptyTier("Entrada General", "15.00")]
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error cargando evento";
      toast({ title: "Error", description: msg, variant: "destructive" });
      onOpenChange(false);
    } finally {
      setLoadingInitial(false);
    }
  };

  // -----------------------------------------------------------------
  // Summary derivado
  // -----------------------------------------------------------------
  const summary: EventSummary = useMemo(() => {
    const activeTiers = tiers.filter((t) => t.active);
    const prices = activeTiers
      .map((t) => parseFloat(t.priceEur))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;

    const caps = activeTiers
      .map((t) => parseInt(t.capacity, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalCap =
      caps.length === activeTiers.length && caps.length > 0
        ? caps.reduce((a, b) => a + b, 0)
        : null;

    const { crossesMidnight } = composeIsoStartEnd(dateTime);

    return {
      title,
      city: location.city,
      venueName: location.venueName,
      address: location.address,
      date: dateTime.date,
      startTime: dateTime.startTime,
      endTime: dateTime.endTime,
      crossesMidnight,
      ticketCount: activeTiers.length,
      minPriceEur: minPrice,
      totalCapacity: totalCap,
      imageUrl: imageUrl || null,
      willPublish,
    };
  }, [title, location, dateTime, tiers, imageUrl, willPublish]);

  // -----------------------------------------------------------------
  // Validators per-step
  // -----------------------------------------------------------------
  const validateStep = useCallback(
    (idx: number): string | null => {
      if (idx === 0) {
        if (!title.trim()) return "El evento necesita un título";
      }
      if (idx === 1) {
        const dtErr = validateDateTime(dateTime);
        if (dtErr) return dtErr;
        const locErr = validateLocation(location);
        if (locErr) return locErr;
      }
      if (idx === 2) {
        const activeTiers = tiers.filter((t) => t.active);
        if (activeTiers.length === 0) {
          return "Añade al menos un tipo de ticket activo";
        }
        for (const t of tiers) {
          if (!t.name.trim()) return "Todos los tickets necesitan un nombre";
          const p = parseFloat(t.priceEur);
          if (!Number.isFinite(p) || p < 0) {
            return `El precio del ticket "${t.name}" no es válido`;
          }
          // Capacity floor vs ventas
          const sales = t.dbId ? tierSalesMap[t.dbId] : undefined;
          if (sales && t.capacity) {
            const cap = parseInt(t.capacity, 10);
            if (Number.isFinite(cap) && cap < sales.sold) {
              return `El cupo de "${t.name}" no puede ser menor que las ventas (${sales.sold}).`;
            }
          }
        }
      }
      return null;
    },
    [title, dateTime, location, tiers, tierSalesMap]
  );

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast({ title: "Falta algo", description: err, variant: "destructive" });
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  // -----------------------------------------------------------------
  // Submit handlers
  // -----------------------------------------------------------------
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
      const path = `${partnerId}/event-${Date.now()}.${ext}`;
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

  /**
   * Validación final transversal a todos los pasos (paranoia + UX para
   * cuando el usuario llega al resumen tras editar atrás).
   */
  const validateAll = (status: "draft" | "published"): string | null => {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i);
      if (err) return err;
    }
    if (status === "published" && tiers.filter((t) => t.active).length === 0) {
      return "Para publicar añade al menos un tipo de ticket activo";
    }
    return null;
  };

  const submit = async (status: "draft" | "published") => {
    const err = validateAll(status);
    if (err) {
      toast({ title: "Faltan datos", description: err, variant: "destructive" });
      return;
    }

    const { startIso, endIso } = composeIsoStartEnd(dateTime);
    if (!startIso) {
      toast({ title: "Fecha/hora inválida", variant: "destructive" });
      return;
    }

    const activeTiers = tiers.filter((t) => t.active);
    const tierPriceCents = activeTiers.map((t) =>
      Math.round(parseFloat(t.priceEur || "0") * 100)
    );
    const minPriceCents = tierPriceCents.length > 0 ? Math.min(...tierPriceCents) : 0;

    const caps = activeTiers
      .map((t) => parseInt(t.capacity, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalCap =
      caps.length === activeTiers.length && caps.length > 0
        ? caps.reduce((a, b) => a + b, 0)
        : null;

    setSubmitting(true);
    try {
      if (mode === "edit" && eventId) {
        await persistEdit(eventId, status, startIso, endIso, minPriceCents, totalCap);
      } else {
        await persistCreate(status, startIso, endIso, minPriceCents, totalCap);
      }
      toast({
        title:
          mode === "edit"
            ? status === "published"
              ? "Cambios publicados"
              : "Cambios guardados"
            : status === "published"
            ? "Evento publicado"
            : "Borrador guardado",
        description:
          status === "published"
            ? "Ya aparece en el calendario público y se puede comprar."
            : "Lo encontrarás en Mis eventos.",
      });
      await onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Error guardando";
      // Mensajes amistosos para errores de trigger BD
      const friendly =
        raw.includes("Cannot change price")
          ? "Hay tipos de entrada con ventas — el precio se ha bloqueado en BD. Revísalos."
          : raw.includes("Cannot reduce")
          ? "Has bajado un aforo por debajo de las ventas. Ajusta los cupos."
          : raw.includes("Cannot delete event")
          ? "No se puede eliminar este evento porque tiene ventas. Cámbialo a borrador en lugar de eliminarlo."
          : raw.includes("Cannot delete tier")
          ? "Hay tipos vendidos que no se pueden borrar. Desactívalos (oculto) en lugar de eliminarlos."
          : raw;
      toast({
        title: "Error guardando",
        description: friendly,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ------- CREATE / DUPLICATE persistence (INSERT events + tiers) -------
  const persistCreate = async (
    status: "draft" | "published",
    startIso: string,
    endIso: string | null,
    minPriceCents: number,
    totalCap: number | null
  ) => {
    const { data: createdEvent, error } = await supabase
      .from("events")
      .insert({
        partner_id: partnerId,
        title: title.trim(),
        description: description.trim() || null,
        city: location.city.trim(),
        venue_name: location.venueName.trim() || null,
        address: location.address.trim() || null,
        date_start: startIso,
        date_end: endIso,
        price_cents: minPriceCents,
        capacity: totalCap,
        image_url: imageUrl || null,
        status,
      })
      .select("id")
      .single();
    if (error || !createdEvent) {
      throw new Error(error?.message ?? "No se pudo crear el evento");
    }
    const tiersToInsert = tiers.map((t, idx) => ({
      event_id: createdEvent.id,
      name: t.name.trim(),
      description: t.description.trim() || null,
      price_cents: Math.round(parseFloat(t.priceEur || "0") * 100),
      currency: "EUR",
      capacity: t.capacity ? parseInt(t.capacity, 10) : null,
      per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
      status: t.active ? "active" : "hidden",
      sort_order: idx,
    }));
    const { error: tierErr } = await supabase.from("ticket_tiers").insert(tiersToInsert);
    if (tierErr) {
      // Rollback manual
      await supabase.from("events").delete().eq("id", createdEvent.id);
      throw new Error(tierErr.message);
    }
  };

  // ------- EDIT persistence (UPDATE event + reconciliate tiers) -------
  const persistEdit = async (
    eid: string,
    status: "draft" | "published",
    startIso: string,
    endIso: string | null,
    minPriceCents: number,
    totalCap: number | null
  ) => {
    // 1) UPDATE event safe + critical fields. La capa BD enforce capacity
    //    floor; si baja por debajo de ventas el UPDATE falla y caemos al catch.
    const { error: evtErr } = await supabase
      .from("events")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        city: location.city.trim(),
        venue_name: location.venueName.trim() || null,
        address: location.address.trim() || null,
        date_start: startIso,
        date_end: endIso,
        price_cents: minPriceCents,
        capacity: totalCap,
        image_url: imageUrl || null,
        status,
      })
      .eq("id", eid);
    if (evtErr) throw new Error(evtErr.message);

    // 2) DELETE tiers eliminados localmente (sólo si no tenían ventas — el
    //    trigger BD también lo bloquea, pero filtramos aquí para evitar
    //    el roundtrip que falla).
    const toDelete = Array.from(removedTierDbIds).filter(
      (tid) => !tierSalesMap[tid]?.hasSales
    );
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("ticket_tiers")
        .delete()
        .in("id", toDelete);
      if (delErr) throw new Error(delErr.message);
    }

    // 3) UPDATE tiers existentes / INSERT tiers nuevos
    for (let idx = 0; idx < tiers.length; idx++) {
      const t = tiers[idx];
      const sales = t.dbId ? tierSalesMap[t.dbId] : undefined;
      const tierStatus = t.active ? "active" : "hidden";
      const tierCap = t.capacity ? parseInt(t.capacity, 10) : null;
      const tierPriceC = Math.round(parseFloat(t.priceEur || "0") * 100);
      if (t.dbId) {
        // Si tiene ventas: no toques price ni bajes capacity bajo sold
        const update: Record<string, unknown> = {
          name: t.name.trim(),
          description: t.description.trim() || null,
          per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
          status: tierStatus,
          sort_order: idx,
        };
        if (!sales?.hasSales) {
          update.price_cents = tierPriceC;
        }
        // Capacity: dejamos siempre el valor (trigger BD enforce floor)
        update.capacity = tierCap;

        const { error: upErr } = await supabase
          .from("ticket_tiers")
          .update(update)
          .eq("id", t.dbId);
        if (upErr) throw new Error(upErr.message);
      } else {
        const { error: insErr } = await supabase.from("ticket_tiers").insert({
          event_id: eid,
          name: t.name.trim(),
          description: t.description.trim() || null,
          price_cents: tierPriceC,
          currency: "EUR",
          capacity: tierCap,
          per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
          status: tierStatus,
          sort_order: idx,
        });
        if (insErr) throw new Error(insErr.message);
      }
    }
  };

  // -----------------------------------------------------------------
  // Marcar tier removed (sólo se aplica si tiene dbId; los nuevos se
  // borran del array localmente). El TicketTiersBuilder dispatcha la
  // mutación del array y aquí inferimos los dbIds que han desaparecido.
  // -----------------------------------------------------------------
  const handleTiersChange = (next: TierDraft[]) => {
    const nextDbIds = new Set(next.map((t) => t.dbId).filter(Boolean) as string[]);
    const removed = new Set<string>(removedTierDbIds);
    for (const t of tiers) {
      if (t.dbId && !nextDbIds.has(t.dbId)) {
        removed.add(t.dbId);
      }
    }
    setRemovedTierDbIds(removed);
    setTiers(next);
  };

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!flex !flex-col !gap-0 overflow-hidden p-0 sm:max-w-4xl lg:max-w-6xl"
        style={{
          height: "min(920px, calc(100dvh - 24px))",
          maxHeight: "calc(100dvh - 24px)",
        }}
      >
        {/* Wizard usa su propia chrome (no DialogHeader / Footer) para
            poder anclar el stepper y el nav prev/next a 100% de altura. */}
        <DialogTitle className="sr-only">
          {mode === "edit"
            ? "Editar evento"
            : mode === "duplicate"
            ? "Duplicar evento"
            : "Nuevo evento"}
        </DialogTitle>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Header */}
          <header className="shrink-0 border-b border-border bg-card/60 px-5 py-4 md:px-7 md:py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
                  style={{ ...mono, letterSpacing: "0.22em" }}
                >
                  <span className="inline-block h-px w-5 bg-orange-500/70" />
                  {mode === "edit"
                    ? "Editar evento"
                    : mode === "duplicate"
                    ? "Duplicar evento"
                    : "Nuevo evento"}
                </div>
                <h2 className="truncate text-xl font-bold leading-tight tracking-tight md:text-2xl">
                  {mode === "edit" ? (
                    <>
                      Edita tu{" "}
                      <span style={serif} className="text-orange-500">
                        evento
                      </span>
                    </>
                  ) : mode === "duplicate" ? (
                    <>
                      Duplica y ajusta tu{" "}
                      <span style={serif} className="text-orange-500">
                        evento
                      </span>
                    </>
                  ) : (
                    <>
                      Crea tu próximo{" "}
                      <span style={serif} className="text-orange-500">
                        evento
                      </span>
                    </>
                  )}
                </h2>
                {eventHasSales && (
                  <div
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-0.5 text-[10px] uppercase text-orange-500"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    <Lock className="h-3 w-3" />
                    Con ventas · edición limitada
                  </div>
                )}
              </div>

              {/* Step pill — sólo desktop */}
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
                        // Permitir saltar a pasos previos sin validar; hacia delante
                        // se valida cada paso intermedio.
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

          {/* Body: layout 2-col en lg+, 1-col en mobile */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main className="scrollbar-pasify min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-7 md:py-8">
              {loadingInitial ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando evento…
                </div>
              ) : (
                <>
                  {step === 0 && (
                    <StepInfo
                      title={title}
                      onTitleChange={setTitle}
                      description={description}
                      onDescriptionChange={setDescription}
                      disabled={submitting}
                    />
                  )}
                  {step === 1 && (
                    <StepWhenWhere
                      dateTime={dateTime}
                      onDateTimeChange={setDateTime}
                      location={location}
                      onLocationChange={setLocation}
                      cities={cities}
                      disabled={submitting}
                    />
                  )}
                  {step === 2 && (
                    <StepTickets
                      tiers={tiers}
                      onTiersChange={handleTiersChange}
                      salesMap={tierSalesMap}
                      disabled={submitting}
                    />
                  )}
                  {step === 3 && (
                    <StepMedia
                      imageUrl={imageUrl}
                      onClear={() => setImageUrl("")}
                      onPick={() => fileInputRef.current?.click()}
                      uploading={uploading}
                      disabled={submitting}
                      fileInputRef={fileInputRef}
                      onFileSelect={handleFileSelect}
                    />
                  )}
                  {step === 4 && (
                    <StepPublish
                      willPublish={willPublish}
                      onWillPublishChange={setWillPublish}
                      disabled={submitting}
                      eventHasSales={eventHasSales}
                    />
                  )}
                  {step === 5 && (
                    <StepReview summary={summary} eventHasSales={eventHasSales} mode={mode} />
                  )}
                </>
              )}
            </main>

            {/* Sidebar sticky — sólo desktop (lg+) y nunca en step "review"
                (allá la summary card ya está en el cuerpo). */}
            {step !== 5 && (
              <aside className="scrollbar-pasify hidden w-[320px] shrink-0 overflow-y-auto border-l border-border bg-card/30 px-5 py-6 lg:block">
                <EventSummaryCard summary={summary} defaultCollapsed={false} />
              </aside>
            )}
          </div>

          {/* Footer: prev / next + acciones finales */}
          <footer className="shrink-0 flex items-center justify-between gap-2 border-t border-border bg-card/60 px-5 py-3 md:px-7">
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

            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={submitting || loadingInitial}
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
              <div className="flex items-center gap-2">
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
                      Guardando…
                    </>
                  ) : willPublish ? (
                    <>
                      <Send className="mr-1.5 h-4 w-4" />
                      {mode === "edit" ? "Guardar y publicar" : "Publicar evento"}
                    </>
                  ) : (
                    "Guardar borrador"
                  )}
                </Button>
              </div>
            )}
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =================================================================
// Sub-componentes (steps)
// =================================================================

const StepInfo = ({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  disabled,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  disabled?: boolean;
}) => (
  <StepShell
    eyebrow="Paso 01"
    title={<>Cuéntanos qué <span style={serif} className="text-orange-500">evento</span> es.</>}
    subtitle="Este es el nombre que verán los clientes en el calendario y en su ticket digital."
  >
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Label htmlFor="evt-title" className="text-xs">
          Título del evento *
        </Label>
        <Input
          id="evt-title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Saturday Night · Halloween Edition"
          disabled={disabled}
          className="mt-1.5 h-11"
        />
      </div>
      <div>
        <Label htmlFor="evt-desc" className="text-xs">
          Descripción
        </Label>
        <Textarea
          id="evt-desc"
          rows={4}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Line-up, código de vestimenta, edad mínima, otra info útil…"
          disabled={disabled}
          className="mt-1.5"
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Aparece debajo del título en la página pública del evento.
        </p>
      </div>
    </div>
  </StepShell>
);

const StepWhenWhere = ({
  dateTime,
  onDateTimeChange,
  location,
  onLocationChange,
  cities,
  disabled,
}: {
  dateTime: DateTimeValue;
  onDateTimeChange: (v: DateTimeValue) => void;
  location: LocationValue;
  onLocationChange: (v: LocationValue) => void;
  cities: City[];
  disabled?: boolean;
}) => (
  <StepShell
    eyebrow="Paso 02"
    title={<>¿Cuándo y <span style={serif} className="text-orange-500">dónde</span>?</>}
    subtitle="Si el evento cruza medianoche detectamos automáticamente que finaliza al día siguiente."
  >
    <div className="mx-auto max-w-2xl space-y-6">
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarIcon className="h-4 w-4 text-orange-500" />
          Fecha y horario
        </h3>
        <EventDateTimeSection
          value={dateTime}
          onChange={onDateTimeChange}
          disabled={disabled}
        />
      </section>
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-orange-500" />
          Ubicación
        </h3>
        <EventLocationSection
          value={location}
          onChange={onLocationChange}
          cities={cities}
          disabled={disabled}
        />
      </section>
    </div>
  </StepShell>
);

const StepTickets = ({
  tiers,
  onTiersChange,
  salesMap,
  disabled,
}: {
  tiers: TierDraft[];
  onTiersChange: (next: TierDraft[]) => void;
  salesMap: Record<string, TierSales>;
  disabled?: boolean;
}) => (
  <StepShell
    eyebrow="Paso 03"
    title={<>Tipos de <span style={serif} className="text-orange-500">entrada</span>.</>}
    subtitle="Define Early Bird, General, VIP, Backstage, Invitación… Cada tipo controla su precio y cupo. Lo que ya se ha vendido queda protegido automáticamente."
  >
    <div className="mx-auto max-w-3xl">
      <TicketTiersBuilder
        tiers={tiers}
        onChange={onTiersChange}
        disabled={disabled}
        salesByDbId={salesMap}
      />
    </div>
  </StepShell>
);

const StepMedia = ({
  imageUrl,
  onClear,
  onPick,
  uploading,
  disabled,
  fileInputRef,
  onFileSelect,
}: {
  imageUrl: string;
  onClear: () => void;
  onPick: () => void;
  uploading: boolean;
  disabled?: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) => (
  <StepShell
    eyebrow="Paso 04"
    title={<>Imagen y <span style={serif} className="text-orange-500">portada</span>.</>}
    subtitle="Una imagen 16:9 funciona mejor en el calendario público y en el ticket digital. JPG, PNG o WEBP."
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
            onClick={onClear}
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
            aria-label="Quitar imagen"
            disabled={disabled}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={uploading || disabled}
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
        onChange={onFileSelect}
      />
    </div>
  </StepShell>
);

const StepPublish = ({
  willPublish,
  onWillPublishChange,
  disabled,
  eventHasSales,
}: {
  willPublish: boolean;
  onWillPublishChange: (v: boolean) => void;
  disabled?: boolean;
  eventHasSales: boolean;
}) => (
  <StepShell
    eyebrow="Paso 05"
    title={<>Opciones de <span style={serif} className="text-orange-500">publicación</span>.</>}
    subtitle="Guárdalo como borrador para seguir ajustándolo o publícalo ya en el calendario."
  >
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Switch
            checked={willPublish}
            onCheckedChange={onWillPublishChange}
            disabled={disabled}
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
                ? "El evento será visible en el calendario público y comprable inmediatamente."
                : "El evento queda privado en Mis eventos. Puedes publicarlo más tarde."}
            </p>
          </div>
        </div>
      </div>

      {eventHasSales && (
        <div
          className="mt-4 flex items-start gap-3 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 text-[12px] leading-relaxed text-orange-200"
          role="status"
        >
          <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0 text-orange-500" />
          <span>
            Este evento ya tiene entradas vendidas. No se puede{" "}
            <strong className="font-semibold">eliminar</strong> ni cambiar el
            precio de los tipos vendidos. Sí puedes ajustar título,
            descripción, imagen, dirección y añadir nuevos tipos de entrada.
          </span>
        </div>
      )}
    </div>
  </StepShell>
);

const StepReview = ({
  summary,
  eventHasSales,
  mode,
}: {
  summary: EventSummary;
  eventHasSales: boolean;
  mode: EditorMode;
}) => (
  <StepShell
    eyebrow="Paso 06"
    title={<>Revisa antes de <span style={serif} className="text-orange-500">guardar</span>.</>}
    subtitle="Comprueba que toda la información del evento es correcta. Los clientes verán exactamente esto."
  >
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <ReviewRow label="Título" value={summary.title || "—"} />
        <ReviewRow
          label="Fecha"
          value={
            summary.date
              ? new Date(`${summary.date}T${summary.startTime || "00:00"}:00`).toLocaleDateString(
                  "es-ES",
                  { weekday: "long", day: "numeric", month: "long", year: "numeric" }
                )
              : "—"
          }
        />
        <ReviewRow
          label="Horario"
          value={
            summary.startTime
              ? `${summary.startTime}h${summary.endTime ? ` → ${summary.endTime}h${summary.crossesMidnight ? " (+1)" : ""}` : ""}`
              : "—"
          }
        />
        <ReviewRow
          label="Ubicación"
          value={
            [summary.venueName, summary.address, summary.city].filter(Boolean).join(" · ") || "—"
          }
        />
        <ReviewRow
          label="Tickets"
          value={
            summary.ticketCount > 0
              ? `${summary.ticketCount} tipo${summary.ticketCount === 1 ? "" : "s"}${
                  summary.minPriceEur != null
                    ? ` · desde ${summary.minPriceEur.toFixed(2)}€`
                    : ""
                }`
              : "Sin tickets activos"
          }
        />
        <ReviewRow
          label="Aforo total"
          value={summary.totalCapacity != null ? `${summary.totalCapacity} entradas` : "Sin límite explícito"}
        />
        <ReviewRow
          label="Visibilidad"
          value={summary.willPublish ? "Se publicará al guardar" : "Borrador (no visible)"}
        />
        {eventHasSales && (
          <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 text-[12px] leading-relaxed text-orange-200">
            <strong className="font-semibold">Edición con ventas:</strong> los
            tipos de entrada con tickets vendidos han mantenido su precio. El
            resto de cambios se aplicará al guardar.
          </div>
        )}
        {mode === "duplicate" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-[12px] leading-relaxed text-emerald-200">
            <strong className="font-semibold">Modo duplicar:</strong> esto
            creará un evento NUEVO en borrador, no afectará al original.
          </div>
        )}
      </div>
      <div>
        <EventSummaryCard summary={summary} defaultCollapsed={false} />
      </div>
    </div>
  </StepShell>
);

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start gap-4 border-b border-border/60 pb-4">
    <div
      className="w-32 shrink-0 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="flex-1 text-sm font-medium capitalize text-foreground">
      {value}
    </div>
  </div>
);

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

export default EventEditorWizard;
