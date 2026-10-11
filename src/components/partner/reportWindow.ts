import { DEFAULT_EVENT_TIMEZONE } from "@/components/tickets/ticketUtils";
import { addDaysToDate, isoToWallClock, zonedWallTimeToDate } from "@/components/partner/zonedTime";

/**
 * Ventana de días de los informes del local (PartnerReports).
 *
 * Los días se cuentan en hora de Madrid, la misma del CSV (saveOrShareFile.ts)
 * y de las entradas (ticketUtils.ts), no en la del móvil de quien mira el
 * informe: con la del navegador, una venta de las 00:30 en Madrid caía en otro
 * día visto desde Londres o Canarias, y el límite del periodo se movía con él.
 *
 * Todo el cálculo de días es de calendario (cadenas "YYYY-MM-DD") y solo el
 * límite de cada día se convierte a un instante con la hora de Madrid, así que
 * los días de 23 y 25 horas (cambios de hora) no descuadran nada.
 */

/** Zona horaria con la que se cuentan los días de los informes. */
export const ZONA_INFORMES = DEFAULT_EVENT_TIMEZONE;

const MS_DIA = 86_400_000;

/** "YYYY-MM-DD" de hoy en Madrid. */
export function hoyEnMadrid(ahora: Date = new Date()): string {
  return isoToWallClock(ahora, ZONA_INFORMES)?.date ?? ahora.toISOString().slice(0, 10);
}

/** Días entre dos "YYYY-MM-DD" (calendario puro). */
const diasEntre = (desde: string, hasta: string): number => {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / MS_DIA);
};

/** Instante (ISO) en que empieza el día "YYYY-MM-DD" en Madrid. */
const medianocheDeMadrid = (dia: string): string => {
  const [y, m, d] = dia.split("-").map(Number);
  return zonedWallTimeToDate(y, m, d, 0, 0, ZONA_INFORMES).toISOString();
};

/** Días del año en curso hasta hoy, contando los dos extremos: el 1 de enero es 1. */
export function diasDesdeEnero(ahora: Date = new Date()): number {
  const hoy = hoyEnMadrid(ahora);
  return diasEntre(`${hoy.slice(0, 4)}-01-01`, hoy) + 1;
}

export interface VentanaInforme {
  /** Días del periodo: es también el número de columnas de la gráfica. */
  dias: number;
  /** Primer día (Madrid), "YYYY-MM-DD". */
  primerDia: string;
  /** Último día = hoy en Madrid, "YYYY-MM-DD". */
  ultimoDia: string;
  /** Instante (ISO) en que empieza el primer día. Entra en el periodo. */
  inicio: string;
  /** Instante (ISO) en que acaba el último día (medianoche de mañana). No entra. */
  fin: string;
  /** Instante (ISO) en que empieza el periodo previo, de los mismos días, que acaba donde empieza este. */
  inicioPrevio: string;
}

/**
 * Los `dias` últimos días de Madrid, contando hoy: con 7 son hoy y los 6
 * anteriores. El periodo previo son los `dias` días justo antes, así que el
 * delta compara periodos de la misma longitud.
 */
export function ventanaDelInforme(dias: number, ahora: Date = new Date()): VentanaInforme {
  const n = Math.max(1, Math.floor(dias));
  const ultimoDia = hoyEnMadrid(ahora);
  const primerDia = addDaysToDate(ultimoDia, -(n - 1));
  return {
    dias: n,
    primerDia,
    ultimoDia,
    inicio: medianocheDeMadrid(primerDia),
    fin: medianocheDeMadrid(addDaysToDate(ultimoDia, 1)),
    inicioPrevio: medianocheDeMadrid(addDaysToDate(primerDia, -n)),
  };
}

export interface MomentoEnMadrid {
  /** "YYYY-MM-DD" */
  dia: string;
  /** 0-23 */
  hora: number;
  /** 0 = domingo … 6 = sábado */
  diaSemana: number;
}

/** Día, hora y día de la semana de un instante en Madrid (null si no es una fecha). */
export function momentoEnMadrid(iso: string | Date | null | undefined): MomentoEnMadrid | null {
  if (!iso) return null;
  const reloj = isoToWallClock(iso, ZONA_INFORMES);
  if (!reloj) return null;
  const [y, m, d] = reloj.date.split("-").map(Number);
  return {
    dia: reloj.date,
    hora: Number(reloj.time.slice(0, 2)),
    diaSemana: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
  };
}

/**
 * Fecha local a medianoche del día "YYYY-MM-DD": para ponerle etiqueta con
 * date-fns sin que el navegador la desplace de día (un `new Date("YYYY-MM-DD")`
 * es medianoche UTC y se vería el día anterior al oeste de Greenwich).
 */
export function fechaDeEtiqueta(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d);
}
