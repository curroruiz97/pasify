import { Navigate, useLocation } from "react-router-dom";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import LoaderOne from "@/components/ui/loader-one";

/**
 * Pasify · PartnerGate (reactivado en Fase 3).
 *
 * Gate de acceso al partner dashboard. Lee `partner_subscriptions` vía
 * `usePartnerSubscription` que ahora resuelve correctamente por `org_id`
 * (Fase 3). Bloquea el dashboard si el partner no tiene:
 *   - trial vigente
 *   - suscripción active / cancel_at_period_end con periodo aún válido
 *   - admin grant temporal vigente
 *
 * Comportamiento:
 *   - loading → spinner
 *   - no record OR no hasAccess → redirect a /partner/choose-plan
 *   - hasAccess → renderiza children
 *
 * NOTA: el banner de trial (días restantes) se renderiza dentro del
 * partner dashboard mismo, no aquí. Este gate sólo decide acceso.
 */
export const PartnerGate = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { loading, hasRecord, hasAccess, orgId } = usePartnerSubscription();

  if (loading) {
    return <LoaderOne />;
  }

  // Si todavía no hay org resuelta (RegisterPartner se quedó a medias por
  // un fallo), no tenemos a dónde mandarlo con sentido — fallback a
  // choose-plan para que reciba feedback claro.
  if (!orgId) {
    return <Navigate to="/partner/choose-plan" replace state={{ from: location.pathname }} />;
  }

  if (!hasRecord || !hasAccess) {
    return <Navigate to="/partner/choose-plan" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default PartnerGate;
