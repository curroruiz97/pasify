import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RefreshCcw, Undo2, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { RefreshIndicator } from "@/components/ui/refresh-indicator";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUserId } from "@/lib/cache/session";
import { getErrorMessage } from "@/lib/sentry";
import { describeWriteError, WriteError } from "@/components/partner/writeErrors";
import { formatInTimeZone } from "@/components/partner/zonedTime";
import {
  REJECT_NOTE_MIN_LENGTH,
  decideRefundRequest,
  invalidarTrasDecidirReembolso,
  usePartnerRefunds,
  type PartnerRefundRequest,
  type PartnerRefundStatus,
} from "@/hooks/queries/partnerData";

/**
 * Reembolsos del local (B1-07, B4-05).
 *
 * Con la política de cada tipo de entrada ("hasta N horas antes del evento"),
 * lo que pide un comprador dentro de plazo llega aquí como pendiente y lo
 * decide el local: «Aprobar» devuelve el dinero en Stripe; «Rechazar» pide el
 * motivo, que le llega al comprador por email. Las dos van por la edge
 * function decide-refund.
 *
 * Arriba las pendientes (la que más lleva esperando, primero) y debajo las
 * decididas con su estado: «En curso» (aprobada, en Stripe), «Reembolsada»,
 * «Fallida · la revisa Pasify» y «Rechazada» con su motivo.
 *
 * Los datos (usePartnerRefunds) llevan lo que escribe el comprador: solo en
 * memoria. El número de pendientes del menú sale de la misma consulta y el
 * tiempo real (usePartnerRefundsLive, en el panel) la mantiene al día.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const ESTADO: Record<PartnerRefundStatus, { label: string; color: string }> = {
  pending: { label: "Por decidir", color: "#E8B04C" },
  approved: { label: "En curso", color: "#8FB8DE" },
  processing: { label: "En curso", color: "#8FB8DE" },
  refunded: { label: "Reembolsada", color: "#4DB87A" },
  failed: { label: "Fallida · la revisa Pasify", color: "#E5484D" },
  rejected: { label: "Rechazada", color: "#8A8275" },
};

const importe = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

const FECHA_CORTA: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
const FECHA_EVENTO: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const SIN_PERMISO = "Tu cuenta no puede decidir los reembolsos de este local. Pídeselo a quien lo gestiona.";

/**
 * Errores de decide-refund en claro. Los códigos exactos son de la edge
 * function (Ola 2, reembolsos); se reconocen por su forma habitual.
 */
const ERRORES_DECISION: Array<[RegExp, string]> = [
  [
    /requested function was not found|function not found/i,
    "Aprobar y rechazar aún no está disponible. Vuelve a intentarlo más tarde o escríbenos desde Soporte.",
  ],
  [/forbidden|not_allowed|unauthori[sz]ed|sin permiso/i, SIN_PERMISO],
  [/already|ya decidida|not_pending|invalid_status|conflict/i, "Esta solicitud ya estaba decidida. La lista se ha actualizado."],
  [/not[_ ]found|no encontrada|no existe/i, "Esta solicitud ya no existe. La lista se ha actualizado."],
  [/note|nota|motivo/i, `Escribe el motivo del rechazo (${REJECT_NOTE_MIN_LENGTH} caracteres o más).`],
  [
    /stripe/i,
    "Stripe no ha podido hacer la devolución ahora. La solicitud queda como fallida y la revisa Pasify.",
  ],
  [/rate_limit|too many/i, "Demasiados intentos seguidos. Espera un minuto y vuelve a probar."],
];

const describirErrorDecision = (err: unknown): string => {
  if (err instanceof WriteError && err.kind === "rejected") {
    const texto = `${err.code ?? ""} ${err.message}`;
    for (const [re, mensaje] of ERRORES_DECISION) if (re.test(texto)) return mensaje;
    if (err.status === 401 || err.status === 403) return SIN_PERMISO;
  }
  return describeWriteError(err, {
    network:
      "No hay conexión con el servidor y no sabemos si se ha aplicado la decisión. Revisa tu conexión y mira la lista antes de volver a intentarlo.",
  });
};

type Pendiente = { request: PartnerRefundRequest; decision: "approve" | "reject" } | null;

