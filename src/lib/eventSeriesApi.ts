import { supabase } from "@/integrations/supabase/client";
import { describeWriteError, toWriteError } from "@/components/partner/writeErrors";
import { isOpenSession } from "@/lib/eventSeries";
import { describePattern, parseStoredRule } from "@/lib/recurrence";

/**
 * Pasify · llamadas del cliente a las funciones de series de eventos
 * (migración 20261013130000_eventos_recurrentes).
 *
 * Las funciones aún no están en los tipos generados de Supabase (se
 * regeneran tras desplegar la migración), así que se llaman con un tipo propio.
 * Todas hacen su trabajo en una sola transacción: o se hace todo o nada.
 */

interface RpcError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface Rpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError | null }>;
}

const rpc = () => supabase as unknown as Rpc;

/** Error de una función de series, con el código que devolvió la base de datos. */
export class SeriesApiError extends Error {
  readonly code: string;
  readonly hint: string | null;
  constructor(code: string, hint: string | null, message: string) {
    super(message);
    this.name = "SeriesApiError";
    this.code = code;
    this.hint = hint;
  }
}

/** Qué le decimos al local por cada código de error. */
const MENSAJES: Record<string, string> = {
  not_authenticated: "Tu sesión ha caducado. Vuelve a entrar y repite la operación.",
  series_invalid_kind: "El tipo de serie no es válido.",
  series_invalid_event: "Faltan datos del evento.",
  series_invalid_rule: "La regla de repetición no es válida.",
  series_invalid_tiers: "Revisa los tipos de entrada: cada uno necesita nombre y un precio válido.",
  series_invalid_sessions: "Alguna de las fechas no es válida.",
  series_invalid_session_times: "En alguna fecha la hora de fin no es posterior a la de inicio.",
  series_invalid_time_zone: "La zona horaria del local no es válida.",
  series_invalid_status: "El estado del evento no es válido.",
  series_invalid_scope: "El alcance del cambio no es válido.",
  series_invalid_patch: "Los cambios no son válidos.",
  series_no_sessions: "La serie no tiene ninguna fecha.",
  series_title_required: "El evento necesita un título.",
  series_city_required: "El evento necesita una ciudad.",
  series_session_in_past: "Alguna de las fechas ya ha pasado. Quítala o guarda la serie como borrador.",
  series_sessions_overlap: "Dos fechas de la serie se pisan: una empieza antes de que acabe la anterior.",
  series_not_found: "La serie ya no existe o no tienes permiso para cambiarla.",
  cancel_reason_required: "Escribe el motivo de la cancelación.",
  Forbidden: "No tienes permiso para hacer esto en este evento.",
};

const CODIGOS = [...Object.keys(MENSAJES), "series_too_many_sessions", "series_duplicate_dates"];

/**
 * Texto para el local de un error de las funciones de series. Los códigos
 * propios se explican; lo demás (sin conexión, un trigger de eventos o de
 * tipos de entrada, la RLS) lo cuenta describeWriteError, con `network` si no
 * ha llegado respuesta.
 */
export function describeSeriesError(err: unknown, network?: string): string {
  if (err instanceof SeriesApiError) {
    if (err.code === "series_too_many_sessions") {
      return `Una serie puede tener hasta ${err.hint ?? "100"} fechas: acorta el periodo o reduce las repeticiones.`;
    }
    if (err.code === "series_duplicate_dates") {
      return `La fecha ${err.hint ?? ""} está repetida en la serie.`;
    }
    return MENSAJES[err.code] ?? err.message;
  }
  return describeWriteError(err, network ? { network } : {});
}

/** Error de PostgREST → SeriesApiError (el mensaje de la excepción SQL es el código) o WriteError. */
function aError(e: RpcError, status?: number): Error {
  const message = (e.message ?? "").trim();
  const conocido = CODIGOS.find((k) => message.includes(k));
  if (conocido) return new SeriesApiError(conocido, e.hint ?? null, message);
  return toWriteError(e, status);
}

async function llamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc().rpc(fn, args);
  if (error) throw aError(error);
  return data as T;
}

// ---------------------------------------------------------------------------

export interface SessionInput {
  date: string;
  start: string;
  end: string | null;
}

export interface TierInput {
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  capacity: number | null;
  per_user_max: number;
  status: "active" | "hidden";
  sort_order: number;
  refundable_until_hours_before: number | null;
  transfer_allowed: boolean;
}

export interface SeriesEventInput {
  title: string;
  description: string | null;
  city: string;
  venue_name: string | null;
  address: string | null;
  image_url: string | null;
  venue_id: string | null;
  category?: string | null;
  status: "draft" | "published";
}

export interface CreateSeriesResult {
  series_id: string;
  event_ids: string[];
  already_created: boolean;
}

