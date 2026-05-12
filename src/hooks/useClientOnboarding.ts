import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ClientOnboardingStep {
  id: string;
  title: string;
  description: string;
  targetTab?: "social" | "partners" | "chats";
  checkField?: string;
  position?: "center" | "top" | "bottom";
  required?: boolean;
  highlightElement?: string;
  arrowDirection?: "up" | "down" | "left" | "right";
}

export interface ClientProfileCompletion {
  hasProfilePhoto: boolean;
  hasCoverPhoto: boolean;
}

const ONBOARDING_STEPS: ClientOnboardingStep[] = [
  {
    id: "welcome",
    title: "¡Bienvenido a StudentsLife! 🎉",
    description: "Te guiaremos para conocer todas las funciones. ¡Vamos!",
    targetTab: "social",
    position: "center",
  },
  {
    id: "go-to-profile",
    title: "📷 Ve a Tu Perfil",
    description: "Haz clic en tu avatar para ir a tu perfil y subir tu foto.",
    targetTab: "social",
    position: "top",
    highlightElement: "avatar",
    arrowDirection: "up",
  },
  {
    id: "profile-photo",
    title: "📷 Sube Tu Foto de Perfil",
    description: "Haz clic en tu avatar para subir una foto. ¡Es obligatorio!",
    position: "top",
    highlightElement: "profile-avatar",
    arrowDirection: "up",
    required: true,
    checkField: "hasProfilePhoto",
  },
  {
    id: "discover-partners",
    title: "🏪 Sección Socios",
    description: "Aquí encontrarás todos los locales con descuentos exclusivos. ¡Explora el mapa!",
    targetTab: "partners",
    position: "center",
  },
  {
    id: "download-discounts",
    title: "🏷️ Descargar Descuentos",
    description: "Entra en cualquier local → ve a sus eventos → descarga el QR. ¡Muéstralo para tu descuento!",
    targetTab: "partners",
    position: "center",
  },
  {
    id: "wallet",
    title: "💼 Tu Wallet",
    description: "Haz clic en el icono del Wallet para ver tus QR descargados.",
    targetTab: "partners",
    position: "bottom",
    highlightElement: "wallet",
    arrowDirection: "up",
  },
  {
    id: "loyalty-cards",
    title: "🎁 Tarjetas de Fidelidad",
    description: "Haz clic en Tarjetas para ver tu progreso de sellos.",
    targetTab: "partners",
    position: "bottom",
    highlightElement: "loyalty-cards",
    arrowDirection: "up",
  },
  {
    id: "social-feed",
    title: "📱 Feed Social",
    description: "Comparte fotos y videos con la comunidad. ¡Usa el botón + para publicar!",
    targetTab: "social",
    position: "center",
  },
  {
    id: "chat",
    title: "💬 Chat",
    description: "Envía mensajes a otros usuarios y partners. ¡Conecta con la comunidad!",
    targetTab: "chats",
    position: "center",
  },
  {
    id: "complete",
    title: "🎊 ¡Listo!",
    description: "Ya conoces StudentsLife. ¡Disfruta de tus descuentos exclusivos!",
    targetTab: "social",
    position: "center",
  },
];

export const useClientOnboarding = (userId: string | undefined) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [profileCompletion, setProfileCompletion] = useState<ClientProfileCompletion | null>(null);
  const [steps, setSteps] = useState<ClientOnboardingStep[]>([]);

  // Get saved step from localStorage
  const getSavedStep = useCallback(() => {
    if (!userId) return 0;
    const saved = localStorage.getItem(`client_onboarding_step_${userId}`);
    return saved ? parseInt(saved, 10) : 0;
  }, [userId]);

  // Save current step to localStorage
  const saveCurrentStep = useCallback((step: number) => {
    if (userId) {
      localStorage.setItem(`client_onboarding_step_${userId}`, step.toString());
    }
  }, [userId]);

  // Check profile completion status
  const checkProfileCompletion = useCallback(async () => {
    if (!userId) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("profile_image_url, cover_image_url")
      .eq("id", userId)
      .single();

    const completion: ClientProfileCompletion = {
      hasProfilePhoto: !!profile?.profile_image_url,
      hasCoverPhoto: !!profile?.cover_image_url,
    };

    setProfileCompletion(completion);
    return completion;
  }, [userId]);

  // Build the steps list based on completion
  const calculateSteps = useCallback(() => {
    const wasCompleted = localStorage.getItem(`client_onboarding_completed_${userId}`);
    
    if (wasCompleted) {
      return [];
    }
    
    localStorage.setItem(`client_onboarding_started_${userId}`, "true");
    return ONBOARDING_STEPS;
  }, [userId]);

  // Initialize
  useEffect(() => {
    const init = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      await checkProfileCompletion();
      const stepsToShow = calculateSteps();
      setSteps(stepsToShow);
      
      // Restore saved step
      const savedStep = getSavedStep();
      if (savedStep > 0 && savedStep < stepsToShow.length) {
        setCurrentStep(savedStep);
      }
      
      setIsOnboardingActive(stepsToShow.length > 0);
      setIsLoading(false);
    };

    init();
  }, [userId, checkProfileCompletion, calculateSteps, getSavedStep]);

  // Refresh completion status and auto-advance if needed
  const refreshCompletion = useCallback(async () => {
    const completion = await checkProfileCompletion();
    if (completion) {
      setProfileCompletion(completion);
      
      // Auto-advance if current required step is now complete
      const currentStepData = steps[currentStep];
      if (currentStepData?.required && currentStepData?.checkField) {
        const isNowComplete = completion[currentStepData.checkField as keyof ClientProfileCompletion];
        if (isNowComplete) {
          // Auto advance to next step
          const nextStepIndex = currentStep + 1;
          if (nextStepIndex < steps.length) {
            setCurrentStep(nextStepIndex);
            saveCurrentStep(nextStepIndex);
          }
        }
      }
    }
  }, [checkProfileCompletion, currentStep, steps, saveCurrentStep]);

  // Check if current step can proceed
  const canProceed = useCallback(() => {
    const currentStepData = steps[currentStep];
    if (!currentStepData) return true;
    
    if (currentStepData.required && currentStepData.checkField && profileCompletion) {
      return profileCompletion[currentStepData.checkField as keyof ClientProfileCompletion];
    }
    
    return true;
  }, [currentStep, steps, profileCompletion]);

  const nextStep = useCallback(() => {
    if (!canProceed()) {
      return false;
    }
    
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      saveCurrentStep(next);
      return true;
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
    if (userId) {
      localStorage.setItem(`client_onboarding_completed_${userId}`, "true");
      localStorage.removeItem(`client_onboarding_step_${userId}`);
    }
    setIsOnboardingActive(false);
  }, [userId]);

  const skipCurrentStep = useCallback(() => {
    const currentStepData = steps[currentStep];
    // Cannot skip required steps
    if (currentStepData?.required && !canProceed()) {
      return false;
    }
    
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      saveCurrentStep(next);
    } else {
      completeOnboarding();
    }
    return true;
  }, [currentStep, steps, completeOnboarding, canProceed, saveCurrentStep]);

  const getCurrentStep = (): ClientOnboardingStep | null => {
    return steps[currentStep] || null;
  };

  const getProgress = (): number => {
    if (steps.length === 0) return 100;
    return ((currentStep + 1) / steps.length) * 100;
  };

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
