import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import FavoritesCarousel from "./FavoritesCarousel";
import UserListItem from "./UserListItem";
import { useChatUsers, useFavorites, useConversations, useInvalidateChat } from "@/hooks/useChat";
import { useOnlinePresence } from "@/hooks/useOnlinePresence";
import { useGlobalTyping } from "@/hooks/useGlobalTyping";

interface ChatsListProps {
  currentUserId: string;
  city?: string;
}

const ChatsList = ({ currentUserId, city }: ChatsListProps) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  // Use cached hooks
  const { data: allUsers = [], isLoading: loadingUsers } = useChatUsers(currentUserId, city);
  const { data: favorites = [], isLoading: loadingFavorites } = useFavorites(currentUserId);
  const { data: conversationData, isLoading: loadingConversations } = useConversations(currentUserId);
  const { invalidateFavorites } = useInvalidateChat();
  const onlineUsers = useOnlinePresence(currentUserId);
  const typingUsers = useGlobalTyping(currentUserId);

  const messages = conversationData?.messages || [];
  const unreadCounts = conversationData?.unreadCounts || {};

  const loading = loadingUsers || loadingFavorites || loadingConversations;

  const handleUserClick = async (otherUserId: string) => {
    const { data: existingConversation } = await supabase
      .from("conversations")
      .select("id")
      .or(
        `and(user1_id.eq.${currentUserId},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${currentUserId})`
      )
      .maybeSingle();

    if (existingConversation) {
      navigate(`/chat/${existingConversation.id}`);
    } else {
      const { data: newConversation } = await supabase
        .from("conversations")
        .insert({
          user1_id: currentUserId,
          user2_id: otherUserId,
        })
        .select()
        .single();

      if (newConversation) {
        navigate(`/chat/${newConversation.id}`);
      }
    }
  };

  const handleToggleFavorite = async (userId: string) => {
    const isFavorite = favorites.some((fav) => fav.id === userId);

    if (isFavorite) {
      await supabase
        .from("favorites")
        .delete()
        .eq("user_id", currentUserId)
        .eq("favorite_user_id", userId);
    } else {
      await supabase
        .from("favorites")
        .insert({ user_id: currentUserId, favorite_user_id: userId });
    }

    invalidateFavorites(currentUserId);
  };

  const filteredUsers = allUsers.filter((u) => {
    const displayName =
      u.first_name || u.business_name
        ? `${u.first_name || ""} ${u.last_name || ""} ${u.business_name || ""}`.toLowerCase()
        : "";
    return displayName.includes(searchQuery.toLowerCase());
  });

  const sortedUsers = filteredUsers.sort((a, b) => {
    const unreadA = unreadCounts[a.id] || 0;
    const unreadB = unreadCounts[b.id] || 0;

    if (unreadA > 0 && unreadB === 0) return -1;
    if (unreadA === 0 && unreadB > 0) return 1;

    const msgA = messages.find((m) => m.other_user_id === a.id);
    const msgB = messages.find((m) => m.other_user_id === b.id);

    if (msgA && !msgB) return -1;
    if (!msgA && msgB) return 1;
    if (msgA && msgB) {
      return new Date(msgB.created_at).getTime() - new Date(msgA.created_at).getTime();
    }

    return 0;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="px-4">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400 z-10" />
          <Input
            type="text"
            placeholder="Cerca utenti..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 rounded-full border-none bg-blue-50 text-blue-800 placeholder:text-blue-400 focus-visible:ring-0 text-base font-medium transition-all duration-200"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 hover:bg-blue-100 rounded-full p-1 transition-colors"
            >
              <X className="w-4 h-4 text-blue-600" />
            </button>
          )}
        </div>
      </div>

      {/* Favorites */}
      {favorites.length > 0 && (
        <FavoritesCarousel
          favorites={favorites}
          onFavoriteClick={handleUserClick}
          onRemoveFavorite={(id) => handleToggleFavorite(id)}
        />
      )}

      {/* Users List */}
      <div className="px-4">
        {sortedUsers.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
            <p className="text-gray-600">Nessun utente trovato</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedUsers.map((user) => {
              const lastMsg = messages.find((m) => m.other_user_id === user.id);
              return (
                <UserListItem
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  unreadCount={unreadCounts[user.id] || 0}
                  lastMessage={lastMsg}
                  isFavorite={favorites.some((fav) => fav.id === user.id)}
                  isOnline={onlineUsers.has(user.id)}
                  isTyping={typingUsers.has(user.id)}
                  onUserClick={() => handleUserClick(user.id)}
                  onToggleFavorite={() => handleToggleFavorite(user.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatsList;
