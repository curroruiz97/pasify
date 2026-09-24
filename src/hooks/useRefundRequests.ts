import { useCallback, useMemo } from "react";
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

async function leerSolicitudes(): Promise<RefundRequest[]> {
  const { data, error } = await supabase
    .from("refund_requests")
    .select(
      "id, ticket_id, order_id, event_id, requester_user_id, amount_cents, currency, reason, reason_code, status, decided_at, decision_note, auto_approved, created_at, events(title, date_start, venue_name)"
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as DbRow[]).map(toRefund);
}

/**
 * useRefundRequests · backend-backed
 * Realtime sobre `refund_requests` · RPC para crear y decidir.
 *
 * Modos:
 *  - "mine"  → solo las del user (RLS filtra)
 *  - "org"   → todas las del org/partner (RLS por membership)
 *  - "admin" → todas (RLS admin)
 *
 * Caché: "mine" vive en qk.me.refunds (guardada en el dispositivo, son las
 * del propio usuario). "org"/"admin" traen solicitudes de otras personas:
 * solo en memoria. Un cambio en tiempo real refresca la lista sin vaciarla
 * (antes cada cambio volvía a poner `loading` y parpadeaba el wallet).
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
    queryFn: leerSolicitudes,
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

  const fetchAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const requestRefund = useCallback(async (ticketId: string, reason: string, reasonCode?: string) => {
    const { data, error } = await supabase.rpc("request_refund", {
      _ticket_id: ticketId,
      _reason: reason,
      _reason_code: reasonCode ?? null,
    });
    if (error) {
      toast({ title: "No se pudo crear la solicitud", description: error.message, variant: "destructive" });
      throw error;
    }
    const requestId = data as string;
    // Dentro del plazo del tipo de entrada la solicitud nace aprobada: el
    // reembolso en Stripe lo lanza el propio comprador (process-refund lo
    // permite solo para las aprobadas automáticamente).
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
      toast({ title: "Solicitud enviada", description: "Te avisamos cuando se decida." });
    }
    await fetchAll();
    return requestId;
  }, [fetchAll, toast]);

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
