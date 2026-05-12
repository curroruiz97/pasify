import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook per registrare il token FCM del dispositivo
 * Questo hook deve essere chiamato nell'app principale quando l'utente è autenticato
 * 
 * Per usarlo, devi prima configurare Firebase Cloud Messaging nella tua app mobile:
 * 1. Aggiungi firebase al tuo progetto Capacitor
 * 2. Ottieni il token FCM usando @capacitor-firebase/messaging
 * 3. Passa il token a questo hook
 */
export const useFCMTokenRegistration = (userId: string | undefined, fcmToken: string | undefined) => {
  useEffect(() => {
    if (!userId || !fcmToken) return;

    const registerToken = async () => {
      try {
        console.log('📱 Registering FCM token for user:', userId);

        // Detect platform (puoi usare Capacitor.getPlatform() per essere più preciso)
        const platform = /android/i.test(navigator.userAgent) ? 'android' : 'ios';

        // Upsert del token (inserisce o aggiorna)
        const { error } = await supabase
          .from('user_fcm_tokens')
          .upsert({
            user_id: userId,
            fcm_token: fcmToken,
            platform: platform,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,platform'
          });

        if (error) {
          console.error('❌ Error registering FCM token:', error);
        } else {
          console.log('✅ FCM token registered successfully');
        }
      } catch (error) {
        console.error('❌ Error in FCM token registration:', error);
      }
    };

    registerToken();
  }, [userId, fcmToken]);
};
