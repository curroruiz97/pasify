import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProfileCompletionState {
  loading: boolean;
  hasProfile: boolean;
  hasRole: boolean;
  isComplete: boolean;
  role: "client" | "partner" | "admin" | null;
  profile: {
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    business_category: string | null;
    account_status: string | null;
  } | null;
  refetch: () => Promise<void>;
}

/**
 * Verifica se il profilo dell'utente è "completo" ovvero ha:
 *   - un user_role ('client' | 'partner' | 'admin')
 *   - i campi minimi compilati (first_name+last_name per client, business_name per partner)
 *
 * Tipico uso: dopo signup Google OAuth, l'utente ha auth.users ma non ha
 * ancora ruolo e dati profilo. Il gate redirige a /complete-profile.
 */
export const useProfileCompletion = (userId?: string): ProfileCompletionState => {
  const [state, setState] = useState<Omit<ProfileCompletionState, "refetch">>({
    loading: true,
    hasProfile: false,
    hasRole: false,
    isComplete: false,
    role: null,
    profile: null,
  });

  const load = async () => {
    if (!userId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    const [{ data: profile }, { data: roleRow }] = await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name, business_name, business_category, account_status")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const role = (roleRow?.role as "client" | "partner" | "admin" | undefined) ?? null;
    const hasRole = Boolean(role);

    // Determina completezza in base al ruolo
    let isComplete = false;
    if (role === "admin") {
      isComplete = true;
    } else if (role === "partner") {
      isComplete = Boolean(profile?.business_name);
    } else if (role === "client") {
      isComplete = Boolean(profile?.first_name) && Boolean(profile?.last_name);
    }

    setState({
      loading: false,
      hasProfile: Boolean(profile),
      hasRole,
      isComplete,
      role,
      profile: profile ?? null,
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { ...state, refetch: load };
};
