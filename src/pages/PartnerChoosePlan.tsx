import { Navigate } from "react-router-dom";

/**
 * /partner/choose-plan: lleva al panel.
 *
 * Pasify ya no tiene planes de pago para locales (se retiró Premium y la
 * prueba gratuita). PartnerGate ya no manda aquí: si a la organización le
 * falta el plan, llama él a `claim_partner_free_plan` y entra al panel. La
 * ruta se conserva por enlaces guardados y versiones antiguas de la app.
 */
const PartnerChoosePlan = () => <Navigate to="/partner-dashboard" replace />;

export default PartnerChoosePlan;
