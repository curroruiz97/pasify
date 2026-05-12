import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Contatore notifiche non lette (likes + comments + QR codes) per l'utente.
 *
 * Il concetto "non letta" è basato su un timestamp salvato in localStorage:
 *   `notifications_last_seen_{userId}` = ISO string dell'ultima volta che
 *   l'utente ha aperto il pannello notifiche.
 *
 * Chi apre il pannello deve chiamare `markAllAsRead()` per azzerare il badge.
 */
export const useUnreadNotifications = (userId: string | undefined) => {
  const [unreadCount, setUnreadCount] = useState(0);

  const getLastSeen = useCallback((): string => {
    if (!userId) return new Date(Date.now() - 86400000).toISOString();
    const saved = localStorage.getItem(`notifications_last_seen_${userId}`);
    if (saved) return saved;
    // Fallback: ultimo giorno
    return new Date(Date.now() - 86400000).toISOString();
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }
    try {
      const threshold = getLastSeen();

      const { data: userPosts } = await supabase
        .from("posts")
        .select("id")
        .eq("user_id", userId);
      const postIds = userPosts?.map((p) => p.id) || [];

      let likesCount = 0;
      if (postIds.length > 0) {
        const { count } = await supabase
          .from("likes")
          .select("id", { count: "exact", head: true })
          .in("post_id", postIds)
          .neq("user_id", userId)
          .gt("created_at", threshold);
        likesCount = count || 0;
      }

      let commentsCount = 0;
      if (postIds.length > 0) {
        const { count } = await supabase
          .from("comments")
          .select("id", { count: "exact", head: true })
          .in("post_id", postIds)
          .neq("user_id", userId)
          .gt("created_at", threshold);
        commentsCount = count || 0;
      }

      // QR codes only for partners
      const { data: userRole } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      let qrCodesCount = 0;
      if (userRole?.role === "partner") {
        const { data: partnerEvents } = await supabase
          .from("events")
          .select("id")
          .eq("partner_id", userId)
          .eq("type", "event");
        const eventIds = partnerEvents?.map((e) => e.id) || [];
        if (eventIds.length > 0) {
          const { count } = await supabase
            .from("qr_codes")
            .select("id", { count: "exact", head: true })
            .in("event_id", eventIds)
            .gt("created_at", threshold);
          qrCodesCount += count || 0;
        }

        const { data: partnerDiscounts } = await supabase
          .from("discounts")
          .select("id")
          .eq("partner_id", userId);
        const discountIds = partnerDiscounts?.map((d) => d.id) || [];
        if (discountIds.length > 0) {
          const { count } = await supabase
            .from("qr_codes")
            .select("id", { count: "exact", head: true })
            .in("discount_id", discountIds)
            .gt("created_at", threshold);
          qrCodesCount += count || 0;
        }
      }

      setUnreadCount(likesCount + commentsCount + qrCodesCount);
    } catch (error) {
      console.error("Error loading unread notifications:", error);
      setUnreadCount(0);
    }
  }, [userId, getLastSeen]);

  useEffect(() => {
    if (!userId) return;
    load();

    const channel = supabase
      .channel("all-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "likes" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "qr_codes" }, load)
      .subscribe();

    const onMarkRead = () => load();
    window.addEventListener("notifications-seen", onMarkRead);
    window.addEventListener("focus", onMarkRead);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("notifications-seen", onMarkRead);
      window.removeEventListener("focus", onMarkRead);
    };
  }, [userId, load]);

  return unreadCount;
};

/**
 * Chiamata quando l'utente apre il pannello notifiche.
 * Salva il timestamp e notifica il hook di riaggiornare il count.
 */
export const markNotificationsAsSeen = (userId: string | undefined) => {
  if (!userId) return;
  localStorage.setItem(`notifications_last_seen_${userId}`, new Date().toISOString());
  window.dispatchEvent(new CustomEvent("notifications-seen"));
};
