import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Loader2,
  Mail,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
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
import { PasifyEmptyState } from "@/components/ui/pasify-empty-state";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { getErrorMessage } from "@/lib/sentry";
import {
  MIN_BUSQUEDA_PEDIDOS,
  useAdminOrderSearch,
  type AdminOrderRow,
  type AdminOrderTicket,
} from "./adminQueries";
import { reembolsarEntrada, reenviarEntradas, type Aviso } from "./adminActions";
import { chipEntrada, euros, fecha, fechaHora, mono } from "./adminFormat";
import { Chip, ErrorCard, Eyebrow } from "./AdminUi";
import { AdminAttendeesDialog, type EventoRef } from "./AdminEventTools";

/* ============================================================================
   Pedidos (B5-7): lo que pide Soporte, "el evento y el correo de la compra".

   Búsqueda en el servidor (admin_search_orders) por email del comprador o
   del titular, referencia del pedido (A1B2C3D4, como en el email y en la
   página de la compra), código de puerta, id (pedido, entrada o solicitud de
   reembolso), id de Stripe o nombre. En el detalle:
     - Reenviar email: resend-tickets-email (llega en esta ola con el
       checkout; si aún no está, se dice).
     - Reembolsar entrada: admin_create_refund_request (solicitud del sistema
       ya aprobada por el admin) y process-refund, como la cola.
     - Ficha pública del evento y sus Asistentes.
   ============================================================================ */

const ESTADO_PEDIDO: Record<string, { label: string; color: string }> = {
  pending: { label: "Sin pagar", color: "#E8B04C" },
  paid: { label: "Pagado", color: "#4DB87A" },
  partial_refund: { label: "Reembolso parcial", color: "#8FB8DE" },
  refunded: { label: "Reembolsado", color: "#8A8275" },
  failed: { label: "Anulado", color: "#8A8275" },
  expired: { label: "Caducado", color: "#8A8275" },
};

const chipPedido = (s: string) => ESTADO_PEDIDO[s] ?? { label: s, color: "#8A8275" };

const ESTADO_REEMBOLSO: Record<string, { label: string; color: string }> = {
  pending: { label: "Reembolso pedido", color: "#E8B04C" },
  approved: { label: "Reembolso en curso", color: "#8FB8DE" },
  processing: { label: "Reembolso en Stripe", color: "#8FB8DE" },
  refunded: { label: "Reembolsada", color: "#4DB87A" },
  rejected: { label: "Reembolso denegado", color: "#8A8275" },
  failed: { label: "Reembolso fallido", color: "#E5484D" },
};

const COINCIDENCIA: Record<string, string> = {
  id: "id",
  reference: "referencia",
  door_code: "código de puerta",
  stripe: "Stripe",
  email: "email",
  name: "nombre",
};

const coincidencia = (m: string) =>
  m
    .split(",")
    .map((x) => COINCIDENCIA[x] ?? x)
    .join(" · ");

const nombreComprador = (o: AdminOrderRow) =>
  [o.buyer_first_name, o.buyer_last_name].filter(Boolean).join(" ") || null;

/** Un pedido admite reembolsos (el servidor lo vuelve a comprobar). */
const pedidoReembolsable = (o: AdminOrderRow) => o.status === "paid" || o.status === "partial_refund";

/** Por qué no se puede reembolsar una entrada; null si se puede. */
function motivoNoReembolsable(o: AdminOrderRow, t: AdminOrderTicket): string | null {
  if (!pedidoReembolsable(o)) return "El pedido no está pagado.";
  if (o.livemode === false) return "Pago de prueba de Stripe.";
  if (t.status === "used" || t.used_at) return "Ya se usó en la puerta.";
  if (t.status !== "paid") return "La entrada no está pagada.";
  if (t.amount_paid_cents <= 0) return "No costó nada.";
  if (t.refund_status && ["approved", "processing", "refunded"].includes(t.refund_status)) {
    return "Ya tiene un reembolso en curso.";
  }
  return null;
}

/** Lo tecleado, 400 ms después de dejar de escribir. */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * `texto` lo guarda el panel: la búsqueda sigue ahí al volver a Pedidos, y
 * Soporte puede abrir la sección ya buscando el email de una conversación.
 */
