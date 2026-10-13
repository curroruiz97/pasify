import { addDaysToDate } from "@/components/partner/zonedTime";
import { composeIsoStartEnd } from "@/components/partner/eventSchedule";

/**
 * Pasify · eventos de varios días y recurrentes: el motor de fechas.
 *
 * Una serie es un conjunto de SESIONES; cada sesión es un evento de verdad
 * (`events`) con sus propios tipos de entrada, aforo, ventas, puerta e
 * informes. La regla (frecuencia, días de la semana, fechas) solo sirve para
 * calcular las fechas y para enseñarlas; lo que manda en la base de datos son
 * las sesiones (create_event_series las recibe ya calculadas).
 *
 * Todo en fechas de calendario del local ("YYYY-MM-DD") y horas de reloj
 * ("HH:mm") en su zona horaria; los instantes salen de composeIsoStartEnd, que
 * ya resuelve el cambio de hora (una sesión de las 23:30 sigue siendo a las
 * 23:30 antes y después del último domingo de octubre).
 *
 * Funciones puras, sin React ni red.
 */

/** Sesiones máximas por serie (BD: max_series_sessions, migración 20261013130000). */
export const MAX_SERIES_SESSIONS = 100;
/** Hasta cuándo puede llegar una serie desde su primera fecha. */
export const MAX_SERIES_SPAN_DAYS = 731;
/** Días máximos de un evento de varios días seguidos. */
export const MAX_MULTI_DAY = 30;

export type SeriesKind = "multi_day" | "recurring";
export type Frequency = "daily" | "weekly" | "monthly" | "custom";
/** Mensual: el mismo día del mes («el 15») o el mismo día de la semana («el segundo viernes»). */
export type MonthlyMode = "day_of_month" | "nth_weekday";
export type EndMode = "until" | "count";

export interface RecurrenceRule {
  kind: SeriesKind;
  frequency: Frequency;
  /** Cada N días, semanas o meses. */
  interval: number;
  /** Días de la semana (semanal): 1 = lunes … 7 = domingo. Vacío = el de la primera fecha. */
  weekdays: number[];
  monthlyMode: MonthlyMode;
  endMode: EndMode;
  /** Última fecha posible, incluida ("YYYY-MM-DD"), con endMode "until". */
  endsOn: string;
  /** Número de sesiones, con endMode "count". */
  count: number;
  /** Fechas elegidas a mano (frecuencia "custom"). */
  customDates: string[];
  /** Fechas que se quitan de las calculadas. */
  excluded: string[];
}

export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
/** En plural: «los lunes … los sábados y los domingos». */
const WEEKDAY_PLURAL = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"] as const;
/** Iniciales para los botones de los días de la semana. */
export const WEEKDAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha de calendario real ("2026-02-30" no lo es)? */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Día de la semana: 1 = lunes … 7 = domingo. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return js === 0 ? 7 : js;
}

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const fechaDe = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

/** Días entre dos fechas de calendario (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function defaultRule(kind: SeriesKind = "recurring"): RecurrenceRule {
  return {
    kind,
    frequency: kind === "multi_day" ? "daily" : "weekly",
    interval: 1,
    weekdays: [],
    monthlyMode: "day_of_month",
    endMode: "count",
    endsOn: "",
    count: kind === "multi_day" ? 3 : 8,
    customDates: [],
    excluded: [],
  };
}

export interface Expansion {
  /** Fechas calculadas, ordenadas, sin las excluidas. */
  dates: string[];
  /** Todas las calculadas (también las excluidas), para poder volver a ponerlas. */
  all: string[];
  /** Se dejó de calcular al llegar al máximo de sesiones: la regla daba más. */
  truncated: boolean;
}

/**
 * Las fechas de la regla a partir de `startsOn`. Nunca pasa de
 * MAX_SERIES_SESSIONS ni de MAX_SERIES_SPAN_DAYS días desde la primera fecha.
 * El mensual «el 31» cae el último día de los meses más cortos.
 */
