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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageUtils";
import { readDraft, removeDraft, writeDraft } from "@/lib/drafts";
import { useToast } from "@/hooks/use-toast";
import {
  TicketTiersBuilder,
  createEmptyTier,
  type TierDraft,
  type TierSales,
} from "@/components/partner/TicketTiersBuilder";
import { isBelowStripeMinimum, priceEurToCents } from "@/components/partner/tierPrice";
import {
  DEFAULT_REFUND_HOURS,
  MAX_REFUND_HOURS,
  parseRefundHours,
  refundHoursForDb,
  summarizePolicies,
} from "@/components/partner/tierPolicy";
import {
  EventDateTimeSection,
  composeIsoStartEnd,
  validateDateTime,
  type DateTimeValue,
} from "@/components/partner/EventDateTimeSection";
import { addDaysToDate, isoToWallClock, timeZoneLabel } from "@/components/partner/zonedTime";
import { describeWriteError, expectRows } from "@/components/partner/writeErrors";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
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
 *   - "duplicate" → carga evento + tiers como plantilla: mismo día de la
 *                   semana y misma hora de reloj, la próxima semana que no
 *                   haya pasado; se guarda como borrador (INSERT nuevo)
 *
 * Guardar un evento existente NO cambia su estado ("Guardar cambios"). Un
 * borrador se publica con "Guardar y publicar"; retirar o cancelar un
 * evento publicado son acciones aparte en Mis eventos.
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
 *   - El aforo del evento (events.capacity) no lo escribe el editor: lo
 *     mantiene un trigger con la suma de los cupos de TODOS los tipos,
 *     también los ocultos (antes se sumaban solo los activos y ocultar un
 *     tipo agotado le quitaba su cupo al aforo).
 *   - Cada escritura pide `.select("id")` y comprueba cuántas filas cambian
 *     (writeErrors): si la RLS la filtra no se dice "Cambios guardados", y el
 *     aviso distingue sin conexión, rechazo del servidor y "no ha cambiado
 *     nada".
 *   - Si la BD rechaza un UPDATE/DELETE por trigger, mostramos el error
 *     legible en un toast sin romper el resto de la transacción manual.
 *
 * Evento nuevo: el local elegido rellena la dirección, el cupo de la entrada
 * por defecto (su aforo) y la zona horaria con la que se leen el día y las
 * horas (EventDateTimeSection).
 *
 * Hora del local (B4-09): el día y las horas se escriben y se leen en la zona
 * del local del evento (`venues.timezone`), también al duplicar y al
 * recuperar el borrador, y se rotula «Hora de <ciudad del local>». Para no
 * leerlos con la zona del dispositivo por llegar tarde la lista de locales,
 * el formulario espera a tener el contexto del local (`contextReady`).
 *
 * Políticas de cada tipo (D-3): devoluciones (NULL = sin devolución salvo
 * cancelación; N = hasta N horas antes) y transferencia; en el resumen se ven
 * las dos.
 *
 * Organización suspendida (`publishBlockedReason`): se puede editar y guardar
 * como borrador, pero no publicar.
 */

/**
 * Filas de ticket_tiers con la política de devoluciones que admite NULL ("sin
 * devolución salvo cancelación"). Los tipos generados aún tienen la columna
 * como NOT NULL: la migración de reembolsos de la Ola 2 la hace opcional, y al
 * regenerarlos estos casts sobran.
 */
type TierInsert = Omit<TablesInsert<"ticket_tiers">, "refundable_until_hours_before"> & {
  refundable_until_hours_before: number | null;
};
type TierUpdate = Omit<TablesUpdate<"ticket_tiers">, "refundable_until_hours_before"> & {
  refundable_until_hours_before?: number | null;
};
const comoInsert = (row: TierInsert) => row as unknown as TablesInsert<"ticket_tiers">;
const comoInserts = (rows: TierInsert[]) => rows as unknown as TablesInsert<"ticket_tiers">[];
const comoUpdate = (row: TierUpdate) => row as unknown as TablesUpdate<"ticket_tiers">;

/** Tipo de un borrador guardado antes de que existieran las políticas: con las de por defecto. */
const normalizarTipo = (t: Partial<TierDraft>): TierDraft => {
  const base = createEmptyTier();
  return {
    ...base,
    ...t,
    _key: typeof t._key === "string" && t._key ? t._key : base._key,
    refundMode: t.refundMode === "hours" ? "hours" : "none",
    refundHours: typeof t.refundHours === "string" && t.refundHours ? t.refundHours : DEFAULT_REFUND_HOURS,
    transferAllowed: typeof t.transferAllowed === "boolean" ? t.transferAllowed : true,
  };
};

/**
 * Borrador de "Nuevo evento" en el dispositivo (lib/drafts): si mientras se
 * rellena el navegador descarta la pestaña o iOS cierra la app, al volver se
 * recupera tal cual. Se borra al guardar el evento o con "Empezar de cero".
 * Solo en "create": editar y duplicar cargan del servidor.
 */
