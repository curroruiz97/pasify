import { useState, useEffect, useRef } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

interface NetworkStatus {
  isOnline: boolean;
  /** true unos segundos tras recuperar la conexión (para "vuelves a tener conexión"). */
  wasOffline: boolean;
}

/** Cuánto dura `wasOffline` tras volver la conexión. */
const AVISO_VUELTA_MS = 5000;

export const useNetworkStatus = (): NetworkStatus => {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  // Se ha perdido la conexión desde el último aviso de vuelta. Antes nunca
  // volvía a false: cualquier "online" posterior (volver a la app con red)
  // repetía el aviso y la recarga de datos.
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleOnline = () => {
      setIsOnline(true);
      if (!wasOfflineRef.current) return;
      wasOfflineRef.current = false;
      setWasOffline(true);
      // Reset wasOffline after a short delay so consumers can react
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setWasOffline(false), AVISO_VUELTA_MS);
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // On Capacitor native, use App state change to re-check connectivity.
    // Al desmontar se quita SOLO este listener: App.removeAllListeners() se
    // llevaba también los de deep links (App.tsx) y el de volver de Stripe
    // (usePendingCheckoutResume) en cuanto se desmontaba un componente que usa
    // el hook (p. ej. el escáner de puerta al cambiar de sección).
    let disposed = false;
    let appListener: PluginListenerHandle | null = null;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => {
            if (!isActive) return;
            // Re-check network when app comes to foreground
            if (navigator.onLine) handleOnline();
            else handleOffline();
          })
        )
        .then((handle) => {
          // Desmontado mientras cargaba el plugin: fuera ya, que no quede colgado.
          if (disposed) void handle.remove();
          else appListener = handle;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      void appListener?.remove();
    };
  }, []);

  return { isOnline, wasOffline };
};
