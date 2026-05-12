/**
 * useWebNotifications · LEGACY NEUTRALIZED stub.
 *
 * Suscribía a `messages` y `conversations` (chat Students Life) y mostraba
 * notificaciones del navegador. En Pasify el realtime de support va por
 * `support_messages` + push FCM nativo, no por web Notifications API. Este
 * hook es no-op para que `Chats.tsx`, `ChatConversation.tsx` y `Social.tsx`
 * (todos orphaned ya) compilen sin tocar el resto.
 */

interface WebNotificationsProps {
  userId: string | undefined;
  currentConversationId?: string;
}

export const useWebNotifications = (_props: WebNotificationsProps) => {
  // no-op
};