interface BorradorEvento {
  v: 1;
  step: number;
  title: string;
  description: string;
  dateTime: DateTimeValue;
  location: LocationValue;
  tiers: TierDraft[];
  imageUrl: string;
  willPublish: boolean;
  venueId: string | null;
  /**
   * Zona con la que se escribieron el día y las horas. Se usa si el local ya
   * no está en la lista; si está, manda la suya. Falta en los borradores
   * anteriores a guardarla.
   */
  timeZone?: string;
}

const esBorradorValido = (b: unknown): b is BorradorEvento => {
  const d = b as BorradorEvento | null;
  return (
    !!d &&
    d.v === 1 &&
    typeof d.title === "string" &&
    typeof d.description === "string" &&
    !!d.dateTime &&
    !!d.location &&
    Array.isArray(d.tiers)
  );
};

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

/** Local de la organización al que se asigna el evento (`events.venue_id`). */
export interface EditorVenue {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  /** Aforo del local: cupo por defecto de la entrada de un evento nuevo. */
  capacity?: number | null;
  /** Zona horaria del local (IANA): el día y las horas del evento son los suyos. */
  timezone?: string | null;
}

/** Zona horaria de un local (sin local o sin zona: la del dispositivo). */
const zonaDe = (venue: EditorVenue | null | undefined): string | undefined => venue?.timezone || undefined;

/** Aforo del local como cupo de la entrada por defecto ("" = sin límite). */
const cupoDelLocal = (venue: EditorVenue | null | undefined): string =>
  venue?.capacity && venue.capacity > 0 ? String(venue.capacity) : "";

/** Entrada por defecto de un evento nuevo, con el aforo del local como cupo. */
const tierPorDefecto = (venue: EditorVenue | null | undefined): TierDraft => ({
  ...createEmptyTier("Entrada General", "15.00"),
  capacity: cupoDelLocal(venue),
});

