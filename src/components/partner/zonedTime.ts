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

/**
 * Instante de una hora de reloj (y, m 1-12, d, h, min) en `timeZone`. Sin
 * zona válida, la del dispositivo. El día puede desbordar (d + 1 el último
 * día del mes pasa al mes siguiente).
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
  // Desfase de la zona en un instante: su hora de reloj leída como UTC − el instante.
  const offsetAt = (utcMs: number) => {
    const c = wallClockIn(utcMs, f);
    return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - utcMs;
  };
  const first = offsetAt(guess);
  let utc = guess - first;
  // Si entre medias hay cambio de hora, el segundo desfase es el bueno.
  const second = offsetAt(utc);
  if (second !== first) utc = guess - second;
  return new Date(utc);
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

/** "YYYY-MM-DD" + n días (calendario puro, sin horas ni cambios de hora). */
export const addDaysToDate = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
};
