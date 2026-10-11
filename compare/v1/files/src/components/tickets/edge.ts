import { supabase } from "@/integrations/supabase/client";
import { parseEdgeError } from "@/components/tickets/ticketUtils";

/**
 * Pasify · llamada a una edge function del flujo de entradas con
 * `supabase.functions.invoke` (manda el JWT de la sesión si la hay) y el
 * error leído con `parseEdgeError`, que entiende los dos formatos en uso.
 *
 * Nunca lanza: devuelve un resultado plano (sin unión discriminada: con
 * `strictNullChecks: false` TS no estrecha por `if (!res.ok)`).
 */
export interface EdgeResult<T> {
  ok: boolean;
  data: T | null;
  /** Código HTTP. 0 = la petición no llegó (sin red, CORS…). */
  httpStatus: number;
  code: string | null;
  /** Texto para el usuario del contrato `{ error, message }` (nunca el técnico). */
  message: string | null;
}

interface EdgeOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  /** Parámetros de la URL (para GET). */
  query?: Record<string, string>;
}

/** El `context` de FunctionsHttpError / FunctionsRelayError es la Response. */
const asResponse = (value: unknown): Response | null =>
  value &&
  typeof value === "object" &&
  typeof (value as Response).status === "number" &&
  typeof (value as Response).json === "function"
    ? (value as Response)
    : null;

export async function invokeEdge<T>(name: string, options: EdgeOptions = {}): Promise<EdgeResult<T>> {
  const qs = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.functions.invoke(`${name}${qs}`, {
      method: options.method ?? "POST",
      ...(options.body ? { body: options.body } : {}),
    });
  } catch {
    return { ok: false, data: null, httpStatus: 0, code: "network_error", message: null };
  }

  if (!result.error) {
    let data = result.data;
    if (typeof data === "string") {
      try {
        data = data ? JSON.parse(data) : null;
      } catch {
        /* texto plano: se queda tal cual */
      }
    }
    return { ok: true, data: (data ?? null) as T | null, httpStatus: 200, code: null, message: null };
  }

  const response = asResponse((result.error as { context?: unknown }).context);
  if (!response) {
    // FunctionsFetchError: la petición no llegó.
    return { ok: false, data: null, httpStatus: 0, code: "network_error", message: null };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const { code, message } = parseEdgeError(body);
  return { ok: false, data: null, httpStatus: response.status, code, message };
}
