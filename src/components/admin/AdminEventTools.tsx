import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/sentry";
import { isEventOver } from "@/components/tickets/ticketUtils";
import { useAdminEventAttendees } from "./adminQueries";
import { cancelarYReembolsar } from "./adminActions";
import { chipEntrada, euros, fechaHora, mono } from "./adminFormat";
import { Chip, ErrorCard } from "./AdminUi";

/* ============================================================================
   Herramientas de un evento en el panel de admin (B5-7):
     - Asistentes: partner_event_attendees, que acepta al admin (con emails y
       teléfonos). Solo en memoria, como todo el ámbito "admin".
     - Cancelar y reembolsar: la edge function partner-cancel-event, que
       acepta al admin. Estado final, reembolso a todos los que pagaron y
       aviso a los titulares. Se confirma escribiendo el nombre del evento.
   ============================================================================ */

export interface EventoRef {
  id: string;
  title: string;
}

export const AdminAttendeesDialog = ({
  uid,
  event,
  onClose,
}: {
  uid: string | null;
  event: EventoRef | null;
  onClose: () => void;
}) => {
  const asistentes = useAdminEventAttendees(uid, event?.id ?? null);
  const filas = useMemo(() => asistentes.data ?? [], [asistentes.data]);
  const cuenta = useMemo(() => {
    const n = (s: string[]) => filas.filter((a) => s.includes(a.status)).length;
    return { vendidas: n(["paid", "used"]), dentro: n(["used"]), reembolsadas: n(["refunded"]), anuladas: n(["cancelled"]) };
  }, [filas]);

  return (
    <Dialog open={!!event} onOpenChange={(abierto) => !abierto && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Asistentes · {event?.title ?? ""}</DialogTitle>
          <DialogDescription>
            Entradas pagadas, usadas, reembolsadas y anuladas del evento, con los datos de contacto de cada titular.
          </DialogDescription>
        </DialogHeader>

        {asistentes.isError ? (
          <ErrorCard
            mensaje={`No se han podido cargar los asistentes: ${getErrorMessage(asistentes.error)}`}
            onRetry={() => void asistentes.refetch()}
          />
        ) : asistentes.isPending ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <Users className="h-8 w-8 opacity-50" />
            Este evento aún no tiene entradas vendidas.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 text-[11px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
              <span>{cuenta.vendidas} vendidas</span>
              <span>{cuenta.dentro} dentro</span>
              <span>{cuenta.reembolsadas} reembolsadas</span>
              <span>{cuenta.anuladas} anuladas</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titular</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Entrada en puerta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((a) => {
                    const chip = chipEntrada(a.status);
                    return (
                      <TableRow key={a.ticket_id}>
                        <TableCell className="font-medium">
                          {[a.buyer_first_name, a.buyer_last_name].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{a.buyer_email ?? "—"}</div>
                          {a.buyer_phone && <div>{a.buyer_phone}</div>}
                        </TableCell>
                        <TableCell>{a.tier_name ?? "—"}</TableCell>
                        <TableCell>
                          <Chip color={chip.color}>{chip.label}</Chip>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{euros(a.amount_paid_cents, a.currency)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {a.used_at ? `${fechaHora(a.used_at)} · ${a.scanned_by_name ?? "—"}` : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export interface EventoCancelable extends EventoRef {
  status: string;
  date_start: string;
  date_end: string | null;
  tickets_sold: number;
}

/** Mismo criterio para comparar lo tecleado con el título: sin espacios de más ni mayúsculas. */
const normaliza = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

export const AdminCancelEventDialog = ({
  event,
  onClose,
  onDone,
}: {
  event: EventoCancelable | null;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const reintento = event?.status === "cancelled";
  const terminado = event ? isEventOver({ date_start: event.date_start, date_end: event.date_end }) : false;
  const motivoValido = motivo.trim().length >= 3;
  const nombreValido = !!event && normaliza(confirmacion) === normaliza(event.title);
  const puede = !trabajando && (reintento || (motivoValido && nombreValido));

  const cerrar = () => {
    if (trabajando) return;
    setMotivo("");
    setConfirmacion("");
    onClose();
  };

  const confirmar = async () => {
    if (!event || !puede) return;
    setTrabajando(true);
    try {
      const aviso = await cancelarYReembolsar(event.id, reintento ? "Reintento de reembolsos" : motivo.trim(), reintento);
      toast({ title: aviso.titulo, description: aviso.descripcion, variant: aviso.ok ? undefined : "destructive" });
      setMotivo("");
      setConfirmacion("");
      onDone();
      onClose();
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Dialog open={!!event} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reintento ? "Reintentar reembolsos" : `Cancelar y reembolsar «${event?.title ?? ""}»`}</DialogTitle>
          <DialogDescription>
            {reintento
              ? "El evento ya está cancelado. Volvemos a intentar devolver el dinero a quien aún no lo haya recibido."
              : "El evento deja de estar a la venta y no se puede volver a publicar. Devolvemos el importe completo a todos los que pagaron y les avisamos; la comisión de Pasify de esas ventas la asume el local. No se puede deshacer."}
          </DialogDescription>
        </DialogHeader>

        {!reintento && (
          <div className="space-y-4">
            {event && event.tickets_sold > 0 && (
              <p className="text-sm font-medium text-foreground">{event.tickets_sold} entrada(s) vendidas se reembolsarán.</p>
            )}
            {terminado && (
              <p className="flex items-start gap-2 text-sm" style={{ color: "#E5484D" }}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                El evento ya ha pasado: se devolverá el dinero a quien no llegó a entrar.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="admin-cancel-motivo" className="text-xs">
                Motivo (lo verán los compradores)
              </Label>
              <Textarea
                id="admin-cancel-motivo"
                value={motivo}
                maxLength={300}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por ejemplo: el local ha perdido la licencia para esa fecha."
                disabled={trabajando}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-cancel-confirmacion" className="text-xs">
                Escribe el nombre del evento para confirmar
              </Label>
              <Input
                id="admin-cancel-confirmacion"
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                placeholder={event?.title ?? ""}
                autoComplete="off"
                disabled={trabajando}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={trabajando}>
            Volver
          </Button>
          <Button variant={reintento ? "default" : "destructive"} disabled={!puede} onClick={() => void confirmar()}>
            {trabajando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : reintento ? (
              <RotateCcw className="mr-2 h-4 w-4" />
            ) : (
              <XCircle className="mr-2 h-4 w-4" />
            )}
            {reintento ? "Reintentar reembolsos" : "Cancelar y reembolsar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
