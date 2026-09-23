import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage } from "@/lib/sentry";

/**
 * Pasify · usePartnerSubscription (post Fase 3 hardening).
 *
 * La tabla `partner_subscriptions` está vinculada a `org_id` (UNIQUE),
 * no a `profiles.id`. Migración 0034 añade `admin_granted_until` y
 * `admin_granted_by` para que admin pueda conceder acceso temporal
 * fuera del flujo Stripe (trial extendido, gestión enterprise).
 *
 * El hook resuelve el `org_id` desde `useOrganization()` si no se
 * pasa explícitamente. Esto permite usarlo dentro del partner panel
 * sin tener que enchufar manualmente la org en cada consumer.
 *
 * `hasAccess` = active OR (trialing & trial vigente) OR (admin grant vigente).
 *
 * Fase 0 (estabilidad del panel):
 *  - Distingue "no se pudo comprobar" (`error`: red, timeout, RLS…) de "no
 *    tiene suscripción" (`hasRecord=false` sin error). Antes un fallo de red
 *    se leía como "sin plan".
 *  - `loading` solo en la primera carga de cada org; un refresco no vuelve a
 *    `loading` y si falla conserva los datos previos.
 *  - Este hook NO decide redirecciones: eso es cosa de quien lo usa
 *    (PartnerGate).
 */

export type PartnerSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "cancel_at_period_end"
  | "cancelled"
  | "paused"
  | "incomplete"
  | "incomplete_expired";

export interface PartnerSubscriptionState {
  loading: boolean;
  /**
   * No se pudo comprobar la suscripción (o resolver la organización): red,
   * timeout, RLS… NO significa "sin suscripción" — para eso está
   * `hasRecord=false` con `error=null`. Ofrecer "Reintentar".
   */
  error: string | null;
  hasRecord: boolean;
  orgId: string | null;
  subscriptionId: string | null;
  planCode: string | null;
  status: PartnerSubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  adminGrantedUntil: Date | null;
  /**
   * true si el partner puede acceder a la dashboard:
   *   - status 'active'
   *   - status 'trialing' y trial_ends_at futuro
   *   - admin grant vigente (admin_granted_until > now()).
   *     `admin_granted_until = null` significa "sin grant" (NO ilimitado).
   *     Si en el futuro queremos grants permanentes, añadir una columna
   *     explícita `admin_granted_indefinite BOOLEAN` y combinarla aquí.
   */
  hasAccess: boolean;
  /** Días residuales (techo). null si no aplica. */
  daysLeft: number | null;
  isTrial: boolean;
  isAdminGranted: boolean;
  /** Recarga organización (si no es explícita) + suscripción. */
  refetch: () => Promise<void>;
}

type Datos = Omit<PartnerSubscriptionState, "loading" | "error" | "refetch">;

const SUBSCRIPTION_TIMEOUT_MS = 10_000;

const datosVacios = (orgId: string | null): Datos => ({
  hasRecord: false,
  orgId,
  subscriptionId: null,
  planCode: null,
  status: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  adminGrantedUntil: null,
  hasAccess: false,
  daysLeft: null,
  isTrial: false,
  isAdminGranted: false,
});

interface SubscriptionRow {
  id: string;
  plan_code: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  admin_granted_until: string | null;
}

