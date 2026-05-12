import { useCallback, useEffect, useState } from "react";

const KEY = "pasify.refunds.v1";

export type RefundStatus = "pending" | "approved" | "rejected";

export interface RefundRequest {
  id: string;
  ticketId: string;
  eventTitle: string;
  eventDate: string | null;
  partnerName: string | null;
  amount_cents: number;
  reason: string;
  status: RefundStatus;
  requestedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

const isValid = (x: unknown): x is RefundRequest =>
  !!x &&
  typeof x === "object" &&
  typeof (x as any).id === "string" &&
  typeof (x as any).ticketId === "string" &&
  typeof (x as any).status === "string";

const readStorage = (): RefundRequest[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
};

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

/**
 * Solicitudes de reembolso — modelo cliente y cola del admin.
 * Persiste en localStorage bajo `pasify.refunds.v1`. Cuando Supabase
 * esté conectado este hook puede ser swapped por una versión que
 * delegue a la tabla `refund_requests`.
 */
export const useRefundRequests = () => {
  const [requests, setRequests] = useState<RefundRequest[]>(readStorage);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(requests));
    } catch {
      /* storage piena / disabilitata */
    }
  }, [requests]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as unknown) : [];
        if (Array.isArray(next)) {
          setRequests(next.filter(isValid));
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const createRequest = useCallback(
    (data: Omit<RefundRequest, "id" | "status" | "requestedAt" | "decidedAt" | "decisionNote">) => {
      const req: RefundRequest = {
        ...data,
        id: newId(),
        status: "pending",
        requestedAt: new Date().toISOString(),
        decidedAt: null,
        decisionNote: null,
      };
      setRequests((prev) => [req, ...prev]);
      return req;
    },
    []
  );

  const setStatus = useCallback(
    (id: string, status: RefundStatus, note?: string) => {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status,
                decidedAt: new Date().toISOString(),
                decisionNote: note ?? null,
              }
            : r
        )
      );
    },
    []
  );

  const hasOpenForTicket = useCallback(
    (ticketId: string) => requests.some((r) => r.ticketId === ticketId && r.status === "pending"),
    [requests]
  );

  const statusForTicket = useCallback(
    (ticketId: string): RefundStatus | null => {
      const found = requests.find((r) => r.ticketId === ticketId);
      return found?.status ?? null;
    },
    [requests]
  );

  return {
    requests,
    createRequest,
    setStatus,
    hasOpenForTicket,
    statusForTicket,
    pendingCount: requests.filter((r) => r.status === "pending").length,
  };
};
