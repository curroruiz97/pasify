import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  Euro,
  Loader2,
  RefreshCcw,
  ScanLine,
  Star,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { RefreshIndicator } from "@/components/ui/refresh-indicator";
import { filtroEventosDelLocal, orgIdsDelLocal, timed } from "@/hooks/queries/partnerData";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { getErrorMessage } from "@/lib/sentry";
import { TimeoutError } from "@/lib/withTimeout";
import { addDaysToDate } from "@/components/partner/zonedTime";
import {
  diasDesdeEnero,
  fechaDeEtiqueta,
  momentoEnMadrid,
  ventanaDelInforme,
  type VentanaInforme,
} from "@/components/partner/reportWindow";
import {
  fileDateStamp,
  formatCsvDateTime,
  formatEurosCsv,
  saveOrShareFile,
  toCsv,
  type CsvCell,
} from "@/lib/saveOrShareFile";

/**
 * PartnerReports — métricas y BI del partner con datos reales.
 *
 * Antes este componente era 100% mock (`buildSeries()` local). Ahora
 * todas las cifras provienen de queries SQL contra `tickets`, de los eventos
 * del local (los que creó y los de sus organizaciones) y de los últimos N días
 * de Madrid (reportWindow.ts).
 *
 * Las cifras son completas o no se enseñan: se lee de mil en mil filas hasta
 * agotarlas (PostgREST corta cada respuesta en 1.000) y, si una lectura falla,
 * sale «Informe incompleto» con su «Reintentar» en vez de números a medias.
 *
 * Si el partner no tiene ventas todavía, mostramos empty state honesto
 * con CTA "Crea tu primer evento" en lugar de cifras mock que engañan.
 *
 * Métricas mostradas (todas reales):
 *   - KPIs: entradas vendidas, recaudado, clientes únicos, tasa entrada
 *   - Serie diaria de ventas + ingresos
 *   - Top eventos por recaudación
 *   - Heatmap día/hora de compras
 *
 * Top RRPP, channels y retention quedan documentados como roadmap en
 * `docs/HARDENING-PENDING.md` porque requieren columnas extra en
 * `tickets` (rrpp_id, source) y/o joins con buyer_user_id.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

type Range = "7d" | "30d" | "90d" | "ytd";

const RANGE_LABEL: Record<Range, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  ytd: "Este año",
};

interface TicketRow {
  id: string;
  event_id: string;
  status: string;
  amount_paid_cents: number;
  paid_at: string | null;
  used_at: string | null;
  buyer_user_id: string | null;
  buyer_email: string | null;
}

interface EventRow {
  id: string;
  title: string;
}

const rangeToDays = (range: Range, ahora: Date): number => {
  switch (range) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    case "ytd": return diasDesdeEnero(ahora);
  }
};

/** Rango anterior (solo para el delta): menos columnas. */
type PrevTicketRow = Pick<TicketRow, "id" | "status" | "amount_paid_cents" | "paid_at">;

interface ReportsData {
  tickets: TicketRow[];
  prevTickets: PrevTicketRow[];
  /** Títulos de los eventos del rango (objeto plano: la caché no guarda Map). */
  eventTitles: Record<string, string>;
  /**
   * Días (de Madrid) con los que se leyó. La gráfica sale de esta misma
   * ventana y no de la hora a la que se pinta, para que sumen lo mismo que los
   * KPIs y el CSV aunque se pinte pasada la medianoche.
   */
  ventana: VentanaInforme;
  /** Se llegó al tope de páginas: hay más ventas de las leídas. */
  parcial: boolean;
  /** El periodo previo tampoco se leyó entero: su delta no es fiable. */
  previoParcial: boolean;
}

const SIN_TICKETS: TicketRow[] = [];
const SIN_TICKETS_PREVIOS: PrevTicketRow[] = [];

/** PostgREST corta cada respuesta en 1.000 filas (db-max-rows de Supabase): se pide de mil en mil. */
const FILAS_POR_PAGINA = 1_000;
/** Tope de seguridad: 50 páginas = 50.000 ventas por lectura. Pasado eso, el informe sale marcado como parcial. */
const MAX_PAGINAS = 50;
/** Ids por consulta de títulos: un `in.(…)` con cientos de uuids pasaría del límite de la URL. */
const IDS_POR_CONSULTA = 100;

interface LecturaPaginada<T> {
  filas: T[];
  /** false si se paró en el tope de páginas con más filas por leer. */
  completo: boolean;
}