const calcularDatos = (orgId: string, data: SubscriptionRow): Datos => {
  const status = data.status as PartnerSubscriptionStatus;
  const trialEndsAt = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
  const currentPeriodEnd = data.current_period_end ? new Date(data.current_period_end) : null;
  const adminGrantedUntil = data.admin_granted_until ? new Date(data.admin_granted_until) : null;
  const cancelAtPeriodEnd = Boolean(data.cancel_at_period_end);
  const now = Date.now();

  let hasAccess = false;
  let daysLeft: number | null = null;
  let isTrial = false;
  let isAdminGranted = false;

  // Override admin: prioridad máxima.
  if (adminGrantedUntil && adminGrantedUntil.getTime() > now) {
    hasAccess = true;
    isAdminGranted = true;
    daysLeft = Math.ceil((adminGrantedUntil.getTime() - now) / (1000 * 60 * 60 * 24));
  } else if (status === "active") {
    hasAccess = true;
    if (currentPeriodEnd) {
      daysLeft = Math.ceil((currentPeriodEnd.getTime() - now) / (1000 * 60 * 60 * 24));
    }
  } else if (status === "trialing") {
    const endMs = trialEndsAt?.getTime() ?? 0;
    if (endMs > now) {
      hasAccess = true;
      isTrial = true;
      daysLeft = Math.ceil((endMs - now) / (1000 * 60 * 60 * 24));
    }
  } else if (status === "cancel_at_period_end") {
    // Sigue activo hasta `current_period_end`.
    if (currentPeriodEnd && currentPeriodEnd.getTime() > now) {
      hasAccess = true;
      daysLeft = Math.ceil((currentPeriodEnd.getTime() - now) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    hasRecord: true,
    orgId,
    subscriptionId: data.id,
    planCode: data.plan_code ?? null,
    status,
    trialEndsAt,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    adminGrantedUntil,
    hasAccess,
    daysLeft,
    isTrial,
    isAdminGranted,
  };
};

interface UseOpts {
  /** Forzar org concreta (admin viewing partner ajeno). Default: tenant del caller. */
  orgId?: string;
}

export const usePartnerSubscription = (
  userIdOrOpts?: string | UseOpts,
): PartnerSubscriptionState => {
  // Compat: aceptamos string (legacy: userId) o UseOpts. El userId legacy
  // se ignora porque la tabla está por org_id; en su lugar resolvemos
  // desde useOrganization. Si se pasa explícitamente `orgId`, lo usamos.
  const explicitOrgId =
    typeof userIdOrOpts === "object" && userIdOrOpts !== null
      ? userIdOrOpts.orgId
      : undefined;

  const {
    tenant,
    loading: tenantLoading,
    error: tenantError,
    refetch: refetchTenant,
  } = useOrganization();
  const resolvedOrgId = explicitOrgId ?? tenant?.org_id ?? null;

  // `datos` = última lectura buena y de qué org es (null = nada leído aún).
  const [datos, setDatos] = useState<Datos | null>(null);
  // Último fallo de lectura y de qué org (solo se expone si es la actual).
  const [fallo, setFallo] = useState<{ orgId: string; message: string } | null>(null);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const enCursoRef = useRef<{ orgId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Lee la suscripción de `orgId`. Con `reutilizar`, si ya hay una lectura
   * de esa misma org en curso se espera a esa en vez de lanzar otra (evita
   * que el efecto pise la lectura que acaba de lanzar `refetch`).
   */
  const load = useCallback((orgId: string | null, reutilizar: boolean): Promise<void> => {
    if (reutilizar && orgId && enCursoRef.current?.orgId === orgId) {
      return enCursoRef.current.promise;
    }

    const seq = ++seqRef.current;

    if (!orgId) {
      // Sin organización: es un dato (no un fallo). Quien use el hook decide
      // qué hacer (PartnerGate activa el plan gratuito, que crea la org).
      enCursoRef.current = null;
      setDatos(datosVacios(null));
      setFallo(null);
      return Promise.resolve();
    }

    const carga = { orgId, promise: Promise.resolve() };
    carga.promise = (async () => {
      try {
        const { data, error: queryError } = await withTimeout(
          Promise.resolve(
            supabase
              .from("partner_subscriptions")
              .select(
                "id, plan_code, status, trial_ends_at, current_period_end, cancel_at_period_end, admin_granted_until",
              )
              .eq("org_id", orgId)
              .maybeSingle(),
          ),
          SUBSCRIPTION_TIMEOUT_MS,
          "partner_subscriptions",
        );
        if (queryError) throw queryError;
        if (!mountedRef.current || seq !== seqRef.current) return;
        setDatos(data ? calcularDatos(orgId, data as SubscriptionRow) : datosVacios(orgId));
        setFallo(null);
      } catch (e) {
        if (!mountedRef.current || seq !== seqRef.current) return;
        console.error("usePartnerSubscription error:", e);
        // Los datos previos (si los hay) se conservan: un fallo de red no es
        // "sin suscripción".
        setFallo({ orgId, message: getErrorMessage(e) });
        captureError(e, { where: "usePartnerSubscription.load", orgId });
      } finally {
        if (enCursoRef.current === carga) enCursoRef.current = null;
      }
    })();
    enCursoRef.current = carga;
    return carga.promise;
  }, []);

  // Sin org explícita hay que esperar a que se resuelva el tenant (con org
  // explícita, lo que haga el tenant no importa y no debe relanzar la lectura).
  const esperandoTenant = !explicitOrgId && tenantLoading;

  useEffect(() => {
    if (esperandoTenant) return;
    void load(resolvedOrgId, true);
  }, [resolvedOrgId, esperandoTenant, load]);

  const refetch = useCallback(async () => {
    // Fuera el error mientras se reintenta: la pantalla pasa a loader.
    setFallo(null);
    let orgId: string | null = explicitOrgId ?? null;
    if (!explicitOrgId) {
      // Puede que la org acabe de crearse (claim_partner_free_plan).
      const t = await refetchTenant();
      orgId = t?.org_id ?? null;
    }
    await load(orgId, false);
  }, [explicitOrgId, refetchTenant, load]);

  // ¿Los datos son de la org actual? Si no, no se exponen (serían de otra org).
  const datosActuales = datos !== null && datos.orgId === resolvedOrgId ? datos : null;
  const errorSuscripcion = fallo !== null && fallo.orgId === resolvedOrgId ? fallo.message : null;
  // Sin org explícita, si no se pudo resolver el tenant es un error (no "sin org").
  const errorTenant = !explicitOrgId && !tenant && !tenantLoading ? tenantError : null;
  const errorExpuesto = errorSuscripcion ?? errorTenant ?? null;
  const loading = esperandoTenant || (datosActuales === null && errorExpuesto === null);

  return {
    ...(datosActuales ?? datosVacios(resolvedOrgId)),
    loading,
    error: errorExpuesto,
    refetch,
  };
};
