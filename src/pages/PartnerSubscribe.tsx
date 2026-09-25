import { Navigate } from "react-router-dom";

/**
 * Rutas del antiguo plan de pago de locales (/partner/subscribe,
 * /partner/manage, /partner/success y /partner/cancel): llevan al panel.
 *
 * Premium y la prueba gratuita se retiraron: todos los locales tienen el plan
 * gratuito (PartnerGate lo activa si hace falta) y Pasify cobra una comisión
 * por entrada vendida. Las rutas se conservan porque hay enlaces guardados,
 * correos antiguos y retornos de Stripe que apuntan a ellas; ya no enseñan
 * nada propio.
 */
const PartnerSubscribe = () => <Navigate to="/partner-dashboard" replace />;

export default PartnerSubscribe;
