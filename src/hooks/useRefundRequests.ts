import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

/**
 * useRefundRequests · backend-backed
 * Realtime sobre `refund_requests` · RPC para crear y decidir.
 *
 * Modos:
 *  - "mine"  → solo las del user (RLS filtra)
 *  - "org"   → todas las del org/partner (RLS por membership)
 *  - "admin" → todas (RLS admin)
 */
export const useRefundRequests = (_mode: "mine" | "org" | "admin" = "mine") => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("refund_requests")
        .select(
          "id, ticket_id, order_id, event_id, requester_user_id, amount_cents, currency, reason, reason_code, status, decided_at, decision_note, auto_approved, created_at, events(title, date_start, venue_name)"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRequests(((data ?? []) as unknown as DbRow[]).map(toRefund));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel("refund_requests_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "refund_requests" }, () => {
        fetchAll();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

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
    toast({ title: "Solicitud enviada", description: "Te avisamos cuando se decida." });
    await fetchAll();
    return data as string;
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
