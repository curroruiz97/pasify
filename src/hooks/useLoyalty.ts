import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/cache/keys";
import { useCurrentUserId } from "@/lib/cache/session";
import { getErrorMessage } from "@/lib/sentry";

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
 *
 * Caché: niveles, saldo y movimientos en qk.me.loyalty (compartido y
 * guardado en el dispositivo): la pantalla de puntos sale al instante.
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

interface LoyaltyData {
  levels: LoyaltyLevel[];
  balance: number;
  movements: LoyaltyMovement[];
}

async function leerPuntos(uid: string): Promise<LoyaltyData> {
  // Levels (público, no requiere user_id)
  const { data: levelData, error: levelErr } = await supabase
    .from("loyalty_levels")
    .select("id, code, name, min_points, color, sort_order, perks")
    .order("min_points", { ascending: true });
  if (levelErr) throw levelErr;

  // Balance (RPC SECURITY DEFINER)
  const { data: balData, error: balErr } = await supabase.rpc("loyalty_balance", { _user_id: uid });
  if (balErr) throw balErr;

  // Movements (RLS por user_id; JOIN a events para título)
  const { data: pointData, error: pointErr } = await supabase
    .from("loyalty_points")
    .select("id, change_amount, reason, reason_code, balance_after, expires_at, created_at, event_id, events(title)")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (pointErr) throw pointErr;

  return {
    levels: ((levelData ?? []) as LevelDbRow[]).map(normalizeLevel),
    balance: typeof balData === "number" ? balData : 0,
    movements: ((pointData ?? []) as unknown as PointsDbRow[]).map(normalizeMovement),
  };
}

const SIN_PUNTOS: LoyaltyData = { levels: [], balance: 0, movements: [] };

export const useLoyalty = () => {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: qk.me.loyalty(userId ?? ""),
    queryFn: () => leerPuntos(userId as string),
    enabled: !!userId,
  });
  const { levels, balance, movements } = query.data ?? SIN_PUNTOS;
  const loading = !!userId && query.isPending && !query.isError;
  const error = query.error ? getErrorMessage(query.error) : null;
  const { refetch: refetchQuery } = query;

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
    refetch: () => refetchQuery(),
  };
};