export const AdminOrders = ({
  uid,
  texto,
  onTexto,
}: {
  uid: string | null;
  texto: string;
  onTexto: (texto: string) => void;
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const q = useDebounced(texto.trim());
  const busqueda = useAdminOrderSearch(uid, q);
  const pedidos = useMemo(() => busqueda.data ?? [], [busqueda.data]);
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [reembolsando, setReembolsando] = useState<{ order: AdminOrderRow; ticket: AdminOrderTicket } | null>(null);
  const [asistentes, setAsistentes] = useState<EventoRef | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);

  const corta = q.length < MIN_BUSQUEDA_PEDIDOS;
  // Con un solo resultado, se abre directamente.
  const seleccion =
    pedidos.find((o) => o.order_id === seleccionId) ?? (pedidos.length === 1 ? pedidos[0] : null);

  const refrescar = () => {
    if (!uid) return;
    void queryClient.invalidateQueries({ queryKey: qk.admin.orders(uid) });
  };

  const avisar = (a: Aviso) =>
    toast({ title: a.titulo, description: a.descripcion, variant: a.ok ? undefined : "destructive" });

  const reenviar = async (o: AdminOrderRow) => {
    setReenviando(o.order_id);
    try {
      avisar(await reenviarEntradas(o.order_id, o.buyer_email));
    } finally {
      setReenviando(null);
      refrescar();
    }
  };

  return (
    <div>
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Pedidos</h1>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Busca una compra por el email del comprador o del titular, la referencia del pedido (A1B2C3D4), el código de
        puerta de una entrada, un id o el nombre. Desde el detalle se reenvían las entradas y se reembolsa.
      </p>

      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          refrescar();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            placeholder="email@ejemplo.com · A1B2C3D4 · código de puerta · id"
            className="h-11 rounded-xl pl-9"
            autoFocus
            aria-label="Buscar pedidos"
          />
        </div>
        <Button type="submit" variant="outline" className="h-11" disabled={corta || busqueda.isFetching} aria-label="Buscar">
          {busqueda.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </form>

      {corta ? (
        <PasifyEmptyState
          icon={<Receipt className="h-7 w-7" />}
          eyebrow="Buscar"
          title="Escribe al menos 3 caracteres."
          subtitle="Por ejemplo, el email con el que se compró o los 8 caracteres de la referencia que salen en el email de la compra."
          compact
        />
      ) : busqueda.isError ? (
        <ErrorCard
          mensaje={`No se ha podido buscar: ${getErrorMessage(busqueda.error)}`}
          onRetry={() => void busqueda.refetch()}
        />
      ) : busqueda.isPending ? (
        <PasifyEmptyState icon={<Receipt className="h-7 w-7" />} eyebrow="Buscando" title="Buscando pedidos…" spin compact />
      ) : pedidos.length === 0 ? (
        <PasifyEmptyState
          icon={<Receipt className="h-7 w-7" />}
          eyebrow="Sin resultados"
          title="Ningún pedido coincide."
          subtitle="Revisa el email o el código. Una referencia o un código de puerta tienen 8 caracteres."
          compact
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="max-h-[75vh] overflow-y-auto rounded-2xl border border-border bg-card">
            {pedidos.map((o) => {
              const activo = seleccion?.order_id === o.order_id;
              const chip = chipPedido(o.status);
              return (
                <button
                  key={o.order_id}
                  type="button"
                  onClick={() => setSeleccionId(o.order_id)}
                  className={`flex w-full flex-col items-start gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${activo ? "bg-muted/60" : ""}`}
                >
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold" style={mono}>
                      {o.reference}
                    </span>
                    <Chip color={chip.color}>{chip.label}</Chip>
                    {o.livemode === false && <Chip color="#E8B04C">Prueba</Chip>}
                    <span className="ml-auto text-sm tabular-nums">{euros(o.total_cents, o.currency)}</span>
                  </div>
                  <div className="w-full truncate text-sm text-foreground/90">{o.event_title ?? "Evento"}</div>
                  <div className="w-full truncate text-xs text-muted-foreground">
                    {o.buyer_email} · {o.tickets.length} {o.tickets.length === 1 ? "entrada" : "entradas"}
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground/70" style={{ ...mono, letterSpacing: "0.12em" }}>
                    {fecha(o.created_at)} · por {coincidencia(o.matched_by)}
                  </div>
                </button>
              );
            })}
            {pedidos.length >= 25 && (
              <p className="p-3 text-center text-xs text-muted-foreground">
                Se enseñan los 25 más recientes: afina la búsqueda para ver otros.
              </p>
            )}
          </div>

          <div className="min-h-[420px] rounded-2xl border border-border bg-card">
            {seleccion ? (
              <OrderDetail
                order={seleccion}
                reenviando={reenviando === seleccion.order_id}
                onReenviar={() => void reenviar(seleccion)}
                onReembolsar={(ticket) => setReembolsando({ order: seleccion, ticket })}
                onAsistentes={() =>
                  seleccion.event_id && setAsistentes({ id: seleccion.event_id, title: seleccion.event_title ?? "Evento" })
                }
              />
            ) : (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <Receipt className="mb-3 h-10 w-10 opacity-40" />
                Elige un pedido de la lista para ver sus entradas.
              </div>
            )}
          </div>
        </div>
      )}

      <RefundTicketDialog
        target={reembolsando}
        onClose={() => setReembolsando(null)}
        onDone={() => {
          if (!uid) return;
          refrescar();
          void queryClient.invalidateQueries({ queryKey: qk.admin.refundQueue(uid) });
          void queryClient.invalidateQueries({ queryKey: qk.admin.kpis(uid) });
          void queryClient.invalidateQueries({ queryKey: qk.admin.settlements(uid) });
        }}
      />
      <AdminAttendeesDialog uid={uid} event={asistentes} onClose={() => setAsistentes(null)} />
    </div>
  );
};

const Dato = ({ etiqueta, children }: { etiqueta: string; children: ReactNode }) => (
  <div className="min-w-0">
    <Eyebrow className="mb-1">{etiqueta}</Eyebrow>
    <div className="text-sm text-foreground">{children}</div>
  </div>
);

const OrderDetail = ({
  order: o,
  reenviando,
  onReenviar,
  onReembolsar,
  onAsistentes,
}: {
  order: AdminOrderRow;
  reenviando: boolean;
  onReenviar: () => void;
  onReembolsar: (t: AdminOrderTicket) => void;
  onAsistentes: () => void;
}) => {
  const chip = chipPedido(o.status);
  const comprador = nombreComprador(o);
  const chipEvento = o.event_status === "cancelled" ? { label: "Evento cancelado", color: "#E5484D" } : null;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Pedido <span style={mono}>{o.reference}</span>
            </h2>
            <Chip color={chip.color}>{chip.label}</Chip>
            {o.livemode === false && <Chip color="#E8B04C">Pago de prueba</Chip>}
            {chipEvento && <Chip color={chipEvento.color}>{chipEvento.label}</Chip>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Creado {fechaHora(o.created_at)}
            {o.paid_at ? ` · pagado ${fechaHora(o.paid_at)}` : ""}
            {o.refunded_at ? ` · reembolsado ${fechaHora(o.refunded_at)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReenviar}
            disabled={reenviando || !pedidoReembolsable(o)}
            title={pedidoReembolsable(o) ? "Reenviar al comprador el email con sus entradas" : "El pedido no está pagado"}
          >
            {reenviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1.5 h-3.5 w-3.5" />}
            Reenviar email
          </Button>
          {o.event_id && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={`#/e/${o.event_id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Ficha pública
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={onAsistentes}>
                <Users className="mr-1.5 h-3.5 w-3.5" />
                Asistentes
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Dato etiqueta="Comprador">
          <div className="truncate">{comprador ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{o.buyer_email}</div>
          {o.buyer_phone && <div className="text-xs text-muted-foreground">{o.buyer_phone}</div>}
          <div className="text-xs text-muted-foreground">{o.buyer_user_id ? "Con cuenta en Pasify" : "Sin cuenta"}</div>
        </Dato>
        <Dato etiqueta="Evento">
          <div className="truncate">{o.event_title ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{fechaHora(o.event_date_start)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[o.venue_name, o.event_city].filter(Boolean).join(" · ") || "—"}
          </div>
          {o.org_name && <div className="truncate text-xs text-muted-foreground">Local: {o.org_name}</div>}
        </Dato>
        <Dato etiqueta="Importes">
          <div className="tabular-nums">Cobrado {euros(o.total_cents, o.currency)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">Comisión Pasify {euros(o.fees_cents, o.currency)}</div>
          {o.refunded_cents > 0 && (
            <div className="text-xs text-muted-foreground tabular-nums">Reembolsado {euros(o.refunded_cents, o.currency)}</div>
          )}
        </Dato>
        <Dato etiqueta="Email de las entradas">
          <div>{o.tickets_email_sent_at ? `Enviado ${fechaHora(o.tickets_email_sent_at)}` : "No consta enviado"}</div>
          {o.stripe_payment_intent_id && (
            <div className="truncate text-[11px] text-muted-foreground" style={mono} title={o.stripe_payment_intent_id}>
              {o.stripe_payment_intent_id}
            </div>
          )}
        </Dato>
      </div>

      <div>
        <Eyebrow className="mb-2">Entradas</Eyebrow>
        {o.tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">El pedido no tiene entradas.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Titular</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.tickets.map((t) => {
                  const estado = chipEntrada(t.status);
                  const reembolso = t.refund_status ? ESTADO_REEMBOLSO[t.refund_status] : null;
                  const noSe = motivoNoReembolsable(o, t);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium" style={mono}>
                        {t.door_code}
                      </TableCell>
                      <TableCell>{t.tier_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="text-sm">{t.holder_name ?? "—"}</div>
                        {t.holder_email && <div className="text-muted-foreground">{t.holder_email}</div>}
                        {t.transferred && <div className="text-muted-foreground">Transferida</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Chip color={estado.color}>{estado.label}</Chip>
                          {reembolso && t.status !== "refunded" && <Chip color={reembolso.color}>{reembolso.label}</Chip>}
                          {t.used_at && <span className="text-[11px] text-muted-foreground">{fechaHora(t.used_at)}</span>}
                          {t.refund_status === "failed" && t.refund_failure && (
                            <span className="max-w-[16rem] text-[11px] text-muted-foreground" title={t.refund_failure}>
                              {t.refund_failure.length > 80 ? `${t.refund_failure.slice(0, 80)}…` : t.refund_failure}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{euros(t.amount_paid_cents, t.currency)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!noSe}
                          title={noSe ?? "Devolver el importe de esta entrada"}
                          onClick={() => onReembolsar(t)}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Reembolsar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};

const NOTA_MINIMA = 5;

const RefundTicketDialog = ({
  target,
  onClose,
  onDone,
}: {
  target: { order: AdminOrderRow; ticket: AdminOrderTicket } | null;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { toast } = useToast();
  const [nota, setNota] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const limpia = nota.trim();
  const valida = limpia.length >= NOTA_MINIMA;
  const t = target?.ticket;

  const previo =
    t?.refund_status === "failed"
      ? "Esta entrada ya tenía un reembolso que falló en Stripe: se vuelve a intentar."
      : t?.refund_status === "pending"
        ? "Tenía una solicitud pendiente de decidir: la resuelve Pasify y se reembolsa."
        : t?.refund_status === "rejected"
          ? "El local había denegado el reembolso: Pasify lo aprueba."
          : null;

  const cerrar = () => {
    if (trabajando) return;
    setNota("");
    onClose();
  };

  const confirmar = async () => {
    if (!t || !valida) return;
    setTrabajando(true);
    try {
      const aviso = await reembolsarEntrada(t.id, limpia);
      toast({ title: aviso.titulo, description: aviso.descripcion, variant: aviso.ok ? undefined : "destructive" });
      onDone();
      setNota("");
      onClose();
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Reembolsar la entrada <span style={mono}>{t?.door_code ?? ""}</span>
          </DialogTitle>
          <DialogDescription>
            {t ? `${t.tier_name ?? "Entrada"} · ${t.holder_name ?? t.holder_email ?? "sin titular"} · ${euros(t.amount_paid_cents, t.currency)}. ` : ""}
            Devolvemos el importe a la tarjeta con la que se pagó y el comprador recibe un email con este motivo. Se
            descuenta del neto del local en Liquidaciones.
          </DialogDescription>
        </DialogHeader>
        {previo && <p className="text-sm text-foreground">{previo}</p>}
        <div className="space-y-1.5">
          <Label htmlFor="admin-refund-nota" className="text-xs">
            Motivo para el comprador
          </Label>
          <Textarea
            id="admin-refund-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Por ejemplo: se te cobró dos veces la misma entrada."
            rows={3}
            maxLength={1000}
            disabled={trabajando}
            autoFocus
          />
          {!valida && nota.length > 0 && (
            <p className="text-xs text-muted-foreground">Escribe al menos {NOTA_MINIMA} caracteres.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={trabajando}>
            Volver
          </Button>
          <Button variant="destructive" disabled={!valida || trabajando} onClick={() => void confirmar()}>
            {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Reembolsar {t ? euros(t.amount_paid_cents, t.currency) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AdminOrders;
