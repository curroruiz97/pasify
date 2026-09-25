import { useState, type FormEvent, type ReactNode } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  RotateCcw,
  Send,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMomentLong, parseEdgeError } from "@/components/tickets/ticketUtils";
import type { WalletTicketRow } from "@/hooks/queries/clientData";
import type { RefundRequest } from "@/hooks/useRefundRequests";
import { qk } from "@/lib/cache/keys";
import { getSessionSnapshot } from "@/lib/cache/session";

/**
 * Acciones de una entrada de la cartera (Ola 2):
 *
 *  - «Enviar a un amigo» (edge send-ticket-transfer): solo si el tipo lo
 *    permite y la entrada está pagada, sin usar, y el evento no ha pasado ni
 *    está cancelado. Después sale «Transferencia pendiente» hasta que la
 *    acepte o caduque (7 días).
 *  - «Reenviar email» (edge resend-tickets-email, máx. 3 por hora): el email
 *    del pedido, solo para quien lo compró.
 *  - «Solicitar reembolso» según la política del tipo (D-3): sin plazo, no se
 *    ofrece («Sin devolución (salvo cancelación)»); con N horas, hasta N horas
 *    antes, con la fecha límite a la vista. Lo decide el local.
 *  - El estado de la solicitud: pendiente, aprobada o en curso, rechazada
 *    (con el motivo del local), reembolsada y con incidencia.
 *
 * Lo que decide el servidor se vuelve a comprobar allí: esto solo evita
 * ofrecer lo que va a fallar.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };
const HORA_MS = 60 * 60 * 1000;
/** Caducidad de una transferencia (ticket_transfers.expires_at por defecto). */
const TRANSFERENCIA_CADUCA_MS = 7 * 24 * HORA_MS;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solicitudes que siguen abiertas: no se puede enviar la entrada mientras tanto. */
const REEMBOLSO_ABIERTO: ReadonlySet<string> = new Set(["pending", "approved", "processing"]);

type Plazo =
  | { tipo: "desconocido" }
  | { tipo: "sin_devolucion" }
  | { tipo: "abierto"; limite: string }
  | { tipo: "cerrado"; limite: string };

/** Hasta cuándo se puede pedir la devolución (misma cuenta que request_refund). */
function plazoDevolucion(ticket: WalletTicketRow, ahora: number): Plazo {
  if (!ticket.politica) return { tipo: "desconocido" };
  const horas = ticket.politica.devolucionHastaHoras;
  if (horas === null) return { tipo: "sin_devolucion" };
  const inicio = Date.parse(ticket.event?.date_start ?? "");
  if (!Number.isFinite(inicio)) return { tipo: "desconocido" };
  const limite = inicio - horas * HORA_MS;
  const iso = new Date(limite).toISOString();
  return limite > ahora ? { tipo: "abierto", limite: iso } : { tipo: "cerrado", limite: iso };
}

// ---------------------------------------------------------------- edge functions

/**
 * Resultado de una edge function. Si `ok`, `data` es la respuesta; si no,
 * `status` (null = sin conexión o sin respuesta), `code` y `message` (texto
 * para el usuario, si el servidor lo manda) salen del cuerpo del error.
 */
type Resultado<T> = {
  ok: boolean;
  data: T | null;
  status: number | null;
  code: string | null;
  message: string | null;
};

const SIN_RESPUESTA = { ok: false, data: null, status: null, code: null, message: null } as const;

/** Llama a una edge function con la sesión del usuario. Nunca lanza. */
async function llamarFuncion<T>(nombre: string, body: Record<string, unknown>): Promise<Resultado<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(nombre, { body });
    if (!error) return { ok: true, data: (data ?? {}) as T, status: 200, code: null, message: null };
    if (error instanceof FunctionsHttpError) {
      const respuesta = error.context as Response;
      const cuerpo = await respuesta.json().catch(() => null);
      const { code, message } = parseEdgeError(cuerpo);
      console.warn(`[${nombre}]`, respuesta.status, code ?? cuerpo);
      return { ok: false, data: null, status: respuesta.status, code, message };
    }
    console.warn(`[${nombre}]`, error);
    return SIN_RESPUESTA;
  } catch (err) {
    console.warn(`[${nombre}]`, err);
    return SIN_RESPUESTA;
  }
}

