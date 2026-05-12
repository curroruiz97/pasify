import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useWebNotifications } from "@/hooks/useWebNotifications";
import OptimizedAvatar from "@/components/shared/OptimizedAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Check, CheckCheck, Paperclip, MoreVertical, File, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import BlockUserButton from "@/components/moderation/BlockUserButton";
import ReportContentDialog from "@/components/moderation/ReportContentDialog";
import MediaUploadSheet from "@/components/chat/MediaUploadSheet";
import VoiceRecorderButton from "@/components/chat/VoiceRecorderButton";
import VoiceMessagePlayer from "@/components/chat/VoiceMessagePlayer";
import ImageViewer from "@/components/social/ImageViewer";
import SharedPostPreview from "@/components/chat/SharedPostPreview";
import SwipeBackWrapper from "@/components/shared/SwipeBackWrapper";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { useOnlinePresence } from "@/hooks/useOnlinePresence";
import { useInvalidateChat } from "@/hooks/useChat";
import { emitGlobalTyping } from "@/hooks/useGlobalTyping";

const ChatConversation = () => {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const onlineUsers = useOnlinePresence(user?.id);
  const isOtherOnline = Boolean(otherUserId && onlineUsers.has(otherUserId));
  const { invalidateConversations } = useInvalidateChat();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [videoViewerOpen, setVideoViewerOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Abilita notifiche web per questa conversazione
  useWebNotifications({ 
    userId: user?.id, 
    currentConversationId: conversationId 
  });

  useEffect(() => {
    checkAuth();
  }, [conversationId]);

  useEffect(() => {
    if (user && conversationId) {
      loadMessages();
      markMessagesAsRead();

      // Subscribe to new messages
      const messagesChannel = supabase
        .channel(`conversation:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            console.log("[Chat] Realtime INSERT received:", payload.new.id);
            setMessages((prev) => {
              const exists = prev.some((msg) => msg.id === payload.new.id);
              if (exists) return prev;
              const filtered = prev.filter((msg) =>
                !(msg.id?.startsWith('temp-') && msg.sender_id === payload.new.sender_id && msg.content === payload.new.content)
              );
              return [...filtered, payload.new];
            });
            scrollToBottom();
            if (payload.new.sender_id !== user.id) {
              markMessagesAsRead();
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === payload.new.id ? payload.new : msg))
            );
          }
        )
        .subscribe((status) => {
          console.log("[Chat] Messages channel status:", status);
        });

      // Subscribe to typing indicators
      const typingChannel = supabase
        .channel(`typing:${conversationId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'typing_indicators',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const data = payload.new as any;
            if (data && data.user_id !== user.id && typeof data.is_typing === 'boolean') {
              console.log("[Chat] Typing indicator:", data.is_typing);
              setIsTyping(data.is_typing);
            }
          }
        )
        .subscribe((status) => {
          console.log("[Chat] Typing channel status:", status);
        });

      return () => {
        supabase.removeChannel(messagesChannel);
        supabase.removeChannel(typingChannel);
      };
    }
  }, [user, conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      navigate("/login");
      return;
    }

    setUser(user);
    
    // Load current user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, business_name, profile_image_url")
      .eq("id", user.id)
      .single();
    
    if (profile) {
      setUserProfile(profile);
    }
    
    await loadOtherUser(user.id);
  };

  const loadOtherUser = async (userId: string) => {
    // Get conversation to find the other user
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (!conversation) return;

    // Determine other user ID
    const otherUserId = conversation.user1_id === userId 
      ? conversation.user2_id 
      : conversation.user1_id;

    if (!otherUserId) return;

    setOtherUserId(otherUserId);

    // Get other user's profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, business_name, profile_image_url")
      .eq("id", otherUserId)
      .single();

    if (profile) {
      setOtherUser(profile);
    }
  };

  const loadMessages = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, created_at, is_read, media_url, media_type, status")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);

    setMessages(data || []);
    setLoading(false);
  };

  const markMessagesAsRead = async () => {
    if (!user) return;

    await supabase
      .from("messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("is_read", false)
      .neq("sender_id", user.id);
    // Invalida la query React Query che popola la lista chat (badge unreadCounts)
    invalidateConversations(user.id);
    // Notifica anche useUnreadMessages per il contatore globale
    window.dispatchEvent(new CustomEvent("messages-read"));
  };

  const handleSendMessage = async (e: React.FormEvent, mediaUrl?: string, mediaType?: string) => {
    e.preventDefault();

    if ((!newMessage.trim() && !mediaUrl) || !user) return;

    // Clear input immediately for instant feedback
    const messageContent = newMessage.trim() || "";
    setNewMessage("");

    // Create optimistic message for instant UI feedback
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: any = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: user.id,
      content: messageContent,
      created_at: new Date().toISOString(),
      is_read: false,
      status: 'sending', // Temporary status
      media_url: mediaUrl || null,
      media_type: mediaType || null,
    };

    // Add message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      // Call moderation AI for message (in background, don't block UI)
      const { data: moderationData, error: moderationError } = await supabase.functions.invoke(
        'moderate-content',
        {
          body: {
            content: messageContent,
            mediaUrl: mediaUrl || undefined,
            contentType: 'message'
          }
        }
      );

      // Handle moderation errors silently for messages (to avoid interrupting chat flow)
      // If moderation fails (rate limit, error, etc.), approve the message anyway
      let moderation = { approved: true, score: 0, category: 'safe', reason: '' };

      if (moderationError || moderationData?.error) {
        console.warn('Message moderation skipped due to error:', moderationError || moderationData?.error);
        // Keep default approved: true
      } else if (moderationData) {
        moderation = moderationData;
      }

      const messageData: any = {
        conversation_id: conversationId,
        sender_id: user.id,
        content: messageContent,
        status: moderation.approved ? 'approved' : 'pending',
        moderation_score: moderation.score || 0,
        moderation_category: moderation.category,
        moderation_reason: moderation.reason,
        auto_moderated: !moderation.approved,
      };

      if (mediaUrl) {
        messageData.media_url = mediaUrl;
        messageData.media_type = mediaType;
      }

      const { data: insertedMessage, error } = await supabase
        .from("messages")
        .insert(messageData)
        .select()
        .single();

      if (error) throw error;

      // Replace optimistic message with real one
      setMessages((prev) =>
        prev.map((msg) => msg.id === tempId ? insertedMessage : msg)
      );

      // Send push notification to recipient
      if (otherUserId && moderation.approved) {
        try {
          const senderName = userProfile?.business_name ||
            `${userProfile?.first_name || ''} ${userProfile?.last_name || ''}`.trim() ||
            'Usuario';

          await supabase.functions.invoke('send-chat-notification', {
            body: {
              recipientUserId: otherUserId,
              senderName: senderName,
              messageContent: messageContent,
              conversationId: conversationId,
              senderId: user.id,
              language: i18n.language,
            }
          });
          console.log('📤 Push notification sent to recipient');
        } catch (notifError) {
          console.warn('Failed to send push notification:', notifError);
          // Don't block the message flow if notification fails
        }
      }

      // Inform user if message is pending moderation
      if (!moderation.approved) {
        toast({
          title: "Mensaje en revisión",
          description: "Tu mensaje está siendo revisado antes de enviarse",
        });
      }

      // Update conversation updated_at
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

      // Stop typing indicator
      await updateTypingStatus(false);

    } catch (error: any) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((msg) => msg.id !== tempId));
      // Restore message input
      setNewMessage(messageContent);
      toast({
        title: "Errore",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateTypingStatus = async (isTyping: boolean) => {
    if (!user || !conversationId) return;

    await supabase
      .from("typing_indicators")
      .upsert({
        conversation_id: conversationId,
        user_id: user.id,
        is_typing: isTyping,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'conversation_id,user_id' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);

    // Update typing indicator (tabella + broadcast globale per ChatsList)
    updateTypingStatus(true);
    if (user?.id && otherUserId) {
      emitGlobalTyping(user.id, otherUserId);
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to stop typing indicator (4s per dare tempo al polling di intercettarlo)
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 4000);
  };

  const handleMediaUpload = async (file: File, type: 'image' | 'video' | 'file') => {
    if (!user) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      const bucket = type === 'image' || type === 'video' ? 'posts' : 'gallery';

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      await handleSendMessage(new Event('submit') as any, publicUrl, type);
      toast({ title: t('chatMedia.fileSent') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleVoiceRecording = async (audioBlob: Blob) => {
    if (!user) return;

    setUploading(true);
    try {
      const type = audioBlob.type || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a'
                : type.includes('ogg') ? 'ogg'
                : type.includes('wav') ? 'wav'
                : 'webm';
      const filePath = `${user.id}/${Date.now()}.${ext}`;
      
      const { error: uploadError } = await supabase.storage
        .from('posts')
        .upload(filePath, audioBlob, { contentType: type });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('posts')
        .getPublicUrl(filePath);

      await handleSendMessage(new Event('submit') as any, publicUrl, 'audio');
      toast({ title: t('chatMedia.voiceSent') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const getDisplayName = () => {
    if (otherUser?.first_name) {
      return `${otherUser.first_name} ${otherUser.last_name || ""}`.trim();
    }
    return otherUser?.business_name || "Utente";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <SwipeBackWrapper>
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 ios-card mx-4 mt-4 px-4 pb-4 flex items-center gap-3 bg-background shadow-sm" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/chats")}
          className="rounded-full"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        
        <div className="relative flex-shrink-0">
          <OptimizedAvatar
            src={otherUser?.profile_image_url}
            fallback={getDisplayName()[0]}
            size="small"
          />
          {isOtherOnline && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 shadow" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{getDisplayName()}</p>
          {isTyping ? (
            <p className="text-xs text-primary animate-pulse">{t('chat.typing')}</p>
          ) : isOtherOnline ? (
            <p className="text-xs text-emerald-600">{t('chat.online', 'En línea')}</p>
          ) : otherUser?.last_active_at ? (
            <p className="text-xs text-muted-foreground">
              {t('chat.lastSeen', 'Últ. acceso')} {formatDistanceToNow(new Date(otherUser.last_active_at), { addSuffix: true, locale: i18n.language === 'es' ? undefined : it })}
            </p>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {otherUserId && (
              <>
                <BlockUserButton
                  userId={otherUserId}
                  userName={getDisplayName()}
                  trigger={
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    {t('moderation.blockUser')}
                  </DropdownMenuItem>
                  }
                  onBlocked={() => navigate("/chats")}
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((message) => {
          const isOwn = message.sender_id === user?.id;
          
          return (
            <div
              key={message.id}
              className={`flex items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {!isOwn && (
                <OptimizedAvatar
                  src={otherUser?.profile_image_url}
                  fallback={getDisplayName()[0]}
                  size="small"
                  className="h-8 w-8 flex-shrink-0"
                  fallbackClassName="bg-primary/10 text-xs"
                />
              )}
              
              <div className="relative group max-w-[75%]">
                <div
                  className={`rounded-2xl px-4 py-2 ${
                    isOwn
                      ? "bg-primary text-primary-foreground"
                      : "bg-card"
                  }`}
                >
                {message.media_url && (
                  <div className="mb-2">
                    {message.media_type === 'image' ? (
                      <img 
                        src={message.media_url} 
                        alt="Media" 
                        className="rounded-lg max-w-[250px] max-h-[350px] object-cover cursor-pointer" 
                        onClick={() => {
                          setSelectedImage(message.media_url);
                          setImageViewerOpen(true);
                        }}
                      />
                    ) : message.media_type === 'video' ? (
                      <div 
                        className="relative rounded-lg max-w-[250px] max-h-[350px] overflow-hidden cursor-pointer"
                        onClick={() => {
                          setSelectedVideo(message.media_url);
                          setVideoViewerOpen(true);
                        }}
                      >
                        <video 
                          src={message.media_url} 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
                            <div className="w-0 h-0 border-t-[8px] border-t-transparent border-l-[14px] border-l-primary border-b-[8px] border-b-transparent ml-1" />
                          </div>
                        </div>
                      </div>
                    ) : message.media_type === 'audio' ? (
                      <VoiceMessagePlayer 
                        audioUrl={message.media_url} 
                        isOwn={isOwn}
                      />
                    ) : (
                      <button 
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = message.media_url;
                          link.download = 'file';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className={`flex items-center gap-2 p-3 rounded-lg border ${isOwn ? 'bg-primary-foreground/10 border-primary-foreground/20' : 'bg-muted border-border'}`}
                      >
                        <Download className="w-5 h-5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{t('chatMedia.fileAttached')}</p>
                          <p className="text-xs opacity-70">{t('chatMedia.tapToDownload')}</p>
                        </div>
                      </button>
                    )}
                  </div>
                )}
                {message.content && (
                  // Check if it's a shared post
                  message.content.match(/^\[shared_post:([a-f0-9-]+)\]$/) ? (
                    <SharedPostPreview 
                      postId={message.content.match(/^\[shared_post:([a-f0-9-]+)\]$/)?.[1] || ''} 
                      isOwn={isOwn}
                    />
                  ) : (
                    <p className="break-words overflow-wrap-anywhere whitespace-pre-wrap">{message.content}</p>
                  )
                )}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className={`text-xs ${isOwn ? "opacity-70" : "text-muted-foreground"}`}>
                    {formatDistanceToNow(new Date(message.created_at), {
                      addSuffix: false,
                      locale: it,
                    })}
                  </span>
                  {isOwn && (
                    message.is_read ? (
                      <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                    ) : (
                      <Check className="w-3.5 h-3.5 opacity-70" />
                    )
                  )}
                </div>
                </div>
                {!isOwn && (
                  <div className="absolute -right-8 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ReportContentDialog
                      contentId={message.id}
                      contentType="message"
                      trigger={
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
              
              {isOwn && (
                <OptimizedAvatar
                  src={userProfile?.profile_image_url}
                  fallback={userProfile?.first_name?.[0] || userProfile?.business_name?.[0] || "U"}
                  size="small"
                  className="h-8 w-8 flex-shrink-0"
                  fallbackClassName="text-xs"
                />
              )}
            </div>
          );
        })}
        
        {/* Typing Indicator */}
        {isTyping && (
          <div className="flex items-end gap-2">
            <OptimizedAvatar
              src={otherUser?.profile_image_url}
              fallback={getDisplayName()[0]}
              size="small"
              className="h-8 w-8 flex-shrink-0"
              fallbackClassName="bg-primary/10 text-xs"
            />
            <div className="bg-card rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="ios-card mx-4 mb-4 p-4">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            className="rounded-full flex-shrink-0"
            onClick={() => setUploadSheetOpen(true)}
          >
            <Paperclip className="w-5 h-5" />
          </Button>

          <VoiceRecorderButton 
            onRecordingComplete={handleVoiceRecording}
            disabled={uploading}
          />

          <Input
            value={newMessage}
            onChange={handleInputChange}
            placeholder={t('chatMedia.typeMessage')}
            className="flex-1 rounded-full"
            disabled={uploading}
          />

          <Button
            type="submit"
            size="icon"
            className="rounded-full flex-shrink-0"
            disabled={!newMessage.trim() || uploading}
          >
            {uploading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </form>
      </div>

      {/* Media Upload Sheet */}
      <MediaUploadSheet
        open={uploadSheetOpen}
        onOpenChange={setUploadSheetOpen}
        onMediaSelect={handleMediaUpload}
        onCameraCapture={(imageUrl) => {
          // Handle camera capture if needed
        }}
        onVoiceRecord={() => {}}
        uploading={uploading}
      />

      {/* Image Viewer */}
      <ImageViewer
        open={imageViewerOpen}
        onOpenChange={setImageViewerOpen}
        imageUrl={selectedImage}
      />

      {/* Video Viewer */}
      <Dialog open={videoViewerOpen} onOpenChange={setVideoViewerOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black border-0">
          <div className="flex items-center justify-center w-full h-full">
            <video
              src={selectedVideo}
              controls
              autoPlay
              className="max-w-full max-h-[95vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </SwipeBackWrapper>
  );
};

export default ChatConversation;
