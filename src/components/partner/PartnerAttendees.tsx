import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Ticket as TicketIcon,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { useToast } from "@/hooks/use-toast";
import { pickActiveEvent } from "@/lib/pickActiveEvent";
import {
  fileDateStamp,
  formatCsvDateTime,
  formatEurosCsv,
  saveOrShareFile,
  slugForFilename,
  toCsv,
  type CsvCell,
} from "@/lib/saveOrShareFile";

/**
 * PartnerAttendees — asistentes y entradas validadas de un evento.
 *   - selector de evento (por defecto el de ahora, vía pickActiveEvent)
 *   - KPIs (vendidas / han entrado / por entrar / reembolsadas)
 *   - filtros por estado y tipo de entrada, búsqueda sin tildes
 *   - exportación a CSV (también en la app, vía hoja de compartir)
 *
 * Datos por RPC SECURITY DEFINER, que comprueban permisos:
 *   - public.partner_event_attendees(_event_id): ya NO devuelve qr_token (era
 *     una credencial por asistente) y, para el rol de puerta, email y
 *     teléfono llegan a null.
 *   - public.partner_event_checkin_stats(_event_id)
 *
 * Realtime: UPDATE/INSERT sobre `tickets` del evento refrescan la lista
 * (típicamente paid → used tras un escaneo).
 */

export interface AttendeesEvent {
  id: string;
  title: string;
  date_start: string;
  date_end?: string | null;
  city: string;
  capacity: number | null;
  tickets_sold: number;
  status: string;
}

interface Props {
  /** Eventos del local (vienen ya filtrados desde PartnerDashboard). */
  events: AttendeesEvent[];
}

type Attendee = {
  ticket_id: string;
  order_id: string | null;
  status: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  /** null para el rol de puerta. */
  buyer_email: string | null;
  /** null para el rol de puerta. */
  buyer_phone: string | null;
  amount_paid_cents: number;
  currency: string | null;
  paid_at: string | null;
  used_at: string | null;
  used_by_partner_id: string | null;
  scanned_by_name: string | null;
  tier_name: string | null;
};

type Stats = {
  capacity: number | null;
  tickets_sold: number;
  tickets_used: number;
  tickets_pending: number;
  tickets_refunded: number;
  revenue_cents: number;
  checkin_pct: number;
};

type StatusFilter = "all" | "paid" | "used" | "refunded" | "cancelled";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  paid: {
    label: "Pendiente",
    cls: "bg-orange-500/10 text-orange-500 border-orange-500/30",
    icon: Clock,
  },
  used: {
    label: "Entró",
    cls: "bg-success/15 text-success border-success/30",
    icon: CheckCircle2,
  },
  refunded: {
    label: "Reembolsado",
    cls: "bg-muted text-muted-foreground border-border",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelado",
    cls: "bg-destructive/10 text-destructive border-destructive/30",
    icon: XCircle,
  },
  pending: {
    label: "Pago pendiente",
    cls: "bg-warning/15 text-warning border-warning/30",
    icon: Clock,
  },
};

/** Minúsculas y sin tildes: "José" encuentra "jose" y al revés. */
const normalizeText = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const digitsOnly = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

