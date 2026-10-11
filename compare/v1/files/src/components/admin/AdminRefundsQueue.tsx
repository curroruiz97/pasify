import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es as esDate } from "date-fns/locale";
import { AlertTriangle, Check, Loader2, Play, RefreshCw, RotateCcw, X as XIcon } from "lucide-react";
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
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { getErrorMessage } from "@/lib/sentry";
import {
  rpcAdmin,
  useAdminRefundCounts,
  useAdminRefundQueue,
  type AdminRefundRow,
  type RefundQueue,
  type RefundStatus6,
} from "./adminQueries";
import { decidirReembolso, lanzarProcessRefund, type Aviso } from "./adminActions";

/* ============================================================================
   Cola de reembolsos del admin (B5-5)

   Los seis estados de una solicitud, repartidos en cuatro colas:
     - Por revisar:     pending → Aprobar / Denegar (con motivo obligatorio).
     - Con incidencia:  failed (con el motivo de Stripe) → Reintentar;
                        aprobada sin ejecutar (> 2 min) o 'processing' sin
                        reembolso en Stripe (> 10 min) → Retomar.
     - En curso:        aprobada o en Stripe, esperando.
     - Histórico:       refunded / rejected.
   Aprobar y Denegar van por la edge function decide-refund: aprobar ejecuta
   el reembolso en Stripe y denegar envía al comprador el email con el
   motivo. Si decide-refund aún no está desplegada, sigue el camino anterior
   (RPC decide_refund + process-refund) y lo avisa.
   Reintentar pasa la solicitud a 'approved' (admin_retry_refund) y llama a
   process-refund; Retomar solo llama a process-refund, que ejecuta una
   aprobada o retoma una 'processing' atascada.
   ============================================================================ */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const PAGE_SIZE = 20;

const QUEUES: { id: RefundQueue; label: string; empty: string }[] = [
  { id: "pending", label: "Por revisar", empty: "No hay solicitudes pendientes de decidir." },
  { id: "attention", label: "Con incidencia", empty: "Ningún reembolso fallido ni atascado." },
  { id: "in_progress", label: "En curso", empty: "Nada tramitándose en Stripe ahora mismo." },
  { id: "done", label: "Histórico", empty: "Aún no hay reembolsos devueltos ni denegados." },
];

const STATUS: Record<RefundStatus6, { label: string; color: string }> = {
  pending: { label: "En revisión", color: "#E8B04C" },
  approved: { label: "Aprobado · tramitando", color: "#8FB8DE" },
  processing: { label: "En Stripe", color: "#8FB8DE" },
  refunded: { label: "Devuelto", color: "#4DB87A" },
  rejected: { label: "Denegado", color: "#8A8275" },
  failed: { label: "Fallido", color: "#E5484D" },
};

/** Estado que se enseña: un aprobado o un 'processing' atascados no son "tramitando". */
const statusChip = (r: AdminRefundRow) => {
  if (r.queue === "attention" && r.status === "approved") return { label: "Aprobado · sin ejecutar", color: "#FF7A4D" };
  if (r.queue === "attention" && r.status === "processing") return { label: "Atascado en Stripe", color: "#FF7A4D" };
  return STATUS[r.status] ?? { label: r.status, color: "#8A8275" };
};

/** failure_reason de un reembolso de Stripe, o el mensaje del error al crearlo. */
const MOTIVOS_STRIPE: Record<string, string> = {
  insufficient_funds: "Saldo insuficiente en la cuenta de Stripe",
  expired_or_canceled_card: "La tarjeta del comprador está caducada o cancelada",
  lost_or_stolen_card: "La tarjeta del comprador está bloqueada (perdida o robada)",
  declined: "El banco del comprador ha rechazado el reembolso",
  charge_for_pending_refund_disputed: "El cargo está en disputa",
  merchant_request: "Cancelado desde Stripe",
  canceled: "Cancelado en Stripe",
  failed: "Stripe no ha podido completarlo",
  unknown: "Stripe no da el motivo",
};

