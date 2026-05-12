/**
 * useUnreadNotifications · LEGACY NEUTRALIZED stub.
 *
 * Antes contaba likes + comments + QR codes no leídos contra tablas que ya
 * no existen (posts/comments/qr_codes/discounts). Pasify usa la tabla
 * `notifications` con realtime — el badge se gestiona desde `useNotifications`
 * (nuevo hook). Mantenemos este stub para no romper imports legacy.
 */
import { useCallback } from "react";

export const useUnreadNotifications = (_userId: string | undefined) => {
  const markAllAsRead = useCallback(() => {
    // no-op
  }, []);

  return {
    unreadCount: 0,
    markAllAsRead,
    refetch: async () => {},
  };
};
