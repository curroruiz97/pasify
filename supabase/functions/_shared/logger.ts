// Pasify · Logger estructurado para edge functions
// Output: JSON lines (compatible Datadog/LogDNA/Supabase Logs Explorer)

export interface LogContext {
  request_id?: string;
  user_id?: string;
  org_id?: string;
  capability?: string;
  duration_ms?: number;
  function?: string;
  [k: string]: unknown;
}

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, ctx: LogContext = {}) {
  const payload = {
    level,
    message,
    ts: new Date().toISOString(),
    ...ctx,
  };
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (m: string, c?: LogContext) => emit("debug", m, c),
  info:  (m: string, c?: LogContext) => emit("info", m, c),
  warn:  (m: string, c?: LogContext) => emit("warn", m, c),
  error: (m: string, c?: LogContext) => emit("error", m, c),

  /** Devuelve un logger con contexto fijo (function_name, request_id). */
  child(ctx: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit("debug", m, { ...ctx, ...c }),
      info:  (m: string, c?: LogContext) => emit("info",  m, { ...ctx, ...c }),
      warn:  (m: string, c?: LogContext) => emit("warn",  m, { ...ctx, ...c }),
      error: (m: string, c?: LogContext) => emit("error", m, { ...ctx, ...c }),
    };
  },
};

/** Mide tiempo de ejecución y log info estructurado al final. */
export async function timed<T>(name: string, fn: () => Promise<T>, ctx?: LogContext): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.info(`${name} ok`, { ...ctx, duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    logger.error(`${name} failed`, {
      ...ctx,
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