const motivoFallo = (raw: string | null): string | null => {
  if (!raw) return null;
  const texto = raw.trim();
  if (texto.startsWith("sin confirmar")) return "Stripe no contestó a tiempo; se puede retomar.";
  return MOTIVOS_STRIPE[texto] ?? (texto.length > 220 ? `${texto.slice(0, 220)}…` : texto);
};

const euros = (cents: number, currency: string) =>
  `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === "EUR" ? "€" : currency}`;

export const AdminRefundsQueue = ({ uid }: { uid: string | null }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<RefundQueue>("pending");
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<AdminRefundRow | null>(null);

  const counts = useAdminRefundCounts(uid);
  const lista = useAdminRefundQueue(uid, queue, page, PAGE_SIZE);
  const rows = lista.data?.rows ?? [];
  const total = lista.data?.total ?? 0;

  // Decidir la última solicitud de una página la deja vacía: a la anterior.
  const paginaVacia = !lista.isFetching && !!lista.data && lista.data.rows.length === 0 && page > 0;
  useEffect(() => {
    if (paginaVacia) setPage((p) => Math.max(0, p - 1));
  }, [paginaVacia]);

  const refrescar = () => {
    if (!uid) return;
    void queryClient.invalidateQueries({ queryKey: qk.admin.refundQueue(uid) });
    void queryClient.invalidateQueries({ queryKey: qk.admin.kpis(uid) });
    // El estado de cada entrada en Pedidos y los reembolsos de Liquidaciones.
    void queryClient.invalidateQueries({ queryKey: qk.admin.orders(uid) });
    void queryClient.invalidateQueries({ queryKey: qk.admin.settlements(uid) });
  };

  const cambiarCola = (q: RefundQueue) => {
    setQueue(q);
    setPage(0);
  };

  const conBusy = async (id: string, accion: () => Promise<void>) => {
    setBusyId(id);
    try {
      await accion();
    } finally {
      setBusyId(null);
      refrescar();
    }
  };

  const avisar = (a: Aviso) =>
    toast({ title: a.titulo, description: a.descripcion, variant: a.ok ? undefined : "destructive" });

  // decide-refund: aprueba y ejecuta el reembolso en Stripe en una llamada.
  const aprobar = (r: AdminRefundRow) =>
    conBusy(r.id, async () => {
      avisar(await decidirReembolso(r.id, "approve", null));
    });

  const reintentar = (r: AdminRefundRow) =>
    conBusy(r.id, async () => {
      const { error } = await rpcAdmin<null>("admin_retry_refund", { _request_id: r.id });
      if (error) {
        toast({ title: "No se ha podido reintentar", description: error.message, variant: "destructive" });
        return;
      }
      const fallo = await lanzarProcessRefund(r.id);
      toast(
        fallo
          ? { title: "Reintento sin éxito", description: fallo, variant: "destructive" }
          : { title: "Reembolso relanzado", description: "Stripe lo está tramitando." },
      );
    });

  const retomar = (r: AdminRefundRow) =>
    conBusy(r.id, async () => {
      const fallo = await lanzarProcessRefund(r.id);
      toast(
        fallo
          ? { title: "No se ha podido retomar", description: fallo, variant: "destructive" }
          : { title: "Reembolso retomado", description: "Stripe lo está tramitando." },
      );
    });

  // decide-refund: deniega y envía al comprador el email con el motivo.
  const denegar = async (r: AdminRefundRow, nota: string) => {
    setBusyId(r.id);
    try {
      const aviso = await decidirReembolso(r.id, "reject", nota);
      avisar(aviso);
      return aviso.ok;
    } finally {
      setBusyId(null);
      refrescar();
    }
  };

  const c = counts.data;
  const desde = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const hasta = Math.min(total, (page + 1) * PAGE_SIZE);
  const actual = QUEUES.find((q) => q.id === queue) ?? QUEUES[0];

  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Reembolsos</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Solicitudes de los compradores y su estado real en Stripe: por revisar, con incidencia, en curso e histórico.
      </p>

      {/* Colas */}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Colas de reembolsos">
        {QUEUES.map((q) => {
          const activo = q.id === queue;
          const n = c?.[q.id];
          const alerta = q.id === "attention" && (n ?? 0) > 0;
          return (
            <button
              key={q.id}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => cambiarCola(q.id)}
              className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition"
              style={{
                background: activo ? "rgba(232,84,42,0.14)" : "transparent",
                borderColor: activo ? "rgba(232,84,42,0.55)" : alerta ? "rgba(229,72,77,0.5)" : "hsl(var(--border))",
                color: activo ? "#FF7A4D" : alerta ? "#E5484D" : undefined,
              }}
            >
              {q.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]" style={mono}>
                {n ?? "–"}
              </span>
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={refrescar}
          disabled={lista.isFetching}
          aria-label="Refrescar"
        >
          <RefreshCw className={`h-4 w-4 ${lista.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {counts.isError && (
        <ErrorCard mensaje={`No se han podido contar las colas: ${getErrorMessage(counts.error)}`} onRetry={() => void counts.refetch()} />
      )}

      {lista.isError ? (
        <ErrorCard
          mensaje={`No se han podido cargar los reembolsos: ${getErrorMessage(lista.error)}`}
          onRetry={() => void lista.refetch()}
        />
      ) : lista.isPending ? (
        <PasifyEmptyState icon={<RotateCcw className="h-7 w-7" />} eyebrow="Cargando" title="Cargando reembolsos…" spin compact />
      ) : rows.length === 0 ? (
        <PasifyEmptyState
          icon={<RotateCcw className="h-7 w-7" />}
          eyebrow={actual.label}
          title={actual.empty}
          compact
        />
      ) : (
        <>
          <div className="space-y-3">
            {rows.map((r) => (
              <RefundRow
                key={r.id}
                r={r}
                busy={busyId === r.id}
                bloqueado={busyId !== null && busyId !== r.id}
                onApprove={() => void aprobar(r)}
                onReject={() => setRechazando(r)}
                onRetry={() => void reintentar(r)}
                onResume={() => void retomar(r)}
              />
            ))}
          </div>

          <div
            className="mt-5 flex items-center justify-between text-[11px] uppercase text-muted-foreground"
            style={{ ...mono, letterSpacing: "0.14em" }}
          >
            <span>
              {desde}–{hasta} de {total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={hasta >= total} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}

      <RejectDialog
        request={rechazando}
        busy={!!rechazando && busyId === rechazando.id}
        onClose={() => setRechazando(null)}
        onConfirm={async (nota) => {
          if (!rechazando) return;
          if (await denegar(rechazando, nota)) setRechazando(null);
        }}
      />
    </div>
  );
};

const RefundRow = ({
  r,
  busy,
  bloqueado,
  onApprove,
  onReject,
  onRetry,
  onResume,
}: {
  r: AdminRefundRow;
  busy: boolean;
  bloqueado: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  onResume: () => void;
}) => {
  const chip = statusChip(r);
  const fallo = motivoFallo(r.stripe_failure_reason);
  const esperandoStripe = r.status === "processing" && !!r.stripe_refund_id && r.queue !== "attention";
  const disabled = busy || bloqueado;

  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-start md:justify-between"
      style={{
        borderColor: r.queue === "attention" ? "rgba(229,72,77,0.45)" : "hsl(var(--border))",
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[9px] uppercase"
            style={{
              ...mono,
              letterSpacing: "0.18em",
              background: `${chip.color}22`,
              color: chip.color,
              border: `1px solid ${chip.color}44`,
            }}
          >
            {chip.label}
          </span>
          <span className="text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
            Pedida {format(new Date(r.created_at), "d MMM · HH:mm", { locale: esDate })}
          </span>
          {r.auto_approved && (
            <span className="text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
              · Aprobada por plazo
            </span>
          )}
          {r.retry_count > 0 && (
            <span className="text-[10px] uppercase text-muted-foreground" style={{ ...mono, letterSpacing: "0.14em" }}>
              · {r.retry_count} {r.retry_count === 1 ? "reintento" : "reintentos"}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-base font-semibold text-foreground">{r.event_title ?? "Evento"}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground" style={mono}>
          {r.venue_name ?? "Local"} ·{" "}
          {r.event_date ? format(new Date(r.event_date), "d MMM yyyy · HH:mm", { locale: esDate }) : "—"} ·{" "}
          {euros(r.amount_cents, r.currency)}
          {r.requester_email ? ` · ${r.requester_email}` : ""}
        </div>
        <p className="mt-2 line-clamp-3 text-sm text-foreground/85">
          <span className="text-muted-foreground">Motivo del comprador: </span>
          {r.reason}
        </p>
        {fallo && (r.status === "failed" || r.queue === "attention") && (
          <p className="mt-2 flex items-start gap-1.5 text-sm" style={{ color: "#E5484D" }}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">Motivo del fallo: </span>
              {fallo}
            </span>
          </p>
        )}
        {r.queue === "attention" && r.status === "approved" && (
          <p className="mt-2 text-sm text-muted-foreground">
            Aprobado pero Stripe no llegó a recibirlo. «Retomar» lo vuelve a lanzar.
          </p>
        )}
        {r.queue === "attention" && r.status === "processing" && (
          <p className="mt-2 text-sm text-muted-foreground">
            Lleva más de 10 minutos en Stripe sin reembolso apuntado. «Retomar» lo busca en Stripe y, si no está, lo crea.
          </p>
        )}
        {esperandoStripe && (
          <p className="mt-2 text-sm text-muted-foreground">
            Esperando la confirmación de Stripe ({r.stripe_refund_status ?? "pendiente"}).
          </p>
        )}
        {r.status === "rejected" && r.decision_note && (
          <p className="mt-2 text-sm text-foreground/85">
            <span className="text-muted-foreground">Motivo de la denegación: </span>
            {r.decision_note}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {r.status === "pending" && (
          <>
            <Button variant="outline" size="sm" onClick={onReject} disabled={disabled}>
              <XIcon className="mr-1.5 h-3.5 w-3.5" />
              Denegar
            </Button>
            <Button size="sm" onClick={onApprove} disabled={disabled}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Aprobar
            </Button>
          </>
        )}
        {r.status === "failed" && (
          <Button size="sm" onClick={onRetry} disabled={disabled}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reintentar
          </Button>
        )}
        {r.queue === "attention" && (r.status === "approved" || r.status === "processing") && (
          <Button size="sm" onClick={onResume} disabled={disabled}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Retomar
          </Button>
        )}
      </div>
    </article>
  );
};

const NOTA_MINIMA = 5;

const RejectDialog = ({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: AdminRefundRow | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (nota: string) => Promise<void>;
}) => {
  const [nota, setNota] = useState("");
  const limpia = nota.trim();
  const valida = limpia.length >= NOTA_MINIMA;

  return (
    <Dialog
      open={!!request}
      onOpenChange={(abierto) => {
        if (!abierto && !busy) {
          setNota("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Denegar el reembolso</DialogTitle>
          <DialogDescription>
            {request
              ? `${request.event_title ?? "Evento"} · ${euros(request.amount_cents, request.currency)}. `
              : ""}
            Explica el motivo: se lo enviamos al comprador por email y queda guardado en la solicitud.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Por ejemplo: la entrada está fuera del plazo de devolución del local."
          rows={4}
          maxLength={1000}
          autoFocus
          aria-label="Motivo de la denegación"
        />
        {!valida && nota.length > 0 && (
          <p className="text-xs text-muted-foreground">Escribe al menos {NOTA_MINIMA} caracteres.</p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setNota("");
              onClose();
            }}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!valida || busy}
            onClick={async () => {
              await onConfirm(limpia);
              setNota("");
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Denegar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ErrorCard = ({ mensaje, onRetry }: { mensaje: string; onRetry: () => void }) => (
  <div
    role="alert"
    className="mb-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
    style={{ borderColor: "rgba(229,72,77,0.45)", background: "rgba(229,72,77,0.06)" }}
  >
    <span className="flex items-start gap-2 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      {mensaje}
    </span>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      Reintentar
    </Button>
  </div>
);

export default AdminRefundsQueue;