/**
 * Lee una consulta en páginas de FILAS_POR_PAGINA hasta agotarla. `pedir` debe
 * llevar un orden total (created_at, id): con offsets, una página se parte en
 * dos o se repite si el orden no es estable. Cualquier página que falle (error
 * de la consulta o timeout) rechaza la lectura entera: nunca se devuelve la
 * mitad. Con `corte.cortada`, la lectura para antes de la página siguiente (si
 * la otra lectura del informe ya ha fallado, no hay que seguir pidiendo).
 */
async function leerPaginas<T extends { id: string }>(
  etiqueta: string,
  corte: { cortada: boolean },
  pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<LecturaPaginada<T>> {
  const filas: T[] = [];
  const vistas = new Set<string>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (corte.cortada) throw new Error(`[informes] ${etiqueta}: lectura cortada`);
    const desde = pagina * FILAS_POR_PAGINA;
    const { data, error } = await timed(pedir(desde, desde + FILAS_POR_PAGINA - 1), `${etiqueta}.${pagina + 1}`);
    if (error) throw error;
    const lote = data ?? [];
    // Una venta que cambia de sitio mientras se lee (se paga una reserva, p. ej.) puede salir en dos páginas.
    for (const fila of lote) {
      if (vistas.has(fila.id)) continue;
      vistas.add(fila.id);
      filas.push(fila);
    }
    if (lote.length < FILAS_POR_PAGINA) return { filas, completo: true };
  }
  return { filas, completo: false };
}

/** Títulos de los eventos (objeto plano: la caché no guarda Map). */
async function leerTitulos(eventIds: string[]): Promise<Record<string, string>> {
  const titulos: Record<string, string> = {};
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const trozos: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) trozos.push(ids.slice(i, i + IDS_POR_CONSULTA));
  const respuestas = await Promise.all(
    trozos.map((trozo) => timed(supabase.from("events").select("id, title").in("id", trozo), "informes.eventos")),
  );
  for (const { data, error } of respuestas) {
    if (error) throw error;
    for (const e of (data ?? []) as EventRow[]) titulos[e.id] = e.title;
  }
  return titulos;
}

