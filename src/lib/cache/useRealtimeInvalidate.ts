import { useEffect, useId, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type EventoPg = "INSERT" | "UPDATE" | "DELETE" | "*";

interface Opciones {
  /** Nombre base del canal; null = sin suscripción. */
  canal: string | null;
  tabla: string;
  /** Filtro de postgres_changes, p. ej. `event_id=eq.<id>`. */
  filtro?: string;
  eventos?: EventoPg[];
  /** Consultas a refrescar cuando llega un cambio. */
  queryKey: QueryKey | null;
  /** Agrupa ráfagas (escaneos seguidos en puerta) en un solo refresco. */
  esperaMs?: number;
}

/**
 * Tiempo real → caché: cuando cambia una fila, se marcan como obsoletas las
 * consultas afectadas y React Query las refresca en segundo plano (las que
 * se estén viendo al momento; las demás, al volver a ellas). Nada de
 * vaciar la pantalla ni de recargar a mano.
 *
 * Cada consumidor abre su propio canal (useId): Supabase Realtime no admite
 * dos canales activos con el mismo nombre.
 */
export function useRealtimeInvalidate({
  canal,
  tabla,
  filtro,
  eventos = ["INSERT", "UPDATE"],
  queryKey,
  esperaMs = 400,
}: Opciones) {
  const queryClient = useQueryClient();
  const id = useId();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;
  const hashKey = queryKey ? JSON.stringify(queryKey) : null;
  const eventosKey = eventos.join(",");

  useEffect(() => {
    if (!canal || !hashKey) return;
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const invalidar = () => {
      if (temporizador) return;
      temporizador = setTimeout(() => {
        temporizador = null;
        const key = keyRef.current;
        if (key) void queryClient.invalidateQueries({ queryKey: key });
      }, esperaMs);
    };

    const interesan = new Set(eventosKey.split(","));
    const ch = supabase
      .channel(`${canal}-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabla, ...(filtro ? { filter: filtro } : {}) },
        (payload) => {
          if (interesan.has("*") || interesan.has(payload.eventType)) invalidar();
        },
      )
      .subscribe();

    return () => {
      if (temporizador) clearTimeout(temporizador);
      void supabase.removeChannel(ch);
    };
  }, [canal, tabla, filtro, eventosKey, hashKey, esperaMs, id, queryClient]);
}
