import {
  addDaysToDate,
  isoToWallClock,
  parseHm,
  wallTimeIssue,
  zonedWallTimeToDate,
  type WallTimeIssue,
} from "@/components/partner/zonedTime";

/**
 * Día y horas de un evento (lo que escribe EventDateTimeSection) y lo que de
 * ellos sale: los instantes que se guardan, los errores que impiden guardar y
 * los avisos que no.
 *
 * Todo en la hora de reloj DEL LOCAL (`venues.timezone`; sin ella, la del
 * dispositivo). Funciones puras, sin React.
 */

export interface DateTimeValue {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
}

/**
 * Devuelve los ISO timestamps para insertar en `events.date_start` /
 * `events.date_end`, con el día y las horas leídos en `timeZone` (la del
 * local; sin ella, la del dispositivo). Si endTime < startTime se asume
 * cross-midnight y se suma 1 día a date_end. Si date o startTime están
 * vacíos (o no son una hora HH:mm válida) devuelve null. Un endTime igual a
 * startTime, o que no es una hora válida, no da fin (endIso null):
 * `validateDateTime` lo rechaza antes de guardar.
 */
export const composeIsoStartEnd = (
  v: DateTimeValue,
  timeZone?: string
): { startIso: string | null; endIso: string | null; crossesMidnight: boolean } => {
  const nulos = { startIso: null, endIso: null, crossesMidnight: false };
  if (!v.date || !v.startTime) return nulos;
  const [y, m, d] = v.date.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return nulos;
  const inicio = parseHm(v.startTime);
  if (!inicio) return nulos;
  const start = zonedWallTimeToDate(y, m, d, inicio.h, inicio.m, timeZone);
  if (Number.isNaN(start.getTime())) return nulos;

  let endIso: string | null = null;
  let crossesMidnight = false;
  const fin = parseHm(v.endTime);
  if (fin && (fin.h !== inicio.h || fin.m !== inicio.m)) {
    // Cross-midnight: nightclub style. Un fin más temprano que el inicio es
    // del día siguiente.
    crossesMidnight = fin.h * 60 + fin.m < inicio.h * 60 + inicio.m;
    const end = zonedWallTimeToDate(y, m, crossesMidnight ? d + 1 : d, fin.h, fin.m, timeZone);
    if (!Number.isNaN(end.getTime())) endIso = end.toISOString();
  }
  return { startIso: start.toISOString(), endIso, crossesMidnight };
};

/**
 * Error de las horas escritas, o null: una hora que no es HH:mm (de 00:00 a
 * 23:59) y un fin igual al inicio (que antes se daba por un evento de 24 h).
 * Con la hora de inicio vacía no dice nada (eso lo pide «Siguiente»).
 */
export const timesError = (v: DateTimeValue): string | null => {
  if (!v.startTime) return null;
  const inicio = parseHm(v.startTime);
  if (!inicio) return "La hora de inicio no es válida: tiene que ser una hora entre 00:00 y 23:59. Elígela de nuevo.";
  if (!v.endTime) return null;
  const fin = parseHm(v.endTime);
  if (!fin) return "La hora de finalización no es válida: tiene que ser una hora entre 00:00 y 23:59. Elígela de nuevo.";
  if (fin.h === inicio.h && fin.m === inicio.m) {
    return "La hora de finalización es la misma que la de inicio. Elige otra; si el evento termina de madrugada, pon la hora a la que acaba y se tomará como del día siguiente.";
  }
  return null;
};

/** Validación humana — devuelve mensaje de error o null si OK. */
export const validateDateTime = (v: DateTimeValue, timeZone?: string): string | null => {
  if (!v.date) return "Selecciona el día del evento";
  if (!v.startTime) return "Selecciona la hora de inicio";
  const horas = timesError(v);
  if (horas) return horas;
  const { startIso } = composeIsoStartEnd(v, timeZone);
  if (!startIso) return "La fecha o la hora no son válidas";
  // No bloqueamos por evento "en el pasado" — el partner puede crear
  // borradores históricos para gestión interna. Sólo valida la lógica; al
  // publicar con el inicio ya pasado, el asistente pide confirmación.
  return null;
};

/** Duración a partir de la cual se avisa (no se bloquea): una noche larga son 8 o 10 horas. */
export const LONG_EVENT_HOURS = 14;

export interface ScheduleNotice {
  id: "largo" | "inicio-hora" | "fin-hora";
  text: string;
}

const horasEnTexto = (horas: number): string =>
  `${Number.isInteger(horas) ? horas : horas.toFixed(1).replace(".", ",")} h`;

/** Aviso de una hora que no existe o se repite por el cambio de hora. */
const avisoCambioDeHora = (
  cual: "inicio" | "fin",
  issue: WallTimeIssue,
  escrita: string,
  iso: string | null,
  timeZone: string | undefined,
  lugar: string
): ScheduleNotice => {
  const id = cual === "inicio" ? "inicio-hora" : "fin-hora";
  const de = cual === "inicio" ? "inicio" : "finalización";
  if (issue === "gap") {
    const resuelta = iso ? isoToWallClock(iso, timeZone)?.time : undefined;
    return {
      id,
      text:
        `La hora de ${de} (${escrita}) no existe ese día en ${lugar}: por el cambio de hora los relojes se adelantan.` +
        (resuelta ? ` El evento ${cual === "inicio" ? "empezará" : "terminará"} a las ${resuelta}.` : ""),
    };
  }
  return {
    id,
    text:
      `La hora de ${de} (${escrita}) se repite ese día en ${lugar}: por el cambio de hora los relojes se atrasan y esa hora pasa dos veces.` +
      " Se toma la segunda; si no es la que quieres, elige otra hora.",
  };
};

/**
 * Avisos que no impiden guardar: un evento de más de 14 horas (por si la hora
 * de fin está mal) y horas que no existen o se repiten por el cambio de hora
 * (en España, el último domingo de marzo y de octubre).
 * Vacío mientras falten el día o la hora de inicio.
 */
export const scheduleNotices = (v: DateTimeValue, timeZone?: string, lugar = "el local"): ScheduleNotice[] => {
  const avisos: ScheduleNotice[] = [];
  const inicio = parseHm(v.startTime);
  const [y, m, d] = (v.date ?? "").split("-").map(Number);
  if (!inicio || !Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return avisos;
  const { startIso, endIso, crossesMidnight } = composeIsoStartEnd(v, timeZone);

  const enInicio = wallTimeIssue(y, m, d, inicio.h, inicio.m, timeZone);
  if (enInicio) avisos.push(avisoCambioDeHora("inicio", enInicio, v.startTime, startIso, timeZone, lugar));

  const fin = parseHm(v.endTime);
  if (fin && endIso) {
    // El día de la hora de fin: el mismo, o el siguiente si cruza medianoche.
    const [fy, fm, fd] = addDaysToDate(v.date, crossesMidnight ? 1 : 0).split("-").map(Number);
    const enFin = wallTimeIssue(fy, fm, fd, fin.h, fin.m, timeZone);
    if (enFin) avisos.push(avisoCambioDeHora("fin", enFin, v.endTime, endIso, timeZone, lugar));
  }

  if (startIso && endIso) {
    const horas = (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
    if (horas > LONG_EVENT_HOURS) {
      avisos.push({
        id: "largo",
        text: `El evento dura ${horasEnTexto(horas)} (de ${v.startTime} a ${v.endTime}${
          crossesMidnight ? " del día siguiente" : ""
        }). Es más de lo habitual: revisa que la hora de finalización sea la correcta.`,
      });
    }
  }
  return avisos;
};
