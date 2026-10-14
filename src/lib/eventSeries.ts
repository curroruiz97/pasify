/**
 * Pasify · series de eventos (varios días y recurrentes) en el cliente.
 *
 * Cada sesión de una serie es un evento de verdad (`events`) que lleva
 * `series_id` y `series_date` (migración 20261013130000). Aquí, lo que las
 * pantallas necesitan para tratarlas como grupo sin tocar la compra, que sigue
 * siendo por evento:
 *   - agrupar la lista del calendario en una tarjeta por serie;
 *   - leer las columnas nuevas con tolerancia (un servidor sin la migración no
 *     las tiene y no debe romper el calendario);
 *   - etiquetas de la serie («3 fechas», «Todos los viernes»).
 *
 * Funciones puras, sin React.
 */

/** Lo mínimo que hace falta de un evento para agruparlo. */
export interface SessionLike {
  id: string;
  date_start: string;
  date_end?: string | null;
  series_id?: string | null;
}

export type CalendarItem<T extends SessionLike> =
  | { kind: "event"; event: T }
  | {
      kind: "series";
      seriesId: string;
      /** La sesión que da la cara: la que se está mirando, o la próxima. */
      event: T;
      /** Todas las de la lista, de la más próxima a la más lejana. */
      sessions: T[];
    };

/**
 * Una tarjeta por serie, en el puesto de la primera de sus sesiones que
 * aparece en la lista (el orden de la lista se respeta: el calendario va de la
 * más próxima a la más lejana, «Pasados» de la más reciente a la más antigua);
 * los eventos sueltos, tal cual. Las sesiones de cada serie van de la más
 * próxima a la más lejana. `focusId` (la sesión por la que se llegó, p. ej. la
 * vuelta del login tras «Comprar») da la cara de su serie aunque no sea la
 * próxima. Una serie con una sola sesión en la lista es un evento más.
 */
export function groupBySeries<T extends SessionLike>(events: readonly T[], opts: { focusId?: string | null } = {}): CalendarItem<T>[] {
  const grupos = new Map<string, T[]>();
  for (const e of events) {
    if (!e.series_id) continue;
    const g = grupos.get(e.series_id);
    if (g) g.push(e);
    else grupos.set(e.series_id, [e]);
  }
  for (const g of grupos.values()) g.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  const salida: CalendarItem<T>[] = [];
  const puestas = new Set<string>();
  for (const e of events) {
    const sid = e.series_id;
    const sesiones = sid ? grupos.get(sid) : undefined;
    if (!sid || !sesiones || sesiones.length < 2) {
      salida.push({ kind: "event", event: e });
      continue;
    }
    if (puestas.has(sid)) continue;
    puestas.add(sid);
    const foco = opts.focusId ? sesiones.find((s) => s.id === opts.focusId) : undefined;
    salida.push({ kind: "series", seriesId: sid, event: foco ?? sesiones[0], sessions: sesiones });
  }
  return salida;
}

/** «1 fecha», «3 fechas». */
export const countLabel = (n: number): string => `${n} ${n === 1 ? "fecha" : "fechas"}`;

/** Sin hora de fin, una sesión se da por terminada 12 h después de empezar (como la venta de entradas). */
const SIN_FIN_MS = 12 * 3_600_000;

/** ¿Termina en el futuro? (fin = date_end o, sin él, inicio + 12 h). */
export const sessionHasNotEnded = (e: { date_start: string; date_end?: string | null }, now = Date.now()): boolean => {
  const inicio = Date.parse(e.date_start);
  if (!Number.isFinite(inicio)) return false;
  const fin = e.date_end ? Date.parse(e.date_end) : NaN;
  return (Number.isFinite(fin) ? fin : inicio + SIN_FIN_MS) >= now;
};

/** Las sesiones que quedan por celebrar y no están canceladas (publicadas o en borrador). */
export const isOpenSession = (e: { status: string; date_start: string; date_end?: string | null }, now = Date.now()): boolean =>
  (e.status === "published" || e.status === "draft") && sessionHasNotEnded(e, now);

