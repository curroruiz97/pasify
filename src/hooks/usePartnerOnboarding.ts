import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Onboarding flow for first-time partner users.
 * Localized via i18n keys (with safe fallbacks baked in so the tour works
 * even if a translation file is missing the partnerOnboarding namespace).
 */

export type PartnerOnboardingTargetTab = "social" | "events" | "scanner" | "stats" | "profile";

export interface OnboardingStep {
  id: string;
  /** i18n key for the title; fallback shown verbatim if the key is missing. */
  titleKey: string;
  titleFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  targetTab?: PartnerOnboardingTargetTab;
  checkField?: keyof ProfileCompletion;
  required?: boolean;
  position?: "center" | "top" | "bottom";
  /** data-onboarding attribute value to highlight + arrow towards. */
  highlightElement?: string;
  arrowDirection?: "up" | "down" | "left" | "right";
  /** "rect" wraps wide targets (button rows, save button, banners);
   *  "circle" (default) for square-ish targets like a single FAB. */
  highlightShape?: "circle" | "rect";
  /** When true the highlighted element stays clickable: tutorial only
   *  shows the spotlight without blocking taps. Use for steps where
   *  the user must actually interact with the target (upload photo,
   *  press Save). Default false → click-blocker prevents accidental
   *  interaction (e.g. FAB show-and-tell). */
  allowInteraction?: boolean;
}

export interface ProfileCompletion {
  hasProfilePhoto: boolean;
  hasBusinessName: boolean;
  hasBusinessCity: boolean;
}

const STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    titleKey: "partnerOnboarding.welcome.title",
    titleFallback: "¡Bienvenido a Pasify Partner! 🎉",
    descriptionKey: "partnerOnboarding.welcome.description",
    descriptionFallback:
      "Te damos un tour rápido para que descubras todas las herramientas para tu negocio.",
    targetTab: "social",
    position: "center",
  },
  {
    id: "profile-photo",
    titleKey: "partnerOnboarding.profilePhoto.title",
    titleFallback: "📷 Sube el logo de tu negocio",
    descriptionKey: "partnerOnboarding.profilePhoto.description",
    descriptionFallback:
      "Pulsa Galería o Foto para elegir el logo de tu negocio.",
    targetTab: "profile",
    position: "bottom",
    highlightElement: "partner-logo-uploader",
    highlightShape: "rect",
    arrowDirection: "up",
    allowInteraction: true,
  },
  {
    id: "profile-save",
    titleKey: "partnerOnboarding.profileSave.title",
    titleFallback: "💾 Guarda los cambios",
    descriptionKey: "partnerOnboarding.profileSave.description",
    descriptionFallback:
      "Pulsa Guardar para que tu logo aparezca junto a tus eventos.",
    targetTab: "profile",
    checkField: "hasProfilePhoto",
    required: true,
    position: "top",
    highlightElement: "partner-save-profile",
    highlightShape: "rect",
    arrowDirection: "down",
    allowInteraction: true,
  },
  {
    id: "fab",
    titleKey: "partnerOnboarding.fab.title",
    titleFallback: "✨ El botón mágico",
    descriptionKey: "partnerOnboarding.fab.description",
    descriptionFallback:
      "Este es tu acceso rápido: publicar, eventos y estadísticas.",
    targetTab: "social",
    position: "top",
    highlightElement: "partner-fab",
    arrowDirection: "down",
  },
  {
    id: "events",
    titleKey: "partnerOnboarding.events.title",
    titleFallback: "📅 Crea tus eventos",
    descriptionKey: "partnerOnboarding.events.description",
    descriptionFallback:
      "Pulsa aquí para crear cenas, fiestas y descuentos por horario.",
    targetTab: "events",
    position: "top",
    highlightElement: "partner-create-event",
    arrowDirection: "down",
  },
  {
    id: "scanner",
    titleKey: "partnerOnboarding.scanner.title",
    titleFallback: "🎟️ Escanea los QR",
    descriptionKey: "partnerOnboarding.scanner.description",
    descriptionFallback:
      "Cuando un estudiante llegue, abre el lector QR, escanea su código y aplica el descuento.",
    targetTab: "scanner",
    position: "center",
  },
  {
    id: "stats",
    titleKey: "partnerOnboarding.stats.title",
    titleFallback: "📊 Mide tu impacto",
    descriptionKey: "partnerOnboarding.stats.description",
    descriptionFallback:
      "Mira cuántos QR has emitido, cuántos se han usado y qué eventos funcionan mejor.",
    targetTab: "stats",
    position: "center",
  },
  {
    id: "publish",
    titleKey: "partnerOnboarding.publish.title",
    titleFallback: "📱 Publica en el feed",
    descriptionKey: "partnerOnboarding.publish.description",
    descriptionFallback:
      "Comparte fotos, vídeos y novedades. La comunidad universitaria de tu ciudad las verá en su Home.",
    targetTab: "social",
    position: "center",
  },
  {
    id: "complete",
    titleKey: "partnerOnboarding.complete.title",
    titleFallback: "🎊 ¡Todo listo!",
    descriptionKey: "partnerOnboarding.complete.description",
    descriptionFallback:
      "Crea tu primer evento, comparte tu primera publicación y empieza a recibir estudiantes.",
    targetTab: "social",
    position: "center",
  },
];

