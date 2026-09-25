import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useFavoritePartners · backend-backed (partner_favorites).
 * RLS asegura que cada user solo ve los suyos.
 *
 * SIN USO desde la Ola 1 del cliente (B2-03): el corazón de los locales está
 * oculto. `toggle` recibe el id del PERFIL del local (el de public_partners)
 * y lo guarda en partner_favorites.org_id, que es una FK a organizations:
 * el INSERT falla siempre con 23503, el error se ignoraba y el corazón no
 * cambiaba. Además cada tarjeta montaba el hook: una consulta por tarjeta.
 * Arreglo completo en la Ola 2: resolver la organización del local y pasar a
 * una sola consulta de React Query (qk.me) con cambio optimista.
 */
export const useFavoritePartners = () => {
  const [partnerIds, setPartnerIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchAll = useCallback(async (uid: string) => {
    setLoading(true);
    const { data } = await supabase.from("partner_favorites").select("org_id").eq("user_id", uid);
    setPartnerIds(new Set((data ?? []).map((r) => r.org_id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUserId(data.user.id);
        await fetchAll(data.user.id);
      } else setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => {
      const uid = s?.user?.id ?? null;
      setUserId(uid);
      if (uid) fetchAll(uid);
      else setPartnerIds(new Set());
    });
    return () => sub.subscription.unsubscribe();
  }, [fetchAll]);

  const toggle = useCallback(async (orgId: string) => {
    if (!userId) return false;
    if (partnerIds.has(orgId)) {
      await supabase.from("partner_favorites").delete().eq("user_id", userId).eq("org_id", orgId);
    } else {
      await supabase.from("partner_favorites").insert({ user_id: userId, org_id: orgId });
    }
    await fetchAll(userId);
    return !partnerIds.has(orgId);
  }, [partnerIds, userId, fetchAll]);

  const isFav = (id: string) => partnerIds.has(id);
  return {
    partnerIds,
    loading,
    toggle,
    isFav,
    // Alias legacy (ClientDashboard usaba { isFavorite, toggle })
    isFavorite: isFav,
  };
};
