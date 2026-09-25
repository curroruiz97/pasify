import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useRealtimeInvalidate } from "@/lib/cache/useRealtimeInvalidate";
import { withTimeout } from "@/lib/withTimeout";

/** "client": Soporte del cliente (client_admin). "partner": el del local (partner_admin). */
export type SupportUnreadScope = "client" | "partner";

const KIND: Record<SupportUnreadScope, "client_admin" | "partner_admin"> = {
  client: "client_admin",
  partner: "partner_admin",
};

const TIMEOUT_MS = 12_000;

/** Clave de la caché del contador (solo memoria: es la conversación privada del usuario). */
export const supportUnreadKey = (uid: string, scope: SupportUnreadScope) => qk.me.support(uid, "unread", scope);

/**
 * Mensajes del equipo de Pasify sin leer en el Soporte del usuario: la suma
 * de unread_for_client de sus conversaciones de ese tipo (en un local, las de
 * todas sus organizaciones). Tiempo real sobre support_conversations: una
 * respuesta del admin sube el contador y abrir el chat (SupportChat →
 * mark_conversation_read) lo pone a cero. Devuelve 0 mientras no se sabe.
 */
export function useSupportUnread(uid: string | null | undefined, scope: SupportUnreadScope = "client"): number {
  const key = uid ? supportUnreadKey(uid, scope) : null;

  useRealtimeInvalidate({
    canal: uid ? `support-unread-${scope}` : null,
    tabla: "support_conversations",
    filtro: uid ? `client_id=eq.${uid}` : undefined,
    eventos: ["INSERT", "UPDATE"],
    queryKey: key,
  });

  const query = useQuery({
    queryKey: key ?? supportUnreadKey("", scope),
    queryFn: async (): Promise<number> => {
      const { data, error } = await withTimeout(
        supabase
          .from("support_conversations")
          .select("unread_for_client")
          .eq("client_id", uid as string)
          .eq("kind", KIND[scope])
          .gt("unread_for_client", 0)
          .limit(50),
        TIMEOUT_MS,
        "support_unread",
      );
      if (error) throw error;
      return (data ?? []).reduce((total, c) => total + (c.unread_for_client ?? 0), 0);
    },
    enabled: !!uid,
    staleTime: 30_000,
    // Si el tiempo real se corta, el aviso del menú no se queda congelado.
    refetchInterval: 2 * 60_000,
  });

  return query.data ?? 0;
}
