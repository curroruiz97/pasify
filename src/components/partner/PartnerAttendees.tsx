import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  Filter,
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

/**
 * PartnerAttendees — sección operativa estilo Eventbrite para gestionar la
 * entrada al evento. Permite al partner:
 *   - seleccionar uno de sus eventos
 *   - ver KPIs en tiempo real (vendidos / entrados / pendientes / % checkin)
 *   - filtrar por estado y buscar por nombre/email
 *   - exportar el listado a CSV
 *   - ver quién escaneó cada ticket y a qué hora
 *
 * Las queries se ejecutan vía las RPCs SECURITY DEFINER:
 *   - public.partner_event_attendees(_event_id)
 *   - public.partner_event_checkin_stats(_event_id)
 * Ambas verifican ownership (partner_id, org_member, o admin) antes de
 * devolver data, por lo que la RLS frontend es transparente.
 *
 * Realtime: nos suscribimos a UPDATE/INSERT sobre `tickets` filtrado por
 * `event_id`. Cuando un escaneo cambia un ticket a 'used' la lista y los
 * KPIs se refrescan sin recargar.
 */

interface Props {
  /** Eventos del partner (vienen ya filtrados desde PartnerDashboard). */
  events: Array<{
    id: string;
    title: string;
    date_start: string;
    city: string;
    capacity: number | null;
    tickets_sold: number;
    status: string;
  }>;
}

