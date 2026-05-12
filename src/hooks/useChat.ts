import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAvatarUrl, preloadImages } from "@/lib/imageUtils";

const CHAT_CACHE_TIME = 5 * 60 * 1000; // 5 minuti
const CHAT_STALE_TIME = 30 * 1000; // 30 secondi

// Fetch all users for chat list
export const useChatUsers = (currentUserId: string, city?: string) => {
  return useQuery({
    // bump "v2" per invalidare cache client dopo aggiunta is_verified + last_active_at
    queryKey: ["chat-users", "v2", currentUserId, city],
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("id, first_name, last_name, business_name, business_city, profile_image_url, last_active_at, is_verified")
        .neq("id", currentUserId);

      // Filter by city (case-insensitive)
      if (city) {
        query = query.or(`business_city.ilike.${city},business_city.ilike.${city} ,business_city.is.null`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Preload avatar images in background
      if (data && data.length > 0) {
        const avatarUrls = data
          .slice(0, 20) // Preload first 20 avatars
          .map(u => u.profile_image_url)
          .filter(Boolean)
          .map(url => getAvatarUrl(url, 'medium'));
        preloadImages(avatarUrls).catch(() => {}); // Ignora errori
      }

      return data || [];
    },
    staleTime: CHAT_STALE_TIME,
    gcTime: CHAT_CACHE_TIME,
    enabled: !!currentUserId,
  });
};

// Fetch favorites
export const useFavorites = (currentUserId: string) => {
  return useQuery({
    queryKey: ["favorites", currentUserId],
    queryFn: async () => {
      const { data: favoritesData, error: favError } = await supabase
        .from("favorites")
        .select("id, favorite_user_id")
        .eq("user_id", currentUserId);

      if (favError) throw favError;
      if (!favoritesData || favoritesData.length === 0) return [];

      const favoriteUserIds = favoritesData.map(f => f.favorite_user_id);
      const { data: profilesData, error: profError } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, business_name, profile_image_url")
        .in("id", favoriteUserIds);

      if (profError) throw profError;

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      const result = favoritesData.map((fav: any) => {
        const profile = profilesMap.get(fav.favorite_user_id);
        return {
          id: fav.favorite_user_id,
          profile_image_url: profile?.profile_image_url,
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          business_name: profile?.business_name,
        };
      });

      // Preload favorite avatars
      const avatarUrls = result
        .map(f => f.profile_image_url)
        .filter(Boolean)
        .map(url => getAvatarUrl(url, 'medium'));
      preloadImages(avatarUrls).catch(() => {});

      return result;
    },
    staleTime: CHAT_STALE_TIME,
    gcTime: CHAT_CACHE_TIME,
    enabled: !!currentUserId,
  });
};

// Fetch conversations and last messages — with realtime invalidation
export const useConversations = (currentUserId: string) => {
  const queryClient = useQueryClient();

  // Realtime: qualsiasi INSERT/UPDATE su messages invalida la query così
  // la lista chat (ultimo messaggio + badge non letti) si aggiorna live.
  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase
      .channel(`chats-list-${currentUserId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        console.log("[ChatsList] realtime INSERT", payload.new);
        queryClient.invalidateQueries({ queryKey: ["conversations", currentUserId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        console.log("[ChatsList] realtime UPDATE", payload.new);
        queryClient.invalidateQueries({ queryKey: ["conversations", currentUserId] });
      })
      .subscribe((status, err) => {
        console.log("[ChatsList] realtime status:", status, err || "");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, queryClient]);

  return useQuery({
    queryKey: ["conversations", currentUserId],
    queryFn: async () => {
      const { data: conversationsData, error: convError } = await supabase
        .from("conversations")
        .select("*")
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`);

      if (convError) throw convError;
      if (!conversationsData || conversationsData.length === 0) {
        return { messages: [], unreadCounts: {} };
      }

      const conversationIds = conversationsData.map((c) => c.id);

      const { data: messagesData, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false });

      if (msgError) throw msgError;

      const lastMessages: any[] = [];
      const unreadCountsMap: Record<string, number> = {};

      conversationsData.forEach((conv) => {
        const convMessages = messagesData?.filter(
          (m) => m.conversation_id === conv.id
        );
        if (convMessages && convMessages.length > 0) {
          const lastMessage = convMessages[0];
          const otherUserId = conv.user1_id === currentUserId ? conv.user2_id : conv.user1_id;

          lastMessages.push({
            ...lastMessage,
            other_user_id: otherUserId,
          });

          const unreadCount = convMessages.filter(
            (m) => !m.is_read && m.sender_id !== currentUserId
          ).length;
          unreadCountsMap[otherUserId] = unreadCount;
        }
      });

      return { messages: lastMessages, unreadCounts: unreadCountsMap };
    },
    staleTime: CHAT_STALE_TIME,
    gcTime: CHAT_CACHE_TIME,
    enabled: !!currentUserId,
  });
};

// Hook to invalidate chat cache
export const useInvalidateChat = () => {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ predicate: (query) =>
        query.queryKey[0] === "chat-users" ||
        query.queryKey[0] === "favorites" ||
        query.queryKey[0] === "conversations"
      });
    },
    invalidateFavorites: (userId: string) =>
      queryClient.invalidateQueries({ queryKey: ["favorites", userId] }),
    invalidateConversations: (userId: string) =>
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] }),
  };
};
