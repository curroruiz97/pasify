import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

/**
 * useFCMToken · registra el FCM token del dispositivo en user_fcm_tokens.
 * Solo se ejecuta cuando hay user autenticado + plataforma nativa (Android/iOS).
 * Re-registra al cambiar de usuario o al refrescar token.
 */
export const useFCMToken = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let removeRegistrationListener: (() => void) | null = null;
    let removeErrorListener: (() => void) | null = null;

    const setupListeners = async () => {
      // Listener: registration token
      const reg = await PushNotifications.addListener("registration", async (token: Token) => {
        if (cancelled) return;
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        const platform = Capacitor.getPlatform() as "ios" | "android" | "web";
        await supabase.from("user_fcm_tokens").upsert(
          { user_id: data.user.id, fcm_token: token.value, platform, updated_at: new Date().toISOString() },
          { onConflict: "user_id,platform" }
        );
        // eslint-disable-next-line no-console
        console.info("[FCM] token registered", { platform, prefix: token.value.slice(0, 12) });
      });
      removeRegistrationListener = () => reg.remove();

      // Listener: registration error
      const err = await PushNotifications.addListener("registrationError", (e) => {
        // eslint-disable-next-line no-console
        console.warn("[FCM] registration error", e);
      });
      removeErrorListener = () => err.remove();
    };

    const requestAndRegister = async () => {
      try {
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt") {
          const req = await PushNotifications.requestPermissions();
          if (req.receive !== "granted") return;
        } else if (perm.receive !== "granted") {
          return;
        }
        await setupListeners();
        await PushNotifications.register();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[FCM] register failed", e);
      }
    };

    // Re-ejecutar cuando cambia auth
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) requestAndRegister();
    });

    // Inicial
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) requestAndRegister();
    });

    return () => {
      cancelled = true;
      removeRegistrationListener?.();
      removeErrorListener?.();
      sub.subscription.unsubscribe();
    };
  }, []);
};