type Attendee = {
  ticket_id: string;
  order_id: string | null;
  status: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_email: string;
  buyer_phone: string | null;
  amount_paid_cents: number;
  currency: string;
  paid_at: string | null;
  used_at: string | null;
  used_by_partner_id: string | null;
  scanned_by_name: string | null;
  tier_name: string | null;
  qr_token: string;
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

export const PartnerAttendees = ({ events }: Props) => {
  const { toast } = useToast();
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
  const [selectedEventId, setSelectedEventId] = useState<string | "">(
    upcomingFirst[0]?.id ?? ""
  );
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Re-seleccionar si llegan eventos nuevos y el seleccionado deja de existir
  useEffect(() => {
    if (!selectedEventId && upcomingFirst[0]) {
      setSelectedEventId(upcomingFirst[0].id);
    }
  }, [upcomingFirst, selectedEventId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const loadData = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);
    try {
      const [att, st] = await Promise.all([
        supabase.rpc("partner_event_attendees", { _event_id: selectedEventId }),
        supabase.rpc("partner_event_checkin_stats", { _event_id: selectedEventId }),
      ]);
      if (att.error) throw new Error(att.error.message);
      if (st.error) throw new Error(st.error.message);
      setAttendees((att.data ?? []) as Attendee[]);
      const statsRow = Array.isArray(st.data) ? st.data[0] : st.data;
      setStats(statsRow as Stats);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error cargando asistentes";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: refresca cuando un ticket de ESTE evento cambia (típicamente
  // de paid → used tras un escaneo). También reaccionamos a INSERTs en
  // ticket_scan_logs para conocer scans rechazados en vivo.
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
        () => loadData()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${selectedEventId}`,
        },
        () => loadData()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedEventId, loadData]);

  const filtered = useMemo(() => {
    let list = attendees;
    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => {
        const name =
          `${a.buyer_first_name ?? ""} ${a.buyer_last_name ?? ""}`.toLowerCase();
        return (
          name.includes(q) ||
          (a.buyer_email ?? "").toLowerCase().includes(q) ||
          (a.buyer_phone ?? "").includes(q)
        );
      });
    }
    return list;
  }, [attendees, statusFilter, search]);

  const exportCSV = () => {
    if (filtered.length === 0) {
      toast({ title: "Sin datos", description: "No hay filas que exportar." });
      return;
    }
    const headers = [
      "ticket_id",
      "order_id",
      "estado",
      "nombre",
      "apellidos",
      "email",
      "telefono",
      "tier",
      "importe_eur",
      "pagado_en",
      "entrada_en",
      "escaneado_por",
    ];
    const rows = filtered.map((a) => [
      a.ticket_id,
      a.order_id ?? "",
      STATUS_META[a.status]?.label ?? a.status,
      a.buyer_first_name ?? "",
      a.buyer_last_name ?? "",
      a.buyer_email,
      a.buyer_phone ?? "",
      a.tier_name ?? "—",
      (a.amount_paid_cents / 100).toFixed(2),
      a.paid_at ?? "",
      a.used_at ?? "",
      a.scanned_by_name ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            // Quote y escape de comillas según RFC 4180
            return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");
    // Prepend BOM (U+FEFF) so Excel detecta UTF-8 correctamente al abrir.
    const BOM = String.fromCharCode(0xfeff);
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = selectedEvent?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "evento";
    a.download = `pasify-asistentes-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          <h2 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">
            Asistentes y check-ins
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Listado en tiempo real de compradores y entradas validadas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedEventId} onValueChange={(v) => setSelectedEventId(v)}>
            <SelectTrigger className="w-full min-w-[220px] md:w-auto">
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
            onClick={loadData}
            disabled={loading}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground disabled:opacity-50"
            aria-label="Recargar"
            title="Recargar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={exportCSV}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:border-orange-500/60"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* KPIs row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<TicketIcon className="h-4 w-4" />}
          label="Vendidos"
          value={String(stats?.tickets_sold ?? 0)}
          sub={
            stats?.capacity
              ? `${stats.tickets_sold} de ${stats.capacity}`
              : "sin aforo"
          }
        />
        <KpiCard
          icon={<UserCheck className="h-4 w-4" />}
          label="Han entrado"
          value={String(stats?.tickets_used ?? 0)}
          sub={`${stats?.checkin_pct ?? 0}% check-in`}
          accent
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Por entrar"
          value={String(stats?.tickets_pending ?? 0)}
          sub="aún en puerta"
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4" />}
          label="Reembolsados"
          value={String(stats?.tickets_refunded ?? 0)}
          sub={
            stats?.revenue_cents
              ? `€${((stats.revenue_cents ?? 0) / 100).toFixed(2)} ingresados`
              : "—"
          }
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
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full min-w-[160px] md:w-auto">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="paid">Pendientes de entrar</SelectItem>
              <SelectItem value="used">Han entrado</SelectItem>
              <SelectItem value="refunded">Reembolsados</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table / list */}
      {selectedEvent && stats?.tickets_sold === 0 ? (
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
          subtitle="Cuando se vendan tickets aparecerán aquí en tiempo real, listos para escanear en la puerta."
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
                  <th className="px-4 py-3 text-left">Tier</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Hora entrada</th>
                  <th className="px-4 py-3 text-left">Escaneado por</th>
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
  `${a.buyer_first_name ?? ""} ${a.buyer_last_name ?? ""}`.trim() || "—";

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
    <td className="px-4 py-3 align-middle text-muted-foreground">{a.buyer_email}</td>
    <td className="px-4 py-3 align-middle text-muted-foreground">{a.tier_name ?? "—"}</td>
    <td className="px-4 py-3 align-middle">
      <StatusBadge status={a.status} />
    </td>
    <td className="px-4 py-3 align-middle text-muted-foreground" style={mono}>
      {formatDateTime(a.used_at)}
    </td>
    <td className="px-4 py-3 align-middle text-muted-foreground">
      {a.scanned_by_name ?? "—"}
    </td>
    <td className="px-4 py-3 text-right align-middle font-medium" style={mono}>
      €{(a.amount_paid_cents / 100).toFixed(2)}
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
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {a.buyer_email}
        </div>
      </div>
      <StatusBadge status={a.status} />
    </div>

    <div className="mt-4 grid grid-cols-3 gap-2">
      <Stat label="Tier" value={a.tier_name ?? "—"} />
      <Stat label="Importe" value={`€${(a.amount_paid_cents / 100).toFixed(2)}`} mono />
      <Stat label="Entrada" value={formatDateTime(a.used_at)} mono />
    </div>

    {a.scanned_by_name && a.status === "used" && (
      <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        Escaneado por <span className="text-foreground">{a.scanned_by_name}</span>
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
