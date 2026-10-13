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
 * Una tarjeta por serie, en el puesto de su sesión más próxima; los eventos
 * sueltos tal cual. `focusId` (la sesión por la que se llegó, p. ej. la vuelta
 * del login tras «Comprar») da la cara de su serie aunque no sea la próxima.
 * Una serie con una sola sesión en la lista es un evento más.
 */
export function groupBySeries<T extends SessionLike>(events: readonly T[], opts: { focusId?: string | null } = {}): CalendarItem<T>[] {
  const ordenadas = [...events].sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  const grupos = new Map<string, T[]>();
  for (const e of ordenadas) {
    if (!e.series_id) continue;
    const g = grupos.get(e.series_id);
    if (g) g.push(e);
    else grupos.set(e.series_id, [e]);
  }
  const salida: CalendarItem<T>[] = [];
  const puestas = new Set<string>();
  for (const e of ordenadas) {
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
