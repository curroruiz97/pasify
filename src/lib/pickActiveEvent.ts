/**
 * Qué evento es "el de ahora" para las pantallas operativas del local
 * (En vivo, Escáner, Asistentes, Cashless).
 *
 * Antes cada pantalla lo decidía a su manera: En vivo cogía el primero con
 * inicio posterior a hace 6 h (un evento de 20:00 desaparecía a las 02:00 en
 * plena noche) y Cashless el más antiguo de una ventana de 48 h.
 *
 * Reglas comunes:
 *   - Solo cuentan eventos `published` o `past` (nada de borradores ni
 *     cancelados).
 *   - Fin del evento = `date_end` o, si no hay, `date_start + 12 h`.
 *   - "En curso" = desde 6 h antes del inicio (apertura de puertas, cola)
 *     hasta el fin. El escáner de servidor (scan_ticket v2) usa la misma
 *     apertura de 6 h.
 */

export interface ActiveEventCandidate {
  id: string;
  date_start: string;
  date_end?: string | null;
  status: string;
}

const HOUR_MS = 3_600_000;
export const DOORS_OPEN_BEFORE_MS = 6 * HOUR_MS;
export const DEFAULT_EVENT_DURATION_MS = 12 * HOUR_MS;
export const UPCOMING_WINDOW_MS = 7 * 24 * HOUR_MS;
export const RECENTLY_ENDED_MS = 12 * HOUR_MS;

const ELIGIBLE_STATUSES = new Set(["published", "past"]);

interface Timed<T> {
  event: T;
  start: number;
  end: number;
}

/** Inicio y fin (ms) de un evento; fin = date_end o inicio + 12 h. */
export const eventTimeWindow = (event: {
  date_start: string;
  date_end?: string | null;
}): { start: number; end: number } | null => {
  const start = Date.parse(event.date_start);
  if (!Number.isFinite(start)) return null;
  const rawEnd = event.date_end ? Date.parse(event.date_end) : Number.NaN;
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + DEFAULT_EVENT_DURATION_MS;
  return { start, end };
};

const toTimed = <T extends ActiveEventCandidate>(events: ReadonlyArray<T>): Timed<T>[] => {
  const out: Timed<T>[] = [];
  for (const event of events) {
    if (!ELIGIBLE_STATUSES.has(event.status)) continue;
    const span = eventTimeWindow(event);
    if (span) out.push({ event, ...span });
  }
  return out;
};

const isInProgress = (x: Timed<unknown>, now: number) =>
  x.start - DOORS_OPEN_BEFORE_MS <= now && now <= x.end;

/**
 * Orden entre eventos en curso: primero los que ya han empezado (el de inicio
 * más reciente delante), después los que aún están en la apertura de puertas
 * (el que empieza antes delante). Así, con dos eventos seguidos en la misma
 * sala, a las 21:00 manda el de 18:00-22:00 que está sonando y no el de las
 * 23:00 que solo está "abriendo puertas".
 */
const compareInProgress = (now: number) => (a: Timed<unknown>, b: Timed<unknown>) => {
  const aStarted = a.start <= now;
  const bStarted = b.start <= now;
  if (aStarted !== bStarted) return aStarted ? -1 : 1;
  return aStarted ? b.start - a.start : a.start - b.start;
};

/**
 * El evento en curso (si hay varios, el de inicio más reciente de los que ya
 * han empezado); si no hay ninguno, el próximo futuro más cercano; si
 * tampoco, null.
 */
export function pickActiveEvent<T extends ActiveEventCandidate>(
  events: ReadonlyArray<T>,
  now: Date = new Date()
): T | null {
  const t = now.getTime();
  const timed = toTimed(events);

  const inProgress = timed.filter((x) => isInProgress(x, t)).sort(compareInProgress(t));
  if (inProgress.length > 0) return inProgress[0].event;

  let next: Timed<T> | null = null;
  for (const x of timed) {
    if (x.start > t && (!next || x.start < next.start)) next = x;
  }
  return next?.event ?? null;
}

/**
 * Eventos que tiene sentido elegir en una pantalla operativa: en curso,
 * los que empiezan en los próximos 7 días y los terminados hace menos de
 * 12 h. Orden: en curso (como pickActiveEvent), próximos (el más cercano
 * primero) y terminados (el más reciente primero).
 */
export function listSelectableEvents<T extends ActiveEventCandidate>(
  events: ReadonlyArray<T>,
  now: Date = new Date()
): T[] {
  const t = now.getTime();
  const inProgress: Timed<T>[] = [];
  const upcoming: Timed<T>[] = [];
  const recentlyEnded: Timed<T>[] = [];

  for (const x of toTimed(events)) {
    if (isInProgress(x, t)) inProgress.push(x);
    else if (x.start > t && x.start - t <= UPCOMING_WINDOW_MS) upcoming.push(x);
    else if (x.end < t && t - x.end <= RECENTLY_ENDED_MS) recentlyEnded.push(x);
  }

  inProgress.sort(compareInProgress(t));
  upcoming.sort((a, b) => a.start - b.start);
  recentlyEnded.sort((a, b) => b.end - a.end);

  return [...inProgress, ...upcoming, ...recentlyEnded].map((x) => x.event);
}

/**
 * Opciones de un selector de evento operativo: listSelectableEvents más el
 * evento por defecto (pickActiveEvent) aunque quede fuera de esa ventana
 * (p. ej. el próximo evento es dentro de 10 días), para que el valor elegido
 * siempre esté entre las opciones.
 */
export function listEventChoices<T extends ActiveEventCandidate>(
  events: ReadonlyArray<T>,
  now: Date = new Date()
): T[] {
  const list = listSelectableEvents(events, now);
  const active = pickActiveEvent(events, now);
  return active && !list.some((e) => e.id === active.id) ? [active, ...list] : list;
}

export type EventPhase = "upcoming" | "live" | "ended";

/** Fase "de verdad" (sin la apertura de puertas): antes, durante o después. */
export const eventPhase = (
  event: { date_start: string; date_end?: string | null },
  now: Date = new Date()
): EventPhase | null => {
  const span = eventTimeWindow(event);
  if (!span) return null;
  const t = now.getTime();
  if (t < span.start) return "upcoming";
  if (t <= span.end) return "live";
  return "ended";
};