export const PartnerRefunds = ({
  orgId,
  timeZoneFor,
}: {
  orgId: string | null;
  /** Zona horaria del local de un evento: las fechas se enseñan en su hora. */
  timeZoneFor: (venueId: string | null) => string | undefined;
}) => {
  const uid = useCurrentUserId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = usePartnerRefunds(uid, orgId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Pendiente>(null);

  const decidir = async (r: PartnerRefundRequest, decision: "approve" | "reject", nota?: string): Promise<boolean> => {
    setBusyId(r.id);
    try {
      const estado = await decideRefundRequest(r.id, decision, nota);
      if (decision === "reject") {
        toast({ title: "Solicitud rechazada", description: "Le hemos enviado el motivo al comprador por email." });
      } else if (estado === "refunded") {
        toast({
          title: "Reembolso hecho",
          description: `${importe(r.amountCents, r.currency)} vuelven al comprador; los verá en 5-10 días laborables.`,
        });
      } else if (estado === "failed") {
        toast({
          title: "Aprobada, pero sin devolver",
          description: "Stripe no ha podido hacer la devolución. La revisa Pasify y te avisamos.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Reembolso aprobado", description: "Stripe lo está tramitando; en unos minutos saldrá como reembolsada." });
      }
      return true;
    } catch (err) {
      console.error("[PartnerRefunds] decide-refund:", err);
      toast({
        title: decision === "approve" ? "No se ha podido aprobar" : "No se ha podido rechazar",
        description: describirErrorDecision(err),
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyId(null);
      // Pase lo que pase (otra persona pudo decidirla antes), la lista al día.
      if (uid) void invalidarTrasDecidirReembolso(queryClient, uid);
    }
  };

  if (!orgId) {
    return (
      <PasifyEmptyState
        icon={<Undo2 className="h-7 w-7" />}
        eyebrow="Sin local"
        title="Aún no hay reembolsos que gestionar"
        subtitle="Las solicitudes de devolución llegan a la organización de tu local. Completa los datos de tu local para empezar a vender."
        compact
      />
    );
  }

  if (query.data === undefined) {
    if (query.isError) {
      return (
        <ErrorCard
          mensaje={`No hemos podido cargar las solicitudes: ${getErrorMessage(query.error)}`}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      );
    }
    return (
      <PasifyEmptyState
        icon={<Undo2 className="h-7 w-7" />}
        eyebrow="Cargando"
        title="Cargando solicitudes…"
        spin
        compact
      />
    );
  }

  const { pending, decided } = query.data;
  const bloqueado = busyId !== null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <RefreshIndicator active={query.isFetching} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCcw className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {query.isError && (
        <ErrorCard
          mensaje="No hemos podido actualizar las solicitudes: ves las de la última carga."
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}

      {pending.length === 0 && decided.length === 0 ? (
        <PasifyEmptyState
          icon={<Undo2 className="h-7 w-7" />}
          eyebrow="Sin solicitudes"
          title="Nadie ha pedido una devolución"
          subtitle="Si en un tipo de entrada permites devoluciones «hasta N horas antes del evento», lo que pidan los compradores dentro de ese plazo llega aquí para que lo apruebes o lo rechaces."
          compact
        />
      ) : (
        <>
          <section aria-labelledby="reembolsos-pendientes">
            <SectionTitle id="reembolsos-pendientes" count={pending.length}>
              Por decidir
            </SectionTitle>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay solicitudes pendientes.</p>
            ) : (
              <div className="space-y-3">
                {pending.map((r) => (
                  <RefundCard
                    key={r.id}
                    r={r}
                    timeZone={timeZoneFor(r.venueId)}
                    busy={busyId === r.id}
                    disabled={bloqueado}
                    onApprove={() => setConfirmar({ request: r, decision: "approve" })}
                    onReject={() => setConfirmar({ request: r, decision: "reject" })}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="reembolsos-decididos">
            <SectionTitle id="reembolsos-decididos" count={decided.length}>
              Decididas
            </SectionTitle>
            {decided.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no has decidido ninguna solicitud.</p>
            ) : (
              <div className="space-y-3">
                {decided.map((r) => (
                  <RefundCard key={r.id} r={r} timeZone={timeZoneFor(r.venueId)} busy={false} disabled />
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Los reembolsos por cancelar un evento no salen aquí: los sigues desde el menú del evento en Mis
              eventos.
            </p>
          </section>
        </>
      )}

      <ApproveDialog
        request={confirmar?.decision === "approve" ? confirmar.request : null}
        busy={!!confirmar && busyId === confirmar.request.id}
        onClose={() => setConfirmar(null)}
        onConfirm={async (r) => {
          if (await decidir(r, "approve")) setConfirmar(null);
        }}
      />
      <RejectDialog
        request={confirmar?.decision === "reject" ? confirmar.request : null}
        busy={!!confirmar && busyId === confirmar.request.id}
        onClose={() => setConfirmar(null)}
        onConfirm={async (r, nota) => {
          if (await decidir(r, "reject", nota)) setConfirmar(null);
        }}
      />
    </div>
  );
};

const SectionTitle = ({ id, count, children }: { id: string; count: number; children: React.ReactNode }) => (
  <h2 id={id} className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
    {children}
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground" style={mono}>
      {count}
    </span>
  </h2>
);

const RefundCard = ({
  r,
  timeZone,
  busy,
  disabled,
  onApprove,
  onReject,
}: {
  r: PartnerRefundRequest;
  timeZone: string | undefined;
  busy: boolean;
  disabled: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) => {
  const estado = ESTADO[r.status];
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-start md:justify-between"
      style={{
        borderColor: r.status === "pending" ? "rgba(232,176,76,0.45)" : "hsl(var(--border))",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
      data-testid="solicitud-reembolso"
      data-status={r.status}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[9px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: `${estado.color}22`,
              color: estado.color,
              border: `1px solid ${estado.color}44`,
            }}
          >
            {estado.label}
          </span>
          <span className="text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
            Pedida el {formatInTimeZone(r.createdAt, FECHA_CORTA, timeZone)}
          </span>
          {r.autoApproved && (
            <span className="text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
              · Aprobada por plazo
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-base font-semibold text-foreground">{r.eventTitle ?? "Evento"}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground" style={mono}>
          {r.eventDate ? formatInTimeZone(r.eventDate, FECHA_EVENTO, timeZone) : "Fecha del evento —"} ·{" "}
          {r.tierName ?? "Tipo de entrada —"} · <span className="text-foreground">{importe(r.amountCents, r.currency)}</span>
        </div>
        <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-foreground/85">
          <span className="text-muted-foreground">Motivo del comprador: </span>
          {r.reason.trim() || "—"}
        </p>
        {r.status === "rejected" && (
          <p className="mt-2 whitespace-pre-line text-sm text-foreground/85">
            <span className="text-muted-foreground">Motivo del rechazo: </span>
            {r.decisionNote?.trim() || "—"}
          </p>
        )}
        {r.status === "failed" && (
          <p className="mt-2 flex items-start gap-1.5 text-sm" style={{ color: "#E5484D" }}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Stripe no ha podido hacer la devolución. La revisa Pasify; no tienes que hacer nada.</span>
          </p>
        )}
      </div>

      {r.status === "pending" && onApprove && onReject && (
        <div className="flex shrink-0 items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Decidiendo…" />}
          <Button variant="outline" size="sm" onClick={onReject} disabled={disabled}>
            <XIcon className="mr-1.5 h-3.5 w-3.5" />
            Rechazar
          </Button>
          <Button size="sm" onClick={onApprove} disabled={disabled}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Aprobar
          </Button>
        </div>
      )}
    </article>
  );
};

/** Aprobar mueve dinero y anula la entrada: se confirma con el importe delante. */
const ApproveDialog = ({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: PartnerRefundRequest | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (r: PartnerRefundRequest) => Promise<void>;
}) => (
  <AlertDialog open={!!request} onOpenChange={(abierto) => !abierto && !busy && onClose()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          ¿Aprobar y devolver {request ? importe(request.amountCents, request.currency) : ""}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {request?.eventTitle ?? "Evento"}
          {request?.tierName ? ` · ${request.tierName}` : ""}. Devolvemos el importe al comprador con el mismo medio
          de pago y su entrada deja de valer. No se puede deshacer.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Volver</AlertDialogCancel>
        <Button disabled={busy || !request} onClick={() => request && void onConfirm(request)}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Aprobar y devolver
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Rechazar pide el motivo: decide-refund lo exige y se lo manda al comprador. */
const RejectDialog = ({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: PartnerRefundRequest | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (r: PartnerRefundRequest, nota: string) => Promise<void>;
}) => {
  const [nota, setNota] = useState("");
  const limpia = nota.trim();
  const valida = limpia.length >= REJECT_NOTE_MIN_LENGTH;
  const cerrar = () => {
    if (busy) return;
    setNota("");
    onClose();
  };

  return (
    <Dialog open={!!request} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechazar la devolución</DialogTitle>
          <DialogDescription>
            {request
              ? `${request.eventTitle ?? "Evento"} · ${importe(request.amountCents, request.currency)}. `
              : ""}
            Explica el motivo: se lo enviamos al comprador por email y queda guardado en la solicitud.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Por ejemplo: la política de este tipo de entrada no permite devoluciones a menos de 48 horas del evento."
          rows={4}
          maxLength={1000}
          autoFocus
          disabled={busy}
          aria-label="Motivo del rechazo"
        />
        {!valida && nota.length > 0 && (
          <p className="text-xs text-muted-foreground">Escribe al menos {REJECT_NOTE_MIN_LENGTH} caracteres.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!valida || busy || !request}
            onClick={async () => {
              if (!request) return;
              await onConfirm(request, limpia);
              setNota("");
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ErrorCard = ({
  mensaje,
  onRetry,
  retrying,
}: {
  mensaje: string;
  onRetry: () => void;
  retrying: boolean;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    style={{ borderColor: "rgba(229,72,77,0.45)", background: "rgba(229,72,77,0.06)" }}
  >
    <span className="flex items-start gap-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#E5484D" }} />
      {mensaje}
    </span>
    <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} className="shrink-0">
      {retrying ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-2 h-3.5 w-3.5" />}
      Reintentar
    </Button>
  </div>
);

export default PartnerRefunds;
