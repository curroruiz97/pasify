import { useEffect, useState } from "react";
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
 *
 * Antes de cancelar se dice cuántas entradas y cuántos euros se devolverán:
 * las pagadas y sin usar, con el importe que pagó cada una (lo mismo que
 * crea create_cancellation_refund_requests), leídas de partner_event_attendees.
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

/** Lo que se devolverá al cancelar: entradas pagadas sin usar y su importe. */
interface ResumenReembolso {
  entradas: number;
  centimos: number;
  /** Entradas ya escaneadas: entraron, no se devuelven. */
  usadas: number;
  /** La lista llegó cortada por el límite de filas de la API: las cifras son un mínimo. */
  parcial: boolean;
}

/** Filas que devuelve la API de una vez (db-max-rows de PostgREST). */
const LIMITE_FILAS = 1000;

async function leerResumen(eventId: string): Promise<ResumenReembolso> {
  const { data, error } = await supabase.rpc("partner_event_attendees", { _event_id: eventId });
  if (error) throw error;
  const filas = (data ?? []) as unknown as Array<{
    status: string | null;
    used_at: string | null;
    amount_paid_cents: number | null;
  }>;
  let entradas = 0;
  let centimos = 0;
  let usadas = 0;
  for (const f of filas) {
    if (f.status === "used" || (f.status === "paid" && f.used_at)) {
      usadas += 1;
    } else if (f.status === "paid" && (f.amount_paid_cents ?? 0) > 0) {
      // Mismo criterio que la cancelación: pagada, sin usar y de pago.
      entradas += 1;
      centimos += f.amount_paid_cents ?? 0;
    }
  }
  return { entradas, centimos, usadas, parcial: filas.length >= LIMITE_FILAS };
}

const importe = (cents: number) => {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
};

/** «Se devolverán 4 entradas (60,00 €). 2 ya han entrado y no se devuelven.» */
const textoResumen = (r: ResumenReembolso): string => {
  const masDe = r.parcial ? "al menos " : "";
  const devolver =
    r.entradas === 0
      ? "No hay entradas de pago que devolver."
      : `Se devolverán ${masDe}${r.entradas} ${r.entradas === 1 ? "entrada" : "entradas"} (${masDe}${importe(r.centimos)}).`;
  const usadas =
    r.usadas > 0
      ? ` ${r.usadas} ${r.usadas === 1 ? "ya ha entrado y no se devuelve" : "ya han entrado y no se devuelven"}.`
      : "";
  return devolver + usadas;
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
  // Un evento sin ventas no tiene nada que devolver ni que leer.
  const eventoConVentas = target && !retry && target.tickets_sold > 0 ? target.id : null;
  // Qué se devolverá, de qué evento: "error" si no se pudo leer (se enseña
  // entonces el número de ventas de siempre). Lo de otro evento no se enseña.
  const [leido, setLeido] = useState<{ id: string; valor: ResumenReembolso | "error" } | null>(null);
  const resumen = eventoConVentas && leido?.id === eventoConVentas ? leido.valor : "cargando";

  useEffect(() => {
    if (!eventoConVentas) return;
    let vigente = true;
    leerResumen(eventoConVentas)
      .then((valor) => vigente && setLeido({ id: eventoConVentas, valor }))
      .catch(() => vigente && setLeido({ id: eventoConVentas, valor: "error" }));
    return () => {
      vigente = false;
    };
  }, [eventoConVentas]);

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
              <p className="text-sm font-medium text-foreground" data-testid="resumen-reembolso">
                {resumen === "cargando"
                  ? "Calculando lo que se devolverá…"
                  : resumen === "error"
                  ? `${target.tickets_sold} entrada(s) vendidas se reembolsarán.`
                  : textoResumen(resumen)}
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
