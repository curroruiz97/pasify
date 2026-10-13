import { Fragment, useMemo, useState } from "react";
import { Calendar, ChevronDown, Repeat, Search, X as XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { useSessionState } from "@/lib/useSessionState";
import { EventRowCard } from "@/components/partner/EventRowCard";
import { EventActionsMenu, type EventActions } from "@/components/partner/EventActionsMenu";
import { SoldBar } from "@/components/partner/SoldBar";
import { StatusBadge } from "@/components/partner/StatusBadge";
import { EVENT_TABS, groupEventsByTab, isEventTab, type EventTab } from "@/components/partner/eventTabs";
import { SeriesActionsMenu, type SeriesActions } from "@/components/partner/SeriesActionsMenu";
import { formatInTimeZone } from "@/components/partner/zonedTime";
import { countLabel, groupBySeries, summarizeSessions, type SessionStats } from "@/lib/eventSeries";
import type { PartnerEventRow } from "@/hooks/queries/partnerData";

/**
 * Mis eventos (WP2.4): pestañas «Próximos», «Borradores» y «Pasados» con su
 * número, búsqueda por título y, en cada fila, las vendidas sobre el aforo
 * con una barra. La pestaña se recuerda en la pestaña del navegador
 * (useSessionState); la búsqueda no, para que al volver no falte nada.
 *
 * Las fechas van en la hora del local de cada evento (`timeZoneFor`), la
 * misma que ven los compradores en la web, el email y Stripe.
 *
 * Las fechas de un evento de varios días o recurrente (serie) se agrupan en
 * una fila con el total de la serie —próxima fecha, vendidas, estado— que se
 * abre para ver cada fecha con su propio menú; el menú de la fila lo es de la
 * serie entera (publicar los borradores, cancelar las que quedan).
 *
 * Cargando, error de carga (con Reintentar) y "Tu primer evento" los pinta
 * quien la usa: aquí siempre hay al menos un evento.
 */

const FECHA: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const VACIA: Record<EventTab, { title: string; subtitle: string }> = {
  proximos: {
    title: "No tienes eventos próximos",
    subtitle: "Crea uno nuevo o publica un borrador para empezar a vender.",
  },
  borradores: {
    title: "No tienes borradores",
    subtitle: "Aquí salen los eventos que guardas sin publicar y los que retiras de la venta.",
  },
  pasados: {
    title: "Aún no hay eventos pasados",
    subtitle: "Cuando termine un evento lo verás aquí con lo que vendiste.",
  },
};

interface Props {
  events: PartnerEventRow[];
  /** Zona horaria del local de un evento (sin ella, la del dispositivo). */
  timeZoneFor: (venueId: string | null | undefined) => string | undefined;
  /** Acciones de cada evento. */
  actionsFor: (event: PartnerEventRow) => EventActions;
  onCreate: () => void;
  changingStatus: boolean;
  /** Motivo por el que no se puede publicar (organización suspendida). */
  publishBlockedReason: string | null;
  /** Acciones sobre una serie entera, con todas sus fechas (las de toda la lista). */
  seriesActionsFor?: (sessions: PartnerEventRow[]) => SeriesActions;
}

const FECHA_CORTA: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };

const eur = (cents: number | null) => (cents == null ? "—" : `${(cents / 100).toFixed(2)} €`);

/** Estado de una serie en la cabecera: cuántas fechas hay de cada estado. */
const EstadoDeSerie = ({ stats }: { stats: SessionStats<PartnerEventRow> }) => (
  <div className="flex flex-wrap gap-1" data-testid="serie-estado">
    {stats.published > 0 && (
      <Badge variant="outline" className="border-success/30 bg-success/15 text-success">
        {stats.published} {stats.published === 1 ? "publicada" : "publicadas"}
      </Badge>
    )}
    {stats.drafts > 0 && (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        {stats.drafts} {stats.drafts === 1 ? "borrador" : "borradores"}
      </Badge>
    )}
    {stats.cancelled > 0 && (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">
        {stats.cancelled} {stats.cancelled === 1 ? "cancelada" : "canceladas"}
      </Badge>
    )}
  </div>
);

