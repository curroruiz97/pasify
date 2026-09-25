import type { ReactNode } from "react";
import { Music } from "lucide-react";
import { StatusBadge } from "@/components/partner/StatusBadge";
import { SoldBar } from "@/components/partner/SoldBar";
import { formatInTimeZone } from "@/components/partner/zonedTime";

/**
 * EventRowCard — versión móvil del row de la tabla de eventos del partner.
 * Se renderiza en `md:hidden` mientras la `<Table>` densa permanece en
 * `hidden md:block`. Patrón visual matchea la captura de mejora:
 *
 *   [thumb 56] [title + status badge]
 *               [eyebrow opcional 'Festival multi-día']
 *   [Ciudad · Fecha · Precio  (micro-grid 3 col)]
 *   [Vendidas / aforo con su barra]                   [⋮ menu]
 *
 * La fecha va en la hora del local (`timeZone`), como la ven los compradores.
 * El menú de acciones (EventActionsMenu) lo pone quien la usa.
 *
 * Estilo Pasify: warm shadow lift on hover, border subtle, padding 16 px.
 */

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

export type EventRowCardEvent = {
  id: string;
  title: string;
  city: string;
  date_start: string;
  status: string;
  price_cents: number;
  capacity: number | null;
  tickets_sold: number;
  image_url?: string | null;
  /** Indica si el evento es un festival multi-día (eyebrow opcional). */
  is_festival?: boolean | null;
};

export interface EventRowCardProps {
  event: EventRowCardEvent;
  /** Zona horaria del local del evento (sin ella, la del dispositivo). */
  timeZone?: string;
  /** Menú de acciones (abajo a la derecha). */
  menu?: ReactNode;
}

const FECHA_CORTA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div
      className="text-[9.5px] uppercase text-muted-foreground"
      style={{ ...monoStyle, letterSpacing: "0.16em" }}
    >
      {label}
    </div>
    <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
      {value}
    </div>
  </div>
);

export const EventRowCard = ({ event, timeZone, menu }: EventRowCardProps) => {
  return (
    <article
      className="group relative rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow =
          "0 1px 0 rgba(255,255,255,0.02) inset, 0 22px 50px -18px rgba(232,84,42,0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 0 rgba(255,255,255,0.02) inset";
      }}
      aria-label={event.title}
    >
      {/* Top row: thumb + title + status */}
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
          {event.image_url ? (
            <img
              src={event.image_url}
              alt={event.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background:
                  "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
                color: "#FFC9B0",
              }}
              aria-hidden="true"
            >
              <Music className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Title block */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground">
            {event.title}
          </h3>
          {event.is_festival && (
            <div
              className="mt-1 inline-flex items-center gap-1.5 text-[10px] uppercase text-orange-500"
              style={{ ...monoStyle, letterSpacing: "0.18em" }}
            >
              <Music className="h-3 w-3" />
              Festival multi-día
            </div>
          )}
        </div>

        {/* Status pill */}
        <div className="shrink-0">
          <StatusBadge status={event.status} />
        </div>
      </div>

      {/* Micro-grid 3 col */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Ciudad" value={event.city || "—"} />
        <Stat label="Fecha" value={formatInTimeZone(event.date_start, FECHA_CORTA, timeZone)} />
        <Stat label="Precio" value={`${(event.price_cents / 100).toFixed(2)} €`} />
      </div>

      {/* Vendidas sobre el aforo; el menú, a su derecha */}
      <div className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <SoldBar sold={event.tickets_sold} capacity={event.capacity} />
        </div>
        {menu && <div className="-mb-1 -mr-2 shrink-0">{menu}</div>}
      </div>
    </article>
  );
};

export default EventRowCard;