const formatEur = (cents: number | null | undefined) =>
  `${((cents ?? 0) / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const PartnerAttendees = ({ events }: Props) => {
  const { toast } = useToast();

  // Selector: próximos primero (el más cercano delante), después los pasados
  // (el más reciente delante).
  const upcomingFirst = useMemo(() => {
    const now = Date.now();
    const list = [...events];
    list.sort((a, b) => {
      const da = new Date(a.date_start).getTime();
      const db = new Date(b.date_start).getTime();
      const aPast = da < now;
      const bPast = db < now;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? db - da : da - db;
    });
    return list;
  }, [events]);

  // Evento por defecto: el de ahora (en curso o el próximo); si no hay, el
  // primero de la lista (el pasado más reciente).
  const defaultEventId = useMemo(
    () => pickActiveEvent(events)?.id ?? upcomingFirst[0]?.id ?? "",
    [events, upcomingFirst]
  );

  const [selectedEventId, setSelectedEventId] = useState<string>(defaultEventId);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const requestRef = useRef(0);

  // Si aún no hay evento elegido o el elegido desaparece, vuelta al de por defecto.
  useEffect(() => {
    if (selectedEventId && events.some((e) => e.id === selectedEventId)) return;
    if (defaultEventId !== selectedEventId) setSelectedEventId(defaultEventId);
  }, [events, selectedEventId, defaultEventId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const loadData = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const [att, st] = await Promise.all([
        supabase.rpc("partner_event_attendees", { _event_id: selectedEventId }),
        supabase.rpc("partner_event_checkin_stats", { _event_id: selectedEventId }),
      ]);
      if (att.error) throw new Error(att.error.message);
      if (st.error) throw new Error(st.error.message);
      if (requestId !== requestRef.current) return;
      setAttendees((att.data ?? []) as unknown as Attendee[]);
      const statsRow = Array.isArray(st.data) ? st.data[0] : st.data;
      setStats((statsRow ?? null) as Stats | null);
      setLoadError(null);
    } catch (e: unknown) {
      if (requestId !== requestRef.current) return;
      const msg = e instanceof Error ? e.message : "Error cargando asistentes";
      setLoadError(msg);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [selectedEventId]);

  // Al cambiar de evento no se enseñan los asistentes del anterior.
  useEffect(() => {
    setAttendees([]);
    setStats(null);
    setLoadError(null);
    setTierFilter("all");
    void loadData();
  }, [loadData]);

  // Realtime: refresca cuando un ticket de ESTE evento cambia.
  useEffect(() => {
    if (!selectedEventId) return;
    const channel = supabase
      .channel(`attendees-${selectedEventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${selectedEventId}`,
        },
        () => void loadData()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${selectedEventId}`,
        },
        () => void loadData()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedEventId, loadData]);

  // Tipos de entrada presentes para el filtro. "Sin tipo" agrupa las entradas
  // sin tier (legacy / pase de festival sin asignar).
  const availableTiers = useMemo(() => {
    const set = new Map<string, string>();
    for (const a of attendees) {
      const key = a.tier_name ?? "__none__";
      const label = a.tier_name ?? "Sin tipo";
      if (!set.has(key)) set.set(key, label);
    }
    return Array.from(set.entries()).map(([key, label]) => ({ key, label }));
  }, [attendees]);

  const filtered = useMemo(() => {
    let list = attendees;
    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }
    if (tierFilter !== "all") {
      list = list.filter((a) => (a.tier_name ?? "__none__") === tierFilter);
    }
    const q = normalizeText(search.trim());
    if (q) {
      const qDigits = digitsOnly(q);
      list = list.filter((a) => {
        const name = normalizeText(`${a.buyer_first_name ?? ""} ${a.buyer_last_name ?? ""}`);
        return (
          name.includes(q) ||
          normalizeText(a.buyer_email).includes(q) ||
          (qDigits.length >= 3 && digitsOnly(a.buyer_phone).includes(qDigits))
        );
      });
    }
    return list;
  }, [attendees, statusFilter, tierFilter, search]);

  const exportCSV = async () => {
    if (filtered.length === 0) {
      toast({ title: "Sin datos", description: "No hay filas que exportar." });
      return;
    }
    setExporting(true);
    try {
      const eventTitle = selectedEvent?.title ?? "";
      const rows: CsvCell[][] = [
        [
          "Evento",
          "Nombre",
          "Apellidos",
          "Email",
          "Teléfono",
          "Tipo de entrada",
          "Estado",
          "Importe",
          "Moneda",
          "Pagada el",
          "Entró el",
          "Validada por",
          "ID de la entrada",
          "ID del pedido",
        ],
        ...filtered.map((a): CsvCell[] => [
          eventTitle,
          a.buyer_first_name ?? "",
          a.buyer_last_name ?? "",
          a.buyer_email ?? "",
          a.buyer_phone ?? "",
          a.tier_name ?? "Sin tipo",
          STATUS_META[a.status]?.label ?? a.status,
          formatEurosCsv(a.amount_paid_cents),
          (a.currency ?? "EUR").toUpperCase(),
          formatCsvDateTime(a.paid_at),
          formatCsvDateTime(a.used_at),
          a.used_at ? (a.scanned_by_name ?? "") : "",
          a.ticket_id,
          a.order_id ?? "",
        ]),
      ];
      await saveOrShareFile({
        filename: `pasify-asistentes-${slugForFilename(eventTitle, "evento")}-${fileDateStamp()}.csv`,
        mimeType: "text/csv;charset=utf-8",
        data: toCsv(rows),
        dialogTitle: "Exportar asistentes",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error preparando el fichero";
      console.error("[PartnerAttendees] exportCSV:", err);
      toast({ title: "No se pudo exportar el CSV", description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (events.length === 0) {
    return (
      <PasifyEmptyState
        icon={<Users className="h-7 w-7" />}
        eyebrow="Sin eventos"
        title={
          <>
            Aún no tienes{" "}
            <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>
              eventos
            </span>{" "}
            publicados.
          </>
        }
        subtitle="Cuando publiques tu primer evento podrás gestionar la entrada y ver el listado de asistentes desde aquí."
      />
    );
  }

  const showInitialLoading = loading && stats === null && !loadError;

  return (
    <div className="space-y-6">
      {/* Header: event selector + refresh + export */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Control de puerta
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
            Asistentes y check-ins
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compradores y entradas validadas, al momento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedEventId} onValueChange={(v) => setSelectedEventId(v)}>
            <SelectTrigger className="w-full min-w-[220px] md:w-auto" aria-label="Evento">
              <SelectValue placeholder="Selecciona evento" />
            </SelectTrigger>
            <SelectContent>
              {upcomingFirst.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title} · {new Date(e.date_start).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground disabled:opacity-50"
            aria-label="Recargar"
            title="Recargar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => void exportCSV()}
            disabled={exporting || filtered.length === 0}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:border-orange-500/60 disabled:opacity-50"
            aria-label="Exportar CSV"
            title="Exportar CSV"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
          style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {stats ? "No se han podido actualizar los asistentes" : "No pudimos cargar los asistentes"}
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {stats ? "Lo que ves son los últimos datos recibidos. " : ""}
              Detalle: {loadError}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-orange-500/40 disabled:opacity-50"
          >
            Reintentar
          </button>
        </div>
      )}

      {showInitialLoading && (
        <PasifyEmptyState
          icon={<Users className="h-7 w-7" />}
          eyebrow="Cargando"
          title="Cargando asistentes…"
          spin
          compact
        />
      )}

      {stats && (
        <>
          {/* KPIs row */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              icon={<TicketIcon className="h-4 w-4" />}
              label="Vendidos"
              value={String(stats.tickets_sold ?? 0)}
              sub={stats.capacity ? `${stats.tickets_sold} de ${stats.capacity}` : "sin aforo definido"}
            />
            <KpiCard
              icon={<UserCheck className="h-4 w-4" />}
              label="Han entrado"
              value={String(stats.tickets_used ?? 0)}
              sub={`${stats.checkin_pct ?? 0} % check-in`}
              accent
            />
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              label="Por entrar"
              value={String(stats.tickets_pending ?? 0)}
              sub="aún en puerta"
            />
            <KpiCard
              icon={<XCircle className="h-4 w-4" />}
              label="Reembolsados"
              value={String(stats.tickets_refunded ?? 0)}
              sub={stats.revenue_cents ? `${formatEur(stats.revenue_cents)} ingresados` : "—"}
            />
          </div>

          {/* Search + status filter */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, email o teléfono..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Buscar asistentes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-full min-w-[160px] md:w-auto" aria-label="Estado">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="paid">Pendientes de entrar</SelectItem>
                  <SelectItem value="used">Han entrado</SelectItem>
                  <SelectItem value="refunded">Reembolsados</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                </SelectContent>
              </Select>
              {availableTiers.length > 0 && (
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="w-full min-w-[180px] md:w-auto" aria-label="Tipo de entrada">
                    <SelectValue placeholder="Tipo de entrada" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los tipos</SelectItem>
                    {availableTiers.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Table / list */}
          {selectedEvent && stats.tickets_sold === 0 && attendees.length === 0 ? (
            <PasifyEmptyState
              icon={<TicketIcon className="h-7 w-7" />}
              eyebrow="Sin ventas"
              title={
                <>
                  Este evento aún no tiene{" "}
                  <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>
                    entradas
                  </span>{" "}
                  vendidas.
                </>
              }
              subtitle="Cuando se vendan aparecerán aquí al momento, listas para validar en la puerta."
            />
          ) : filtered.length === 0 ? (
            <PasifyEmptyState
              icon={<Search className="h-7 w-7" />}
              eyebrow="Sin coincidencias"
              title="Ningún asistente con esos filtros"
              subtitle="Prueba a quitar el filtro de estado o limpiar la búsqueda."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
                <table className="w-full text-sm">
                  <thead
                    className="border-b border-border bg-card/60 text-[10px] uppercase text-muted-foreground"
                    style={{ ...mono, letterSpacing: "0.16em" }}
                  >
                    <tr>
                      <th className="px-4 py-3 text-left">Comprador</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Tipo</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      <th className="px-4 py-3 text-left">Hora entrada</th>
                      <th className="px-4 py-3 text-left">Validada por</th>
                      <th className="px-4 py-3 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((a) => (
                      <AttendeeRow key={a.ticket_id} attendee={a} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="grid gap-3 md:hidden">
                {filtered.map((a) => (
                  <AttendeeCard key={a.ticket_id} attendee={a} />
                ))}
              </div>
            </>
          )}

          {/* Footer count */}
          {filtered.length > 0 && (
            <div
              className="text-[11px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.18em" }}
            >
              Mostrando {filtered.length} de {attendees.length} asistentes
            </div>
          )}
        </>
      )}
    </div>
  );
};

// =============================================================
// Sub-components
// =============================================================

const KpiCard = ({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) => (
  <div
    className="rounded-2xl border border-border bg-card p-4"
    style={
      accent
        ? {
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -22px rgba(232,84,42,0.22)",
            borderColor: "rgba(232,84,42,0.30)",
          }
        : { boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }
    }
  >
    <div
      className={`mb-1 inline-flex items-center gap-1.5 text-[10px] uppercase ${
        accent ? "text-orange-500" : "text-muted-foreground"
      }`}
      style={{ ...mono, letterSpacing: "0.18em" }}
    >
      {icon}
      {label}
    </div>
    <div className="text-2xl font-bold leading-none tracking-tight text-foreground md:text-3xl">
      {value}
    </div>
    {sub && (
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    )}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const meta = STATUS_META[status] ?? STATUS_META["paid"];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
};

const fullName = (a: Attendee) =>
  `${a.buyer_first_name ?? ""} ${a.buyer_last_name ?? ""}`.trim() || "Sin nombre";

const formatDateTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const AttendeeRow = ({ attendee: a }: { attendee: Attendee }) => (
  <tr className="transition-colors hover:bg-muted/30">
    <td className="px-4 py-3 align-middle">
      <div className="font-medium text-foreground">{fullName(a)}</div>
      {a.buyer_phone && (
        <div className="text-[11px] text-muted-foreground">{a.buyer_phone}</div>
      )}
    </td>
    <td className="px-4 py-3 align-middle text-muted-foreground">{a.buyer_email ?? "—"}</td>
    <td className="px-4 py-3 align-middle text-muted-foreground">{a.tier_name ?? "—"}</td>
    <td className="px-4 py-3 align-middle">
      <StatusBadge status={a.status} />
    </td>
    <td className="px-4 py-3 align-middle text-muted-foreground" style={mono}>
      {formatDateTime(a.used_at)}
    </td>
    <td className="px-4 py-3 align-middle text-muted-foreground">
      {a.used_at ? (a.scanned_by_name ?? "—") : "—"}
    </td>
    <td className="px-4 py-3 text-right align-middle font-medium" style={mono}>
      {formatEur(a.amount_paid_cents)}
    </td>
  </tr>
);

const AttendeeCard = ({ attendee: a }: { attendee: Attendee }) => (
  <article className="rounded-2xl border border-border bg-card p-4">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground">
          {fullName(a)}
        </h3>
        {(a.buyer_email || a.buyer_phone) && (
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {a.buyer_email ?? a.buyer_phone}
          </div>
        )}
      </div>
      <StatusBadge status={a.status} />
    </div>

    <div className="mt-4 grid grid-cols-3 gap-2">
      <Stat label="Tipo" value={a.tier_name ?? "—"} />
      <Stat label="Importe" value={formatEur(a.amount_paid_cents)} mono />
      <Stat label="Entrada" value={formatDateTime(a.used_at)} mono />
    </div>

    {a.scanned_by_name && a.status === "used" && (
      <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        Validada por <span className="text-foreground">{a.scanned_by_name}</span>
      </div>
    )}
  </article>
);

const Stat = ({ label, value, mono: isMono }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <div
      className="text-[9.5px] uppercase text-muted-foreground"
      style={{ ...mono, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div
      className="mt-0.5 truncate text-[13px] font-semibold text-foreground"
      style={isMono ? mono : undefined}
    >
      {value}
    </div>
  </div>
);

export default PartnerAttendees;
