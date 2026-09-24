import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { withTimeout } from "@/lib/withTimeout";
import { captureError, getErrorMessage } from "@/lib/sentry";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";

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
 *
 * Caché: la fila vive en qk.partner.subscription (compartida y guardada en el
 * dispositivo). Se guarda la fila tal cual; `hasAccess` y los días se
 * calculan al leer, con la hora actual.
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

async function leerSuscripcion(orgId: string): Promise<SubscriptionRow | null> {
  try {
    const { data, error } = await withTimeout(
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
    if (error) throw error;
    return (data as SubscriptionRow | null) ?? null;
  } catch (e) {
    console.error("usePartnerSubscription error:", e);
    captureError(e, { where: "usePartnerSubscription.load", orgId });
    throw e;
  }
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

  const uid = useCurrentUserId();
  const queryClient = useQueryClient();
  const {
    tenant,
    loading: tenantLoading,
    refreshing: tenantRefreshing,
    error: tenantError,
    refetch: refetchTenant,
  } = useOrganization();
  const resolvedOrgId = explicitOrgId ?? tenant?.org_id ?? null;

  // Sin org explícita hay que esperar a que se resuelva el tenant (con org
  // explícita, lo que haga el tenant no importa y no debe relanzar la lectura).
  const esperandoTenant = !explicitOrgId && tenantLoading;

  const query = useQuery({
    queryKey: qk.partner.subscription(uid ?? "", resolvedOrgId),
    queryFn: () => leerSuscripcion(resolvedOrgId as string),
    enabled: !!resolvedOrgId && !esperandoTenant,
    staleTime: 2 * 60_000,
  });

  const refetch = useCallback(async () => {
    let orgId: string | null = explicitOrgId ?? null;
    if (!explicitOrgId) {
      // Puede que la org acabe de crearse (claim_partner_free_plan).
      const t = await refetchTenant();
      orgId = t?.org_id ?? null;
    }
    if (!orgId) return;
    const id = orgId;
    await queryClient
      .fetchQuery({
        queryKey: qk.partner.subscription(uid ?? "", id),
        queryFn: () => leerSuscripcion(id),
        staleTime: 0,
      })
      .catch(() => undefined); // el error queda en la consulta
  }, [explicitOrgId, refetchTenant, queryClient, uid]);

  // Sin organización es un dato (no un fallo): quien use el hook decide qué
  // hacer (PartnerGate activa el plan gratuito, que crea la org).
  const fila = query.data;
  const datosActuales = useMemo<Datos | null>(() => {
    if (esperandoTenant) return null;
    if (!resolvedOrgId) return datosVacios(null);
    if (fila === undefined) return null;
    return fila ? calcularDatos(resolvedOrgId, fila) : datosVacios(resolvedOrgId);
  }, [esperandoTenant, resolvedOrgId, fila]);

  // Reintento sin datos todavía: loader, nunca un "sin acceso" que dispararía
  // el alta del plan gratuito.
  const reintentando = !!resolvedOrgId && fila === undefined && query.isFetching;
  const errorSuscripcion =
    resolvedOrgId && query.error && !reintentando ? getErrorMessage(query.error) : null;
  // Sin org explícita, si no se pudo resolver el tenant es un error (no "sin org").
  const tenantReintentando = !explicitOrgId && !tenant && tenantRefreshing;
  const errorTenant =
    !explicitOrgId && !tenant && !tenantLoading && !tenantReintentando ? tenantError : null;
  const errorExpuesto = errorSuscripcion ?? errorTenant ?? null;
  const loading =
    esperandoTenant || tenantReintentando || reintentando || (datosActuales === null && errorExpuesto === null);

  return {
    ...(datosActuales ?? datosVacios(resolvedOrgId)),
    loading,
    error: errorExpuesto,
    refetch,
  };
};
