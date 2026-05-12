import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Activity, Clock, FileText } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WebhookLogsScreen from "./WebhookLogsScreen";

/**
 * Pannello admin: monitor degli eventi Stripe webhook.
 * Mostra:
 *   - Conteggio totali / succeeded / failed (24h)
 *   - Lista failed degli ultimi 7 giorni con error_message
 * Invalidare React Query non serve: realtime non c'è ma il pannello
 * fa refetch ogni 30s.
 */

interface WebhookEvent {
  id: string;
  event_id: string;
  event_type: string;
  status: "received" | "succeeded" | "failed";
  livemode: boolean;
  error_message: string | null;
  attempt_count: number;
  received_at: string;
}

export const StripeWebhookMonitor = () => {
  const [logsOpen, setLogsOpen] = useState(false);
  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-stripe-webhooks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stripe_webhook_events")
        .select("id, event_id, event_type, status, livemode, error_message, attempt_count, received_at")
        .gte("received_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("received_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as WebhookEvent[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const last24h = (events || []).filter(
    (e) => new Date(e.received_at).getTime() > Date.now() - 24 * 60 * 60 * 1000,
  );
  const succeeded = last24h.filter((e) => e.status === "succeeded").length;
  const failed = last24h.filter((e) => e.status === "failed").length;
  const received = last24h.filter((e) => e.status === "received").length;

  const recentFailures = (events || []).filter((e) => e.status === "failed").slice(0, 10);

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold">Stripe Webhook Monitor</h3>
        </div>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          ultime 24h
        </Badge>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-emerald-50 p-3 dark:bg-emerald-950/30">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-wide">Succeeded</span>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {succeeded}
          </p>
        </div>
        <div className={`rounded-xl border p-3 ${failed > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-muted/30"}`}>
          <div className={`flex items-center gap-1.5 ${failed > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
            <AlertTriangle className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-wide">Failed</span>
          </div>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${failed > 0 ? "text-red-700 dark:text-red-400" : ""}`}>
            {failed}
          </p>
        </div>
        <div className="rounded-xl border bg-amber-50 p-3 dark:bg-amber-950/30">
          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4" />
            <span className="text-[11px] font-medium uppercase tracking-wide">In corso</span>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
            {received}
          </p>
        </div>
      </div>

      {/* Recent failures */}
      {recentFailures.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Errori recenti (ultimi 7 giorni)
          </h4>
          <ul className="space-y-2">
            {recentFailures.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-red-200 bg-red-50/40 p-3 text-sm dark:border-red-900/40 dark:bg-red-950/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-red-700 dark:text-red-400">
                    {e.event_type}
                  </span>
                  <div className="flex items-center gap-2">
                    {!e.livemode && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">test</Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(e.received_at), "d MMM HH:mm", { locale: es })}
                    </span>
                  </div>
                </div>
                {e.error_message && (
                  <p className="mt-1.5 break-words text-xs text-muted-foreground">
                    {e.error_message}
                  </p>
                )}
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                  {e.event_id}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentFailures.length === 0 && (
        <div className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-emerald-500" />
          Nessun errore negli ultimi 7 giorni
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={() => setLogsOpen(true)}
        >
          <FileText className="h-4 w-4" />
          Ver logs
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() =>
            window.open("https://dashboard.stripe.com/webhooks", "_blank", "noopener,noreferrer")
          }
        >
          Stripe Dashboard
        </Button>
      </div>

      <WebhookLogsScreen open={logsOpen} onClose={() => setLogsOpen(false)} />
    </div>
  );
};
