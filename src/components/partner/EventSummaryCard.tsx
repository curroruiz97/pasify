import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  MapPin,
  Ticket as TicketIcon,
  Users,
} from "lucide-react";

/**
 * EventSummaryCard — resumen sticky en desktop, accordion en móvil.
 *
 * Renderiza una vista en vivo de los datos que el partner está
 * introduciendo en el wizard del nuevo evento. En desktop se queda
 * pegado al sidebar derecho (`sticky top-24`), en móvil aparece colapsado
 * en la parte superior para que no robe espacio.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const serif = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: "italic" as const,
  fontWeight: 400,
};

export interface EventSummary {
  title: string;
  city: string;
  venueName: string;
  address: string;
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:mm
  endTime: string;       // HH:mm
  crossesMidnight: boolean;
  ticketCount: number;
  minPriceEur: number | null;
  totalCapacity: number | null;
  imageUrl: string | null;
  willPublish: boolean;
}

interface Props {
  summary: EventSummary;
  /** Si true, comienza colapsado en móvil. Default true. */
  defaultCollapsed?: boolean;
}

const formatHumanDate = (date: string): string => {
  if (!date) return "—";
  try {
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d) return "—";
    return new Date(y, m - 1, d).toLocaleDateString("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return date;
  }
};

const formatTimeRange = (start: string, end: string, cross: boolean): string => {
  if (!start) return "—";
  if (!end) return `${start}h`;
  return cross ? `${start}h → ${end}h (+1)` : `${start}h → ${end}h`;
};

const formatPrice = (eur: number | null): string => {
  if (eur == null) return "—";
  if (eur === 0) return "Gratis";
  return `Desde ${eur.toFixed(2)}€`;
};

export const EventSummaryCard = ({ summary, defaultCollapsed = true }: Props) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <aside
      className="lg:sticky lg:top-6"
      aria-label="Resumen del evento"
    >
      {/* Mobile: collapsable */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-4 text-left lg:hidden"
      >
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.2em" }}
          >
            Resumen
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold">
            {summary.title || "Tu evento"}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
        />
      </button>

      <div
        className={`${
          collapsed ? "hidden" : "mt-3 block"
        } overflow-hidden rounded-2xl border border-border bg-card lg:mt-0 lg:block`}
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -22px rgba(232,84,42,0.18)",
        }}
      >
        {/* Cover */}
        <div className="relative aspect-[16/9] w-full overflow-hidden">
          {summary.imageUrl ? (
            <img
              src={summary.imageUrl}
              alt={summary.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-[#FFC9B0]"
              style={{
                background:
                  "linear-gradient(135deg, rgba(232,84,42,0.55) 0%, rgba(184,56,26,0.65) 100%)",
              }}
              aria-hidden="true"
            >
              <TicketIcon className="h-10 w-10 opacity-60" />
            </div>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,0.7) 100%)",
            }}
          />
          <div className="absolute bottom-3 left-4 right-4">
            <div
              className="mb-1 inline-flex items-center gap-1.5 text-[9.5px] uppercase text-orange-300"
              style={{ ...mono, letterSpacing: "0.22em" }}
            >
              <span className="inline-block h-px w-4 bg-orange-300/70" />
              Vista previa
            </div>
            <h3 className="line-clamp-2 text-lg font-semibold leading-tight text-white">
              {summary.title || (
                <span className="text-white/40" style={serif}>
                  Título de tu evento
                </span>
              )}
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          <Row icon={<CalendarDays className="h-4 w-4" />} label="Cuándo">
            <span className="capitalize">{formatHumanDate(summary.date)}</span>
          </Row>
          <Row icon={<Clock className="h-4 w-4" />} label="Horario">
            {formatTimeRange(summary.startTime, summary.endTime, summary.crossesMidnight)}
          </Row>
          <Row icon={<MapPin className="h-4 w-4" />} label="Dónde">
            {summary.venueName || summary.address || summary.city ? (
              <span>
                {summary.venueName && (
                  <span className="block font-medium text-foreground">
                    {summary.venueName}
                  </span>
                )}
                {summary.address && (
                  <span className="block text-[12px] text-muted-foreground">
                    {summary.address}
                  </span>
                )}
                {!summary.venueName && !summary.address && summary.city && (
                  <span>{summary.city}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground/70">—</span>
            )}
          </Row>
          <Row icon={<TicketIcon className="h-4 w-4" />} label="Tickets">
            <span>
              {summary.ticketCount > 0
                ? `${summary.ticketCount} ${summary.ticketCount === 1 ? "tipo" : "tipos"}`
                : "—"}{" "}
              {summary.minPriceEur != null && (
                <span className="text-muted-foreground" style={mono}>
                  · {formatPrice(summary.minPriceEur)}
                </span>
              )}
            </span>
          </Row>
          {summary.totalCapacity != null && summary.totalCapacity > 0 && (
            <Row icon={<Users className="h-4 w-4" />} label="Aforo">
              <span style={mono}>{summary.totalCapacity} entradas</span>
            </Row>
          )}

          <div className="!mt-4 border-t border-border pt-3">
            <div
              className="flex items-center gap-1.5 text-[10px] uppercase"
              style={{
                ...mono,
                letterSpacing: "0.18em",
                color: summary.willPublish ? "#4DB87A" : "#8A8275",
              }}
            >
              {summary.willPublish ? (
                <>
                  <Eye className="h-3 w-3" />
                  Se publicará al guardar
                </>
              ) : (
                <>
                  <EyeOff className="h-3 w-3" />
                  Se guardará como borrador
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const Row = ({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-3 text-sm">
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-500/10 text-orange-500">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div
        className="text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        {label}
      </div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  </div>
);

export default EventSummaryCard;
