import { Navigate } from "react-router-dom";

/**
 * /partner/onboarding: lleva al panel.
 *
 * Era el alta antigua (de otra app: hablaba de "estudiantes", con el tema
 * claro y textos en italiano) y su "Crear evento" escribía columnas que no
 * existen y aun así decía "¡Listo!". El alta del local es el asistente del
 * panel (PartnerOnboardingWizard), que se abre desde la lista de primeros
 * pasos, Configuración o Ayuda. La ruta se conserva por enlaces guardados.
 */
const PartnerOnboarding = () => <Navigate to="/partner-dashboard" replace />;

export default PartnerOnboarding;
