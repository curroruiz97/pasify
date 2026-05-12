import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import UserListItem from "@/components/chat/UserListItem";

const AdminChats = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userMessages, setUserMessages] = useState<Map<string, any>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [newMessageUserId, setNewMessageUserId] = useState<string | null>(null);
  const previousUnreadCountsRef = useRef<Map<string, number>>(new Map());
  const { playNotificationSound } = useNotificationSound();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Subscribe to new messages for realtime updates
    const messagesChannel = supabase
      .channel('admin-messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        async (payload) => {
          const newMsg = payload.new as any;
          
          // Only notify if message is not from current user
          if (newMsg.sender_id !== user.id) {
            // Find sender from conversation
            const { data: conv } = await supabase
              .from("conversations")
              .select("user1_id, user2_id")
              .eq("id", newMsg.conversation_id)
              .maybeSingle();
            
            if (conv) {
              const senderId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
              if (senderId) {
                // Play sound and trigger animation
                playNotificationSound();
                setNewMessageUserId(senderId);
                setTimeout(() => setNewMessageUserId(null), 2000);
              }
            }
          }
          
          // Reload messages data
          loadMessagesData(user.id);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
        },
        () => {
          loadMessagesData(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
    };
  }, [user, playNotificationSound]);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUser(user);
      await Promise.all([
        loadAllUsers(user.id),
        loadMessagesData(user.id)
      ]);
    } catch (error: any) {
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const loadAllUsers = async (currentUserId: string) => {
    setLoading(true);
    
    const { data: usersData } = await supabase
      .from("profiles")
      .select("*")
      .neq("id", currentUserId);

    setAllUsers(usersData || []);
    setLoading(false);
  };

  const loadMessagesData = async (userId: string) => {
    const { data: convData } = await supabase
      .from("conversations")
      .select("*")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);

    if (!convData || convData.length === 0) return;

    const messagesMap = new Map();
    const unreadMap = new Map();

    // Use Promise.all for parallel fetching
    await Promise.all(convData.map(async (conv) => {
      const otherUserId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;
      if (!otherUserId) return;

      // Fetch last message and unread count in parallel
      const [lastMsgResult, unreadResult] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .eq("is_read", false)
          .neq("sender_id", userId)
      ]);

      if (lastMsgResult.data) {
        messagesMap.set(otherUserId, lastMsgResult.data);
      }

      if (unreadResult.count && unreadResult.count > 0) {
        unreadMap.set(otherUserId, unreadResult.count);
      }
    }));

    setUserMessages(messagesMap);
    setUnreadCounts(unreadMap);
  };

  const handleUserClick = async (otherUserId: string) => {
    if (!user) return;

    try {
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("*")
        .or(`and(user1_id.eq.${user.id},user2_id.eq.${otherUserId}),and(user1_id.eq.${otherUserId},user2_id.eq.${user.id})`)
        .maybeSingle();

      if (existingConv) {
        navigate(`/chat/${existingConv.id}`);
        return;
      }

      const { data: newConv, error } = await supabase
        .from("conversations")
        .insert({
          user1_id: user.id,
          user2_id: otherUserId
        })
        .select()
        .single();

      if (error) throw error;

      navigate(`/chat/${newConv.id}`);
    } catch (error: any) {
      toast({ 
        title: "Errore", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  };

  const filteredUsers = allUsers.filter((u) => {
    const name = u.first_name || u.business_name || "";
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aUnread = unreadCounts.get(a.id) || 0;
    const bUnread = unreadCounts.get(b.id) || 0;
    
    if (aUnread !== bUnread) {
      return bUnread - aUnread;
    }

    const aMsg = userMessages.get(a.id);
    const bMsg = userMessages.get(b.id);
    
    if (!aMsg && !bMsg) return 0;
    if (!aMsg) return 1;
    if (!bMsg) return -1;
    
    return new Date(bMsg.created_at).getTime() - new Date(aMsg.created_at).getTime();
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="ios-card p-6 mb-6">
        <h2 className="text-2xl font-bold text-primary mb-4">Chat Amministratore</h2>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <Input
            placeholder="Cerca utenti..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 ios-input"
          />
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : sortedUsers.length === 0 ? (
          <div className="text-center py-12 ios-card">
            <p className="text-muted-foreground">Nessun utente trovato</p>
          </div>
        ) : (
          sortedUsers.map((userItem) => (
            <div
              key={userItem.id}
              className={`transition-all duration-300 ${
                newMessageUserId === userItem.id 
                  ? 'animate-pulse ring-2 ring-primary rounded-xl scale-[1.02]' 
                  : ''
              }`}
            >
              <UserListItem
                user={userItem}
                currentUserId={user?.id || ""}
                unreadCount={unreadCounts.get(userItem.id) || 0}
                lastMessage={userMessages.get(userItem.id)}
                isFavorite={false}
                onUserClick={handleUserClick}
                onToggleFavorite={() => {}}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminChats;
