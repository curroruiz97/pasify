import { QueryClient, focusManager } from "@tanstack/react-query";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { TimeoutError } from "@/lib/withTimeout";

/**
 * Caché de datos de la app (React Query): stale-while-revalidate.
 *
 *  - Lo que ya se ha cargado se pinta al instante al volver a una pantalla,
 *    a una pestaña o a la app; si tiene más de `staleTime` se refresca en
 *    segundo plano, sin loader. Solo sale un esqueleto cuando no hay nada.
 *  - `gcTime` largo: lo que no se está viendo sigue en memoria (y en el
 *    dispositivo, según policy.ts) para la próxima visita. Las consultas con
 *    datos personales de compradores lo acortan en su propio hook.
 *  - Reintentos solo cuando tiene sentido: red caída, timeout o error del
 *    servidor. Un permiso denegado o un dato inválido no mejora reintentando.
 */
const SEGUNDO = 1000;
const DIA = 24 * 60 * 60 * SEGUNDO;

// Permiso denegado, tabla/columna/función inexistente, dato inválido,
// restricción violada y errores de la petición o del esquema en PostgREST.
// PGRST3xx (JWT caducado) sí se reintenta: auth-js renueva el token.
const CODIGOS_SIN_REINTENTO = /^(42501|42P01|42703|42883|22|23|PGRST1|PGRST2)/;

export function debeReintentar(fallos: number, error: unknown): boolean {
  if (fallos >= 2) return false;
  if (error instanceof TimeoutError) return true;
  const e = error as { status?: unknown; code?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  if (typeof e?.code === "string" && CODIGOS_SIN_REINTENTO.test(e.code)) return false;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * SEGUNDO,
      gcTime: 7 * DIA,
      retry: debeReintentar,
      retryDelay: (intento) => Math.min(1000 * 2 ** intento, 8000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});

// En la app nativa no hay "foco de ventana": volver a la app es el
// `appStateChange` de Capacitor. En la web sirve el visibilitychange de siempre.
if (Capacitor.isNativePlatform()) {
  focusManager.setEventListener((alCambiarFoco) => {
    let handle: PluginListenerHandle | null = null;
    let quitado = false;
    import("@capacitor/app")
      .then(({ App }) => App.addListener("appStateChange", ({ isActive }) => alCambiarFoco(isActive)))
      .then((h) => {
        if (quitado) void h.remove();
        else handle = h;
      })
      .catch(() => undefined);
    return () => {
      quitado = true;
      void handle?.remove();
    };
  });
}
