import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Conta i messaggi non letti totali per l'utente.
 * Si auto-aggiorna via:
 *   - Realtime INSERT/UPDATE su messages
 *   - Window focus (in caso realtime abbia perso eventi)
 *   - Evento custom 'messages-read' (triggerato da ChatConversation dopo mark-as-read)
 */
export const useUnreadMessages = (userId: string | undefined) => {
  const [totalUnread, setTotalUnread] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    if (!userId) {
      setTotalUnread(0);
      return;
    }
    const { data: convData } = await supabase
      .from("conversations")
      .select("id")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (!convData || convData.length === 0) {
      setTotalUnread(0);
      return;
    }

    const convIds = convData.map((c) => c.id);
    const { count } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .eq("is_read", false)
      .neq("sender_id", userId);

    setTotalUnread(count || 0);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadUnreadCount();

    const channel = supabase
      .channel(`unread-messages-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const newMessage = payload.new as { sender_id?: string };
        if (newMessage.sender_id !== userId) loadUnreadCount();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, () => {
        loadUnreadCount();
      })
      .subscribe();

    // Trigger manuale da ChatConversation dopo mark-as-read (evita dipendenza
    // da realtime UPDATE che a volte è in ritardo / perso).
    const onMessagesRead = () => loadUnreadCount();
    window.addEventListener("messages-read", onMessagesRead);

    // Re-fetch quando la finestra torna in focus (utente cambia tab)
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onMessagesRead);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("messages-read", onMessagesRead);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onMessagesRead);
    };
  }, [userId, loadUnreadCount]);

  return totalUnread;
};