export const PartnerEventList = ({
  events,
  timeZoneFor,
  actionsFor,
  onCreate,
  changingStatus,
  publishBlockedReason,
  seriesActionsFor,
}: Props) => {
  const [guardada, setPestana] = useSessionState<EventTab>("partner.eventos.pestana", "proximos");
  const pestana: EventTab = isEventTab(guardada) ? guardada : "proximos";
  const [busqueda, setBusqueda] = useState("");

  // "Ahora" se fija al pintar: un evento que termina mientras se mira la
  // lista cambia de pestaña al refrescarla, no en mitad de un clic.
  const grupos = useMemo(() => groupEventsByTab(events, busqueda), [events, busqueda]);
  const lista = grupos[pestana];
  const buscando = busqueda.trim().length > 0;

  // Las fechas de una serie, juntas (con todas las de la serie, esté en la pestaña que esté, para las acciones).
  const elementos = useMemo(() => groupBySeries(lista), [lista]);
  const fechasDeSerie = useMemo(() => {
    const m = new Map<string, PartnerEventRow[]>();
    for (const e of events) {
      if (!e.series_id) continue;
      const g = m.get(e.series_id);
      if (g) g.push(e);
      else m.set(e.series_id, [e]);
    }
    return m;
  }, [events]);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // El menú de la cabecera actúa sobre TODAS las fechas de la serie, estén en la
  // pestaña que estén: sus cifras también (la cabecera cuenta solo las de la pestaña).
  const menuDeSerie = (seriesId: string, className?: string) => {
    if (!seriesActionsFor) return null;
    const todas = fechasDeSerie.get(seriesId) ?? [];
    if (todas.length === 0) return null;
    const stats = summarizeSessions(todas);
    return (
      <SeriesActionsMenu
        actions={seriesActionsFor(todas)}
        drafts={stats.openDrafts}
        cancellable={stats.open}
        changingStatus={changingStatus}
        publishBlockedReason={publishBlockedReason}
        triggerClassName={className}
      />
    );
  };

  const menu = (e: PartnerEventRow, className?: string) => (
    <EventActionsMenu
      event={e}
      actions={actionsFor(e)}
      changingStatus={changingStatus}
      publishBlockedReason={publishBlockedReason}
      triggerClassName={className}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Eventos por estado"
          className="inline-flex w-full items-center gap-1 rounded-xl border border-border bg-card p-1 sm:w-auto"
        >
          {EVENT_TABS.map((t) => {
            const activa = t.id === pestana;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`eventos-tab-${t.id}`}
                aria-selected={activa}
                aria-controls="eventos-lista"
                onClick={() => setPestana(t.id)}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition sm:flex-initial ${
                  activa ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    activa ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {grupos[t.id].length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          {/* type="text": el "×" nativo de type="search" duplicaría el nuestro. */}
          <Input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={busqueda}
            onChange={(ev) => setBusqueda(ev.target.value)}
            placeholder="Buscar por título"
            aria-label="Buscar eventos por título"
            className="pl-9 pr-9"
          />
          {buscando && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Borrar búsqueda"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div id="eventos-lista" role="tabpanel" aria-labelledby={`eventos-tab-${pestana}`}>
        {lista.length === 0 ? (
          buscando ? (
            <PasifyEmptyState
              icon={<Search className="h-7 w-7" />}
              eyebrow="Sin resultados"
              title={`Ningún evento coincide con «${busqueda.trim()}»`}
              subtitle={
                grupos.proximos.length + grupos.borradores.length + grupos.pasados.length > 0
                  ? "Mira en las otras pestañas: el número de cada una ya cuenta la búsqueda."
                  : "Prueba con otra palabra del título."
              }
              action={{ label: "Borrar búsqueda", onClick: () => setBusqueda("") }}
              compact
            />
          ) : (
            <PasifyEmptyState
              icon={<Calendar className="h-7 w-7" />}
              eyebrow={EVENT_TABS.find((t) => t.id === pestana)?.label}
              title={VACIA[pestana].title}
              subtitle={
                pestana === "proximos" && grupos.borradores.length > 0
                  ? `Tienes ${grupos.borradores.length} ${
                      grupos.borradores.length === 1 ? "borrador sin publicar" : "borradores sin publicar"
                    }.`
                  : VACIA[pestana].subtitle
              }
              action={
                pestana === "proximos" && grupos.borradores.length > 0
                  ? { label: "Ver borradores", onClick: () => setPestana("borradores") }
                  : pestana !== "pasados"
                    ? { label: "Nuevo evento", onClick: onCreate }
                    : undefined
              }
              compact
            />
          )
        ) : (
          <>
            {/* Escritorio: tabla densa (≥ md). */}
            <Card className="hidden md:block">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Precio</TableHead>
                      <TableHead className="w-48">Vendidas</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Acciones</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {elementos.map((item) => {
                      const fila = (e: PartnerEventRow, hija = false) => (
                        <TableRow key={e.id} data-serie-hija={hija ? "" : undefined}>
                          <TableCell className={hija ? "pl-12" : undefined}>
                            <div className="font-medium text-foreground">{e.title}</div>
                            {e.city && <div className="text-[12px] text-muted-foreground">{e.city}</div>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatInTimeZone(e.date_start, FECHA, timeZoneFor(e.venue_id))}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{(e.price_cents / 100).toFixed(2)} €</TableCell>
                          <TableCell>
                            <SoldBar sold={e.tickets_sold} capacity={e.capacity} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={e.status} />
                          </TableCell>
                          <TableCell className="p-1 text-right">{menu(e)}</TableCell>
                        </TableRow>
                      );
                      if (item.kind === "event") return fila(item.event);

                      const stats = summarizeSessions(item.sessions);
                      const abierta = abiertas.has(item.seriesId);
                      const zona = timeZoneFor(stats.next.venue_id);
                      return (
                        <Fragment key={`serie-${item.seriesId}`}>
                          <TableRow className="bg-muted/30" data-testid={`serie-${item.seriesId}`}>
                            <TableCell>
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => alternar(item.seriesId)}
                                  aria-expanded={abierta}
                                  aria-label={`${abierta ? "Ocultar" : "Ver"} las ${countLabel(stats.count)} de «${stats.next.title}»`}
                                  data-testid={`serie-alternar-${item.seriesId}`}
                                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                >
                                  <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : "-rotate-90"}`} />
                                </button>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                                    {stats.next.title}
                                    <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary">
                                      <Repeat className="h-3 w-3" />
                                      {countLabel(stats.count)}
                                    </Badge>
                                  </div>
                                  {stats.next.city && <div className="text-[12px] text-muted-foreground">{stats.next.city}</div>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              <div>
                                {stats.open > 0 ? "Próxima: " : "Última: "}
                                {formatInTimeZone(stats.next.date_start, FECHA_CORTA, zona)}
                              </div>
                              {stats.count > 1 && (
                                <div className="text-[12px]">
                                  hasta {formatInTimeZone(stats.last.date_start, { day: "2-digit", month: "short", year: "numeric" }, zona)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{stats.minPriceCents == null ? "—" : `desde ${eur(stats.minPriceCents)}`}</TableCell>
                            <TableCell>
                              <SoldBar sold={stats.sold} capacity={stats.capacity} />
                            </TableCell>
                            <TableCell>
                              <EstadoDeSerie stats={stats} />
                            </TableCell>
                            <TableCell className="p-1 text-right">{menuDeSerie(item.seriesId)}</TableCell>
                          </TableRow>
                          {abierta && item.sessions.map((e) => fila(e, true))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Móvil: tarjetas, sin scroll horizontal. */}
            <div className="grid gap-3 md:hidden">
              {elementos.map((item) => {
                const tarjeta = (e: PartnerEventRow) => (
                  <EventRowCard key={e.id} event={e} timeZone={timeZoneFor(e.venue_id)} menu={menu(e, "h-8 w-8")} />
                );
                if (item.kind === "event") return tarjeta(item.event);

                const stats = summarizeSessions(item.sessions);
                const abierta = abiertas.has(item.seriesId);
                const zona = timeZoneFor(stats.next.venue_id);
                return (
                  <div key={`serie-${item.seriesId}`} className="space-y-2" data-testid={`serie-movil-${item.seriesId}`}>
                    <article className="rounded-2xl border border-primary/30 bg-card p-4" aria-label={`Serie ${stats.next.title}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground">
                            {stats.next.title}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary">
                              <Repeat className="h-3 w-3" />
                              {countLabel(stats.count)}
                            </Badge>
                            <EstadoDeSerie stats={stats} />
                          </div>
                        </div>
                        {menuDeSerie(item.seriesId, "h-8 w-8")}
                      </div>
                      <div className="mt-3 text-[13px] text-muted-foreground">
                        {stats.open > 0 ? "Próxima: " : "Última: "}
                        <span className="font-semibold text-foreground">{formatInTimeZone(stats.next.date_start, FECHA_CORTA, zona)}</span>
                        {stats.minPriceCents != null && <span> · desde {eur(stats.minPriceCents)}</span>}
                      </div>
                      <div className="mt-3">
                        <SoldBar sold={stats.sold} capacity={stats.capacity} />
                      </div>
                      <button
                        type="button"
                        onClick={() => alternar(item.seriesId)}
                        aria-expanded={abierta}
                        data-testid={`serie-alternar-movil-${item.seriesId}`}
                        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-primary"
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? "rotate-180" : ""}`} />
                        {abierta ? "Ocultar las fechas" : `Ver las ${countLabel(stats.count)}`}
                      </button>
                    </article>
                    {abierta && <div className="ml-3 grid gap-3 border-l-2 border-primary/20 pl-3">{item.sessions.map(tarjeta)}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerEventList;
