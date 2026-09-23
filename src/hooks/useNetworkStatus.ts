import { useState, useEffect, useRef } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
}

export const useNetworkStatus = (): NetworkStatus => {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        setWasOffline(true);
        // Reset wasOffline after a short delay so consumers can react
        setTimeout(() => setWasOffline(false), 5000);
      }
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
            if (isActive) {
              // Re-check network when app comes to foreground
              setIsOnline(navigator.onLine);
              if (navigator.onLine && wasOfflineRef.current) {
                handleOnline();
              }
            }
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
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      void appListener?.remove();
    };
  }, []);

  return { isOnline, wasOffline };
};
