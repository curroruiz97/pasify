// Pasify · Rate limit wrapper para edge functions
// Usa la RPC check_rate_limit (token bucket en postgres). Idempotente, persistente.

import { supabaseAdmin } from "./supabase.ts";

export interface RateLimitConfig {
  /** Identificador único del bucket (e.g. "checkout:user:<uid>"). */
  key: string;
  /** Máximo de peticiones permitidas en la ventana. */
  max: number;
  /** Tamaño de la ventana en segundos. */
  windowSec: number;
}

export class RateLimitError extends Error {
  status = 429;
  code = "rate_limit_exceeded";
  constructor(message = "Too many requests") {
    super(message);
  }
}

/**
 * Throws RateLimitError si se supera el límite. Llamar al inicio de cada
 * edge function sensible.
 */
export async function enforceRateLimit(cfg: RateLimitConfig): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    _key: cfg.key,
    _max: cfg.max,
    _window_sec: cfg.windowSec,
  });
  if (error) {
    // Si la RPC falla, NO bloqueamos (degradación elegante).
    console.warn("rate_limit_rpc_failed", error.message);
    return;
  }
  if (data === false) {
    throw new RateLimitError(`Rate limit exceeded for ${cfg.key}`);
  }
}

/** Helper para identificar IP del cliente desde headers Supabase. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