async function leerInformes(uid: string, range: Range): Promise<ReportsData> {
  const ahora = new Date();
  const ventana = ventanaDelInforme(rangeToDays(range, ahora), ahora);

  // Los mismos eventos que «Mis eventos»: los que creó este usuario y los de sus
  // organizaciones. Filtrar solo por partner_id perdía los de otros miembros.
  // `estricto`: sin saber las organizaciones faltarían ventas sin avisar.
  const orgIds = await orgIdsDelLocal(uid, { estricto: true });
  const delLocal = filtroEventosDelLocal(uid, orgIds);

  // tickets NO tiene partner_id ni org_id: el vínculo va por tickets.event_id ->
  // events. El !inner fuerza el join para poder filtrar por las columnas de la
  // tabla relacionada. Las dos lecturas (periodo y previo) van a la vez.
  const corte = { cortada: false };
  const [actual, previo] = await Promise.all([
    leerPaginas<TicketRow>("informes.tickets", corte, (desde, hasta) =>
      supabase
        .from("tickets")
        .select(
          "id, event_id, status, amount_paid_cents, paid_at, used_at, buyer_user_id, buyer_email, events!inner(partner_id,org_id)",
        )
        .or(delLocal, { referencedTable: "events" })
        .in("status", ["paid", "used"])
        .gte("paid_at", ventana.inicio)
        .lt("paid_at", ventana.fin)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
    // Periodo previo (para el delta): de la misma longitud, justo antes.
    leerPaginas<PrevTicketRow>("informes.previo", corte, (desde, hasta) =>
      supabase
        .from("tickets")
        .select("id, status, amount_paid_cents, paid_at, events!inner(partner_id,org_id)")
        .or(delLocal, { referencedTable: "events" })
        .in("status", ["paid", "used"])
        .gte("paid_at", ventana.inicioPrevio)
        .lt("paid_at", ventana.inicio)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
  ]).catch((err: unknown) => {
    corte.cortada = true; // la otra lectura no sigue pidiendo páginas de un informe que ya no vale
    throw err;
  });

  // Eventos referenciados para top events / titulares
  const eventTitles = await leerTitulos(actual.filas.map((t) => t.event_id));

  return {
    tickets: actual.filas,
    prevTickets: previo.filas,
    eventTitles,
    ventana,
    parcial: !actual.completo,
    previoParcial: !previo.completo,
  };
}

/** Texto del fallo para quien mira el informe. */
const describirFallo = (err: unknown): string =>
  err instanceof TimeoutError
    ? "El servidor no responde. Revisa tu conexión y vuelve a intentarlo."
    : getErrorMessage(err);

export const PartnerReports = () => {
  const { toast } = useToast();
  const uid = useCurrentUserId();
  const [range, setRange] = useState<Range>("30d");

  // Informes en la caché, por rango. Llevan emails de compradores: solo en
  // memoria (nunca en el dispositivo) y fuera a la media hora sin verse. Al
  // cambiar de rango se siguen viendo los del anterior hasta que llegan.
  const query = useQuery({
    queryKey: qk.partner.reports(uid ?? "", range),
    queryFn: () => leerInformes(uid as string, range),
    enabled: !!uid,
    placeholderData: keepPreviousData,
    gcTime: 30 * 60_000,
  });
  const data = query.data;
  const tickets = data?.tickets ?? SIN_TICKETS;
  const prevTickets = data?.prevTickets ?? SIN_TICKETS_PREVIOS;
  const events = useMemo(() => {
    const m = new Map<string, EventRow>();
    for (const [id, title] of Object.entries(data?.eventTitles ?? {})) m.set(id, { id, title });
    return m;
  }, [data?.eventTitles]);
  // Solo la primera vez (sin nada que enseñar) hay "Cargando métricas…".
  const loading = !!uid && query.isPending;
  // Una lectura fallida sin nada que enseñar es un informe incompleto: ni
  // cifras a medias ni «aún no hay ventas». Con un informe completo de antes a
  // la vista, un refresco fallido solo se avisa (y se puede reintentar).
  const incompleto = query.isError && data === undefined;
  const desactualizado = query.isError && data !== undefined;
  const refrescando = query.isFetching && !!data;

  useEffect(() => {
    if (query.error) console.error("[PartnerReports] load:", query.error);
  }, [query.error]);

  // Día y hora de cada venta en Madrid (como el CSV): los comparten la
  // gráfica y el heatmap.
  const momentos = useMemo(() => tickets.map((t) => momentoEnMadrid(t.paid_at)), [tickets]);

  // Agregados
  const stats = useMemo(() => {
    const sold = tickets.length;
    const revenue = tickets.reduce((s, t) => s + (t.amount_paid_cents ?? 0), 0);
    const used = tickets.filter((t) => t.status === "used").length;
    const usageRate = sold > 0 ? Math.round((used / sold) * 100) : 0;
    const uniqueBuyers = new Set(
      tickets.map((t) => t.buyer_user_id ?? t.buyer_email ?? "")
        .filter((x) => x.length > 0)
    ).size;

    // El periodo previo dura lo mismo y acaba donde empieza este. Si uno de los
    // dos no se pudo leer entero, el delta se calla antes que enseñar uno falso.
    const prevSold = prevTickets.length;
    const prevRev = prevTickets.reduce((s, t) => s + (t.amount_paid_cents ?? 0), 0);
    const comparable = !data?.parcial && !data?.previoParcial;
    const deltaSoldPct = !comparable ? null : prevSold > 0 ? ((sold - prevSold) / prevSold) * 100 : 0;
    const deltaRevPct = !comparable ? null : prevRev > 0 ? ((revenue - prevRev) / prevRev) * 100 : 0;

    return { sold, revenue, used, usageRate, uniqueBuyers, deltaSoldPct, deltaRevPct };
  }, [tickets, prevTickets, data?.parcial, data?.previoParcial]);

  // Serie diaria: una columna por día de la ventana con la que se leyó (la
  // misma que filtra los KPIs), así que la suma de la gráfica es la de los KPIs.
  const ventana = data?.ventana;
  const series = useMemo(() => {
    if (!ventana) return [];
    const buckets = new Map<string, { sold: number; rev: number }>();
    for (let i = 0; i < ventana.dias; i++) {
      buckets.set(addDaysToDate(ventana.primerDia, i), { sold: 0, rev: 0 });
    }
    tickets.forEach((t, i) => {
      const cur = buckets.get(momentos[i]?.dia ?? "");
      if (cur) {
        cur.sold++;
        cur.rev += t.amount_paid_cents ?? 0;
      }
    });
    return Array.from(buckets.entries()).map(([day, v]) => ({
      day,
      date: fechaDeEtiqueta(day),
      sold: v.sold,
      revenueCents: v.rev,
    }));
  }, [tickets, momentos, ventana]);

  // Top eventos por recaudación
  const topEvents = useMemo(() => {
    const map = new Map<string, { sold: number; rev: number; title: string }>();
    for (const t of tickets) {
      const cur = map.get(t.event_id);
      if (cur) {
        cur.sold++;
        cur.rev += t.amount_paid_cents ?? 0;
      } else {
        map.set(t.event_id, {
          sold: 1,
          rev: t.amount_paid_cents ?? 0,
          title: events.get(t.event_id)?.title ?? "Evento",
        });
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5);
  }, [tickets, events]);

  // Heatmap dia/hora (Dom=0..Sáb=6), en hora de Madrid
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const m of momentos) {
      if (m) grid[m.diaSemana][m.hora]++;
    }
    return grid;
  }, [momentos]);

  const [exporting, setExporting] = useState(false);

  // CSV para Excel en español (";" y coma decimal), horas de Madrid y el
  // título del evento en vez de su UUID. En la app se abre la hoja de
  // compartir: el <a download> de antes no hacía nada en iOS/Android.
  // Sin datos de compradores (decisión D15: nada de emails en la analítica):
  // la lista de personas está en Asistentes.
  const exportCsv = async () => {
    if (tickets.length === 0) {
      toast({ title: "Nada que exportar", description: "Aún no tienes ventas en este rango." });
      return;
    }
    setExporting(true);
    try {
      const statusLabel: Record<string, string> = { paid: "Pagada", used: "Usada" };
      const rows: CsvCell[][] = [
        ["Evento", "Estado", "Importe (€)", "Pagada el", "Usada el", "ID de la entrada"],
        ...tickets.map((t): CsvCell[] => [
          events.get(t.event_id)?.title ?? t.event_id,
          statusLabel[t.status] ?? t.status,
          formatEurosCsv(t.amount_paid_cents),
          formatCsvDateTime(t.paid_at),
          formatCsvDateTime(t.used_at),
          t.id,
        ]),
      ];
      await saveOrShareFile({
        filename: `pasify-ventas-${range}-${fileDateStamp()}.csv`,
        mimeType: "text/csv;charset=utf-8",
        data: toCsv(rows),
        dialogTitle: "Exportar ventas",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error preparando el fichero";
      console.error("[PartnerReports] exportCsv:", err);
      toast({ title: "No se pudo exportar el CSV", description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <BarChart3 className="h-3 w-3" />
            Reports
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-3xl">
              {RANGE_LABEL[range]}
            </h2>
            <RefreshIndicator active={refrescando} />
          </div>
          {/* Con el informe incompleto no hay ninguna cifra que dar, tampoco «0 tickets». */}
          {!incompleto && (
            <p className="mt-1 text-xs text-muted-foreground" style={mono}>
              Datos reales · {tickets.length} {tickets.length === 1 ? "ticket" : "tickets"} en el rango
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="h-10 w-40 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 días</SelectItem>
              <SelectItem value="30d">30 días</SelectItem>
              <SelectItem value="90d">90 días</SelectItem>
              <SelectItem value="ytd">Año</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={tickets.length === 0 || exporting}
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Exportar CSV
          </Button>
        </div>
      </header>

      {incompleto && (
        <InformeIncompleto
          detalle={describirFallo(query.error)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}

      {desactualizado && (
        <InformeDesactualizado onRetry={() => void query.refetch()} retrying={query.isFetching} />
      )}

      {data?.parcial && <InformeParcial />}

      {loading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
          Cargando métricas reales…
        </div>
      )}

      {!loading && tickets.length === 0 && !incompleto && (
        <PasifyEmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          eyebrow="Sin datos todavía"
          title={<>Aún no hay <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic", fontWeight: 400, color: "#FF7A4D" }}>ventas</span> en este rango.</>}
          subtitle="Cuando empieces a vender tickets aparecerán aquí KPIs, serie diaria, top eventos y heatmap de horas. Datos reales, sin maquillaje."
        />
      )}

      {!loading && tickets.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <Kpi
              testId="kpi-entradas"
              icon={<Ticket className="h-4 w-4" />}
              color="#FF7A4D"
              eyebrow="Entradas vendidas"
              value={stats.sold.toString()}
              deltaPct={stats.deltaSoldPct}
            />
            <Kpi
              testId="kpi-recaudado"
              icon={<Euro className="h-4 w-4" />}
              color="#E8542A"
              eyebrow="Recaudado"
              value={`${(stats.revenue / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€`}
              deltaPct={stats.deltaRevPct}
            />
            <Kpi
              icon={<Users className="h-4 w-4" />}
              color="#4DB87A"
              eyebrow="Compradores únicos"
              value={stats.uniqueBuyers.toString()}
              deltaPct={null}
            />
            <Kpi
              icon={<ScanLine className="h-4 w-4" />}
              color="#E8B04C"
              eyebrow="Tasa entrada"
              value={`${stats.usageRate}%`}
              deltaPct={null}
              sub={`${stats.used}/${stats.sold} usados`}
            />
          </section>

          <RevenueChart series={series} />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <TopEvents items={topEvents} />
            <HoursHeatmap grid={heatmap} />
          </div>
        </>
      )}
    </div>
  );
};

// =============================================================
// KPI
// =============================================================

const Kpi = ({
  icon,
  color,
  eyebrow,
  value,
  deltaPct,
  sub,
  testId,
}: {
  icon: React.ReactNode;
  color: string;
  eyebrow: string;
  value: string;
  deltaPct: number | null;
  sub?: string;
  /** Para los tests: el KPI, su valor (`<id>-valor`) y su delta (`<id>-delta`). */
  testId?: string;
}) => (
  <article
    data-testid={testId}
    className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition hover:-translate-y-0.5"
    style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
  >
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-12 -top-12 h-24 w-24 rounded-full opacity-50"
      style={{ background: `${color}33`, filter: "blur(30px)" }}
    />
    <div className="relative flex items-start justify-between">
      <div
        className="grid h-9 w-9 place-items-center rounded-xl text-white"
        style={{ background: color }}
      >
        {icon}
      </div>
      {deltaPct !== null && (
        <span
          data-testid={testId ? `${testId}-delta` : undefined}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
          style={{
            ...mono,
            background: deltaPct >= 0 ? "rgba(77,184,122,0.15)" : "rgba(184,56,26,0.15)",
            color: deltaPct >= 0 ? "#4DB87A" : "#FF7A4D",
          }}
        >
          {deltaPct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(deltaPct).toFixed(0)}%
        </span>
      )}
    </div>
    <div className="relative mt-3">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        {eyebrow}
      </div>
      <div
        data-testid={testId ? `${testId}-valor` : undefined}
        className="mt-0.5 text-2xl font-bold text-foreground"
        style={mono}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-muted-foreground" style={mono}>
          {sub}
        </div>
      )}
    </div>
  </article>
);

// =============================================================
// Avisos: informe incompleto, parcial o sin actualizar
// =============================================================

/** Una lectura ha fallado: no se enseña nada a medias, solo cómo reintentar. */
const InformeIncompleto = ({
  detalle,
  onRetry,
  retrying,
}: {
  detalle: string;
  onRetry: () => void;
  retrying: boolean;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
    style={{ background: "rgba(232,84,42,0.08)", borderColor: "rgba(232,84,42,0.32)" }}
  >
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
        style={{ background: "linear-gradient(180deg, #FF7A4D 0%, #B8381A 100%)" }}
      >
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">Informe incompleto</div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          Ha fallado la lectura de las ventas de este periodo y no queremos enseñarte cifras a medias.
        </p>
        <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground/80">{detalle}</p>
      </div>
    </div>
    <Button size="sm" onClick={onRetry} disabled={retrying} className="shrink-0 max-md:h-11">
      {retrying ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="mr-2 h-3.5 w-3.5" />
      )}
      Reintentar
    </Button>
  </div>
);

/** Un refresco ha fallado con el informe completo de antes a la vista. */
const InformeDesactualizado = ({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) => (
  <div
    role="status"
    className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
  >
    <span className="flex items-center gap-2 text-muted-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
      El informe no se ha podido actualizar: ves el último que se cargó.
    </span>
    <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} className="shrink-0 max-md:h-11">
      {retrying ? (
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCcw className="mr-2 h-3.5 w-3.5" />
      )}
      Reintentar
    </Button>
  </div>
);

/** Se llegó al tope de páginas: las cifras y el CSV son de las primeras ventas. */
const InformeParcial = () => (
  <div
    role="status"
    className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
  >
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
    <span>
      <strong className="font-semibold text-foreground">Informe parcial.</strong> Este periodo tiene más de{" "}
      {(FILAS_POR_PAGINA * MAX_PAGINAS).toLocaleString("es-ES")} ventas y solo hemos leído las primeras: las cifras y
      el CSV no están completos. Prueba con un periodo más corto.
    </span>
  </div>
);

// =============================================================
// Revenue chart (SVG simple, sin libs externas)
// =============================================================

const RevenueChart = ({
  series,
}: {
  series: Array<{ day: string; date: Date; sold: number; revenueCents: number }>;
}) => {
  if (series.length === 0) return null;
  const maxRev = Math.max(...series.map((s) => s.revenueCents), 1);
  const W = 600;
  const H = 160;
  const pad = 8;
  const step = (W - pad * 2) / Math.max(series.length - 1, 1);

  const points = series
    .map((s, i) => {
      const x = pad + i * step;
      const y = H - pad - (s.revenueCents / maxRev) * (H - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <article
      className="rounded-2xl border border-border bg-card p-5"
      // Para los tests: lo que suma la gráfica y lo de cada día ("día:entradas:céntimos").
      data-testid="grafica-ventas"
      data-dias={series.length}
      data-entradas={series.reduce((s, d) => s + d.sold, 0)}
      data-ingresos-cents={series.reduce((s, d) => s + d.revenueCents, 0)}
      data-serie={series.map((d) => `${d.day}:${d.sold}:${d.revenueCents}`).join(" ")}
    >
      <header className="mb-4 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <TrendingUp className="h-3 w-3" />
          Ventas diarias
        </div>
        <div className="text-xs text-muted-foreground" style={mono}>
          Pico: {(maxRev / 100).toFixed(0)}€/día
        </div>
      </header>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF7A4D" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#FF7A4D" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={points} fill="none" stroke="#FF7A4D" strokeWidth="2" strokeLinejoin="round" />
        <polyline
          points={`${pad},${H - pad} ${points} ${W - pad},${H - pad}`}
          fill="url(#revGrad)"
          stroke="none"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground" style={mono}>
        <span>{format(series[0].date, "d MMM", { locale: es })}</span>
        <span>{format(series[series.length - 1].date, "d MMM", { locale: es })}</span>
      </div>
    </article>
  );
};

// =============================================================
// Top events
// =============================================================

const TopEvents = ({
  items,
}: {
  items: Array<{ id: string; sold: number; rev: number; title: string }>;
}) => (
  <article className="rounded-2xl border border-border bg-card p-5">
    <header className="mb-4 flex items-center justify-between">
      <div
        className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
        style={{ ...mono, letterSpacing: "0.22em" }}
      >
        <Trophy className="h-3 w-3" />
        Top eventos
      </div>
    </header>
    {items.length === 0 ? (
      <div className="py-4 text-center text-xs text-muted-foreground">Sin datos</div>
    ) : (
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-3">
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold"
              style={{
                ...mono,
                background: i === 0 ? "rgba(255,122,77,0.2)" : "rgba(255,255,255,0.04)",
                color: i === 0 ? "#FF7A4D" : "#9b9388",
              }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{it.title}</div>
              <div className="text-[10px] text-muted-foreground" style={mono}>
                {it.sold} {it.sold === 1 ? "ticket" : "tickets"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-foreground" style={mono}>
                {(it.rev / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })}€
              </div>
            </div>
            {i === 0 && <Star className="h-3.5 w-3.5 text-orange-500" />}
          </li>
        ))}
      </ol>
    )}
  </article>
);

// =============================================================
// Hours heatmap
// =============================================================

const DOW_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const HoursHeatmap = ({ grid }: { grid: number[][] }) => {
  const max = Math.max(...grid.flat(), 1);
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-4 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
          style={{ ...mono, letterSpacing: "0.22em" }}
        >
          <BarChart3 className="h-3 w-3" />
          Heatmap día / hora
        </div>
        <div className="text-[10px] text-muted-foreground" style={mono}>
          Pico {max} compras
        </div>
      </header>
      <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-0.5 text-[9px]">
        <div></div>
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            className="text-center text-muted-foreground"
            style={mono}
          >
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {grid.map((row, dow) => (
          <Fragment key={`row-${dow}`}>
            <div
              className="pr-1 text-right text-muted-foreground"
              style={mono}
            >
              {DOW_LABELS[dow]}
            </div>
            {row.map((cell, h) => {
              const intensity = cell / max;
              return (
                <div
                  key={`${dow}-${h}`}
                  title={`${DOW_LABELS[dow]} ${h}h · ${cell}`}
                  className="aspect-square rounded-sm"
                  style={{
                    background:
                      cell === 0
                        ? "rgba(255,255,255,0.03)"
                        : `rgba(255,122,77,${Math.max(0.12, intensity)})`,
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </article>
  );
};

export default PartnerReports;