export function expandRule(startsOn: string, rule: RecurrenceRule): Expansion {
  const vacio: Expansion = { dates: [], all: [], truncated: false };

  if (rule.frequency === "custom") {
    const todas = [...new Set(rule.customDates.filter(isDate))].sort();
    const recortadas = todas.slice(0, MAX_SERIES_SESSIONS);
    return finalizar(recortadas, rule.excluded, todas.length > MAX_SERIES_SESSIONS);
  }
  if (!isDate(startsOn)) return vacio;

  const intervalo = Math.max(1, Math.floor(rule.interval) || 1);
  const limite =
    rule.endMode === "until" && isDate(rule.endsOn) ? rule.endsOn : addDaysToDate(startsOn, MAX_SERIES_SPAN_DAYS);
  const tope = addDaysToDate(startsOn, MAX_SERIES_SPAN_DAYS);
  const hasta = limite < tope ? limite : tope;
  const quiere = rule.endMode === "count" ? Math.min(Math.max(1, Math.floor(rule.count) || 1), MAX_SERIES_SESSIONS) : MAX_SERIES_SESSIONS;

  const out: string[] = [];
  let truncated = false;
  /** Añade una fecha; false si hay que parar. */
  const pidioMasDelMaximo = rule.endMode === "count" && Math.floor(rule.count) > MAX_SERIES_SESSIONS;
  const poner = (fecha: string): boolean => {
    if (fecha > hasta) return false;
    if (out.length >= quiere) {
      // «Truncada»: la regla seguía dando fechas y lo que cortó fue el máximo
      // de sesiones (no el número que se pidió).
      truncated = rule.endMode === "until" || pidioMasDelMaximo;
      return false;
    }
    out.push(fecha);
    return true;
  };

  if (rule.frequency === "daily") {
    for (let d = startsOn; poner(d); d = addDaysToDate(d, intervalo));
  } else if (rule.frequency === "weekly") {
    const dias = [...new Set(rule.weekdays.filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
    const usar = dias.length > 0 ? dias : [weekdayOf(startsOn)];
    // Lunes de la semana de la primera fecha: las semanas se cuentan desde ahí.
    const lunes = addDaysToDate(startsOn, -(weekdayOf(startsOn) - 1));
    parar: for (let semana = 0; semana < 400; semana++) {
      const base = addDaysToDate(lunes, 7 * intervalo * semana);
      for (const wd of usar) {
        const fecha = addDaysToDate(base, wd - 1);
        if (fecha < startsOn) continue;
        if (!poner(fecha)) break parar;
      }
      if (base > hasta) break;
    }
  } else if (rule.frequency === "monthly") {
    const [y0, m0, d0] = startsOn.split("-").map(Number);
    const nth = Math.ceil(d0 / 7);
    const wd0 = weekdayOf(startsOn);
    for (let k = 0; k < 400; k++) {
      const total = m0 - 1 + k * intervalo;
      const y = y0 + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const dim = daysInMonth(y, m);
      let dia: number;
      if (rule.monthlyMode === "nth_weekday") {
        const primero = 1 + ((wd0 - weekdayOf(fechaDe(y, m, 1)) + 7) % 7);
        dia = primero + 7 * (nth - 1);
        // «El quinto viernes» no existe todos los meses: se toma el último.
        while (dia > dim) dia -= 7;
      } else {
        dia = Math.min(d0, dim);
      }
      const fecha = fechaDe(y, m, dia);
      if (fecha < startsOn) continue;
      if (!poner(fecha)) break;
    }
  }
  return finalizar(out, rule.excluded, truncated);
}

function finalizar(todas: string[], excluidas: string[], truncated: boolean): Expansion {
  const quitar = new Set(excluidas);
  return { dates: todas.filter((d) => !quitar.has(d)), all: todas, truncated };
}

export interface SeriesSession {
  /** Día de la serie en el reloj del local ("YYYY-MM-DD"). */
  date: string;
  startIso: string;
  endIso: string | null;
  crossesMidnight: boolean;
}

/** Las sesiones (instantes) de unas fechas con la misma hora de inicio y de fin, en la zona del local. */
export function buildSessions(
  dates: readonly string[],
  times: { startTime: string; endTime: string },
  timeZone?: string,
): SeriesSession[] {
  const sesiones: SeriesSession[] = [];
  for (const date of dates) {
    const { startIso, endIso, crossesMidnight } = composeIsoStartEnd({ date, ...times }, timeZone);
    if (startIso) sesiones.push({ date, startIso, endIso, crossesMidnight });
  }
  return sesiones;
}

/** Sin hora de fin, una sesión se da por terminada 12 h después de empezar (como la venta de entradas). */
const SIN_FIN_MS = 12 * 3_600_000;

export interface PlannedSeries {
  /** Los días de la serie que se van a crear. */
  dates: string[];
  /** Esas sesiones con sus instantes (misma longitud y orden que `dates`). */
  sessions: SeriesSession[];
  /** Fechas calculadas que ya han terminado y se dejan fuera (solo con `dropPast`). */
  pastDates: string[];
  /** Por qué no se puede crear (null = bien). */
  error: string | null;
}

/**
 * Lo que se va a crear: valida la regla, calcula las fechas, les pone la hora
 * del local (con el cambio de hora resuelto) y, si se va a publicar
 * (`dropPast`), deja fuera las que ya han terminado, como hace el servidor al
 * rechazarlas. Es lo que enseña la vista previa del editor y lo que manda
 * create_event_series, para que lo que se ve sea lo que se crea.
 */
export function planSeries(opts: {
  startsOn: string;
  rule: RecurrenceRule;
  startTime: string;
  endTime: string;
  timeZone?: string;
  now?: number;
  dropPast?: boolean;
}): PlannedSeries {
  const vacio = (error: string | null): PlannedSeries => ({ dates: [], sessions: [], pastDates: [], error });
  const error = validateRule(opts.startsOn, opts.rule);
  if (error) return vacio(error);
  const { dates } = expandRule(opts.startsOn, opts.rule);
  const todas = buildSessions(dates, { startTime: opts.startTime, endTime: opts.endTime }, opts.timeZone);
  if (todas.length !== dates.length) return vacio("La hora de inicio no es válida.");
  const ahora = opts.now ?? Date.now();
  const terminada = (x: SeriesSession): boolean =>
    (x.endIso ? Date.parse(x.endIso) : Date.parse(x.startIso) + SIN_FIN_MS) < ahora;
  const pastDates: string[] = [];
  const sesiones = opts.dropPast
    ? todas.filter((x) => {
        if (!terminada(x)) return true;
        pastDates.push(x.date);
        return false;
      })
    : todas;
  if (sesiones.length === 0) {
    return { dates: [], sessions: [], pastDates, error: "Todas las fechas ya han pasado. Elige fechas futuras o guárdalo como borrador." };
  }
  return { dates: sesiones.map((x) => x.date), sessions: sesiones, pastDates, error: null };
}

/** Primer error que impide crear la serie (null = bien). */
export function validateRule(startsOn: string, rule: RecurrenceRule): string | null {
  if (rule.frequency !== "custom" && !isDate(startsOn)) return "Elige la primera fecha.";
  if (rule.frequency === "custom") {
    if (rule.customDates.filter(isDate).length === 0) return "Elige al menos una fecha en el calendario.";
  } else {
    const intervalo = Number(rule.interval);
    if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 52) {
      return "«Cada» tiene que ser un número entero entre 1 y 52.";
    }
    if (rule.kind === "multi_day") {
      if (!isDate(rule.endsOn)) return "Elige el último día.";
      const dias = daysBetween(startsOn, rule.endsOn) + 1;
      if (dias < 2) return "Un evento de varios días dura al menos 2 días: el último día tiene que ser posterior al primero.";
      if (dias > MAX_MULTI_DAY) return `Un evento de varios días puede durar hasta ${MAX_MULTI_DAY} días.`;
    } else if (rule.endMode === "until") {
      if (!isDate(rule.endsOn)) return "Elige hasta qué fecha se repite.";
      if (rule.endsOn < startsOn) return "La fecha final no puede ser anterior a la primera.";
      if (daysBetween(startsOn, rule.endsOn) > MAX_SERIES_SPAN_DAYS) return "La serie puede durar hasta 2 años desde la primera fecha.";
    } else {
      const n = Number(rule.count);
      if (!Number.isInteger(n) || n < 1 || n > MAX_SERIES_SESSIONS) {
        return `El número de sesiones tiene que ser un entero entre 1 y ${MAX_SERIES_SESSIONS}.`;
      }
    }
    if (rule.frequency === "weekly" && rule.weekdays.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) {
      return "Los días de la semana no son válidos.";
    }
  }
  const { dates, truncated } = expandRule(startsOn, rule);
  if (dates.length === 0) return "Con esas opciones no sale ninguna fecha.";
  if (truncated) return `Una serie puede tener hasta ${MAX_SERIES_SESSIONS} sesiones: acorta las fechas.`;
  return null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** «16 oct 2026». */
export function formatDay(date: string, withYear = true): string {
  if (!isDate(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MESES[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** «vie 16 oct». */
export function formatDayShort(date: string): string {
  if (!isDate(date)) return date;
  const wd = WEEKDAY_NAMES[weekdayOf(date) - 1];
  return `${wd.slice(0, 3)} ${formatDay(date, false)}`;
}

const lista = (cosas: string[]): string =>
  cosas.length > 1 ? `${cosas.slice(0, -1).join(", ")} y ${cosas[cosas.length - 1]}` : (cosas[0] ?? "");

const ORDINAL = ["primer", "segundo", "tercer", "cuarto", "último"] as const;

/**
 * Cómo se repite, sin contar sesiones: «Todos los viernes y sábados», «Cada 2
 * semanas, los lunes», «El segundo viernes de cada mes», «Días seguidos»…
 * Es lo que se enseña en la página del evento (las sesiones que quedan salen
 * de la lista de fechas, no de la regla).
 */
export function describePattern(startsOn: string, rule: RecurrenceRule): string {
  if (rule.kind === "multi_day") return "Varios días seguidos";
  const cada = Math.max(1, Math.floor(rule.interval) || 1);
  switch (rule.frequency) {
    case "custom":
      return "Fechas elegidas";
    case "daily":
      return cada === 1 ? "Todos los días" : `Cada ${cada} días`;
    case "weekly": {
      const dias = [...new Set(rule.weekdays)].sort((a, b) => a - b);
      const nombres = (dias.length > 0 ? dias : isDate(startsOn) ? [weekdayOf(startsOn)] : []).map((d) => WEEKDAY_PLURAL[d - 1]);
      if (nombres.length === 0) return cada === 1 ? "Todas las semanas" : `Cada ${cada} semanas`;
      return cada === 1 ? `Todos los ${lista(nombres)}` : `Cada ${cada} semanas, los ${lista(nombres)}`;
    }
    case "monthly": {
      if (!isDate(startsOn)) return cada === 1 ? "Cada mes" : `Cada ${cada} meses`;
      const dia = Number(startsOn.slice(8));
      return rule.monthlyMode === "nth_weekday"
        ? `El ${ORDINAL[Math.min(Math.ceil(dia / 7), 5) - 1]} ${WEEKDAY_NAMES[weekdayOf(startsOn) - 1]} de ${cada === 1 ? "cada mes" : `cada ${cada} meses`}`
        : `El día ${dia} de ${cada === 1 ? "cada mes" : `cada ${cada} meses`}`;
    }
  }
}

/** La regla en una frase: «Todos los viernes y sábados · 12 sesiones hasta el 18 dic 2026». */
export function describeRule(startsOn: string, rule: RecurrenceRule): string {
  const { dates } = expandRule(startsOn, rule);
  const n = dates.length;
  const sesiones = `${n} ${n === 1 ? "sesión" : "sesiones"}`;
  const hasta = n > 0 ? ` hasta el ${formatDay(dates[n - 1])}` : "";
  if (rule.kind === "multi_day") {
    return `${n} días seguidos · del ${formatDay(startsOn)} al ${formatDay(dates[n - 1] ?? rule.endsOn)}`;
  }
  if (rule.frequency === "custom") return `Fechas elegidas · ${sesiones}`;
  return `${describePattern(startsOn, rule)} · ${sesiones}${hasta}`;
}

/** Lo que se guarda en `event_series.rule`: la regla y la primera fecha. */
export interface StoredRule extends RecurrenceRule {
  v: 1;
  startsOn: string;
}

export function toStoredRule(startsOn: string, rule: RecurrenceRule): StoredRule {
  return { v: 1, startsOn, ...rule };
}

/**
 * Lee `event_series.rule` con desconfianza (es JSON que escribió un cliente):
 * devuelve la regla solo si todos sus campos son los esperados, y null si no
 * (la página no enseña la frase en vez de romperse).
 */
export function parseStoredRule(value: unknown): { startsOn: string; rule: RecurrenceRule } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const kind = r.kind;
  const frequency = r.frequency;
  if (kind !== "multi_day" && kind !== "recurring") return null;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly" && frequency !== "custom") return null;
  const interval = typeof r.interval === "number" && Number.isFinite(r.interval) ? r.interval : 1;
  const weekdays = Array.isArray(r.weekdays) ? r.weekdays.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 7) : [];
  const monthlyMode = r.monthlyMode === "nth_weekday" ? "nth_weekday" : "day_of_month";
  const endMode = r.endMode === "until" ? "until" : "count";
  const startsOn = isDate(r.startsOn) ? r.startsOn : "";
  return {
    startsOn,
    rule: {
      kind,
      frequency,
      interval,
      weekdays,
      monthlyMode,
      endMode,
      endsOn: isDate(r.endsOn) ? r.endsOn : "",
      count: typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 1,
      customDates: Array.isArray(r.customDates) ? r.customDates.filter(isDate) : [],
      excluded: Array.isArray(r.excluded) ? r.excluded.filter(isDate) : [],
    },
  };
}
