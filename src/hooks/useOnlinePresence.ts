import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Traccia la presence online globale via Supabase Realtime Presence.
 *   - Chi ha l'app aperta e un userId si registra → è "online"
 *   - Hook ritorna un Set con tutti gli user_id online in questo momento
 *   - Inoltre aggiorna automaticamente profiles.last_active_at periodicamente
 */
export const useOnlinePresence = (userId: string | undefined) => {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel("online-users", {
      config: { presence: { key: userId } },
    });

    const syncOnline = () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id: string }>>;
      const ids = new Set<string>();
      Object.keys(state).forEach((k) => ids.add(k));
      setOnlineUsers(ids);
    };

    channel
      .on("presence", { event: "sync" }, syncOnline)
      .on("presence", { event: "join" }, syncOnline)
      .on("presence", { event: "leave" }, syncOnline)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId, online_at: new Date().toISOString() });
          // Heartbeat last_active_at ogni 60s
          const bump = async () => {
            await supabase
              .from("profiles")
              .update({ last_active_at: new Date().toISOString() })
              .eq("id", userId);
          };
          bump();
          heartbeatRef.current = setInterval(bump, 60_000);
        }
      });

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return onlineUsers;
};
