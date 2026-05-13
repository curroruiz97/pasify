import { Copy, FileText, MoreVertical, Music, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/partner/StatusBadge";

/**
 * EventRowCard — versión móvil del row de la tabla de eventos del partner.
 * Se renderiza en `md:hidden` mientras la `<Table>` densa permanece en
 * `hidden md:block`. Patrón visual matchea la captura de mejora:
 *
 *   [thumb 56] [title + status badge]
 *               [eyebrow opcional 'Festival multi-día']
 *   [Ciudad · Fecha · Precio · Aforo  (micro-grid 4 col)]
 *                                                  [⋮ menu]
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
  onEdit?: () => void;
  onDuplicate?: () => void;
  onReportPdf?: () => void;
  onDelete?: () => void;
}

const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

export const EventRowCard = ({
  event,
  onEdit,
  onDuplicate,
  onReportPdf,
  onDelete,
}: EventRowCardProps) => {
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

      {/* Bottom row: micro-grid 4 col */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Stat label="Ciudad" value={event.city || "—"} />
        <Stat label="Fecha" value={formatShortDate(event.date_start)} />
        <Stat
          label="Precio"
          value={`${(event.price_cents / 100).toFixed(2)} €`}
        />
        <Stat
          label="Aforo"
          value={event.capacity != null ? String(event.capacity) : "—"}
        />
      </div>

      {/* Overflow menu — absolute bottom right to keep the micro-grid clean */}
      <div className="absolute bottom-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Acciones del evento"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar evento
              </DropdownMenuItem>
            )}
            {onDuplicate && (
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicar evento
              </DropdownMenuItem>
            )}
            {onReportPdf && (
              <DropdownMenuItem onClick={onReportPdf}>
                <FileText className="mr-2 h-4 w-4" />
                Report PDF post-evento
              </DropdownMenuItem>
            )}
            {onDelete && (onEdit || onDuplicate || onReportPdf) && (
              <DropdownMenuSeparator />
            )}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar evento
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
};

export default EventRowCard;