/** Códigos de send-ticket-transfer (errorResponse con el código). */
const ERRORES_TRANSFERENCIA: Record<string, string> = {
  invalid_email: "Revisa el email de tu amigo.",
  transfer_to_self: "No puedes enviarte la entrada a ti mismo.",
  ticket_not_found: "Esta entrada ya no existe.",
  not_ticket_holder: "Esta entrada ya no está a tu nombre.",
  ticket_not_transferable: "Esta entrada ya no se puede enviar: puede que ya se haya usado.",
  event_not_transferable: "El evento ya ha pasado o se ha cancelado: la entrada no se puede enviar.",
  transfer_not_allowed: "Este tipo de entrada no se puede enviar a otra persona.",
  refund_in_progress: "Hay una devolución en curso para esta entrada.",
  transfer_pending: "Ya has enviado esta entrada y está pendiente de aceptar.",
  email_failed: "No hemos podido mandarle el email. Vuelve a intentarlo en unos minutos.",
};

function textoErrorTransferencia(r: Resultado<unknown>): string {
  if (r.status === null) return "Revisa tu conexión e inténtalo de nuevo.";
  if (r.status === 429 || r.code === "rate_limit_exceeded") return "Has enviado varias seguidas: espera un poco y vuelve a intentarlo.";
  if (r.status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (r.code && ERRORES_TRANSFERENCIA[r.code]) return ERRORES_TRANSFERENCIA[r.code];
  // 404 sin código: la función no está desplegada (su texto viene en inglés).
  if (r.status === 404) return "El envío de entradas no está disponible ahora mismo. Inténtalo más tarde.";
  // Contrato del servidor: el `message` de primer nivel es texto para el usuario.
  if (r.message && r.status >= 400 && r.status < 500) return r.message;
  return "No hemos podido enviarla. Vuelve a intentarlo en unos minutos.";
}

// ---------------------------------------------------------------- componente

interface Props {
  ticket: WalletTicketRow;
  /** Usuario de la cartera. */
  uid: string;
  /** Solicitud de devolución de esta entrada, si hay. */
  refund: RefundRequest | null;
  onRequestRefund: (ticketId: string, reason: string) => Promise<unknown>;
  /** El evento ya terminó (isEventOver, como la cuenta atrás). */
  past: boolean;
  /** El local canceló el evento (y la entrada no se había usado). */
  cancelled: boolean;
  /** Hora de la cuenta atrás (se refresca cada minuto): cierra el plazo de devolución a su hora. */
  ahora: number;
}

export const AccionesEntrada = ({ ticket, uid, refund, onRequestRefund, past, cancelled, ahora }: Props) => {
  const queryClient = useQueryClient();
  const [transferirAbierto, setTransferirAbierto] = useState(false);
  const [devolucionAbierta, setDevolucionAbierta] = useState(false);
  const [reenviando, setReenviando] = useState(false);

  const activa = ticket.status === "paid" && !ticket.used_at && !cancelled && !past;
  const reembolsoAbierto = !!refund && REEMBOLSO_ABIERTO.has(refund.status);
  const transferencia =
    ticket.status === "paid" &&
    ticket.transferencia_pendiente &&
    Date.parse(ticket.transferencia_pendiente.caduca) > ahora
      ? ticket.transferencia_pendiente
      : null;
  const conImporte = (ticket.amount_paid_cents ?? 0) > 0;
  const plazo = plazoDevolucion(ticket, ahora);

  const transferible = activa && ticket.politica?.transferible === true;
  const puedeTransferir = transferible && !transferencia && !reembolsoAbierto;
  // El email del pedido va al comprador: una entrada recibida no tiene "su" pedido.
  const puedeReenviar =
    activa && !!ticket.order_id && ticket.buyer_user_id === uid && !ticket.transferred_to_user_id;
  const devolvible = activa && conImporte && plazo.tipo === "abierto";
  const puedePedirDevolucion = devolvible && !refund && !transferencia;
  const verPolitica = activa && conImporte && !refund && plazo.tipo !== "desconocido";

  const reenviarEmail = async () => {
    if (!ticket.order_id || reenviando) return;
    setReenviando(true);
    try {
      const r = await llamarFuncion<{ sent?: boolean }>("resend-tickets-email", { order_id: ticket.order_id });
      if (r.ok && r.data?.sent === true) {
        toast.success("Enviado", { description: "Te hemos reenviado el email con tus entradas. Si no lo ves, mira en spam." });
      } else if (r.ok) {
        toast.error("No se ha podido enviar el email", { description: "Vuelve a intentarlo en unos minutos." });
      } else if (r.status === 429 || r.code === "rate_limit_exceeded") {
        toast("Espera un poco", {
          description: r.message ?? "Ya te lo hemos reenviado varias veces. Podrás pedirlo de nuevo en un rato.",
        });
      } else {
        toast.error("No se ha podido reenviar el email", {
          description:
            r.status === null
              ? "Revisa tu conexión e inténtalo de nuevo."
              : r.status === 404 && !r.code
                ? // Sin código: la función no está desplegada (su texto viene en inglés).
                  "El reenvío no está disponible ahora mismo. Inténtalo más tarde."
                : // Contrato del servidor: `message` es texto para el usuario.
                  r.message ?? "Vuelve a intentarlo en unos minutos.",
        });
      }
    } finally {
      setReenviando(false);
    }
  };

  /** Transferencia hecha: la tarjeta pasa a «Transferencia pendiente» ya; el refresco lo confirma. */
  const alTransferir = (transferId: string | null) => {
    const clave = qk.me.tickets(uid);
    queryClient.setQueryData<WalletTicketRow[]>(clave, (prev) =>
      prev?.map((t) =>
        t.id === ticket.id
          ? {
              ...t,
              transferencia_pendiente: {
                id: transferId ?? "pendiente",
                caduca: new Date(Date.now() + TRANSFERENCIA_CADUCA_MS).toISOString(),
              },
            }
          : t,
      ),
    );
    void queryClient.invalidateQueries({ queryKey: clave });
  };

  const hayAlgo = !!refund || !!transferencia || transferible || puedeReenviar || verPolitica || devolvible;
  if (!hayAlgo) return null;

  return (
    <div className="mt-3 space-y-2">
      {refund && <EstadoDevolucion refund={refund} past={past} />}

      {transferencia && (
        <Aviso
          tono="naranja"
          icono={<Send className="h-4 w-4" />}
          titulo="Transferencia pendiente"
          texto={`Esperando a que la acepte (caduca el ${formatMomentLong(transferencia.caduca)}). Hasta entonces, la entrada sigue siendo tuya.`}
        />
      )}

      {(puedeTransferir || puedeReenviar) && (
        <div className="flex flex-wrap gap-2">
          {puedeTransferir && (
            <BotonAccion onClick={() => setTransferirAbierto(true)} icono={<Send className="h-3.5 w-3.5" />}>
              ENVIAR A UN AMIGO
            </BotonAccion>
          )}
          {puedeReenviar && (
            <BotonAccion
              onClick={() => void reenviarEmail()}
              disabled={reenviando}
              icono={reenviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            >
              REENVIAR EMAIL
            </BotonAccion>
          )}
        </div>
      )}

      {verPolitica && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11px] text-muted-foreground">
          {plazo.tipo === "sin_devolucion" && (
            <span className="inline-flex items-center gap-1.5">
              <ShieldOff className="h-3.5 w-3.5 shrink-0" />
              Sin devolución (salvo cancelación)
            </span>
          )}
          {plazo.tipo === "abierto" && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Devolución hasta el {formatMomentLong(plazo.limite)}
            </span>
          )}
          {plazo.tipo === "cerrado" && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              El plazo de devolución terminó el {formatMomentLong(plazo.limite)}
            </span>
          )}
        </div>
      )}

      {puedePedirDevolucion && (
        <button
          type="button"
          onClick={() => setDevolucionAbierta(true)}
          className="mx-auto block min-h-[44px] px-2 text-[10px] uppercase text-muted-foreground transition hover:text-orange-500"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          ¿No puedes ir? Solicita el reembolso
        </button>
      )}

      {/* Montados mientras la acción tenga sentido, aunque ya se haya usado:
          así se cierran con su animación al terminar. */}
      {transferible && (
        <EnviarAUnAmigo
          open={transferirAbierto}
          onOpenChange={setTransferirAbierto}
          ticket={ticket}
          onEnviada={alTransferir}
          onDesfasada={() => void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) })}
        />
      )}
      {devolvible && plazo.tipo === "abierto" && (
        <SolicitarDevolucion
          open={devolucionAbierta}
          onOpenChange={setDevolucionAbierta}
          limite={plazo.limite}
          onEnviar={(motivo) => onRequestRefund(ticket.id, motivo)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- piezas

const BotonAccion = ({
  onClick,
  disabled,
  icono,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icono: ReactNode;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex min-h-[44px] flex-1 basis-[9.5rem] items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-center text-[11px] font-medium leading-tight text-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:cursor-wait disabled:opacity-60"
    style={{ ...mono, letterSpacing: "0.08em" }}
  >
    {icono}
    {children}
  </button>
);

type Tono = "naranja" | "verde" | "gris" | "rojo";
const TONOS: Record<Tono, string> = {
  naranja: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  verde: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  gris: "border-border bg-muted/40 text-muted-foreground",
  rojo: "border-red-500/40 bg-red-500/10 text-red-400",
};

const Aviso = ({ tono, icono, titulo, texto }: { tono: Tono; icono: ReactNode; titulo: string; texto?: ReactNode }) => (
  <div role="status" className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${TONOS[tono]}`}>
    <span className="mt-0.5 shrink-0">{icono}</span>
    <div className="min-w-0">
      <div className="text-[12px] font-semibold text-foreground">{titulo}</div>
      {texto && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{texto}</p>}
    </div>
  </div>
);

/** Estado de la solicitud de devolución, con el motivo si el local la rechazó. */
const EstadoDevolucion = ({ refund, past }: { refund: RefundRequest; past: boolean }) => {
  switch (refund.status) {
    case "pending":
      return (
        <Aviso
          tono="naranja"
          icono={<Clock className="h-4 w-4" />}
          titulo="Reembolso solicitado"
          texto="Pendiente de que el local lo revise. Te avisaremos cuando decida."
        />
      );
    case "approved":
    case "processing":
      return (
        <Aviso
          tono="verde"
          icono={<CheckCircle2 className="h-4 w-4" />}
          titulo="Reembolso aprobado · en curso"
          texto="Verás el dinero en tu método de pago en 5-10 días laborables."
        />
      );
    case "refunded":
      return (
        <Aviso
          tono="verde"
          icono={<RotateCcw className="h-4 w-4" />}
          titulo="Reembolsada"
          texto="Te hemos devuelto el importe a tu método de pago."
        />
      );
    case "rejected":
      return (
        <Aviso
          tono="gris"
          icono={<XCircle className="h-4 w-4" />}
          titulo="Reembolso rechazado"
          texto={
            <>
              {refund.decisionNote ? (
                <>
                  Motivo del local: <span className="text-foreground">«{refund.decisionNote}»</span>.{" "}
                </>
              ) : null}
              {past ? null : "Tu entrada sigue siendo válida."}
            </>
          }
        />
      );
    case "failed":
      return (
        <Aviso
          tono="rojo"
          icono={<AlertTriangle className="h-4 w-4" />}
          titulo="Reembolso con incidencia"
          texto="La estamos revisando. No tienes que hacer nada: te escribiremos si necesitamos algo."
        />
      );
    default:
      return null;
  }
};

/** Hoja «Enviar a un amigo»: email y mensaje opcional. */
const EnviarAUnAmigo = ({
  open,
  onOpenChange,
  ticket,
  onEnviada,
  onDesfasada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: WalletTicketRow;
  onEnviada: (transferId: string | null) => void;
  /** El servidor la ve distinta (ya enviada, usada…): refrescar la cartera. */
  onDesfasada: () => void;
}) => {
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiarApertura = (abierta: boolean) => {
    if (enviando) return;
    onOpenChange(abierta);
    if (!abierta) setError(null);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    const destino = email.trim().toLowerCase();
    if (!EMAIL_RE.test(destino)) {
      setError("Escribe un email válido.");
      return;
    }
    const miEmail = getSessionSnapshot().session?.user?.email?.trim().toLowerCase();
    if (miEmail && destino === miEmail) {
      setError("Ese es tu email: escribe el de la persona a la que se la envías.");
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      const r = await llamarFuncion<{ transfer_id?: string }>("send-ticket-transfer", {
        ticket_id: ticket.id,
        to_email: destino,
        ...(mensaje.trim() ? { message: mensaje.trim() } : {}),
      });
      if (!r.ok) {
        setError(textoErrorTransferencia(r));
        // La entrada ha cambiado en el servidor (usada, ya enviada, con
        // devolución…): la cartera se pone al día.
        if (r.status === 403 || r.status === 404 || r.status === 409) onDesfasada();
        return;
      }
      onEnviada(typeof r.data?.transfer_id === "string" ? r.data.transfer_id : null);
      toast.success("Entrada enviada", {
        description: `Le hemos mandado un email a ${destino} para que la acepte.`,
      });
      setEmail("");
      setMensaje("");
      onOpenChange(false);
    } finally {
      setEnviando(false);
    }
  };

  const titulo = ticket.event?.title ?? "tu entrada";
  return (
    <Sheet open={open} onOpenChange={cambiarApertura}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto border-border bg-card px-5 pb-8 text-foreground">
        <SheetHeader className="pb-4 pt-3 text-left">
          <SheetTitle className="text-xl text-foreground">Enviar a un amigo</SheetTitle>
          <SheetDescription className="text-muted-foreground">
            {`Le llegará un email para aceptar ${ticket.tier_name ? `tu entrada ${ticket.tier_name}` : "tu entrada"} de «${titulo}». Cuando la acepte tendrá un QR nuevo y el tuyo dejará de valer. Si no la acepta en 7 días, sigue siendo tuya.`}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={(e) => void enviar(e)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={`transferir-email-${ticket.id}`}>Email de tu amigo</Label>
            <Input
              id={`transferir-email-${ticket.id}`}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@email.com"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? `transferir-error-${ticket.id}` : undefined}
              className="h-12 text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`transferir-mensaje-${ticket.id}`}>Mensaje (opcional)</Label>
            <Textarea
              id={`transferir-mensaje-${ticket.id}`}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="¡Nos vemos dentro!"
              maxLength={280}
              rows={3}
            />
          </div>
          {error && (
            <p id={`transferir-error-${ticket.id}`} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-12 w-full text-base" disabled={enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar entrada
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
};

/** Diálogo «Solicitar reembolso»: motivo obligatorio, con la fecha límite a la vista. */
const SolicitarDevolucion = ({
  open,
  onOpenChange,
  limite,
  onEnviar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limite: string;
  onEnviar: (motivo: string) => Promise<unknown>;
}) => {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (enviando) return;
    if (!motivo.trim()) {
      setError("Cuéntanos brevemente por qué la devuelves.");
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await onEnviar(motivo.trim());
      setMotivo("");
      onOpenChange(false);
    } catch {
      // useRefundRequests ya ha avisado con el motivo (plazo cerrado, sin devolución…).
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !enviando && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar reembolso</DialogTitle>
          <DialogDescription>
            Puedes pedirlo hasta el {formatMomentLong(limite)}. Lo revisa el local y te avisaremos cuando decida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Label htmlFor="motivo-reembolso">Motivo</Label>
          <Textarea
            id="motivo-reembolso"
            placeholder="Enfermedad, cambio de planes…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={4}
            aria-invalid={!!error || undefined}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} disabled={enviando}>
            {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Enviar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AccionesEntrada;
