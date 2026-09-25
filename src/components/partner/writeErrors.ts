import { TimeoutError } from "@/lib/withTimeout";

/**
 * Escrituras del panel de local (guardar, publicar, retirar, borrar eventos y
 * tipos de entrada) con el resultado comprobado.
 *
 * Antes se miraba solo `error`: si la RLS filtraba la escritura, Supabase
 * respondía sin error y con 0 filas, y el panel decía "Cambios guardados" sin
 * haber cambiado nada. Y cualquier rechazo del servidor salía como "Revisa tu
 * conexión". Ahora cada escritura pide `.select("id")`, se comprueba cuántas
 * filas han cambiado y el mensaje distingue:
 *   - sin conexión (no llegó respuesta: no sabemos si se aplicó),
 *   - el servidor lo ha rechazado (con el motivo real),
 *   - el servidor no ha cambiado nada (sin permiso o ya no existe).
 */

export type WriteFailure = "network" | "rejected" | "no_rows";

/** Fallo de una escritura ya clasificado. */
export class WriteError extends Error {
  readonly kind: WriteFailure;
  readonly code: string | null;

  constructor(kind: WriteFailure, message: string, code: string | null = null) {
    super(message);
    this.name = "WriteError";
    this.kind = kind;
    this.code = code;
  }
}

/** Lo que devuelve una escritura de supabase-js. */
interface WriteResponse<T> {
  data: T[] | T | null;
  error: { message: string; code?: string | null } | null;
  status?: number;
}

const NETWORK_RE =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed|network connection was lost|internet connection appears to be offline|fetcherror|aborterror/i;

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Error de supabase-js → WriteError. Sin respuesta (status 0) es la red. */
export function toWriteError(
  error: { message?: string | null; code?: string | null } | null | undefined,
  status?: number
): WriteError {
  const message = error?.message ?? "Error desconocido";
  if (status === 0 || NETWORK_RE.test(message) || (!error?.code && isOffline())) {
    return new WriteError("network", message);
  }
  return new WriteError("rejected", message, error?.code ?? null);
}

/**
 * Comprueba una escritura hecha con `.select("id")` que tiene que cambiar
 * exactamente `expected` filas. Devuelve las filas; si no, lanza WriteError.
 */
export function expectRows<T>(res: WriteResponse<T>, expected = 1): T[] {
  if (res.error) throw toWriteError(res.error, res.status);
  const rows = res.data == null ? [] : Array.isArray(res.data) ? res.data : [res.data];
  if (rows.length !== expected) {
    throw new WriteError(
      "no_rows",
      `Se esperaba cambiar ${expected} ${expected === 1 ? "fila" : "filas"} y han cambiado ${rows.length}`
    );
  }
  return rows;
}

/** Mensajes del servidor (triggers y RLS) en lenguaje del local. */
const friendlyServerMessage = (message: string, code: string | null): string | null => {
  if (message.includes("Cannot change price")) {
    return "Hay tipos de entrada con ventas: su precio ya no se puede cambiar. Revísalos.";
  }
  if (message.includes("Cannot reduce")) {
    return "Has bajado un cupo por debajo de las entradas ya vendidas. Ajusta los cupos.";
  }
  if (message.includes("Cannot delete event")) {
    return "Este evento ya tiene entradas vendidas y no se puede eliminar. Puedes retirarlo de la venta o cancelarlo.";
  }
  if (message.includes("Cannot delete tier")) {
    return "Hay tipos de entrada con ventas que no se pueden borrar: ocúltalos en lugar de borrarlos.";
  }
  if (message.includes("cancelado no se puede")) return "Un evento cancelado no se puede volver a publicar.";
  if (message.includes("ya ha pasado")) return "Un evento que ya ha pasado no puede volver a la venta ni cambiar de estado.";
  // Mensajes de los triggers de Pasify: ya están escritos para el local.
  if (/precio mínimo|no está activa|tu nombre|organización|propietario/i.test(message)) return message;
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "Tu cuenta no tiene permiso para hacer este cambio en este evento.";
  }
  if (message.includes("foreign key") || message.includes("violates")) {
    return "Hay entradas o pedidos que dependen de esto y el servidor no lo acepta. Si es un evento, cancélalo o retíralo de la venta en vez de borrarlo.";
  }
  return null;
};

interface DescribeOptions {
  /** Texto para cuando no ha llegado respuesta (depende de lo que se hacía). */
  network?: string;
  /** Texto para cuando el servidor no ha cambiado nada. */
  noRows?: string;
}

const DEFAULT_NETWORK =
  "No hay conexión con el servidor y no se ha podido confirmar el cambio. Revisa tu conexión y vuelve a intentarlo.";
const DEFAULT_NO_ROWS =
  "El servidor no ha aplicado el cambio: puede que el evento ya no exista o que tu cuenta ya no tenga permiso sobre él. Recarga la lista.";

/** Texto para el aviso de error de una escritura. */
export function describeWriteError(err: unknown, options: DescribeOptions = {}): string {
  if (err instanceof TimeoutError) return options.network ?? DEFAULT_NETWORK;
  if (err instanceof WriteError) {
    if (err.kind === "network") return options.network ?? DEFAULT_NETWORK;
    if (err.kind === "no_rows") return options.noRows ?? DEFAULT_NO_ROWS;
    return friendlyServerMessage(err.message, err.code) ?? `El servidor ha rechazado el cambio: ${err.message}`;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown } | null)?.message === "string"
        ? String((err as { message: string }).message)
        : "";
  if (!message) return "No se ha podido completar el cambio.";
  if (NETWORK_RE.test(message) || isOffline()) return options.network ?? DEFAULT_NETWORK;
  const code = typeof (err as { code?: unknown } | null)?.code === "string" ? String((err as { code: string }).code) : null;
  return friendlyServerMessage(message, code) ?? `El servidor ha rechazado el cambio: ${message}`;
}
