import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AppNotification {
  id: string;
  user_id: string;
  category: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  icon: string | null;
  payload: Record<string, unknown>;
  priority: "low" | "normal" | "high" | "critical";
  read_at: string | null;
  created_at: string;
}

/**
 * useNotifications · realtime sobre `notifications.user_id=auth.uid()`.
 * Marca como leídas, lista paginada, contador unread.
 */
export const useNotifications = (limit = 50) => {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async (uid: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(limit);
    setItems((data ?? []) as AppNotification[]);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUserId(data.user.id);
        await fetchAll(data.user.id);
      } else setLoading(false);
    })();

    const channel = supabase
      .channel("notifications_user")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, (payload) => {
        // Solo refetch si me afecta
        if ((payload.new as any)?.user_id === userId || (payload.old as any)?.user_id === userId) {
          fetchAll(userId!);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll, userId]);

  const markRead = useCallback(async (id: string) => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (userId) await fetchAll(userId);
  }, [fetchAll, userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    await fetchAll(userId);
  }, [fetchAll, userId]);

  const unread = items.filter((n) => !n.read_at);

  return {
    items,
    unread,
    unreadCount: unread.length,
    loading,
    markRead,
    markAllRead,
    refetch: () => userId && fetchAll(userId),
  };
};
