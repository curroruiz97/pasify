import { MoreVertical, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Acciones de una serie entera en Mis eventos (la cabecera del grupo de
 * fechas): publicar las fechas que siguen en borrador y cancelar las que
 * quedan por celebrar. Cada fecha tiene además su propio menú.
 *
 * Con la organización suspendida (`publishBlockedReason`) «Publicar» sale
 * desactivado, como en el menú de un evento.
 */

export interface SeriesActions {
  /** Publica las fechas en borrador. */
  onPublishAll: () => void;
  /** Cancela las fechas que quedan por celebrar (con reembolso donde haya ventas). */
  onCancelAll: () => void;
}

export const SeriesActionsMenu = ({
  actions,
  drafts,
  cancellable,
  changingStatus = false,
  publishBlockedReason = null,
  triggerClassName,
}: {
  actions: SeriesActions;
  /** Fechas en borrador. */
  drafts: number;
  /** Fechas que se pueden cancelar (por celebrar y no canceladas). */
  cancellable: number;
  changingStatus?: boolean;
  publishBlockedReason?: string | null;
  triggerClassName?: string;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Acciones de la serie" className={triggerClassName}>
        <MoreVertical className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {drafts > 0 && (
        <DropdownMenuItem
          disabled={changingStatus || !!publishBlockedReason}
          onClick={actions.onPublishAll}
          title={publishBlockedReason ?? undefined}
        >
          <Send className="mr-2 h-4 w-4" />
          {drafts === 1 ? "Publicar la fecha en borrador" : `Publicar las ${drafts} fechas en borrador`}
        </DropdownMenuItem>
      )}
      {cancellable > 0 && (
        <DropdownMenuItem
          onClick={actions.onCancelAll}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <XCircle className="mr-2 h-4 w-4" />
          {cancellable === 1 ? "Cancelar la fecha que queda" : `Cancelar la serie (${cancellable} fechas)`}
        </DropdownMenuItem>
      )}
      {drafts === 0 && cancellable === 0 && (
        <DropdownMenuItem disabled>No queda nada por hacer en esta serie</DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

export default SeriesActionsMenu;
