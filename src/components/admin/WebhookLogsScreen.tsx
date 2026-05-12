import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface WebhookLog {
  id: string;
  event_id: string;
  event_type: string;
  status: "received" | "succeeded" | "failed";
  livemode: boolean;
  error_message: string | null;
  attempt_count: number;
  received_at: string;
}

type StatusFilter = "all" | "succeeded" | "failed" | "received";

interface WebhookLogsScreenProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_META: Record<
  WebhookLog["status"],
  { icon: typeof CheckCircle2; cls: string; label: string }
> = {
  succeeded: { icon: CheckCircle2, cls: "text-emerald-600", label: "Succeeded" },
  failed: { icon: AlertTriangle, cls: "text-red-600", label: "Failed" },
  received: { icon: Clock, cls: "text-amber-600", label: "Received" },
};

const WebhookLogsScreen = ({ open, onClose }: WebhookLogsScreenProps) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [livemodeFilter, setLivemodeFilter] = useState<"all" | "live" | "test">("all");

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // iOS-like edge-swipe-to-back: if a touch starts within 24px of the left
  // edge and is dragged > 80px to the right (or flicks fast enough), close.
  // We translate the panel during the gesture so the user sees feedback.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const swipeStateRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const EDGE = 24; // px from left to consider an edge swipe
    const THRESHOLD_PX = 80;
    const THRESHOLD_VELOCITY = 0.5; // px/ms
    const node = panelRef.current;
    if (!node) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX > EDGE) return;
      swipeStateRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
      };
      setDragging(true);
    };
    const onTouchMove = (e: TouchEvent) => {
      const s = swipeStateRef.current;
      if (!s) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.startX;
      const dy = Math.abs(t.clientY - s.startY);
      // If the gesture is mostly vertical, abandon (let scroll happen).
      if (dy > Math.abs(dx) + 8 && dx < 24) {
        swipeStateRef.current = null;
        setDragX(0);
        setDragging(false);
        return;
      }
      setDragX(Math.max(0, dx));
    };
    const onTouchEnd = () => {
      const s = swipeStateRef.current;
      if (!s) {
        setDragX(0);
        setDragging(false);
        return;
      }
      const dx = dragX;
      const elapsed = Date.now() - s.startTime;
      const velocity = elapsed > 0 ? dx / elapsed : 0;
      swipeStateRef.current = null;
      if (dx > THRESHOLD_PX || velocity > THRESHOLD_VELOCITY) {
        // Slide off then dismiss.
        setDragX(window.innerWidth);
        setTimeout(() => {
          setDragX(0);
          setDragging(false);
          onClose();
        }, 180);
      } else {
        setDragX(0);
        setDragging(false);
      }
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: true });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [open, onClose, dragX]);

  const { data: logs, isFetching, refetch } = useQuery({
    queryKey: ["admin-stripe-webhooks-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stripe_webhook_events")
        .select(
          "id, event_id, event_type, status, livemode, error_message, attempt_count, received_at"
        )
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as WebhookLog[];
    },
    refetchInterval: open ? 30_000 : false,
    enabled: open,
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    if (!logs) return [];
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (livemodeFilter === "live" && !l.livemode) return false;
      if (livemodeFilter === "test" && l.livemode) return false;
      if (q) {
        const hay = `${l.event_type} ${l.event_id} ${l.error_message ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, statusFilter, livemodeFilter, search]);

  if (!open) return null;

  const counts = {
    succeeded: (logs ?? []).filter((l) => l.status === "succeeded").length,
    failed: (logs ?? []).filter((l) => l.status === "failed").length,
    received: (logs ?? []).filter((l) => l.status === "received").length,
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 z-[100] flex flex-col bg-background animate-in fade-in slide-in-from-bottom-4 duration-200"
      style={{
        height: "100dvh",
        width: "100vw",
        transform: dragX > 0 ? `translateX(${dragX}px)` : undefined,
        transition: dragging ? "none" : "transform 180ms cubic-bezier(0.25,0.46,0.45,0.94)",
        boxShadow:
          dragX > 0
            ? "-8px 0 24px -8px rgba(0,0,0,0.25)"
            : undefined,
        touchAction: "pan-y",
      }}
    >
      {/* Header — sticky, layered: title bar / chips / search.
         Chips stay visually separate from the title bar with a generous gap
         so the appbar can never overlap the touch targets. */}
      <div
        className="flex-shrink-0 border-b border-border/40 bg-background/85 backdrop-blur-xl"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0.5rem))" }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={onClose}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <Activity className="h-4 w-4 text-primary flex-shrink-0" />
            <h1 className="truncate text-base font-bold tracking-tight">
              Webhook logs
            </h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Status segmented control — modern pill row, full width.
           Pushed down with mt-1 + extra py so it never touches the appbar. */}
        <div className="px-3 pt-2">
          <div className="flex gap-1 overflow-x-auto rounded-full border border-border/50 bg-muted/40 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(
              [
                { key: "all", label: "Todos", count: logs?.length ?? 0, dot: "bg-foreground/60" },
                { key: "succeeded", label: "OK", count: counts.succeeded, dot: "bg-emerald-500" },
                { key: "failed", label: "Errores", count: counts.failed, dot: "bg-red-500" },
                { key: "received", label: "En curso", count: counts.received, dot: "bg-amber-500" },
              ] as { key: StatusFilter; label: string; count: number; dot: string }[]
            ).map((c) => {
              const active = statusFilter === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setStatusFilter(c.key)}
                  className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                  <span>{c.label}</span>
                  <span
                    className={`tabular-nums ${
                      active ? "text-foreground/70" : "text-muted-foreground/70"
                    }`}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live/Test toggle */}
        <div className="px-3 pt-2">
          <div className="inline-flex gap-0 rounded-full border border-border/50 bg-muted/40 p-0.5">
            {(["all", "live", "test"] as const).map((mode) => {
              const active = livemodeFilter === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setLivemodeFilter(mode)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-all ${
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="relative px-3 pb-3 pt-2">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="event type, event id, error..."
            className="pl-9"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Activity className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Sin logs que coincidan</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Prueba a cambiar filtros o búsqueda.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((log) => {
              const meta = STATUS_META[log.status];
              const Icon = meta.icon;
              const isOpen = expanded === log.id;
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : log.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${meta.cls}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-semibold">
                          {log.event_type}
                        </span>
                        {!log.livemode && (
                          <Badge
                            variant="outline"
                            className="h-4 flex-shrink-0 px-1 text-[9px]"
                          >
                            test
                          </Badge>
                        )}
                        {log.attempt_count > 1 && (
                          <Badge
                            variant="outline"
                            className="h-4 flex-shrink-0 px-1 text-[9px]"
                          >
                            ×{log.attempt_count}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                        {log.event_id}
                      </p>
                      {log.error_message && !isOpen && (
                        <p className="mt-1 line-clamp-1 text-xs text-red-600 dark:text-red-400">
                          {log.error_message}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {format(new Date(log.received_at), "d MMM HH:mm:ss", { locale: es })}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t bg-muted/30 px-4 py-3 text-xs">
                      <Row label="Status" value={<span className={meta.cls}>{meta.label}</span>} />
                      <Row label="Event ID" value={<code className="font-mono text-[11px]">{log.event_id}</code>} />
                      <Row label="Type" value={<code className="font-mono text-[11px]">{log.event_type}</code>} />
                      <Row label="Recibido" value={format(new Date(log.received_at), "d MMM yyyy HH:mm:ss", { locale: es })} />
                      <Row label="Reintentos" value={log.attempt_count} />
                      <Row label="Live" value={log.livemode ? "sí" : "no"} />
                      {log.error_message && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                            Error
                          </p>
                          <p className="break-words">{log.error_message}</p>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full gap-1.5"
                        onClick={() =>
                          window.open(
                            `https://dashboard.stripe.com/${log.livemode ? "" : "test/"}events/${log.event_id}`,
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir en Stripe Dashboard
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
};

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <span className="break-all text-right">{value}</span>
  </div>
);

export default WebhookLogsScreen;
