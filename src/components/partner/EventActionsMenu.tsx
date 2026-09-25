import type { ReactNode } from "react";
import {
  Copy,
  ExternalLink,
  EyeOff,
  MoreVertical,
  Pencil,
  QrCode,
  RotateCcw,
  Send,
  Share2,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Acciones de un evento en Mis eventos: las mismas en la tabla (escritorio) y
 * en la tarjeta (móvil).
 *
 * Con la organización suspendida (`publishBlockedReason`) «Publicar» sale
 * desactivado con la explicación, y también compartir el enlace y el QR: el
 * evento no se ve en la web mientras dure. El servidor rechaza publicar igual.
 */

export interface EventActionsTarget {
  status: string;
  tickets_sold: number;
}

export interface EventActions {
  onEdit: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onShare: () => void;
  onOpenPublic: () => void;
  onShowQr: () => void;
  /** Cancelar (publicado/borrador) o reintentar reembolsos (cancelado). */
  onCancel: () => void;
  onDelete: () => void;
}

const Bloqueada = ({ children, motivo }: { children: ReactNode; motivo: string | null }) =>
  motivo ? (
    <span className="flex flex-col">
      <span>{children}</span>
      <span className="text-[11px] font-normal text-muted-foreground">Tu cuenta está suspendida</span>
    </span>
  ) : (
    <>{children}</>
  );

export const EventActionsMenu = ({
  event,
  actions,
  changingStatus = false,
  publishBlockedReason = null,
  triggerClassName,
}: {
  event: EventActionsTarget;
  actions: EventActions;
  /** Hay un cambio de estado en marcha: «Publicar» espera. */
  changingStatus?: boolean;
  /** Motivo por el que no se puede publicar (organización suspendida). */
  publishBlockedReason?: string | null;
  triggerClassName?: string;
}) => {
  const bloqueo = publishBlockedReason ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Acciones del evento" className={triggerClassName}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={actions.onEdit}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar evento
        </DropdownMenuItem>
        <DropdownMenuItem onClick={actions.onDuplicate}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicar evento
        </DropdownMenuItem>
        {event.status === "draft" && (
          <DropdownMenuItem
            disabled={changingStatus || !!bloqueo}
            onClick={actions.onPublish}
            title={bloqueo ?? undefined}
          >
            <Send className="mr-2 h-4 w-4" />
            <Bloqueada motivo={bloqueo}>Publicar</Bloqueada>
          </DropdownMenuItem>
        )}
        {event.status === "published" && (
          <>
            <DropdownMenuItem disabled={!!bloqueo} onClick={actions.onShare} title={bloqueo ?? undefined}>
              <Share2 className="mr-2 h-4 w-4" />
              <Bloqueada motivo={bloqueo}>Compartir enlace</Bloqueada>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onOpenPublic}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Ver página del evento
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!!bloqueo} onClick={actions.onShowQr} title={bloqueo ?? undefined}>
              <QrCode className="mr-2 h-4 w-4" />
              <Bloqueada motivo={bloqueo}>QR para cartel</Bloqueada>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={actions.onUnpublish}>
              <EyeOff className="mr-2 h-4 w-4" />
              Retirar de la venta
            </DropdownMenuItem>
          </>
        )}
        {(event.status === "published" || event.status === "draft") && (
          <DropdownMenuItem
            onClick={actions.onCancel}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancelar evento
          </DropdownMenuItem>
        )}
        {event.status === "cancelled" && event.tickets_sold > 0 && (
          <DropdownMenuItem onClick={actions.onCancel}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reintentar reembolsos
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={actions.onDelete}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Eliminar evento
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default EventActionsMenu;
