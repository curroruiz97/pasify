import { Link } from "react-router-dom";
import { Loader2, Repeat, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { eventPriceLabel, formatEventDate, formatEventTime } from "@/components/tickets/ticketUtils";
import { countLabel } from "@/lib/eventSeries";

/**
 * Las fechas de un evento de varios días o recurrente (serie), desde su cartel
 * en el calendario: cada una con su día y hora, su precio, si está agotada y
 * los botones de siempre (comprar o ver el evento). Cada fecha es un evento de
 * verdad: tiene sus propias entradas, su aforo y su página, así que comprar
 * aquí es comprar esa fecha.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** Lo que el diálogo necesita de cada fecha (lo cumplen los eventos del calendario y los de la ficha del local). */
export interface SeriesDateRow {
  id: string;
  date_start: string;
  price_cents: number | null;
  capacity: number | null;
  tickets_sold: number | null;
}

interface Props<T extends SeriesDateRow> {
  title: string;
  /** Las fechas por celebrar, de la más próxima a la más lejana. null = cerrado. */
  sessions: T[] | null;
  onOpenChange: (open: boolean) => void;
  onBuy: (event: T) => void;
  /** La compra en curso (spinner en su botón). */
  buyingId: string | null;
  /** Fechas de las que ya tiene entrada. */
  heldIds: ReadonlySet<string>;
}

const agotada = (e: SeriesDateRow): boolean => e.capacity != null && e.capacity > 0 && (e.tickets_sold ?? 0) >= e.capacity;

export const SeriesDatesDialog = <T extends SeriesDateRow>({ title, sessions, onOpenChange, onBuy, buyingId, heldIds }: Props<T>) => (
  <Dialog open={sessions !== null} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-testid="serie-fechas">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-6">
          <Repeat className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{title}</span>
        </DialogTitle>
        <DialogDescription>
          {sessions ? `${countLabel(sessions.length)} por celebrar.` : ""} Cada fecha tiene sus propias entradas.
        </DialogDescription>
      </DialogHeader>
      <ul className="space-y-2">
        {(sessions ?? []).map((e) => {
          const precio = eventPriceLabel(e.price_cents);
          const sinEntradas = agotada(e);
          const loTiene = heldIds.has(e.id);
          return (
            <li
              key={e.id}
              data-testid={`serie-fecha-${e.id}`}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{formatEventDate(e.date_start)}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" style={mono}>
                  <span>{formatEventTime(e.date_start)}h</span>
                  {precio && !sinEntradas && <span>· {precio}</span>}
                  {sinEntradas && <span className="font-semibold text-destructive">· Agotado</span>}
                  {loTiene && <span className="font-semibold text-primary">· Tienes entrada</span>}
                </div>
              </div>
              <Link
                to={`/e/${e.id}`}
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Ver
              </Link>
              <Button
                type="button"
                size="sm"
                disabled={sinEntradas || buyingId === e.id}
                onClick={() => onBuy(e)}
                className="h-9 shrink-0 rounded-full px-4 text-xs font-semibold"
                data-testid={`serie-comprar-${e.id}`}
              >
                {buyingId === e.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Ticket className="mr-1.5 h-3.5 w-3.5" />
                    {sinEntradas ? "Agotado" : loTiene ? "Comprar más" : "Comprar"}
                  </>
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </DialogContent>
  </Dialog>
);

export default SeriesDatesDialog;
