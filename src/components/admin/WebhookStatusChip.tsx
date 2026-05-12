import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface WebhookStatusChipProps {
  onClick?: () => void;
}

/**
 * Compact webhook status indicator.
 * - green dot: all good in last 24h
 * - red dot + count: failed events present
 * - amber dot: events still in "received" (queue stuck)
 * Click → opens the full-screen logs (handled by parent).
 */
const WebhookStatusChip = ({ onClick }: WebhookStatusChipProps) => {
  const { data } = useQuery({
    queryKey: ["admin-stripe-webhooks-chip"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("stripe_webhook_events")
        .select("status")
        .gte("received_at", since);
      if (error) throw error;
      const failed = (data ?? []).filter((e) => e.status === "failed").length;
      const stuck = (data ?? []).filter((e) => e.status === "received").length;
      return { failed, stuck, total: (data ?? []).length };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const failed = data?.failed ?? 0;
  const stuck = data?.stuck ?? 0;

  const tone =
    failed > 0
      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
      : stuck > 0
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";

  const dotColor =
    failed > 0 ? "bg-red-500" : stuck > 0 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all hover:opacity-80 ${tone}`}
      aria-label="Webhook status"
    >
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${dotColor}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
      </span>
      <Activity className="h-3 w-3" />
      <span>
        {failed > 0
          ? `${failed} err`
          : stuck > 0
          ? `${stuck} hold`
          : "OK"}
      </span>
    </button>
  );
};

export default WebhookStatusChip;
