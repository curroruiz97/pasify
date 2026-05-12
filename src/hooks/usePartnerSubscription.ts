import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PartnerSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export interface PartnerSubscriptionState {
  loading: boolean;
  hasRecord: boolean;
  status: PartnerSubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  grantedByAdmin: boolean;
  adminGrantedUntil: Date | null;
  /**
   * true se il partner può accedere alla dashboard:
   *   - override admin attivo (illimitato o non scaduto)
   *   - status 'active'
   *   - status 'trialing' e trial_ends_at futuro
   */
  hasAccess: boolean;
  /** Giorni residui (arrotondati per eccesso). null se non rilevante. */
  daysLeft: number | null;
  isTrial: boolean;
  isAdminGranted: boolean;
  refetch: () => Promise<void>;
}

const defaultState: Omit<PartnerSubscriptionState, "refetch"> = {
  loading: true,
  hasRecord: false,
  status: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  grantedByAdmin: false,
  adminGrantedUntil: null,
  hasAccess: false,
  daysLeft: null,
  isTrial: false,
  isAdminGranted: false,
};

export const usePartnerSubscription = (userId?: string): PartnerSubscriptionState => {
  const [state, setState] = useState<Omit<PartnerSubscriptionState, "refetch">>(defaultState);
  // Ultimo userId per cui abbiamo completato il fetch. Finché non coincide
  // con l'userId corrente, consideriamo loading=true per evitare che il gate
  // legga dati "vecchi" durante i cambi utente.
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);

  const load = async () => {
    if (!userId) {
      setState({ ...defaultState, loading: false });
      setFetchedFor(null);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await supabase
      .from("partner_subscriptions")
      .select("status, trial_ends_at, current_period_end, granted_by_admin, admin_granted_until")
      .eq("partner_id", userId)
      .maybeSingle();

    if (error) {
      console.error("usePartnerSubscription error:", error);
      setState({ ...defaultState, loading: false });
      setFetchedFor(userId);
      return;
    }

    if (!data) {
      setState({ ...defaultState, loading: false });
      setFetchedFor(userId);
      return;
    }

    const status = data.status as PartnerSubscriptionStatus;
    const trialEndsAt = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
    const currentPeriodEnd = data.current_period_end ? new Date(data.current_period_end) : null;
    const grantedByAdmin = Boolean((data as any).granted_by_admin);
    const adminGrantedUntil = (data as any).admin_granted_until
      ? new Date((data as any).admin_granted_until)
      : null;
    const now = Date.now();

    let hasAccess = false;
    let daysLeft: number | null = null;
    let isTrial = false;
    let isAdminGranted = false;

    // Override admin: priorità massima
    if (grantedByAdmin) {
      if (!adminGrantedUntil || adminGrantedUntil.getTime() > now) {
        hasAccess = true;
        isAdminGranted = true;
        if (adminGrantedUntil) {
          daysLeft = Math.ceil((adminGrantedUntil.getTime() - now) / (1000 * 60 * 60 * 24));
        }
      }
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
    }

    setState({
      loading: false,
      hasRecord: true,
      status,
      trialEndsAt,
      currentPeriodEnd,
      grantedByAdmin,
      adminGrantedUntil,
      hasAccess,
      daysLeft,
      isTrial,
      isAdminGranted,
    });
    setFetchedFor(userId);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Se l'userId corrente non coincide con quello per cui abbiamo fetchato,
  // lo stato è "stale" — forziamo loading=true per evitare redirect errati.
  const isStale = Boolean(userId) && fetchedFor !== userId;

  return {
    ...state,
    loading: state.loading || isStale,
    refetch: load,
  };
};
