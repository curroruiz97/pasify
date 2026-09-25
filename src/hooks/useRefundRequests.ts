import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { useRealtimeInvalidate } from "@/lib/cache/useRealtimeInvalidate";
import { getErrorMessage } from "@/lib/sentry";

export type RefundStatus = "pending" | "approved" | "rejected" | "processing" | "refunded" | "failed";

export interface RefundRequest {
  id: string;
  ticketId: string;
  orderId: string | null;
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  partnerName: string | null;
  amount_cents: number;
  currency: string;
  reason: string;
  reason_code: string | null;
  status: RefundStatus;
  requestedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  autoApproved: boolean;
}

interface DbRow {
  id: string;
  ticket_id: string;
  order_id: string | null;
  event_id: string;
  requester_user_id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  reason_code: string | null;
  status: RefundStatus;
  decided_at: string | null;
  decision_note: string | null;
  auto_approved: boolean;
  created_at: string;
  events?: { title: string; date_start: string; venue_name: string | null };
}

const toRefund = (r: DbRow): RefundRequest => ({
  id: r.id,
  ticketId: r.ticket_id,
  orderId: r.order_id,
  eventId: r.event_id,
  eventTitle: r.events?.title ?? "Evento",
  eventDate: r.events?.date_start ?? null,
  partnerName: r.events?.venue_name ?? null,
  amount_cents: r.amount_cents,
  currency: r.currency,
  reason: r.reason,
  reason_code: r.reason_code,
  status: r.status,
  requestedBy: r.requester_user_id,
  requestedAt: r.created_at,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  autoApproved: r.auto_approved,
});

const SIN_SOLICITUDES: RefundRequest[] = [];

/**
 * Textos de los errores de request_refund: los códigos de la política por
 * tipo de entrada (Ola 2) y los mensajes de las comprobaciones de siempre.
 * Se buscan en message, details y hint (el código puede ir en cualquiera).
 */
const ERRORES_SOLICITUD: ReadonlyArray<readonly [RegExp, string]> = [
  [/refund_not_allowed/i, "Esta entrada no admite devolución, salvo que se cancele el evento."],
  [/refund_window_closed/i, "Ya ha pasado el plazo para pedir la devolución de esta entrada."],
  [/refund_in_dispute/i, "El pago de esta entrada está en disputa con el banco."],
  [/ya existe solicitud/i, "Ya has pedido la devolución de esta entrada."],
  [/transferencia pendiente/i, "Tienes una transferencia pendiente de esta entrada: mientras no se acepte o caduque, no se puede pedir la devolución."],
  [/ya escaneado/i, "Esta entrada ya se ha usado en la puerta."],
  [/no tiene importe/i, "Esta entrada no tiene importe que devolver."],
  [/titular/i, "Esta entrada ya no está a tu nombre."],
];

/** Códigos con el texto para el comprador en DETAIL (RAISE … USING DETAIL). */
const CODIGO_CON_DETALLE = /^(refund_not_allowed|refund_window_closed|refund_in_dispute)$/;

/** Texto para el comprador de un error de request_refund. */
export function mensajeErrorSolicitud(error: { message?: string; details?: string | null; hint?: string | null }): string {
  const detalle = error.details?.trim();
  if (detalle && CODIGO_CON_DETALLE.test(error.message?.trim() ?? "")) return detalle;
  const texto = [error.message, error.details, error.hint].filter(Boolean).join(" · ");
  return (
    ERRORES_SOLICITUD.find(([patron]) => patron.test(texto))?.[1] ??
    "No hemos podido enviar la solicitud. Vuelve a intentarlo en unos minutos."
  );
}

/** `requesterId`: solo las que ha pedido ese usuario; null = todas las que deje ver RLS. */
async function leerSolicitudes(requesterId: string | null): Promise<RefundRequest[]> {
  let consulta = supabase
    .from("refund_requests")
    .select(
      "id, ticket_id, order_id, event_id, requester_user_id, amount_cents, currency, reason, reason_code, status, decided_at, decision_note, auto_approved, created_at, events(title, date_start, venue_name)"
    );
  if (requesterId) consulta = consulta.eq("requester_user_id", requesterId);
  const { data, error } = await consulta.order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as DbRow[]).map(toRefund);
}

/**
 * useRefundRequests · backend-backed
 * Realtime sobre `refund_requests` · RPC para crear y decidir.
 *
 * Modos:
 *  - "mine"  → solo las que ha pedido el usuario. Se filtra en la consulta:
 *              RLS no basta, al super-admin (o a un owner/manager que entra
 *              como cliente) le deja ver las de toda la plataforma o del local.
 *  - "org"   → todas las del org/partner (RLS por membership)
 *  - "admin" → todas (RLS admin)
 *
 * Caché: "mine" vive en qk.me.refunds (guardada en el dispositivo, son las
 * del propio usuario, motivo incluido). "org"/"admin" traen solicitudes de
 * otras personas: solo en memoria. Un cambio en tiempo real refresca la lista
 * sin vaciarla (antes cada cambio volvía a poner `loading` y parpadeaba el
 * wallet).
 *
 * En "mine", cada vez que cambian las solicitudes (una nueva, una decisión, el
 * reembolso hecho en Stripe, la cancelación del evento) se vuelven a pedir
 * también las entradas (qk.me.tickets): antes la entrada seguía "Válida" y con
 * su QR hasta refrescar a mano, o 30 días sin conexión.
 */
