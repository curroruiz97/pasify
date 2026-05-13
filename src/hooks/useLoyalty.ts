import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pasify · useLoyalty
 *
 * Backend-backed con tres fuentes:
 *  - `loyalty_balance(_user_id)` RPC → balance actual (todas las
 *    transacciones no expiradas). Migración 0021.
 *  - `loyalty_points` tabla → historial (últimas 50 filas RLS-permitidas).
 *  - `loyalty_levels` tabla → catálogo bronze/silver/gold/platinum
 *    sembrado en mig 0021.
 *
 * Nota: el catálogo del DB usa 4 niveles (bronze/silver/gold/platinum).
 * El UI legacy de ClientLoyalty usaba 5 niveles (newbie/regular/vip/insider/icon).
 * Usamos el catálogo de la DB como fuente de verdad para que el admin pueda
 * modificarlo desde un solo lugar.
 */

export interface LoyaltyLevel {
  id: string;
  code: string;
  name: string;
  min_points: number;
  color: string | null;
  sort_order: number;
  perks: string[];
}

export interface LoyaltyMovement {
  id: string;
  change_amount: number;
  reason: string;
  reason_code: string | null;
  balance_after: number;
  expires_at: string | null;
  created_at: string;
  event_id: string | null;
  event_title?: string | null;
}

interface PointsDbRow {
  id: string;
  change_amount: number;
  reason: string;
  reason_code: string | null;
  balance_after: number;
  expires_at: string | null;
  created_at: string;
  event_id: string | null;
  events?: { title: string | null } | null;
}

interface LevelDbRow {
  id: string;
  code: string;
  name: string;
  min_points: number;
  color: string | null;
  sort_order: number | null;
  perks: unknown;
}

const normalizeLevel = (r: LevelDbRow): LoyaltyLevel => ({
  id: r.id,
  code: r.code,
  name: r.name,
  min_points: r.min_points,
  color: r.color,
  sort_order: r.sort_order ?? 0,
  perks: Array.isArray(r.perks) ? (r.perks as string[]) : [],
});

const normalizeMovement = (r: PointsDbRow): LoyaltyMovement => ({
  id: r.id,
  change_amount: r.change_amount,
  reason: r.reason,
  reason_code: r.reason_code,
  balance_after: r.balance_after,
  expires_at: r.expires_at,
  created_at: r.created_at,
  event_id: r.event_id,
  event_title: r.events?.title ?? null,
});

export const useLoyalty = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [levels, setLevels] = useState<LoyaltyLevel[]>([]);
  const [movements, setMovements] = useState<LoyaltyMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async (uid: string | null) => {
    setLoading(true);
    setError(null);
    try {
      // Levels (público, no requiere user_id)
      const { data: levelData, error: levelErr } = await supabase
        .from("loyalty_levels")
        .select("id, code, name, min_points, color, sort_order, perks")
        .order("min_points", { ascending: true });
      if (levelErr) throw levelErr;
      setLevels(((levelData ?? []) as LevelDbRow[]).map(normalizeLevel));

      if (!uid) {
        setBalance(0);
        setMovements([]);
        return;
      }

      // Balance (RPC SECURITY DEFINER)
      const { data: balData, error: balErr } = await supabase.rpc("loyalty_balance", {
        _user_id: uid,
      });
      if (balErr) throw balErr;
      setBalance(typeof balData === "number" ? balData : 0);

      // Movements (RLS por user_id; JOIN a events para título)
      const { data: pointData, error: pointErr } = await supabase
        .from("loyalty_points")
        .select("id, change_amount, reason, reason_code, balance_after, expires_at, created_at, event_id, events(title)")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(50);
      if (pointErr) throw pointErr;
      setMovements(((pointData ?? []) as unknown as PointsDbRow[]).map(normalizeMovement));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      await loadAll(uid);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      loadAll(uid);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadAll]);

  // Derivados
  const sortedLevels = [...levels].sort((a, b) => a.min_points - b.min_points);
  const currentLevelIdx = (() => {
    if (sortedLevels.length === 0) return 0;
    for (let i = sortedLevels.length - 1; i >= 0; i--) {
      if (balance >= sortedLevels[i].min_points) return i;
    }
    return 0;
  })();
  const currentLevel: LoyaltyLevel | null = sortedLevels[currentLevelIdx] ?? null;
  const nextLevel: LoyaltyLevel | null = sortedLevels[currentLevelIdx + 1] ?? null;
  const pointsToNext = nextLevel ? Math.max(0, nextLevel.min_points - balance) : 0;
  const progressPct = nextLevel && currentLevel
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((balance - currentLevel.min_points) /
              Math.max(1, nextLevel.min_points - currentLevel.min_points)) *
              100,
          ),
        ),
      )
    : 100;

  return {
    userId,
    balance,
    levels: sortedLevels,
    movements,
    currentLevel,
    nextLevel,
    pointsToNext,
    progressPct,
    loading,
    error,
    refetch: () => loadAll(userId),
  };
};