const lsKey = (suffix: string, userId: string | undefined) =>
  userId ? `partner_onboarding_${suffix}_${userId}` : null;

export const usePartnerOnboarding = (userId: string | undefined) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profileCompletion, setProfileCompletion] = useState<ProfileCompletion | null>(null);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);

  const getSavedStep = useCallback(() => {
    const key = lsKey("step", userId);
    if (!key) return 0;
    const saved = localStorage.getItem(key);
    return saved ? parseInt(saved, 10) : 0;
  }, [userId]);

  const saveCurrentStep = useCallback(
    (step: number) => {
      const key = lsKey("step", userId);
      if (key) localStorage.setItem(key, String(step));
    },
    [userId]
  );

  const checkProfileCompletion = useCallback(async () => {
    if (!userId) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("profile_image_url, business_name, business_city")
      .eq("id", userId)
      .single();
    const completion: ProfileCompletion = {
      hasProfilePhoto: !!profile?.profile_image_url,
      hasBusinessName: !!profile?.business_name?.trim(),
      hasBusinessCity: !!profile?.business_city?.trim(),
    };
    setProfileCompletion(completion);
    return completion;
  }, [userId]);

  // Initialize: load completion + saved step, decide whether to run.
  useEffect(() => {
    const init = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }
      await checkProfileCompletion();

      const completedKey = lsKey("completed", userId);
      const wasCompleted = completedKey ? localStorage.getItem(completedKey) : null;
      if (wasCompleted) {
        setSteps([]);
        setIsOnboardingActive(false);
        setIsLoading(false);
        return;
      }

      const startedKey = lsKey("started", userId);
      if (startedKey) localStorage.setItem(startedKey, "true");

      setSteps(STEPS);
      const saved = getSavedStep();
      if (saved > 0 && saved < STEPS.length) setCurrentStep(saved);
      setIsOnboardingActive(true);
      setIsLoading(false);
    };
    init();
  }, [userId, checkProfileCompletion, getSavedStep]);

  const refreshCompletion = useCallback(async () => {
    const completion = await checkProfileCompletion();
    if (!completion) return;
    setProfileCompletion(completion);
    const stepData = steps[currentStep];
    if (stepData?.required && stepData?.checkField) {
      const isNowComplete = completion[stepData.checkField];
      if (isNowComplete) {
        const next = currentStep + 1;
        if (next < steps.length) {
          setCurrentStep(next);
          saveCurrentStep(next);
        }
      }
    }
  }, [checkProfileCompletion, currentStep, steps, saveCurrentStep]);

  const canProceed = useCallback(() => {
    const stepData = steps[currentStep];
    if (!stepData) return true;
    if (stepData.required && stepData.checkField && profileCompletion) {
      return profileCompletion[stepData.checkField];
    }
    return true;
  }, [currentStep, steps, profileCompletion]);

  const nextStep = useCallback(() => {
    if (!canProceed()) return false;
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      saveCurrentStep(next);
    }
    return true;
  }, [currentStep, steps.length, canProceed, saveCurrentStep]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
      saveCurrentStep(prev);
    }
  }, [currentStep, saveCurrentStep]);

  const completeOnboarding = useCallback(() => {
    const completedKey = lsKey("completed", userId);
    const stepKey = lsKey("step", userId);
    if (completedKey) localStorage.setItem(completedKey, "true");
    if (stepKey) localStorage.removeItem(stepKey);
    setIsOnboardingActive(false);
  }, [userId]);

  const skipCurrentStep = useCallback(() => {
    const stepData = steps[currentStep];
    if (stepData?.required && !canProceed()) return false;
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      saveCurrentStep(next);
    } else {
      completeOnboarding();
    }
    return true;
  }, [currentStep, steps, canProceed, saveCurrentStep, completeOnboarding]);

  const getCurrentStep = (): OnboardingStep | null => steps[currentStep] || null;
  const getProgress = (): number =>
    steps.length === 0 ? 100 : ((currentStep + 1) / steps.length) * 100;

  return {
    currentStep,
    totalSteps: steps.length,
    isOnboardingActive,
    isLoading,
    steps,
    profileCompletion,
    getCurrentStep,
    getProgress,
    nextStep,
    prevStep,
    skipCurrentStep,
    completeOnboarding,
    refreshCompletion,
    setCurrentStep,
    canProceed,
  };
};