export function createEventSeries(args: {
  requestId: string;
  kind: "multi_day" | "recurring";
  rule: Record<string, unknown>;
  timeZone: string;
  event: SeriesEventInput;
  tiers: TierInput[];
  sessions: SessionInput[];
}): Promise<CreateSeriesResult> {
  return llamar<CreateSeriesResult>("create_event_series", {
    _request_id: args.requestId,
    _kind: args.kind,
    _rule: args.rule,
    _time_zone: args.timeZone,
    _event: args.event,
    _tiers: args.tiers,
    _sessions: args.sessions,
  });
}

export interface UpdateSeriesPatch {
  title?: string;
  description?: string | null;
  image_url?: string | null;
  category?: string | null;
  venue_id?: string | null;
  venue_name?: string | null;
  city?: string;
  address?: string | null;
  /** "HH:mm" en la zona de la serie. */
  start_time?: string;
  /** "HH:mm"; "" = sin hora de fin. */
  end_time?: string;
}

export function updateEventSeries(args: {
  seriesId: string;
  /** Sesiones desde este instante; null = todas las que quedan por celebrar. */
  from: string | null;
  patch: UpdateSeriesPatch;
  includeExceptions?: boolean;
}): Promise<{ updated: number; skipped_exceptions: number }> {
  return llamar("update_event_series", {
    _series_id: args.seriesId,
    _from: args.from,
    _patch: args.patch,
    _include_exceptions: args.includeExceptions ?? false,
  });
}

export function applyEventTiersToSeries(args: {
  eventId: string;
  scope: "following" | "all";
}): Promise<{ applied: number; skipped_with_sales: number }> {
  return llamar("apply_event_tiers_to_series", { _event_id: args.eventId, _scope: args.scope });
}

export function cancelEventSeries(args: {
  seriesId: string;
  from: string | null;
  reason: string;
}): Promise<{ cancelled: number; needs_refunds: string[] }> {
  return llamar("cancel_event_series", { _series_id: args.seriesId, _from: args.from, _reason: args.reason });
}

// ---------------------------------------------------------------------------
// Contexto de una fecha que pertenece a una serie (para editarla)
// ---------------------------------------------------------------------------

/** Lo que el editor necesita saber de la serie de la fecha que se edita. */
export interface SeriesContext {
  seriesId: string;
  /** Esta fecha se editó por separado: las ediciones de toda la serie la respetan. */
  exception: boolean;
  /** Cómo se repite («Todos los viernes»), si la regla guardada se entiende. */
  pattern: string | null;
  /** Fechas por celebrar y no canceladas de la serie, incluida esta. */
  open: number;
  /** De las demás por celebrar, las posteriores a esta. */
  following: number;
  /** De las demás por celebrar, las editadas por separado. */
  exceptions: number;
  /** De las posteriores, las editadas por separado. */
  exceptionsFollowing: number;
}

type Fila = Record<string, unknown>;
interface Consulta extends PromiseLike<{ data: Fila[] | null; error: RpcError | null }> {
  maybeSingle: () => PromiseLike<{ data: Fila | null; error: RpcError | null }>;
}
interface SinTipos {
  from: (tabla: string) => { select: (columnas: string) => { eq: (columna: string, valor: string) => Consulta } };
}

/**
 * La serie de una fecha, o null si no es de ninguna (o si el servidor aún no
 * tiene la migración de series: entonces el editor funciona como siempre).
 * Una lectura que falla se trata como «sin serie»: editar la fecha sigue
 * siendo posible, solo que sin ofrecer cambios para las demás.
 */
export async function loadSeriesContext(eventId: string, now = Date.now()): Promise<SeriesContext | null> {
  const db = supabase as unknown as SinTipos;
  try {
    const { data: ev, error } = await db.from("events").select("series_id, series_exception, date_start").eq("id", eventId).maybeSingle();
    const seriesId = typeof ev?.series_id === "string" ? ev.series_id : null;
    if (error || !seriesId) return null;
    const esta = Date.parse(String(ev?.date_start ?? ""));
    const [sesiones, serie] = await Promise.all([
      db.from("events").select("id, status, date_start, date_end, series_exception").eq("series_id", seriesId),
      db.from("event_series").select("kind, rule").eq("id", seriesId).maybeSingle(),
    ]);
    if (sesiones.error) return null;
    const otras = (sesiones.data ?? []).filter((s) => s.id !== eventId && isOpenSession({ status: String(s.status), date_start: String(s.date_start), date_end: (s.date_end as string | null) ?? null }, now));
    const posteriores = otras.filter((s) => Date.parse(String(s.date_start)) > esta);
    const parsed = serie.data ? parseStoredRule({ ...(serie.data.rule as object), kind: serie.data.kind }) : null;
    return {
      seriesId,
      exception: ev?.series_exception === true,
      pattern: parsed ? describePattern(parsed.startsOn, parsed.rule) : null,
      open: otras.length + 1,
      following: posteriores.length,
      exceptions: otras.filter((s) => s.series_exception === true).length,
      exceptionsFollowing: posteriores.filter((s) => s.series_exception === true).length,
    };
  } catch {
    return null;
  }
}
