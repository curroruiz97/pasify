import { useEffect, useMemo, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cancelEventSeries, describeSeriesError } from "@/lib/eventSeriesApi";
import { countLabel, isOpenSession } from "@/lib/eventSeries";

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
 *
 * Una fecha de un evento de varios días o recurrente (serie) se puede cancelar
 * sola, ella y las siguientes, o todas las que quedan por celebrar
 * (cancel_event_series). Las fechas sin entradas ni reservas se cancelan de una
 * vez en la base de datos; las que sí las tienen, una a una con
 * partner-cancel-event, que es quien reembolsa en Stripe (aquí, igual que con
 * un evento suelto, se repite mientras queden reembolsos). Si alguna falla,
 * las demás siguen canceladas y se puede volver a pulsar: lo ya cancelado no
 * se repite.
 */

export interface CancelTarget {
  id: string;
  title: string;
  status: string;
  tickets_sold: number;
  /** Serie a la que pertenece esta fecha (null o ausente: evento suelto). */
  series_id?: string | null;
  date_start?: string;
  /** Alcance con el que se abre: «toda la serie» desde el menú de la serie. */
  initialScope?: CancelScope;
}

export type CancelScope = "one" | "following" | "all";

/** Una fecha de la serie, como la conoce Mis eventos. */
export interface CancelSession {
  id: string;
  status: string;
  date_start: string;
  date_end?: string | null;
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
  seriesSessions = [],
  onOpenChange,
  onDone,
}: {
  target: CancelTarget | null;
  /** Todas las fechas de la serie del evento (las que conoce Mis eventos). */
  seriesSessions?: CancelSession[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void | Promise<void>;
}) => {
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [alcance, setAlcance] = useState<CancelScope>("one");
  const retry = target?.status === "cancelled";

  // Las fechas que se cancelarían con cada alcance (por celebrar y no canceladas).
  const abiertas = useMemo(
    () =>
      seriesSessions
        .filter((x) => isOpenSession(x))
        .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)),
    [seriesSessions],
  );
  const desdeEsta = useMemo(
    () => (target?.date_start ? abiertas.filter((x) => Date.parse(x.date_start) >= Date.parse(target.date_start as string)) : abiertas),
    [abiertas, target?.date_start],
  );
  const esDeSerie = !!target?.series_id && !retry && abiertas.length > 1;
  const afectadas = !esDeSerie || alcance === "one" ? null : alcance === "all" ? abiertas : desdeEsta;
  const enSerie = afectadas !== null && !!target?.series_id;

  // Cada vez que se abre, el alcance con el que llega (solo esta fecha, salvo desde el menú de la serie).
  useEffect(() => {
    if (target) setAlcance(target.initialScope ?? "one");
  }, [target]);

  // Un evento sin ventas no tiene nada que devolver ni que leer. Con varias
  // fechas, el detalle (euros) se lee solo de una fecha suelta: en una serie
  // se cuentan las entradas de las fechas que se cancelan.
  const eventoConVentas = target && !retry && !enSerie && target.tickets_sold > 0 ? target.id : null;
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

  /** Cancela varias fechas de la serie: las sin ventas de una vez, las demás una a una. */
  const cancelarSerie = async (text: string) => {
    if (!target?.series_id || !afectadas) return;
    setWorking(true);
    let canceladas = 0;
    let reembolsados = 0;
    let fallidas = 0;
    let sinCuenta = 0;
    let pendientes = false;
    let limite = false;
    try {
      const desde = alcance === "following" ? target.date_start ?? null : null;
      const res = await cancelEventSeries({ seriesId: target.series_id, from: desde, reason: text });
      canceladas = res.cancelled;
      for (const id of res.needs_refunds) {
        if (limite) {
          fallidas += 1;
          continue;
        }
        try {
          let last: CancelResult | null = null;
          for (let round = 0; round < MAX_ROUNDS; round++) {
            last = await callCancel(id, text);
            reembolsados += last.refunded;
            if (last.remaining === 0) break;
          }
          canceladas += 1;
          if (last?.refunds_pending) pendientes = true;
          sinCuenta += last?.tickets_without_account ?? 0;
        } catch (err) {
          fallidas += 1;
          if (err instanceof Error && err.message === "rate_limit_exceeded") limite = true;
        }
      }
      const partes: string[] = [];
      if (reembolsados > 0) partes.push(`${reembolsados} comprador(es) recibirán su dinero y un aviso.`);
      if (pendientes) partes.push("Algunos reembolsos no se han podido hacer ahora: reinténtalos desde el menú de cada fecha.");
      if (sinCuenta > 0) partes.push(`${sinCuenta} entrada(s) sin cuenta de comprador: escríbenos desde Soporte para devolverlas.`);
      if (fallidas > 0) {
        toast.error(`${countLabel(canceladas)} canceladas; ${fallidas} no se ${fallidas === 1 ? "ha podido" : "han podido"} cancelar`, {
          description:
            (limite ? "Has llegado al límite de cancelaciones con reembolso por hora: espera un poco. " : "") +
            "Vuelve a pulsar «Cancelar la serie» para las que quedan: lo ya cancelado no se repite. " +
            partes.join(" "),
        });
      } else {
        toast.success(`${countLabel(canceladas)} canceladas`, { description: partes.join(" ") || "Hemos avisado a quien tenía entradas." });
      }
      setReason("");
      onOpenChange(false);
      await onDone();
    } catch (err) {
      toast.error("No se ha podido cancelar la serie", {
        description: describeSeriesError(err, "Revisa tu conexión y vuelve a intentarlo: lo que ya se haya cancelado no se repite."),
      });
      // Pudo cancelarse parte: se refresca la lista.
      await onDone();
    } finally {
      setWorking(false);
    }
  };

  const run = async () => {
    if (!target) return;
    const text = retry ? "Reintento de reembolsos" : reason.trim();
    if (!retry && text.length < 3) {
      toast.error(ERRORS.cancel_reason_required);
      return;
    }
    if (enSerie) {
      await cancelarSerie(text);
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
            {retry
              ? "Reintentar reembolsos"
              : enSerie
              ? `¿Cancelar ${countLabel(afectadas?.length ?? 0)} de «${target?.title ?? ""}»?`
              : `¿Cancelar «${target?.title ?? ""}»?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {retry
              ? "Volveremos a intentar devolver el dinero a quien aún no lo haya recibido."
              : enSerie
              ? "Esas fechas dejarán de estar a la venta y no se podrán volver a publicar. A todos los que han pagado les devolvemos el importe completo y les avisamos; la comisión de Pasify de esas ventas la asume el local. Las fechas ya celebradas y las que no elijas no se tocan. No se puede deshacer."
              : "El evento dejará de estar a la venta y no se podrá volver a publicar. A todos los que han pagado les devolvemos el importe completo y les avisamos; la comisión de Pasify de esas ventas la asume el local. No se puede deshacer."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {esDeSerie && (
          <fieldset className="space-y-2" disabled={working}>
            <legend className="text-xs font-medium">Esta fecha forma parte de una serie. ¿Qué cancelas?</legend>
            <RadioGroup value={alcance} onValueChange={(v) => setAlcance(v as CancelScope)} className="gap-2" data-testid="cancel-alcance">
              {(
                [
                  ["one", "Solo esta fecha", null],
                  ["following", `Esta y las siguientes`, desdeEsta.length],
                  ["all", "Todas las que quedan por celebrar", abiertas.length],
                ] as const
              ).map(([valor, texto, n]) => (
                <label
                  key={valor}
                  htmlFor={`cancel-alcance-${valor}`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5"
                >
                  <RadioGroupItem value={valor} id={`cancel-alcance-${valor}`} data-testid={`cancel-alcance-${valor}`} />
                  <span>{texto}</span>
                  {n !== null && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{countLabel(n)}</span>}
                </label>
              ))}
            </RadioGroup>
            {enSerie && afectadas && (
              <p className="text-sm font-medium text-foreground" data-testid="resumen-serie">
                {(() => {
                  const conVentas = afectadas.filter((x) => x.tickets_sold > 0);
                  const entradas = conVentas.reduce((n, x) => n + x.tickets_sold, 0);
                  return conVentas.length === 0
                    ? `Se cancelarán ${countLabel(afectadas.length)}; ninguna tiene entradas vendidas.`
                    : `Se cancelarán ${countLabel(afectadas.length)}. ${conVentas.length === 1 ? "Una tiene" : `${conVentas.length} tienen`} entradas vendidas (${entradas}): se reembolsarán a quien pagó.`;
                })()}
              </p>
            )}
          </fieldset>
        )}
        {!retry && (
          <div className="space-y-2">
            {target && !enSerie && target.tickets_sold > 0 && (
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
            {retry
              ? "Reintentar"
              : enSerie
              ? `Cancelar ${countLabel(afectadas?.length ?? 0)} y reembolsar`
              : "Cancelar evento y reembolsar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default CancelEventDialog;
