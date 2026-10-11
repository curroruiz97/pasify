import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePartnerSubscription } from "@/hooks/usePartnerSubscription";
import { signOutLocal } from "@/hooks/useAuth";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage } from "@/lib/sentry";
import LoaderOne from "@/components/ui/loader-one";
import AuthErrorScreen from "@/components/auth/AuthErrorScreen";
import { SUPPORT_EMAIL } from "@/components/auth/authErrors";
import { esOrganizacionCerrada, prepararCuentaDeLocal } from "@/components/auth/alta";

const CLAIM_TIMEOUT_MS = 10_000;

type EstadoReclamo = "pendiente" | "reclamando" | "hecho" | "fallido" | "cerrada";

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
 *     `rpc('complete_partner_signup')` (crea la org si falta, con los datos
 *     del negocio del alta, y el plan; idempotente) y continúa. Es lo que
 *     termina un alta de local hecha con «Confirm email», que no tuvo sesión
 *     para crearlos. Solo si falla → pantalla de error con "Reintentar".
 *   - plan en pausa (`paused`) → NO se llama: lo decide Pasify y el servidor
 *     tampoco lo pisa. Pantalla para escribir a soporte (y volver a comprobar).
 *   - organización cerrada (el servidor contesta 55000 `org_closed`) → pantalla
 *     «cuenta cerrada» para escribir a soporte, sin "Reintentar": no se arregla
 *     reintentando.
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
  const { loading, error, hasAccess, orgId, status, refetch } = usePartnerSubscription();

  const [concedido, setConcedido] = useState(false);
  const [reclamo, setReclamo] = useState<{ estado: EstadoReclamo; error: string | null }>({
    estado: "pendiente",
    error: null,
  });
  const autoReclamoHechoRef = useRef(false);

  const accesoAhora = !loading && !error && hasAccess;
  const sinAcceso = !loading && !error && !hasAccess;
  // Un plan en pausa no se reactiva solo (claim_partner_free_plan tampoco lo pisa).
  const enPausa = sinAcceso && status === "paused";

  useEffect(() => {
    if (accesoAhora) setConcedido(true);
  }, [accesoAhora]);

  const reclamarPlanGratuito = useCallback(async () => {
    setReclamo({ estado: "reclamando", error: null });
    try {
      // Con un servidor anterior a la Ola 3, prepararCuentaDeLocal llama a
      // claim_partner_free_plan como antes.
      const rpcError = await withTimeout(prepararCuentaDeLocal(), CLAIM_TIMEOUT_MS, "rpc complete_partner_signup");
      if (rpcError) throw rpcError;
      // La RPC puede haber creado la organización: recargamos tenant +
      // suscripción. Qué se pinta después lo decide el estado del hook.
      await refetch();
      setReclamo({ estado: "hecho", error: null });
    } catch (err) {
      if (esOrganizacionCerrada(err as { code?: string; message?: string })) {
        // Un estado de la cuenta, no un fallo: no va a Sentry ni se puede reintentar.
        setReclamo({ estado: "cerrada", error: null });
        return;
      }
      console.error("[PartnerGate] complete_partner_signup:", err);
      captureError(err, { where: "PartnerGate.complete_partner_signup", orgId });
      setReclamo({ estado: "fallido", error: getErrorMessage(err) });
    }
  }, [refetch, orgId]);

  // Sin acceso y sin error → activamos el plan gratuito automáticamente, UNA vez
  // (salvo un plan en pausa).
  useEffect(() => {
    if (!sinAcceso || enPausa || concedido || autoReclamoHechoRef.current) return;
    autoReclamoHechoRef.current = true;
    void reclamarPlanGratuito();
  }, [sinAcceso, enPausa, concedido, reclamarPlanGratuito]);

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

  if (reclamo.estado === "cerrada") {
    return (
      <AuthErrorScreen
        title="Esta cuenta de local está cerrada"
        description="La cuenta de este local está cerrada y no se puede usar. Si crees que es un error, escríbenos y lo revisamos."
        contactEmail={SUPPORT_EMAIL}
        onSignOut={cerrarSesion}
      />
    );
  }

  if (enPausa) {
    return (
      <AuthErrorScreen
        title="Tu plan está en pausa"
        description="De momento no puedes entrar al panel de tu local porque su plan está en pausa. Escríbenos y lo revisamos."
        contactEmail={SUPPORT_EMAIL}
        onRetry={refetch}
        onSignOut={cerrarSesion}
      />
    );
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
    // La llamada respondió bien pero la suscripción sigue sin dar acceso: el
    // servidor no dice que el plan esté activo, así que tampoco lo decimos aquí.
    return (
      <AuthErrorScreen
        title="No pudimos preparar tu cuenta de local"
        description="No hemos podido confirmar tu plan gratuito. Vuelve a intentarlo en unos segundos; si sigue igual, escríbenos a soporte."
        contactEmail={SUPPORT_EMAIL}
        onRetry={reclamarPlanGratuito}
        onSignOut={cerrarSesion}
      />
    );
  }

  // Sin acceso y reclamo aún no lanzado: el efecto de arriba lo lanza ya.
  return <LoaderOne />;
};

export default PartnerGate;
