import { useMemo } from "react";
import { CalendarDays, ChevronRight, Repeat } from "lucide-react";
import { useCalendarEvents, type CalendarEvent } from "@/hooks/useEvents";
import { eventDayMonth, eventPriceLabel, formatEventTime } from "@/components/tickets/ticketUtils";
import { formatEventPlace } from "@/lib/eventPlace";
import { EVENT_CATEGORIES, effectiveEventCategory, type EventCategory } from "@/lib/eventCategories";
import { countLabel, groupBySeries } from "@/lib/eventSeries";

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Cuántos eventos caben en la tira; el resto, en el calendario. */
const MAX_EVENTOS = 10;

interface Props {
  /** Ciudad elegida (useCiudadElegida); null = «Toda España». */
  city: string | null;
  /** Solo los eventos de esta categoría (su categoría o, si no tiene, la de su local). null = todos. */
  category?: EventCategory | null;
  onOpen: (eventId: string) => void;
  onSeeAll: () => void;
}

/**
 * Próximos eventos de verdad en la home del cliente: los mismos del calendario
 * público (useCalendarEvents, caché qk.public.calendarEvents, misma regla de
 * "sigue a la venta" que el servidor), de la ciudad elegida. Sustituye a las
 * recomendaciones inventadas de SmartHomeStrip fuera del modo demo.
 *
 * Es un extra: mientras carga, si falla o si no hay eventos no pinta nada (la
 * lista de locales de debajo tiene su propio estado de error).
 */
export const UpcomingEventsStrip = ({ city, category = null, onOpen, onSeeAll }: Props) => {
  const { data, isLoading } = useCalendarEvents(city);
  // Una tarjeta por serie (eventos de varios días y recurrentes): su fecha más
  // próxima, con cuántas son. Si no, un festival de 30 noches se comería la tira.
  const eventos = useMemo(
    () =>
      groupBySeries(
        (data ?? []).filter(
          (e) => !category || effectiveEventCategory(e.category, e.profiles?.business_category) === category,
        ),
      ).slice(0, MAX_EVENTOS),
    [data, category],
  );
  const etiqueta = EVENT_CATEGORIES.find((c) => c.value === category);
  if (eventos.length === 0) {
    // Con una categoría elegida, que no salga nada parece que el filtro no
    // hace nada: se dice que no hay.
    if (!category || isLoading) return null;
    return (
      <p data-testid="sin-eventos-de-categoria" className="text-sm text-muted-foreground">
        No hay eventos de {etiqueta?.label ?? "esa categoría"} {city ? `en ${city}` : "próximamente"}.{" "}
        <button type="button" onClick={onSeeAll} className="text-orange-500 underline underline-offset-4">
          Ver el calendario
        </button>
      </p>
    );
  }

  return (
    <section aria-label="Próximos eventos">
      <header className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Próximos eventos
          </div>
          <h2 className="truncate text-xl font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
            {etiqueta
              ? `${etiqueta.plural} ${city ? `en ${city}` : "estos días"}`
              : city
              ? `Qué hay en ${city}`
              : "Qué hay estos días"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 px-1 text-[11px] uppercase text-muted-foreground transition hover:text-orange-500"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          Ver calendario
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </header>

      <div
        className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {eventos.map((e) => (
          <EventoCard
            key={e.event.id}
            evento={e.event}
            fechas={e.kind === "series" ? e.sessions.length : 0}
            onClick={() => onOpen(e.event.id)}
          />
        ))}
      </div>
    </section>
  );
};

const EventoCard = ({ evento, fechas, onClick }: { evento: CalendarEvent; fechas: number; onClick: () => void }) => {
  // Día, mes y hora en la hora del evento (Europe/Madrid), no la del móvil.
  const fecha = eventDayMonth(evento.date_start);
  const hora = formatEventTime(evento.date_start);
  const lugar = formatEventPlace(evento, evento.profiles?.business_name).short;
  const precio = eventPriceLabel(evento.price_cents);
  const inicial = (evento.title?.[0] ?? "?").toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/card relative w-56 shrink-0 overflow-hidden rounded-2xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-orange-500/50"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 14px -6px rgba(0,0,0,0.4)" }}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
        {evento.image_url ? (
          <img
            src={evento.image_url}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover/card:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(232,84,42,0.85) 0%, rgba(184,56,26,0.95) 100%)",
              color: "#F4EEE2",
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            {inicial}
          </div>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(to top, rgba(10,10,10,0.88) 0%, rgba(10,10,10,0.25) 55%, transparent 100%)",
          }}
        />

        {fecha && (
          <div
            className="absolute left-2 top-2 flex flex-col items-center rounded-lg px-2 py-1 text-center"
            style={{ background: "rgba(232,84,42,0.94)", color: "#fff" }}
          >
            <span className="text-[9px] font-semibold uppercase leading-none" style={{ ...mono, letterSpacing: "0.18em" }}>
              {fecha.month}
            </span>
            <span className="mt-0.5 text-base font-bold leading-none" style={mono}>
              {fecha.day}
            </span>
          </div>
        )}

        {fechas > 1 && (
          <div
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur"
            data-testid={`tira-fechas-${evento.id}`}
          >
            <Repeat className="h-3 w-3" />
            {countLabel(fechas)}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="line-clamp-2 text-base font-bold leading-tight text-white drop-shadow">{evento.title}</div>
          <div
            className="mt-1 flex items-center gap-1.5 text-[11px] text-white/85 drop-shadow"
            style={{ ...mono, letterSpacing: "0.06em" }}
          >
            {hora && <span>{hora}H</span>}
            {hora && lugar && <span className="opacity-50">·</span>}
            {lugar && <span className="truncate">{lugar}</span>}
          </div>
          {precio && (
            <div
              className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ background: "rgba(232,84,42,0.95)", color: "#fff" }}
            >
              {precio}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

export default UpcomingEventsStrip;
