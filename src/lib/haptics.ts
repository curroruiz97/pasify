import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

/**
 * Haptic feedback helpers — wrap Capacitor Haptics in named primitives
 * (haptic.tap, haptic.success, …) e fanno no-op silenzioso su web/desktop.
 *
 * Linee guida d'uso:
 *  - tap()/light()  : interazione neutra (toggle, tab change, swipe close)
 *  - medium()       : conferma azione (partecipa, save)
 *  - heavy()        : evento importante (QR scan ok, payment success)
 *  - success()      : flusso completato con successo
 *  - warning()      : avviso non bloccante
 *  - error()        : errore o validation fail
 *  - selection()    : tick di scroll/picker
 *
 * NON spammare: una vibrazione per azione utente, mai due in <300ms.
 */

const isNative = Capacitor.isNativePlatform();

const safe = async (fn: () => Promise<void>) => {
  if (!isNative) return;
  try {
    await fn();
  } catch {
    // Haptics può non essere disponibile (device sconosciuto, mute, ecc.)
    // Falliamo silenziosamente — non è feedback critico.
  }
};

export const haptic = {
  tap: () => safe(() => Haptics.impact({ style: ImpactStyle.Light })),
  light: () => safe(() => Haptics.impact({ style: ImpactStyle.Light })),
  medium: () => safe(() => Haptics.impact({ style: ImpactStyle.Medium })),
  heavy: () => safe(() => Haptics.impact({ style: ImpactStyle.Heavy })),
  success: () => safe(() => Haptics.notification({ type: NotificationType.Success })),
  warning: () => safe(() => Haptics.notification({ type: NotificationType.Warning })),
  error: () => safe(() => Haptics.notification({ type: NotificationType.Error })),
  selection: () => safe(() => Haptics.selectionStart().then(() => Haptics.selectionEnd())),
};
