import { useState, useEffect, useRef } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Send, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";

interface SharePostSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: string;
  currentUserId: string;
  onShareComplete?: () => void;
}

interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  profile_image_url?: string;
  isFavorite?: boolean;
}

const SharePostSheet = ({ open, onOpenChange, postId, currentUserId, onShareComplete }: SharePostSheetProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      loadFavorites();
      loadAllUsers();
      setSelectedUsers([]);
      setSearchQuery("");
      setSearchResults([]);
      setKeyboardOpen(false);
    }
  }, [open, currentUserId]);

  useEffect(() => {
    if (searchQuery.trim()) {
      searchUsers(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  // Detect keyboard open/close via visual viewport
  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        // If viewport is significantly smaller, keyboard is likely open
        setKeyboardOpen(windowHeight - viewportHeight > 150);
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
      return () => window.visualViewport?.removeEventListener('resize', handleResize);
    }
  }, []);

  const loadFavorites = async () => {
    const { data } = await supabase
      .from("favorites")
      .select(`
        favorite_user_id,
        profiles:favorite_user_id (
          id, first_name, last_name, business_name, profile_image_url
        )
      `)
      .eq("user_id", currentUserId);

    if (data) {
      const favUsers = data
        .map((f: any) => ({ ...f.profiles, isFavorite: true }))
        .filter((u: any) => u.id);
      setFavorites(favUsers);
    }
  };

  const loadAllUsers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, business_name, profile_image_url")
      .neq("id", currentUserId)
      .limit(50);

    if (data) {
      setAllUsers(data);
    }
  };

  const searchUsers = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, business_name, profile_image_url")
      .neq("id", currentUserId)
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,business_name.ilike.%${query}%`)
      .limit(20);

    if (data) {
      setSearchResults(data);
    }
    setSearching(false);
  };

  const getDisplayName = (user: User) => {
    if (user.first_name) {
      return `${user.first_name} ${user.last_name || ""}`.trim();
    }
    return user.business_name || t('common.user');
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSend = async () => {
    if (selectedUsers.length === 0) return;
    
    setSending(true);
    try {
      for (const userId of selectedUsers) {
        // Find or create conversation
        let conversationId: string;
        
        const { data: existingConv } = await supabase
          .from("conversations")
          .select("id")
          .or(`and(user1_id.eq.${currentUserId},user2_id.eq.${userId}),and(user1_id.eq.${userId},user2_id.eq.${currentUserId})`)
          .maybeSingle();

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const { data: newConv, error: convError } = await supabase
            .from("conversations")
            .insert({ user1_id: currentUserId, user2_id: userId })
            .select("id")
            .single();
          
          if (convError) throw convError;
          conversationId = newConv.id;

          // Add participants
          await supabase.from("conversation_participants").insert([
            { conversation_id: conversationId, user_id: currentUserId },
            { conversation_id: conversationId, user_id: userId }
          ]);
        }

        // Send message with post reference (using special format)
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: `[shared_post:${postId}]`,
          status: 'approved'
        });

        // Record the share in post_shares table
        await supabase.from("post_shares").insert({
          post_id: postId,
          shared_by: currentUserId,
          shared_to: userId
        });

        // Update conversation timestamp
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      }

      toast({
        title: t('social.shared'),
        description: t('social.sharedSuccess'),
      });

      onShareComplete?.();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const filteredFavorites = favorites.filter(user => 
    !searchQuery || getDisplayName(user).toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Show search results when searching, otherwise show all users (excluding favorites)
  const usersToShow = searchQuery.trim() 
    ? searchResults.filter(user => !favorites.some(f => f.id === user.id))
    : allUsers.filter(user => !favorites.some(f => f.id === user.id));

  const UserItem = ({ user }: { user: User }) => {
    const isSelected = selectedUsers.includes(user.id);
    
    return (
      <div 
        className="flex items-center justify-between p-3 hover:bg-muted/50 rounded-xl cursor-pointer transition-colors"
        onClick={() => toggleUserSelection(user.id)}
      >
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={user.profile_image_url} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {getDisplayName(user)[0]}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">{getDisplayName(user)}</span>
        </div>
        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
          isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
        }`}>
          {isSelected && <Check className="w-4 h-4 text-primary-foreground" />}
        </div>
      </div>
    );
  };

  // Calculate dynamic height based on keyboard state
  const sheetHeight = keyboardOpen ? '50vh' : '85vh';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent 
        className="transition-all duration-200 z-[200]"
        style={{ height: sheetHeight }}
      >
        <DrawerHeader className="pb-4">
          <DrawerTitle className="text-center">{t('social.share')}</DrawerTitle>
        </DrawerHeader>

        {/* Search - not auto-focused */}
        <div className="relative mb-4 px-4">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder={t('chat.searchContacts')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 rounded-xl bg-muted/50 border-0"
            autoFocus={false}
            autoComplete="off"
          />
        </div>

        {/* Content */}
        <div 
          ref={contentRef}
          className="flex-1 overflow-y-auto px-4"
          style={{ maxHeight: keyboardOpen ? 'calc(50vh - 180px)' : 'calc(85vh - 200px)' }}
        >
          {/* Favorites */}
          {filteredFavorites.length > 0 && !keyboardOpen && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 px-1">
                {t('chat.favorites').toUpperCase()}
              </h3>
              <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-hide">
                {filteredFavorites.map(user => (
                  <div 
                    key={user.id} 
                    className="flex flex-col items-center gap-1 min-w-[70px] cursor-pointer"
                    onClick={() => toggleUserSelection(user.id)}
                  >
                    <div className="relative">
                      <Avatar className={`h-16 w-16 border-2 transition-colors ${
                        selectedUsers.includes(user.id) ? 'border-primary' : 'border-transparent'
                      }`}>
                        <AvatarImage src={user.profile_image_url} />
                        <AvatarFallback className="bg-primary/10 text-primary text-lg">
                          {getDisplayName(user)[0]}
                        </AvatarFallback>
                      </Avatar>
                      {selectedUsers.includes(user.id) && (
                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-center truncate w-full">
                      {getDisplayName(user).split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Users / Search Results */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 px-1">
              {searchQuery.trim() ? t('search.searching') : t('social.allUsers')}
            </h3>
            <div className="space-y-1">
              {searching ? (
                <p className="text-center text-muted-foreground py-4">{t('common.loading')}</p>
              ) : usersToShow.length > 0 ? (
                usersToShow.map(user => (
                  <UserItem key={user.id} user={user} />
                ))
              ) : searchQuery.trim() ? (
                <p className="text-center text-muted-foreground py-4">{t('search.noUsersFound')}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Send Button */}
        {selectedUsers.length > 0 && (
          <div 
            className="absolute bottom-0 left-0 right-0 p-4 bg-background border-t" 
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1rem)' }}
          >
            <Button 
              className="w-full rounded-xl h-12 gap-2"
              onClick={handleSend}
              disabled={sending}
            >
              <Send className="w-5 h-5" />
              {t('social.sendTo')} {selectedUsers.length} {selectedUsers.length === 1 ? t('common.person') : t('common.people')}
            </Button>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
};

export default SharePostSheet;
