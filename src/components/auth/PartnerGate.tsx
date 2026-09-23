import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { signOutLocal } from "@/hooks/useAuth";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage } from "@/lib/sentry";
import LoaderOne from "@/components/ui/loader-one";
import AuthErrorScreen from "@/components/auth/AuthErrorScreen";

const CLAIM_TIMEOUT_MS = 10_000;

type EstadoReclamo = "pendiente" | "reclamando" | "hecho" | "fallido";

/**
 * Pasify · PartnerGate.
 *
 * Gate de acceso al panel de local. Todos los locales tienen plan gratuito
 * (se retiraron Premium y la prueba gratuita), así que el gate ya no vende
 * nada: se asegura de que la organización tenga una suscripción activa y,
 * si no la tiene, la crea.
 *
 * Comportamiento:
 *   - primera carga → loader.
 *   - acceso (active / trial vigente / grant de admin) → children.
 *   - sin organización o sin suscripción activa (incluye past_due, cancelled,
 *     trial caducado… heredados) → llama UNA vez a
 *     `rpc('claim_partner_free_plan')` (crea la org si falta; idempotente) y
 *     continúa. Solo si falla → pantalla de error con "Reintentar".
 *   - no se pudo comprobar (red, timeout) → "Reintentar". Un fallo de red
 *     NO es "sin plan": nunca dispara el claim.
 *   - NUNCA redirige a /partner/choose-plan ni muestra precios.
 *
 * Una vez concedido el acceso, los children siguen montados durante
 * cualquier refresco (antes un refresco con loading=true desmontaba el panel
 * y se perdía el asistente de evento a medias o el escáner).
 */
export const PartnerGate = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const { loading, error, hasAccess, orgId, refetch } = usePartnerSubscription();

  const [concedido, setConcedido] = useState(false);
  const [reclamo, setReclamo] = useState<{ estado: EstadoReclamo; error: string | null }>({
    estado: "pendiente",
    error: null,
  });
  const autoReclamoHechoRef = useRef(false);

  const accesoAhora = !loading && !error && hasAccess;
  const sinAcceso = !loading && !error && !hasAccess;

  useEffect(() => {
    if (accesoAhora) setConcedido(true);
  }, [accesoAhora]);

  const reclamarPlanGratuito = useCallback(async () => {
    setReclamo({ estado: "reclamando", error: null });
    try {
      const { error: rpcError } = await withTimeout(
        Promise.resolve(supabase.rpc("claim_partner_free_plan")),
        CLAIM_TIMEOUT_MS,
        "rpc claim_partner_free_plan",
      );
      if (rpcError) throw rpcError;
      // La RPC puede haber creado la organización: recargamos tenant +
      // suscripción. Qué se pinta después lo decide el estado del hook.
      await refetch();
      setReclamo({ estado: "hecho", error: null });
    } catch (err) {
      console.error("[PartnerGate] claim_partner_free_plan:", err);
      captureError(err, { where: "PartnerGate.claim_partner_free_plan", orgId });
      setReclamo({ estado: "fallido", error: getErrorMessage(err) });
    }
  }, [refetch, orgId]);

  // Sin acceso y sin error → activamos el plan gratuito automáticamente, UNA vez.
  useEffect(() => {
    if (!sinAcceso || concedido || autoReclamoHechoRef.current) return;
    autoReclamoHechoRef.current = true;
    void reclamarPlanGratuito();
  }, [sinAcceso, concedido, reclamarPlanGratuito]);

  const cerrarSesion = useCallback(async () => {
    await signOutLocal();
    navigate("/login", { replace: true });
  }, [navigate]);

  if (concedido || accesoAhora) {
    return <>{children}</>;
  }

  if (reclamo.estado === "reclamando") {
    return <LoaderOne />;
  }

  if (reclamo.estado === "fallido") {
    return (
      <AuthErrorScreen
        title="No pudimos preparar tu cuenta de local"
        description="Ha fallado la activación de tu plan gratuito. Vuelve a intentarlo; si sigue fallando, escríbenos a soporte."
        detail={reclamo.error}
        onRetry={reclamarPlanGratuito}
        onSignOut={cerrarSesion}
      />
    );
  }

  if (loading) {
    return <LoaderOne />;
  }

  if (error) {
    return (
      <AuthErrorScreen
        title="No pudimos comprobar tu cuenta"
        description="Parece un problema de conexión. Comprueba que tienes internet y vuelve a intentarlo."
        detail={error}
        onRetry={refetch}
        onSignOut={cerrarSesion}
      />
    );
  }

  if (reclamo.estado === "hecho") {
    // El claim respondió bien pero la suscripción sigue sin dar acceso.
    return (
      <AuthErrorScreen
        title="No pudimos preparar tu cuenta de local"
        description="Tu plan gratuito se ha activado, pero no hemos podido confirmarlo. Vuelve a intentarlo en unos segundos."
        onRetry={reclamarPlanGratuito}
        onSignOut={cerrarSesion}
      />
    );
  }

  // Sin acceso y reclamo aún no lanzado: el efecto de arriba lo lanza ya.
  return <LoaderOne />;
};

export default PartnerGate;
