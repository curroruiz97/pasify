import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

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
   *   - admin grant vigente (admin_granted_until > now() o null = ilimitado)
   */
  hasAccess: boolean;
  /** Días residuales (techo). null si no aplica. */
  daysLeft: number | null;
  isTrial: boolean;
  isAdminGranted: boolean;
  refetch: () => Promise<void>;
}

const defaultState: Omit<PartnerSubscriptionState, "refetch"> = {
  loading: true,
  hasRecord: false,
  orgId: null,
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

  const { tenant, loading: tenantLoading } = useOrganization();
  const resolvedOrgId = explicitOrgId ?? tenant?.org_id ?? null;

  const [state, setState] = useState<Omit<PartnerSubscriptionState, "refetch">>(defaultState);

  const load = async () => {
    if (!resolvedOrgId) {
      setState({ ...defaultState, loading: tenantLoading });
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    const { data, error } = await supabase
      .from("partner_subscriptions")
      .select(
        "id, plan_code, status, trial_ends_at, current_period_end, cancel_at_period_end, admin_granted_until",
      )
      .eq("org_id", resolvedOrgId)
      .maybeSingle();

    if (error) {
      console.error("usePartnerSubscription error:", error);
      setState({ ...defaultState, loading: false, orgId: resolvedOrgId });
      return;
    }

    if (!data) {
      setState({ ...defaultState, loading: false, orgId: resolvedOrgId });
      return;
    }

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

    setState({
      loading: false,
      hasRecord: true,
      orgId: resolvedOrgId,
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
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedOrgId, tenantLoading]);

  return {
    ...state,
    loading: state.loading || (tenantLoading && !explicitOrgId),
    refetch: load,
  };
};
