import { CalendarDays, Clock, Globe2, Moon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { PasifyDateInput } from "@/components/ui/pasify-date-input";
import { PasifyTimeInput } from "@/components/ui/pasify-time-input";
import { isoToWallClock, timeZoneLabel, zonedWallTimeToDate } from "@/components/partner/zonedTime";

/**
 * EventDateTimeSection — selector fecha + hora inicio + hora fin separados.
 *
 * Reemplaza el `datetime-local` único por una UI donde el partner percibe
 * con claridad la diferencia entre el DÍA del evento y las HORAS de
 * comienzo y final. Especialmente útil para eventos nocturnos que cruzan
 * medianoche (e.g. doors 23:30 → close 06:00).
 *
 * Cross-midnight smart: si endTime < startTime se interpreta como "del
 * día siguiente". El helper `composeIsoStartEnd` que vive abajo devuelve
 * tanto el ISO de inicio como el de fin con el +1 día aplicado cuando
 * procede.
 *
 * Zona horaria: el día y las horas son los del reloj DEL LOCAL
 * (`venues.timezone`), no los del móvil de quien crea el evento. Un local de
 * Canarias editado desde Madrid (o al revés) ya no se desplaza una hora. Sin
 * zona (local sin elegir, o la del local no es válida) se usa la del
 * dispositivo, como antes. Se rotula «Hora de <ciudad del local>» y, si el
 * dispositivo está en otra zona, se dice qué hora es ahora en cada sitio.
 *
 * No persiste — el padre llama a `composeIsoStartEnd(...)` antes del INSERT.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

export interface DateTimeValue {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
}

interface Props {
  value: DateTimeValue;
  onChange: (next: DateTimeValue) => void;
  disabled?: boolean;
  /** Zona horaria del local (IANA, p. ej. "Europe/Madrid"). */
  timeZone?: string;
  /** Ciudad del local, para rotular «Hora de <ciudad>». */
  placeName?: string | null;
}

/**
 * Devuelve los ISO timestamps para insertar en `events.date_start` /
 * `events.date_end`, con el día y las horas leídos en `timeZone` (la del
 * local; sin ella, la del dispositivo). Si endTime < startTime se asume
 * cross-midnight y se suma 1 día a date_end. Si date o startTime están
 * vacíos devuelve null.
 */
export const composeIsoStartEnd = (
  v: DateTimeValue,
  timeZone?: string
): { startIso: string | null; endIso: string | null; crossesMidnight: boolean } => {
  if (!v.date || !v.startTime) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }
  const [y, m, d] = v.date.split("-").map(Number);
  const [sh, sm] = v.startTime.split(":").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }
  const start = zonedWallTimeToDate(y, m, d, sh, sm, timeZone);
  if (Number.isNaN(start.getTime())) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }

  let endIso: string | null = null;
  let crossesMidnight = false;
  if (v.endTime) {
    const [eh, em] = v.endTime.split(":").map(Number);
    let end = zonedWallTimeToDate(y, m, d, eh, em, timeZone);
    if (!Number.isNaN(end.getTime())) {
      if (end <= start) {
        // Cross-midnight: nightclub style. Adelantar 1 día.
        end = zonedWallTimeToDate(y, m, d + 1, eh, em, timeZone);
        crossesMidnight = true;
      }
      endIso = end.toISOString();
    }
  }
  return { startIso: start.toISOString(), endIso, crossesMidnight };
};

/** Validación humana — devuelve mensaje de error o null si OK. */
export const validateDateTime = (v: DateTimeValue, timeZone?: string): string | null => {
  if (!v.date) return "Selecciona el día del evento";
  if (!v.startTime) return "Selecciona la hora de inicio";
  const { startIso } = composeIsoStartEnd(v, timeZone);
  if (!startIso) return "La fecha o la hora no son válidas";
  // No bloqueamos por evento "en el pasado" — el partner puede crear
  // borradores históricos para gestión interna. Sólo valida la lógica.
  return null;
};

export const EventDateTimeSection = ({ value, onChange, disabled, timeZone, placeName }: Props) => {
  const { crossesMidnight } = composeIsoStartEnd(value, timeZone);
  const label = timeZoneLabel(placeName, timeZone);
  // Solo se avisa si el reloj del local y el del dispositivo marcan ahora
  // horas distintas (Europe/Madrid y Europe/Paris dan la misma: nada que decir).
  const ahoraLocal = timeZone ? isoToWallClock(new Date(), timeZone)?.time : undefined;
  const ahoraAqui = isoToWallClock(new Date())?.time;
  const otraHora = !!ahoraLocal && !!ahoraAqui && ahoraLocal !== ahoraAqui;
  const lugar = placeName?.trim() || "el local";

  return (
    <div className="space-y-4">
      <div
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] text-foreground"
        style={mono}
        data-testid="evt-time-zone"
      >
        <Globe2 className="h-3.5 w-3.5 text-orange-500" />
        {label}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="evt-date" className="flex items-center gap-2 text-xs">
            <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
            Día del evento *
          </Label>
          <div className="mt-1.5">
            <PasifyDateInput
              id="evt-date"
              value={value.date}
              onChange={(d) => onChange({ ...value, date: d })}
              disabled={disabled}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="evt-start" className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-orange-500" />
            Hora de inicio *
          </Label>
          <div className="mt-1.5">
            <PasifyTimeInput
              id="evt-start"
              value={value.startTime}
              onChange={(t) => onChange({ ...value, startTime: t })}
              disabled={disabled}
              placeholder="23:30"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="evt-end" className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-orange-500" />
            Hora de finalización
          </Label>
          <div className="mt-1.5">
            <PasifyTimeInput
              id="evt-end"
              value={value.endTime}
              onChange={(t) => onChange({ ...value, endTime: t })}
              disabled={disabled}
              placeholder="06:00"
            />
          </div>
        </div>
      </div>

      {otraHora && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Las horas son las de {lugar}, no las de este dispositivo: ahora allí son las {ahoraLocal} y aquí las{" "}
          {ahoraAqui}. Los compradores ven la hora de {lugar}.
        </p>
      )}

      {crossesMidnight && (
        <div
          className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-500"
          style={mono}
        >
          <Moon className="h-3.5 w-3.5" />
          El evento cruza medianoche · finaliza al día siguiente
        </div>
      )}
    </div>
  );
};

export default EventDateTimeSection;
