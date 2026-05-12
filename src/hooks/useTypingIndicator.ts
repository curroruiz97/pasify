import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Indicatore "sta scrivendo..." per una singola conversazione.
 *
 * - `isOtherTyping`: true se l'altro utente ha inviato un typing nei last 3s
 * - `emitTyping()`: chiamala quando il currentUser digita nell'input
 *
 * Usa Supabase Realtime broadcast sul canale `typing-{conversationId}`.
 */
export const useTypingIndicator = (
  conversationId: string | undefined,
  currentUserId: string | undefined,
  otherUserId: string | undefined,
) => {
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitRef = useRef<number>(0);

  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    const channel = supabase.channel(`typing-${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload?.user_id) return;
        if (otherUserId && payload.user_id !== otherUserId) return;
        if (payload.user_id === currentUserId) return;
        setIsOtherTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
      })
      .subscribe();

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, currentUserId, otherUserId]);

  const emitTyping = useCallback(() => {
    if (!channelRef.current || !currentUserId) return;
    // Throttle: max 1 emit ogni 1.5s per non saturare il canale
    const now = Date.now();
    if (now - lastEmitRef.current < 1500) return;
    lastEmitRef.current = now;
    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: currentUserId, ts: now },
    });
  }, [currentUserId]);

  return { isOtherTyping, emitTyping };
};