/** Estado de un tipo de entrada según su interruptor "Activo". */
const estadoDelTipo = (active: boolean): "active" | "hidden" => (active ? "active" : "hidden");

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
  /**
   * Locales de la organización. Con `venue_id` el trigger de la BD liga el
   * evento a su organización (cobros, equipo, informes).
   */
  venues?: EditorVenue[];
  defaultVenueId?: string | null;
  /**
   * El contexto del local (sus locales y zonas horarias) ya se ha cargado.
   * Hasta entonces el formulario espera: leer o escribir la fecha antes
   * usaría la zona del dispositivo.
   */
  contextReady?: boolean;
  /** Si no se puede publicar (organización suspendida), el motivo. */
  publishBlockedReason?: string | null;
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
  venues = [],
  defaultVenueId = null,
  contextReady = true,
  publishBlockedReason = null,
  onSaved,
}: Props) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Abierto pero sin el contexto del local todavía: se espera (ver Props).
  const esperandoContexto = open && !contextReady;

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
  const [tiers, setTiers] = useState<TierDraft[]>(() => [
    tierPorDefecto(venues.find((v) => v.id === defaultVenueId)),
  ]);
  const [imageUrl, setImageUrl] = useState("");
  const [willPublish, setWillPublish] = useState(true);
  const [venueId, setVenueId] = useState<string | null>(defaultVenueId);
  // Zona horaria con la que se leen el día y las horas del formulario: la del
  // local del evento. Se fija al cargar (con la que se descompuso la fecha) y
  // al cambiar de local, no cuando llega tarde la lista de locales: así nunca
  // se guarda con una zona distinta de la que se usó para enseñar la hora.
  const [timeZone, setTimeZone] = useState<string | undefined>(() =>
    zonaDe(venues.find((v) => v.id === defaultVenueId))
  );
  // Estado del evento al abrirlo en "edit": guardar no lo cambia.
  const [originalStatus, setOriginalStatus] = useState<string | null>(null);

  // "Nuevo evento" recuperado de un borrador: cuándo se guardó (null = no).
  const [borradorDe, setBorradorDe] = useState<number | null>(null);
  const claveBorrador = partnerId ? `evento.${partnerId}` : null;

  // Edit-mode: ventas reales por tier para bloqueos UI + tiers eliminados
  const [tierSalesMap, setTierSalesMap] = useState<Record<string, TierSales>>({});
  const [removedTierDbIds, setRemovedTierDbIds] = useState<Set<string>>(new Set());
  const [eventHasSales, setEventHasSales] = useState(false);
  // "Nuevo evento" ya rellenado (con el borrador o vacío). Hasta entonces no
  // se guarda borrador: el formulario en blanco de mientras borraría el de verdad.
  const [formListo, setFormListo] = useState(false);

  // Local del evento y rótulo de su hora («Hora de Santa Cruz de Tenerife»).
  const venueActual = venues.find((v) => v.id === venueId) ?? null;
  const etiquetaHora = timeZoneLabel(venueActual?.city, timeZone);

  // Sin poder publicar (organización suspendida): nunca "Publicar al guardar".
  useEffect(() => {
    if (publishBlockedReason) setWillPublish(false);
  }, [publishBlockedReason]);

  /** Formulario vacío de "Nuevo evento" (con el local por defecto). */
  const aplicarValoresDeNuevo = () => {
    const defaultVenue = venues.find((v) => v.id === defaultVenueId) ?? null;
    setTitle("");
    setDescription("");
    setDateTime({ date: "", startTime: "23:30", endTime: "06:00" });
    setLocation({
      city: defaultVenue?.city || defaultCity,
      venueName: defaultVenue?.name || defaultVenueName,
      address: defaultVenue?.address ?? "",
    });
    setVenueId(defaultVenue?.id ?? null);
    setTimeZone(zonaDe(defaultVenue));
    setOriginalStatus(null);
    setTiers([tierPorDefecto(defaultVenue)]);
    setImageUrl("");
    setWillPublish(!publishBlockedReason);
    setTierSalesMap({});
    setEventHasSales(false);
  };

  /** "Empezar de cero": fuera el borrador recuperado. */
  const descartarBorrador = () => {
    if (claveBorrador) removeDraft(claveBorrador);
    setBorradorDe(null);
    setStep(0);
    aplicarValoresDeNuevo();
  };

  // Guarda el borrador de "Nuevo evento" mientras se rellena (con una pausa
  // para no escribir en cada tecla). Un formulario sin tocar no deja borrador.
  useEffect(() => {
    if (!open || mode !== "create" || !claveBorrador || !formListo) return;
    const t = setTimeout(() => {
      const [primero] = tiers;
      // El cupo que viene del aforo del local no cuenta como "tocado".
      const porDefecto = tierPorDefecto(venues.find((v) => v.id === venueId));
      const tocado =
        !!title.trim() ||
        !!description.trim() ||
        !!dateTime.date ||
        !!imageUrl ||
        tiers.length !== 1 ||
        primero?.name !== porDefecto.name ||
        primero?.description !== porDefecto.description ||
        primero?.priceEur !== porDefecto.priceEur ||
        primero?.capacity !== porDefecto.capacity ||
        primero?.perUserMax !== porDefecto.perUserMax ||
        primero?.active !== porDefecto.active ||
        primero?.refundMode !== porDefecto.refundMode ||
        primero?.transferAllowed !== porDefecto.transferAllowed;
      if (!tocado) {
        removeDraft(claveBorrador);
        return;
      }
      const borrador: BorradorEvento = {
        v: 1,
        step,
        title,
        description,
        dateTime,
        location,
        tiers,
        imageUrl,
        willPublish,
        venueId,
        timeZone,
      };
      writeDraft(claveBorrador, borrador);
    }, 400);
    return () => clearTimeout(t);
  }, [
    open,
    mode,
    claveBorrador,
    formListo,
    step,
    title,
    description,
    dateTime,
    location,
    tiers,
    imageUrl,
    willPublish,
    venueId,
    venues,
    timeZone,
  ]);

  // -----------------------------------------------------------------
  // Reset / load según mode al abrir (con el contexto del local ya cargado:
  // sin él, el día y las horas se leerían con la zona del dispositivo)
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!open) {
      setFormListo(false);
      return;
    }
    if (!contextReady) return;
    setStep(0);
    setRemovedTierDbIds(new Set());

    if (mode === "create") {
      const guardado = claveBorrador ? readDraft<unknown>(claveBorrador) : null;
      if (guardado && esBorradorValido(guardado.data)) {
        const b = guardado.data;
        const venueDelBorrador = venues.find((v) => v.id === b.venueId);
        setStep(Math.min(Math.max(b.step ?? 0, 0), STEPS.length - 1));
        setTitle(b.title);
        setDescription(b.description);
        setDateTime(b.dateTime);
        setLocation(b.location);
        setVenueId(b.venueId ?? null);
        // La hora se escribió como hora del local: con la zona del local (o,
        // si ya no está en la lista, con la que se escribió).
        setTimeZone(zonaDe(venueDelBorrador) ?? (b.timeZone || undefined));
        setOriginalStatus(null);
        setTiers(
          b.tiers.length > 0 ? b.tiers.map((t) => normalizarTipo(t)) : [tierPorDefecto(venueDelBorrador)]
        );
        setImageUrl(b.imageUrl ?? "");
        setWillPublish((b.willPublish ?? true) && !publishBlockedReason);
        setTierSalesMap({});
        setEventHasSales(false);
        setBorradorDe(guardado.savedAt);
        setFormListo(true);
        return;
      }
      setBorradorDe(null);
      aplicarValoresDeNuevo();
      setFormListo(true);
      return;
    }

    if ((mode === "edit" || mode === "duplicate") && eventId) {
      void loadForEdit(eventId, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, eventId, contextReady]);

  const loadForEdit = async (eid: string, m: EditorMode) => {
    setLoadingInitial(true);
    try {
      // 1) Evento
      const { data: evt, error: evtErr } = await supabase
        .from("events")
        .select(
          "id, title, description, city, venue_name, address, date_start, date_end, image_url, status, capacity, price_cents, venue_id"
        )
        .eq("id", eid)
        .maybeSingle();
      if (evtErr || !evt) throw evtErr ?? new Error("Evento no encontrado");

      // 2) Tiers
      const { data: t, error: tErr } = await supabase
        .from("ticket_tiers")
        .select(
          "id, name, description, price_cents, capacity, per_user_max, status, sort_order, refundable_until_hours_before, transfer_allowed"
        )
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

      // 4) Fecha y hora desde date_start (+ end opcional), en la hora del
      //    local del evento (la misma zona con la que se guardará).
      const venueDelEvento = venues.find((v) => v.id === (evt.venue_id ?? defaultVenueId));
      const zona = zonaDe(venueDelEvento);
      const inicio = evt.date_start ? isoToWallClock(evt.date_start, zona) : null;
      const fin = evt.date_end ? isoToWallClock(evt.date_end, zona) : null;

      const baseTitle = evt.title ?? "";
      const dt = (() => {
        if (!inicio) return { date: "", startTime: "23:30", endTime: "06:00" };
        // Duplicate: mismo día de la semana y misma hora de reloj, la próxima
        // semana que no haya pasado. Se suman días de calendario y la hora se
        // conserva: un cambio de horario no la desplaza (sumar 7×24 h sí).
        let date = inicio.date;
        if (m === "duplicate") {
          const hoy = isoToWallClock(new Date(), zona)?.date ?? inicio.date;
          let weeks = 1;
          while (addDaysToDate(inicio.date, 7 * weeks) < hoy && weeks < 520) weeks++;
          date = addDaysToDate(inicio.date, 7 * weeks);
        }
        return { date, startTime: inicio.time, endTime: fin?.time ?? "" };
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
      // Una copia nace como borrador; en edit el estado no se toca al guardar.
      setWillPublish(false);
      setOriginalStatus(m === "edit" ? evt.status ?? null : null);
      setVenueId(evt.venue_id ?? defaultVenueId ?? null);
      setTimeZone(zona);
      setEventHasSales(m === "edit" ? hasSales : false);
      setTierSalesMap(salesMap);

      const draftTiers: TierDraft[] = (t ?? []).map((row) => {
        // NULL = sin devolución (salvo cancelación); N = hasta N horas antes.
        const horas: number | null = row.refundable_until_hours_before ?? null;
        return {
          _key: `db-${row.id}`,
          dbId: m === "edit" ? row.id : undefined, // duplicate trata como nuevo
          name: row.name ?? "",
          description: row.description ?? "",
          priceEur: ((row.price_cents ?? 0) / 100).toFixed(2),
          capacity: row.capacity != null ? String(row.capacity) : "",
          perUserMax: row.per_user_max != null ? String(row.per_user_max) : "4",
          active: (row.status ?? "active") === "active",
          refundMode: horas === null ? "none" : "hours",
          refundHours: horas === null ? DEFAULT_REFUND_HOURS : String(horas),
          transferAllowed: row.transfer_allowed ?? true,
        };
      });
      setTiers(draftTiers.length > 0 ? draftTiers : [tierPorDefecto(venueDelEvento)]);
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

    // Aforo = suma de los cupos de TODOS los tipos, también los ocultos (lo
    // que ya vendieron sigue ocupando sitio), como lo guarda la BD. Un tipo
    // sin cupo deja el evento sin límite.
    const caps = tiers
      .map((t) => parseInt(t.capacity, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalCap =
      caps.length === tiers.length && caps.length > 0
        ? caps.reduce((a, b) => a + b, 0)
        : null;

    const { crossesMidnight } = composeIsoStartEnd(dateTime, timeZone);

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
      willPublish: mode === "edit" ? originalStatus === "published" : willPublish,
      timeZoneLabel: etiquetaHora,
      // Lo que verá quien compre: las políticas de los tipos a la venta.
      policies: activeTiers.map((t) => ({
        name: t.name,
        refundHours: refundHoursForDb(t.refundMode, t.refundHours),
        transferAllowed: t.transferAllowed,
      })),
    };
  }, [title, location, dateTime, tiers, imageUrl, willPublish, mode, originalStatus, timeZone, etiquetaHora]);

  // -----------------------------------------------------------------
  // Validators per-step
  // -----------------------------------------------------------------
  const validateStep = useCallback(
    (idx: number): string | null => {
      if (idx === 0) {
        if (!title.trim()) return "El evento necesita un título";
      }
      if (idx === 1) {
        const dtErr = validateDateTime(dateTime, timeZone);
        if (dtErr) return dtErr;
        const locErr = validateLocation(location);
        if (locErr) return locErr;
        if (venues.length > 0 && !venueId) return "Elige el local del evento";
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
          // Stripe no cobra de 0,01 a 0,49 € (el precio de un tipo con ventas
          // no se puede tocar, así que ese no se comprueba).
          const sales = t.dbId ? tierSalesMap[t.dbId] : undefined;
          if (!sales?.hasSales && isBelowStripeMinimum(t.priceEur)) {
            return `El precio de "${t.name}" es demasiado bajo: el mínimo que se puede cobrar es 0,50 €.`;
          }
          // Capacity floor vs ventas
          if (sales && t.capacity) {
            const cap = parseInt(t.capacity, 10);
            if (Number.isFinite(cap) && cap < sales.sold) {
              return `El cupo de "${t.name}" no puede ser menor que las ventas (${sales.sold}).`;
            }
          }
          if (t.refundMode === "hours" && parseRefundHours(t.refundHours) === null) {
            return `El plazo de devolución de "${t.name}" tiene que ser un número entero de horas entre 1 y ${MAX_REFUND_HOURS}.`;
          }
        }
      }
      return null;
    },
    [title, dateTime, location, tiers, tierSalesMap, venues.length, venueId, timeZone]
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
    if (!file.type.startsWith("image/")) {
      toast({ title: "Formato no válido", description: "Sube una imagen JPG, PNG o WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "Máximo 25 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      // Se reduce a 1600×2000 como máximo (cartel 4:5) y se pasa a JPEG: una
      // foto del móvil pasa de varios MB a unos cientos de KB.
      const blob = await compressImage(file, { maxWidth: 1600, maxHeight: 2000, quality: 0.82 });
      if (blob.size > 10 * 1024 * 1024) throw new Error("La imagen sigue ocupando más de 10 MB.");
      const ext = blob.type === "image/jpeg" ? "jpg" : file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${partnerId}/event-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("event-images")
        .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: blob.type || file.type });
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

  const submit = async (status: "draft" | "published" | "keep") => {
    const effective: "draft" | "published" =
      status === "keep" ? (originalStatus === "published" ? "published" : "draft") : status;
    // Organización suspendida: no se publica (el servidor también lo
    // rechaza). Guardar un evento que ya estaba publicado sí se deja.
    if (publishBlockedReason && status === "published") {
      toast({ title: "No se puede publicar", description: publishBlockedReason, variant: "destructive" });
      return;
    }
    const err = validateAll(effective);
    if (err) {
      toast({ title: "Faltan datos", description: err, variant: "destructive" });
      return;
    }

    const { startIso, endIso } = composeIsoStartEnd(dateTime, timeZone);
    if (!startIso) {
      toast({ title: "Fecha/hora inválida", variant: "destructive" });
      return;
    }

    const activeTiers = tiers.filter((t) => t.active);
    const tierPriceCents = activeTiers.map((t) => priceEurToCents(t.priceEur || "0") ?? 0);
    const minPriceCents = tierPriceCents.length > 0 ? Math.min(...tierPriceCents) : 0;

    setSubmitting(true);
    try {
      if (mode === "edit" && eventId) {
        await persistEdit(eventId, status === "keep" ? null : status, startIso, endIso, minPriceCents);
      } else {
        await persistCreate(effective, startIso, endIso, minPriceCents);
      }
      toast({
        title:
          mode === "edit"
            ? status === "published"
              ? "Evento publicado"
              : "Cambios guardados"
            : effective === "published"
            ? "Evento publicado"
            : "Borrador guardado",
        description:
          status === "keep"
            ? originalStatus === "published"
              ? "El evento sigue publicado con los cambios."
              : "Lo encontrarás en Mis eventos."
            : effective === "published"
            ? "Ya aparece en el calendario público y se puede comprar."
            : "Lo encontrarás en Mis eventos.",
      });
      // Guardado: el borrador ya no hace falta.
      if (mode === "create" && claveBorrador) removeDraft(claveBorrador);
      setBorradorDe(null);
      await onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      console.error("[EventEditorWizard] guardar:", e);
      // Sin conexión, rechazo del servidor (con su motivo) o "no ha cambiado
      // nada" (RLS): cada uno con su mensaje.
      const description = describeWriteError(e, {
        network:
          mode === "edit"
            ? "No hay conexión con el servidor y puede que parte de los cambios no se haya guardado. Revisa tu conexión y vuelve a guardar."
            : "No hay conexión con el servidor y no sabemos si el evento se ha creado. Revisa tu conexión y mira Mis eventos antes de volver a intentarlo.",
        noRows:
          mode === "edit"
            ? "El servidor no ha guardado los cambios: puede que el evento ya no exista o que tu cuenta ya no tenga permiso para editarlo. Recarga la lista."
            : "El servidor no ha guardado el evento: tu cuenta no tiene permiso para crear eventos en ese local.",
      });
      toast({
        // En edición se guarda por partes (evento y cada tipo): lo anterior
        // al fallo puede haberse guardado ya.
        title: mode === "edit" ? "No se han guardado todos los cambios" : "No se ha guardado el evento",
        description,
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
    minPriceCents: number
  ) => {
    // Sin capacity: el aforo lo pone la BD con los cupos de los tipos.
    const eventRes = await supabase
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
        image_url: imageUrl || null,
        // Con venue_id el trigger rellena brand_id y org_id.
        venue_id: venueId,
        status,
      })
      .select("id");
    const [createdEvent] = expectRows<{ id: string }>(eventRes);
    const tiersToInsert: TierInsert[] = tiers.map((t, idx) => ({
      event_id: createdEvent.id,
      name: t.name.trim(),
      description: t.description.trim() || null,
      price_cents: priceEurToCents(t.priceEur || "0") ?? 0,
      currency: "EUR",
      capacity: t.capacity ? parseInt(t.capacity, 10) : null,
      per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
      status: estadoDelTipo(t.active),
      sort_order: idx,
      refundable_until_hours_before: refundHoursForDb(t.refundMode, t.refundHours),
      transfer_allowed: t.transferAllowed,
    }));
    const tiersRes = await supabase.from("ticket_tiers").insert(comoInserts(tiersToInsert)).select("id");
    try {
      expectRows(tiersRes, tiersToInsert.length);
    } catch (err) {
      // Rollback manual: un evento sin sus tipos de entrada no se queda.
      await supabase.from("events").delete().eq("id", createdEvent.id);
      throw err;
    }
  };

  // ------- EDIT persistence (UPDATE event + reconciliate tiers) -------
  const persistEdit = async (
    eid: string,
    /** null = no tocar el estado */
    status: "draft" | "published" | null,
    startIso: string,
    endIso: string | null,
    minPriceCents: number
  ) => {
    // 1) UPDATE del evento: campos seguros + críticos. Sin capacity: el aforo
    //    lo mantiene la BD con los cupos de los tipos (paso 3). Tiene que
    //    cambiar exactamente una fila: con 0, la RLS lo ha filtrado.
    const eventRes = await supabase
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
        image_url: imageUrl || null,
        ...(venueId ? { venue_id: venueId } : {}),
        ...(status ? { status } : {}),
      })
      .eq("id", eid)
      .select("id");
    expectRows(eventRes);

    // 2) DELETE tiers eliminados localmente (sólo si no tenían ventas — el
    //    trigger BD también lo bloquea, pero filtramos aquí para evitar
    //    el roundtrip que falla).
    const toDelete = Array.from(removedTierDbIds).filter(
      (tid) => !tierSalesMap[tid]?.hasSales
    );
    if (toDelete.length > 0) {
      const delRes = await supabase
        .from("ticket_tiers")
        .delete()
        .in("id", toDelete)
        .select("id");
      expectRows(delRes, toDelete.length);
      // Ya borrados: si hay que volver a guardar, no se piden otra vez.
      setRemovedTierDbIds((prev) => {
        const next = new Set(prev);
        for (const tid of toDelete) next.delete(tid);
        return next;
      });
    }

    // 3) UPDATE tiers existentes / INSERT tiers nuevos
    for (let idx = 0; idx < tiers.length; idx++) {
      const t = tiers[idx];
      const sales = t.dbId ? tierSalesMap[t.dbId] : undefined;
      const tierCap = t.capacity ? parseInt(t.capacity, 10) : null;
      const tierPriceC = priceEurToCents(t.priceEur || "0") ?? 0;
      // Políticas: también en un tipo con ventas (valen para lo que se pida
      // a partir de ahora; el editor lo avisa).
      const politicas = {
        refundable_until_hours_before: refundHoursForDb(t.refundMode, t.refundHours),
        transfer_allowed: t.transferAllowed,
      };
      if (t.dbId) {
        // Si tiene ventas: no toques price ni bajes capacity bajo sold
        const update: TierUpdate = {
          name: t.name.trim(),
          description: t.description.trim() || null,
          per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
          status: estadoDelTipo(t.active),
          sort_order: idx,
          ...politicas,
        };
        if (!sales?.hasSales) {
          update.price_cents = tierPriceC;
        }
        // Capacity: dejamos siempre el valor (trigger BD enforce floor)
        update.capacity = tierCap;

        const upRes = await supabase
          .from("ticket_tiers")
          .update(comoUpdate(update))
          .eq("id", t.dbId)
          .select("id");
        expectRows(upRes);
      } else {
        const insRes = await supabase
          .from("ticket_tiers")
          .insert(
            comoInsert({
              event_id: eid,
              name: t.name.trim(),
              description: t.description.trim() || null,
              price_cents: tierPriceC,
              currency: "EUR",
              capacity: tierCap,
              per_user_max: t.perUserMax ? parseInt(t.perUserMax, 10) : 4,
              status: estadoDelTipo(t.active),
              sort_order: idx,
              ...politicas,
            })
          )
          .select("id");
        const [creado] = expectRows<{ id: string }>(insRes);
        // Si algo falla después y se vuelve a guardar, este tipo ya existe:
        // se actualiza en vez de crearlo dos veces.
        const key = t._key;
        setTiers((prev) => prev.map((x) => (x._key === key ? { ...x, dbId: creado.id } : x)));
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
                {mode === "create" && borradorDe !== null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-0.5 text-orange-500">
                      Borrador recuperado ·{" "}
                      {new Date(borradorDe).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={descartarBorrador}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Empezar de cero
                    </button>
                  </div>
                )}
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
              {loadingInitial || esperandoContexto ? (
                <div className="flex h-full items-center justify-center text-muted-foreground" role="status">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === "create" ? "Preparando el formulario…" : "Cargando evento…"}
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
                      venues={venues}
                      venueId={venueId}
                      timeZone={timeZone}
                      placeName={venueActual?.city ?? null}
                      onVenueChange={(id) => {
                        const v = venues.find((x) => x.id === id);
                        const anterior = venues.find((x) => x.id === venueId);
                        setVenueId(id);
                        if (v) {
                          setLocation((prev) => ({
                            city: v.city || prev.city,
                            venueName: v.name,
                            address: v.address || prev.address,
                          }));
                          // El día y las horas pasan a ser los del reloj del
                          // nuevo local.
                          setTimeZone(zonaDe(v));
                          // Evento nuevo: el cupo que venía del aforo del local
                          // anterior (o vacío) pasa a ser el del nuevo local. Un
                          // cupo escrito a mano no se toca.
                          if (mode === "create") {
                            setTiers((prev) =>
                              prev.map((t, i) =>
                                i === 0 && !t.dbId && t.capacity === cupoDelLocal(anterior)
                                  ? { ...t, capacity: cupoDelLocal(v) }
                                  : t
                              )
                            );
                          }
                        }
                      }}
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
                      editStatus={mode === "edit" ? originalStatus ?? "draft" : null}
                      disabled={submitting}
                      eventHasSales={eventHasSales}
                      blockedReason={publishBlockedReason}
                    />
                  )}
                  {step === 5 && (
                    <StepReview
                      summary={summary}
                      eventHasSales={eventHasSales}
                      mode={mode}
                      blockedReason={publishBlockedReason}
                    />
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
                disabled={submitting || loadingInitial || esperandoContexto}
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
                {mode === "edit" ? (
                  originalStatus === "draft" && (
                    <Button
                      variant="outline"
                      type="button"
                      disabled={submitting || !!publishBlockedReason}
                      title={publishBlockedReason ?? undefined}
                      onClick={() => submit("published")}
                      className="h-10"
                    >
                      <Send className="mr-1.5 h-4 w-4" />
                      Guardar y publicar
                    </Button>
                  )
                ) : (
                  // Con "Publicar al guardar" apagado el botón principal ya
                  // es "Guardar borrador": no se repite.
                  willPublish && (
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
                  )
                )}
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => submit(mode === "edit" ? "keep" : willPublish ? "published" : "draft")}
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
                  ) : mode === "edit" ? (
                    "Guardar cambios"
                  ) : willPublish ? (
                    <>
                      <Send className="mr-1.5 h-4 w-4" />
                      Publicar evento
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
  venues,
  venueId,
  timeZone,
  placeName,
  onVenueChange,
  disabled,
}: {
  dateTime: DateTimeValue;
  onDateTimeChange: (v: DateTimeValue) => void;
  location: LocationValue;
  onLocationChange: (v: LocationValue) => void;
  cities: City[];
  venues: EditorVenue[];
  venueId: string | null;
  /** Zona horaria del local elegido (el día y las horas son los suyos). */
  timeZone?: string;
  /** Ciudad del local elegido («Hora de <ciudad>»). */
  placeName?: string | null;
  onVenueChange: (id: string) => void;
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
          timeZone={timeZone}
          placeName={placeName}
        />
      </section>
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-orange-500" />
          Ubicación
        </h3>
        {venues.length > 0 && (
          <div className="mb-4">
            {/* "evt-local": "evt-venue" es el nombre del local, más abajo. */}
            <Label htmlFor="evt-local" className="text-xs">
              Local *
            </Label>
            <Select value={venueId ?? ""} onValueChange={onVenueChange} disabled={disabled}>
              <SelectTrigger id="evt-local" className="mt-1.5">
                <SelectValue placeholder="Elige el local" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.city ? ` · ${v.city}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Las ventas, el equipo y los informes de este evento van a este local.
            </p>
          </div>
        )}
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
    subtitle="Define Early Bird, General, VIP, Backstage, Invitación… Cada tipo controla su precio, su cupo, sus devoluciones y si se puede transferir. Lo que ya se ha vendido queda protegido automáticamente."
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
    subtitle="Mejor en vertical, formato 4:5 (el de un cartel): así se ve en la página del evento. JPG, PNG o WEBP de hasta 25 MB; al subirla se reduce y se comprime."
  >
    <div className="mx-auto max-w-sm">
      {imageUrl ? (
        <div className="relative overflow-hidden rounded-2xl border border-border">
          <img
            src={imageUrl}
            alt="Póster"
            className="aspect-[4/5] w-full object-cover"
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
          className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-sm text-muted-foreground transition hover:border-orange-500/50 hover:bg-muted/40 disabled:opacity-50"
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
                4:5 · JPG · PNG · WEBP · máx. 25 MB
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

const EDIT_STATUS_TEXT: Record<string, { title: string; text: string }> = {
  published: {
    title: "Publicado",
    text: "«Guardar cambios» mantiene el evento publicado. Para retirarlo de la venta usa las acciones del evento en Mis eventos.",
  },
  draft: {
    title: "Borrador",
    text: "«Guardar cambios» lo deja como borrador. Usa «Guardar y publicar» para ponerlo a la venta.",
  },
  cancelled: {
    title: "Cancelado",
    text: "Un evento cancelado no vuelve a la venta. Puedes corregir sus datos, pero seguirá cancelado.",
  },
  past: {
    title: "Finalizado",
    text: "El evento ya pasó. Los cambios no lo vuelven a poner a la venta.",
  },
};

const StepPublish = ({
  willPublish,
  onWillPublishChange,
  editStatus,
  disabled,
  eventHasSales,
  blockedReason,
}: {
  willPublish: boolean;
  onWillPublishChange: (v: boolean) => void;
  /** Estado actual en modo edit (null en create/duplicate). */
  editStatus: string | null;
  disabled?: boolean;
  eventHasSales: boolean;
  /** Motivo por el que no se puede publicar (organización suspendida). */
  blockedReason?: string | null;
}) => (
  <StepShell
    eyebrow="Paso 05"
    title={<>Opciones de <span style={serif} className="text-orange-500">publicación</span>.</>}
    subtitle="Guárdalo como borrador para seguir ajustándolo o publícalo ya en el calendario."
  >
    <div className="mx-auto max-w-3xl">
      {blockedReason && <PublishBlockedNote reason={blockedReason} published={editStatus === "published"} />}
      {editStatus ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {editStatus === "published" ? (
              <Eye className="h-4 w-4 text-orange-500" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            )}
            Estado actual: {(EDIT_STATUS_TEXT[editStatus] ?? EDIT_STATUS_TEXT.draft).title}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {(EDIT_STATUS_TEXT[editStatus] ?? EDIT_STATUS_TEXT.draft).text}
          </p>
        </div>
      ) : (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Switch
            checked={willPublish && !blockedReason}
            onCheckedChange={onWillPublishChange}
            disabled={disabled || !!blockedReason}
            className="mt-1"
            aria-label="Publicar al guardar"
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
      )}

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

/**
 * Aviso de que no se puede publicar (organización suspendida). Un evento que
 * ya estaba publicado no se despublica: se oculta al público mientras dure.
 */
const PublishBlockedNote = ({ reason, published }: { reason: string; published?: boolean }) => (
  <div
    className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-[12px] leading-relaxed text-foreground"
    role="note"
  >
    <AlertTriangle className="mt-[1px] h-4 w-4 shrink-0 text-destructive" />
    <span>
      {reason}{" "}
      {published
        ? "Mientras dure, este evento no se ve en la web ni vende entradas; puedes seguir editándolo."
        : "Puedes seguir editando y guardarlo como borrador."}
    </span>
  </div>
);

const StepReview = ({
  summary,
  eventHasSales,
  mode,
  blockedReason,
}: {
  summary: EventSummary;
  eventHasSales: boolean;
  mode: EditorMode;
  blockedReason?: string | null;
}) => {
  const politicas = summarizePolicies(summary.policies ?? []);
  return (
    <StepShell
      eyebrow="Paso 06"
      title={<>Revisa antes de <span style={serif} className="text-orange-500">guardar</span>.</>}
      subtitle="Comprueba que toda la información del evento es correcta. Los clientes verán exactamente esto."
    >
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {blockedReason && (
            <PublishBlockedNote reason={blockedReason} published={mode === "edit" && summary.willPublish} />
          )}
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
                ? `${summary.startTime}h${
                    summary.endTime ? ` → ${summary.endTime}h${summary.crossesMidnight ? " (+1)" : ""}` : ""
                  }${summary.timeZoneLabel ? ` · ${summary.timeZoneLabel}` : ""}`
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
          <ReviewRow label="Devoluciones" value={politicas.refunds.length ? politicas.refunds : "—"} />
          <ReviewRow label="Transferencia" value={politicas.transfers.length ? politicas.transfers : "—"} />
          <ReviewRow
            label="Visibilidad"
            value={
              mode === "edit"
                ? summary.willPublish
                  ? "Publicado (sigue igual al guardar)"
                  : "Sin publicar"
                : summary.willPublish
                ? "Se publicará al guardar"
                : "Borrador (no visible)"
            }
          />
          {eventHasSales && (
            <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 text-[12px] leading-relaxed text-orange-200">
              <strong className="font-semibold">Edición con ventas:</strong> los
              tipos de entrada con tickets vendidos han mantenido su precio. El
              resto de cambios se aplicará al guardar; las devoluciones y la
              transferencia, a las solicitudes nuevas.
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
};

/** Fila del resumen; con varias líneas (una política por tipo), una debajo de otra. */
const ReviewRow = ({ label, value }: { label: string; value: string | string[] }) => (
  <div className="flex items-start gap-4 border-b border-border/60 pb-4">
    <div
      className="w-32 shrink-0 text-[10px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {label}
    </div>
    <div className="flex-1 text-sm font-medium text-foreground first-letter:uppercase">
      {Array.isArray(value) ? (
        value.length === 1 ? (
          value[0]
        ) : (
          <ul className="space-y-1">
            {value.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        )
      ) : (
        value
      )}
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
