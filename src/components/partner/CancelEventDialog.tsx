import { useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cancelar un evento (WP2.3) o reintentar sus reembolsos.
 *
 * Llama a la edge function partner-cancel-event, que cancela (estado final),
 * avisa a los titulares y reembolsa por tandas: aquí se repite mientras
 * queden. Si alguno falla, el evento sigue cancelado y el menú ofrece
 * "Reintentar reembolsos".
 */

export interface CancelTarget {
  id: string;
  title: string;
  status: string;
  tickets_sold: number;
}

interface CancelResult {
  already_cancelled: boolean;
  refunded: number;
  failed: number;
  remaining: number;
  refunds_pending: boolean;
  tickets_without_account: number;
}

const MAX_ROUNDS = 10;

const ERRORS: Record<string, string> = {
  forbidden: "Tu cuenta no puede cancelar este evento.",
  event_not_cancellable: "Este evento ya terminó y no se puede cancelar.",
  cancel_reason_required: "Escribe el motivo de la cancelación.",
  rate_limit_exceeded: "Demasiados intentos seguidos. Espera unos minutos.",
};

async function callCancel(eventId: string, reason: string): Promise<CancelResult> {
  const { data, error } = await supabase.functions.invoke("partner-cancel-event", {
    body: { event_id: eventId, reason },
  });
  if (error) {
    let code = "";
    try {
      const body = await (error as { context?: Response }).context?.json();
      code = body?.error?.message ?? body?.error?.code ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new Error(code || "network");
  }
  return data as CancelResult;
}

export const CancelEventDialog = ({
  target,
  onOpenChange,
  onDone,
}: {
  target: CancelTarget | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void | Promise<void>;
}) => {
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const retry = target?.status === "cancelled";

  const run = async () => {
    if (!target) return;
    const text = retry ? "Reintento de reembolsos" : reason.trim();
    if (!retry && text.length < 3) {
      toast.error(ERRORS.cancel_reason_required);
      return;
    }
    setWorking(true);
    let refunded = 0;
    let last: CancelResult | null = null;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        last = await callCancel(target.id, text);
        refunded += last.refunded;
        if (last.remaining === 0) break;
      }
      const pendingMsg =
        last && last.refunds_pending
          ? " Algunos reembolsos no se han podido hacer ahora: reinténtalo desde el menú del evento."
          : "";
      const noAccount =
        last && last.tickets_without_account > 0
          ? ` ${last.tickets_without_account} entrada(s) sin cuenta de comprador: escríbenos desde Soporte para devolverlas.`
          : "";
      if (retry) {
        toast.success(refunded > 0 ? `${refunded} reembolso(s) hechos.` : "No quedan reembolsos pendientes.", {
          description: (pendingMsg + noAccount).trim() || undefined,
        });
      } else {
        toast.success("Evento cancelado", {
          description:
            (refunded > 0
              ? `${refunded} comprador(es) recibirán su dinero y un aviso.`
              : "Hemos avisado a quien tenía entradas.") +
            pendingMsg +
            noAccount,
        });
      }
      setReason("");
      onOpenChange(false);
      await onDone();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(retry ? "No se han podido reintentar los reembolsos" : "No se ha podido cancelar el evento", {
        description: ERRORS[code] ?? "Revisa tu conexión y vuelve a intentarlo.",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !working && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {retry ? "Reintentar reembolsos" : `¿Cancelar «${target?.title ?? ""}»?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {retry
              ? "Volveremos a intentar devolver el dinero a quien aún no lo haya recibido."
              : "El evento dejará de estar a la venta y no se podrá volver a publicar. A todos los que han pagado les devolvemos el importe completo y les avisamos; la comisión de Pasify de esas ventas la asume el local. No se puede deshacer."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!retry && (
          <div className="space-y-2">
            {target && target.tickets_sold > 0 && (
              <p className="text-sm font-medium text-foreground">
                {target.tickets_sold} entrada(s) vendidas se reembolsarán.
              </p>
            )}
            <Label htmlFor="cancel-reason" className="text-xs">
              Motivo (lo verán los compradores)
            </Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: problema con la licencia del local"
              disabled={working}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Volver</AlertDialogCancel>
          <Button
            variant={retry ? "default" : "destructive"}
            disabled={working || (!retry && reason.trim().length < 3)}
            onClick={() => void run()}
          >
            {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
            {retry ? "Reintentar" : "Cancelar evento y reembolsar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CancelEventDialog;
