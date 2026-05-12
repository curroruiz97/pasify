import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ascolta un unico canale broadcast globale `typing-global` e ritorna il Set
 * degli user_id che stanno scrivendo all'utente corrente. Usato da ChatsList
 * per mostrare "sta scrivendo..." anche fuori dalla singola conversazione.
 *
 * Ogni client che sta digitando deve chiamare `emitGlobalTyping(to_user_id)`.
 */
export const useGlobalTyping = (currentUserId: string | undefined) => {
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase.channel("typing-global", {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { from, to } = payload || {};
        if (!from || to !== currentUserId) return;
        setTypingUsers((prev) => {
          const next = new Set(prev);
          next.add(from);
          return next;
        });
        const existing = timeoutsRef.current.get(from);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.delete(from);
            return next;
          });
          timeoutsRef.current.delete(from);
        }, 3500);
        timeoutsRef.current.set(from, t);
      })
      .subscribe();

    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current.clear();
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return typingUsers;
};

let emitChannel: ReturnType<typeof supabase.channel> | null = null;
let lastEmit = 0;

/** Chiamata da chi sta digitando. Throttled 1.5s. */
export const emitGlobalTyping = async (fromUserId: string, toUserId: string) => {
  const now = Date.now();
  if (now - lastEmit < 1500) return;
  lastEmit = now;
  if (!emitChannel) {
    emitChannel = supabase.channel("typing-global", { config: { broadcast: { self: false } } });
    await new Promise<void>((resolve) => {
      emitChannel!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
  }
  emitChannel.send({
    type: "broadcast",
    event: "typing",
    payload: { from: fromUserId, to: toUserId, ts: now },
  });
};
