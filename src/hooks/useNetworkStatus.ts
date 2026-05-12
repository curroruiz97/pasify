import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

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

    // On Capacitor native, use App state change to re-check connectivity
    let appCleanup: (() => void) | null = null;
    if (Capacitor.isNativePlatform()) {
      import("@capacitor/app").then(({ App }) => {
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            // Re-check network when app comes to foreground
            setIsOnline(navigator.onLine);
            if (navigator.onLine && wasOfflineRef.current) {
              handleOnline();
            }
          }
        });
        appCleanup = () => {
          App.removeAllListeners();
        };
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      appCleanup?.();
    };
  }, []);

  return { isOnline, wasOffline };
};
