import { useMemo, useState } from "react";
import { Calendar, Search, X as XIcon } from "lucide-react";
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
import { formatInTimeZone } from "@/components/partner/zonedTime";
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
}

export const PartnerEventList = ({
  events,
  timeZoneFor,
  actionsFor,
  onCreate,
  changingStatus,
  publishBlockedReason,
}: Props) => {
  const [guardada, setPestana] = useSessionState<EventTab>("partner.eventos.pestana", "proximos");
  const pestana: EventTab = isEventTab(guardada) ? guardada : "proximos";
  const [busqueda, setBusqueda] = useState("");

  // "Ahora" se fija al pintar: un evento que termina mientras se mira la
  // lista cambia de pestaña al refrescarla, no en mitad de un clic.
  const grupos = useMemo(() => groupEventsByTab(events, busqueda), [events, busqueda]);
  const lista = grupos[pestana];
  const buscando = busqueda.trim().length > 0;

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
                    {lista.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
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
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Móvil: tarjetas, sin scroll horizontal. */}
            <div className="grid gap-3 md:hidden">
              {lista.map((e) => (
                <EventRowCard
                  key={e.id}
                  event={e}
                  timeZone={timeZoneFor(e.venue_id)}
                  menu={menu(e, "h-8 w-8")}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerEventList;