export interface SessionStats<T> {
  count: number;
  /** Entradas vendidas entre todas las fechas. */
  sold: number;
  /** Aforo total; null si alguna fecha no tiene límite. */
  capacity: number | null;
  /** Precio más bajo de todas las fechas, en céntimos. */
  minPriceCents: number | null;
  published: number;
  drafts: number;
  cancelled: number;
  /** Fechas por celebrar que no están canceladas. */
  open: number;
  /** De esas, las que siguen en borrador. */
  openDrafts: number;
  /** La próxima por celebrar (o, si ya no queda ninguna, la última). */
  next: T;
  first: T;
  last: T;
}

/** Cifras de una serie para su cabecera en Mis eventos. Sesiones ordenadas por fecha. */
export function summarizeSessions<
  T extends { status: string; date_start: string; date_end?: string | null; tickets_sold?: number | null; capacity?: number | null; price_cents?: number | null },
>(sessions: readonly T[], now = Date.now()): SessionStats<T> {
  const ordenadas = [...sessions].sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  const abiertas = ordenadas.filter((e) => isOpenSession(e, now));
  const vivas = ordenadas.filter((e) => e.status !== "cancelled");
  const sinLimite = vivas.length === 0 || vivas.some((e) => !(e.capacity != null && e.capacity > 0));
  const precios = vivas.map((e) => e.price_cents).filter((c): c is number => typeof c === "number");
  return {
    count: ordenadas.length,
    sold: ordenadas.reduce((n, e) => n + Math.max(0, e.tickets_sold ?? 0), 0),
    capacity: sinLimite ? null : vivas.reduce((n, e) => n + (e.capacity ?? 0), 0),
    minPriceCents: precios.length > 0 ? Math.min(...precios) : null,
    published: ordenadas.filter((e) => e.status === "published").length,
    drafts: ordenadas.filter((e) => e.status === "draft").length,
    cancelled: ordenadas.filter((e) => e.status === "cancelled").length,
    open: abiertas.length,
    openDrafts: abiertas.filter((e) => e.status === "draft").length,
    next: abiertas[0] ?? ordenadas[ordenadas.length - 1],
    first: ordenadas[0],
    last: ordenadas[ordenadas.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Columnas de serie con tolerancia a un servidor sin la migración
// ---------------------------------------------------------------------------

/** Columnas de `events` que añade la migración de series. */
export const SERIES_COLUMNS = "series_id, series_date";

let columnasAusentes = false;

/** `select` con las columnas de serie, salvo que ya se sepa que el servidor no las tiene. */
export const conColumnasDeSerie = (select: string): string => (columnasAusentes ? select : `${select}, ${SERIES_COLUMNS}`);

/** ¿Es el error de una columna de serie que el servidor no tiene (BD sin migrar)? */
export function esErrorDeColumnaDeSerie(error: { message?: string; code?: string; details?: string } | null | undefined): boolean {
  if (!error) return false;
  const texto = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!/series_(id|date|exception)/i.test(texto)) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|could not find|schema cache/i.test(texto);
}

/**
 * Ejecuta una consulta de `events` pidiendo las columnas de serie y, si el
 * servidor no las tiene (la migración aún no se ha aplicado), la repite sin
 * ellas y lo recuerda: el calendario sigue funcionando, sin series.
 */
export async function leerConSeries<R extends { error: { message?: string; code?: string; details?: string } | null }>(
  select: string,
  consulta: (select: string) => PromiseLike<R>,
): Promise<R> {
  const primera = await consulta(conColumnasDeSerie(select));
  if (!columnasAusentes && esErrorDeColumnaDeSerie(primera.error)) {
    columnasAusentes = true;
    return consulta(select);
  }
  return primera;
}

/** Solo para las pruebas: olvida lo aprendido. */
export const olvidarColumnasAusentes = (): void => {
  columnasAusentes = false;
};