export const useRefundRequests = (mode: "mine" | "org" | "admin" = "mine") => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uid = useCurrentUserId();
  const queryKey = useMemo<QueryKey>(
    () => (mode === "mine" ? qk.me.refunds(uid ?? "") : ["admin", uid ?? "", "refunds", mode]),
    [mode, uid],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => leerSolicitudes(mode === "mine" ? uid : null),
    enabled: !!uid,
  });
  const requests = query.data ?? SIN_SOLICITUDES;
  const loading = !!uid && query.isPending && !query.isError;
  const error = query.error ? getErrorMessage(query.error) : null;

  useRealtimeInvalidate({
    canal: uid ? "refund_requests_changes" : null,
    tabla: "refund_requests",
    eventos: ["*"],
    queryKey: uid ? queryKey : null,
  });

  // Las entradas dependen de las solicitudes: si la lista cambia de verdad
  // (React Query conserva la misma referencia cuando llega lo mismo), la
  // cartera se vuelve a pedir. La primera carga no cuenta.
  const solicitudesPrevias = useRef<RefundRequest[] | undefined>(undefined);
  useEffect(() => {
    const previas = solicitudesPrevias.current;
    solicitudesPrevias.current = query.data;
    if (mode !== "mine" || !uid || !previas || !query.data || previas === query.data) return;
    void queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) });
  }, [mode, uid, query.data, queryClient]);

  const fetchAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      mode === "mine" && uid ? queryClient.invalidateQueries({ queryKey: qk.me.tickets(uid) }) : undefined,
    ]);
  }, [queryClient, queryKey, mode, uid]);

  /**
   * Pide la devolución (RPC request_refund). Desde la Ola 2 la política es
   * del tipo de entrada (D-3): sin plazo → `refund_not_allowed`; fuera de
   * plazo → `refund_window_closed`; dentro, una solicitud 'pending' que
   * decide el local. La tarjeta pasa al momento a «Pendiente de que el local
   * lo revise» (se añade a la lista antes del refresco).
   */
  const requestRefund = useCallback(async (ticketId: string, reason: string, reasonCode?: string) => {
    const { data, error } = await supabase.rpc("request_refund", {
      _ticket_id: ticketId,
      _reason: reason,
      _reason_code: reasonCode ?? null,
    });
    if (error) {
      console.warn("[reembolsos] request_refund", error);
      toast({ title: "No se ha podido pedir la devolución", description: mensajeErrorSolicitud(error), variant: "destructive" });
      throw error;
    }
    const requestId = data as string;
    if (mode === "mine" && uid) {
      queryClient.setQueryData<RefundRequest[]>(qk.me.refunds(uid), (prev) => {
        const lista = prev ?? [];
        // Una rechazada o fallida se reabre con el mismo id (ticket_id es UNIQUE).
        const previa = lista.find((r) => r.id === requestId || r.ticketId === ticketId);
        const pendiente: RefundRequest = {
          orderId: null,
          eventId: "",
          eventTitle: "Evento",
          eventDate: null,
          partnerName: null,
          amount_cents: 0,
          currency: "EUR",
          ...previa,
          id: requestId,
          ticketId,
          reason,
          reason_code: reasonCode ?? null,
          status: "pending",
          requestedBy: uid,
          requestedAt: new Date().toISOString(),
          decidedAt: null,
          decisionNote: null,
          autoApproved: false,
        };
        return [pendiente, ...lista.filter((r) => r !== previa)];
      });
    }
    // Servidor anterior a la Ola 2: dentro del plazo la solicitud nacía
    // aprobada y el reembolso en Stripe lo lanzaba el propio comprador
    // (process-refund solo lo permite en las aprobadas automáticamente).
    const { data: created } = await supabase
      .from("refund_requests")
      .select("status, auto_approved")
      .eq("id", requestId)
      .maybeSingle();
    if (created?.status === "approved" && created.auto_approved) {
      const { error: procErr } = await supabase.functions.invoke("process-refund", { body: { request_id: requestId } });
      toast(
        procErr
          ? {
              title: "Reembolso aprobado",
              description: "Lo estamos tramitando; si no lo ves en unos días, escríbenos desde Soporte.",
            }
          : {
              title: "Reembolso aprobado",
              description: "Verás el dinero en tu método de pago en 5-10 días laborables.",
            },
      );
    } else {
      toast({ title: "Solicitud enviada", description: "Pendiente de que el local lo revise. Te avisaremos cuando decida." });
    }
    await fetchAll();
    return requestId;
  }, [fetchAll, toast, mode, uid, queryClient]);

  const decideRefund = useCallback(async (requestId: string, decision: "approve" | "reject", note?: string) => {
    const { error } = await supabase.rpc("decide_refund", {
      _request_id: requestId,
      _decision: decision,
      _note: note ?? null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      throw error;
    }
    if (decision === "approve") {
      const { error: procErr } = await supabase.functions.invoke("process-refund", { body: { request_id: requestId } });
      if (procErr) {
        toast({
          title: "Aviso",
          description: "Aprobado pero el proceso Stripe ha fallado. Revisa logs.",
          variant: "destructive",
        });
      }
    }
    toast({ title: decision === "approve" ? "Reembolso aprobado" : "Reembolso rechazado" });
    await fetchAll();
  }, [fetchAll, toast]);

  // Devuelve el RefundRequest activo para un ticket (si existe), null si no hay
  const statusForTicket = useCallback(
    (ticketId: string): RefundRequest | null => {
      return requests.find((r) => r.ticketId === ticketId) ?? null;
    },
    [requests]
  );

  return {
    requests,
    loading,
    error,
    refetch: fetchAll,
    requestRefund,
    decideRefund,
    statusForTicket,
    // Alias legacy (ClientDashboard usa `createRequest`)
    createRequest: requestRefund,
    pending: requests.filter((r) => r.status === "pending"),
    approved: requests.filter((r) => r.status === "approved" || r.status === "processing"),
    refunded: requests.filter((r) => r.status === "refunded"),
    rejected: requests.filter((r) => r.status === "rejected"),
  };
};
