/**
 * Horas de reloj en una zona horaria, sin librerías (Intl).
 *
 * El día y las horas de un evento son los del reloj DEL LOCAL
 * (`venues.timezone`), no los del móvil de quien lo crea o lo edita: un local
 * de Canarias editado desde Madrid (o al revés) no se desplaza una hora. Sin
 * zona válida se usa la del dispositivo, como antes.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Zona horaria del dispositivo (IANA), si el navegador la da. */
export const deviceTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** Formateador de partes de reloj de una zona; null si la zona no es válida. */
const formatterFor = (timeZone: string): Intl.DateTimeFormat | null => {
  if (!formatters.has(timeZone)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      f = null;
    }
    formatters.set(timeZone, f);
  }
  return formatters.get(timeZone) ?? null;
};

/** ¿Es una zona IANA que este navegador conoce? */
export const isValidTimeZone = (timeZone?: string | null): timeZone is string =>
  !!timeZone && formatterFor(timeZone) !== null;

/**
 * Rótulo de la hora con la que se leen el día y las horas de un evento:
 * «Hora de Santa Cruz de Tenerife» (ciudad del local). Sin zona válida es la
 * del dispositivo, y así se dice.
 */
export const timeZoneLabel = (placeName?: string | null, timeZone?: string | null): string => {
  if (!isValidTimeZone(timeZone)) return "Hora de este dispositivo";
  const lugar = placeName?.trim();
  return lugar ? `Hora de ${lugar}` : "Hora del local";
};

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const wallClockIn = (utcMs: number, f: Intl.DateTimeFormat): WallClock => {
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  // Algunos motores devuelven "24" a medianoche.
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
};

/** Desfase de la zona en un instante: su hora de reloj leída como UTC − el instante. */
const zoneOffsetMs = (utcMs: number, f: Intl.DateTimeFormat): number => {
  const c = wallClockIn(utcMs, f);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - utcMs;
};

/**
 * Instante de una hora de reloj (y, m 1-12, d, h, min) en `timeZone`. Sin
 * zona válida, la del dispositivo. El día puede desbordar (d + 1 el último
 * día del mes pasa al mes siguiente).
 *
 * Con cambio de hora: una hora que no existe (salta de las 02:00 a las 03:00)
 * se corre hacia delante (02:30 → 03:30) y una que se repite (02:30 pasa dos
 * veces) toma la segunda vez. `wallTimeIssue` dice cuándo pasa.
 */
export const zonedWallTimeToDate = (
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone?: string
): Date => {
  const f = timeZone ? formatterFor(timeZone) : null;
  if (!f) return new Date(y, m - 1, d, h, min, 0, 0);
  const guess = Date.UTC(y, m - 1, d, h, min, 0, 0);
  if (!Number.isFinite(guess)) return new Date(Number.NaN);
  const first = zoneOffsetMs(guess, f);
  let utc = guess - first;
  // Si entre medias hay cambio de hora, el segundo desfase es el bueno.
  const second = zoneOffsetMs(utc, f);
  if (second !== first) utc = guess - second;
  return new Date(utc);
};

/** "no existe" (los relojes se adelantan) o "se repite" (se atrasan). */
export type WallTimeIssue = "gap" | "ambiguous";

const DAY_MS = 86_400_000;

/**
 * ¿Esa hora de reloj no existe o se repite en `timeZone` (sin zona válida, la
 * del dispositivo)? En España pasa el último domingo de marzo (de las 02:00 a
 * las 03:00: 02:30 no existe) y el último de octubre (de las 03:00 a las
 * 02:00: 02:30 pasa dos veces). No bloquea nada: `zonedWallTimeToDate` la
 * resuelve y el editor avisa.
 */
export const wallTimeIssue = (
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone?: string
): WallTimeIssue | null => {
  const f = formatterFor(isValidTimeZone(timeZone) ? timeZone : deviceTimeZone() ?? "");
  if (!f) return null;
  const guess = Date.UTC(y, m - 1, d, h, min, 0, 0);
  if (!Number.isFinite(guess)) return null;
  // Desfase un día antes y un día después: si coinciden no hay cambio de hora cerca.
  const antes = zoneOffsetMs(guess - DAY_MS, f);
  const despues = zoneOffsetMs(guess + DAY_MS, f);
  if (antes === despues) return null;
  // Con cada desfase, ¿el instante que sale vuelve a marcar esa hora de reloj?
  const posibles = [antes, despues].filter((offset) => zoneOffsetMs(guess - offset, f) === offset);
  return posibles.length === 0 ? "gap" : posibles.length === 2 ? "ambiguous" : null;
};

/** "HH:mm" → { h, m }; null si no es una hora de reloj (00:00 a 23:59). Sin ajustar: "25:61" no vale. */
export const parseHm = (value: string | null | undefined): { h: number; m: number } | null => {
  const t = /^(\d{1,2}):(\d{1,2})$/.exec(value ?? "");
  if (!t) return null;
  const h = Number(t[1]);
  const m = Number(t[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
};

/** "YYYY-MM-DD" y "HH:mm" de un instante en `timeZone` (o en la del dispositivo). */
export const isoToWallClock = (
  iso: string | Date,
  timeZone?: string
): { date: string; time: string } | null => {
  const ms = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const f = timeZone ? formatterFor(timeZone) : null;
  if (!f) {
    const d = new Date(ms);
    return {
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  }
  const c = wallClockIn(ms, f);
  return { date: `${c.year}-${pad2(c.month)}-${pad2(c.day)}`, time: `${pad2(c.hour)}:${pad2(c.minute)}` };
};

/**
 * Un instante escrito en la hora de `timeZone` (la del local), con las
 * opciones de Intl que se pidan. Sin zona, o si no es válida, en la del
 * dispositivo. La web, el email y Stripe enseñan la hora del local: el panel
 * también, para que no haya dos horas distintas del mismo evento.
 */
export const formatInTimeZone = (
  iso: string | Date,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
  locale = "es-ES"
): string => {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (timeZone) {
    try {
      return d.toLocaleString(locale, { ...options, timeZone });
    } catch {
      /* zona no válida: la del dispositivo */
    }
  }
  return d.toLocaleString(locale, options);
};

/** "YYYY-MM-DD" + n días (calendario puro, sin horas ni cambios de hora). */
export const addDaysToDate = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
};
