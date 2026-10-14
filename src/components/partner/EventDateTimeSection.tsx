import { AlertTriangle, CalendarDays, Clock, Globe2, Moon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { PasifyDateInput } from "@/components/ui/pasify-date-input";
import { PasifyTimeInput } from "@/components/ui/pasify-time-input";
import { isoToWallClock, timeZoneLabel } from "@/components/partner/zonedTime";
import {
  composeIsoStartEnd,
  scheduleNotices,
  timesError,
  type DateTimeValue,
} from "@/components/partner/eventSchedule";

/**
 * EventDateTimeSection — selector fecha + hora inicio + hora fin separados.
 *
 * Reemplaza el `datetime-local` único por una UI donde el partner percibe
 * con claridad la diferencia entre el DÍA del evento y las HORAS de
 * comienzo y final. Especialmente útil para eventos nocturnos que cruzan
 * medianoche (e.g. doors 23:30 → close 06:00).
 *
 * Cross-midnight smart: si endTime < startTime se interpreta como "del
 * día siguiente". El helper `composeIsoStartEnd` (eventSchedule.ts) devuelve
 * tanto el ISO de inicio como el de fin con el +1 día aplicado cuando
 * procede. Una hora de fin IGUAL a la de inicio no se convierte en 24 h:
 * se rechaza (`validateDateTime`, que también está ahí).
 *
 * Avisos que no bloquean (`scheduleNotices`): un evento de más de 14 h, y una
 * hora que no existe o se repite por el cambio de hora (en España, el último
 * domingo de marzo y de octubre).
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

export type { DateTimeValue } from "@/components/partner/eventSchedule";

interface Props {
  value: DateTimeValue;
  onChange: (next: DateTimeValue) => void;
  disabled?: boolean;
  /** Zona horaria del local (IANA, p. ej. "Europe/Madrid"). */
  timeZone?: string;
  /** Ciudad del local, para rotular «Hora de <ciudad>». */
  placeName?: string | null;
  /** Rótulo del día («Día del evento» por defecto; «Primer día» en una serie). */
  dateLabel?: string;
  /** Solo las horas: el día lo pide quien lo usa (una serie de fechas elegidas a mano). */
  hideDate?: boolean;
}

export const EventDateTimeSection = ({
  value,
  onChange,
  disabled,
  timeZone,
  placeName,
  dateLabel = "Día del evento",
  hideDate = false,
}: Props) => {
  const { crossesMidnight } = composeIsoStartEnd(value, timeZone);
  const label = timeZoneLabel(placeName, timeZone);
  // Solo se avisa si el reloj del local y el del dispositivo marcan ahora
  // horas distintas (Europe/Madrid y Europe/Paris dan la misma: nada que decir).
  const ahoraLocal = timeZone ? isoToWallClock(new Date(), timeZone)?.time : undefined;
  const ahoraAqui = isoToWallClock(new Date())?.time;
  const otraHora = !!ahoraLocal && !!ahoraAqui && ahoraLocal !== ahoraAqui;
  const lugar = placeName?.trim() || "el local";
  const errorHoras = timesError(value);
  const avisos = scheduleNotices(value, timeZone, lugar);

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
        {!hideDate && (
          <div className="sm:col-span-2">
            <Label htmlFor="evt-date" className="flex items-center gap-2 text-xs">
              <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
              {dateLabel} *
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
        )}
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

      {errorHoras && (
        <p className="text-[11px] leading-relaxed text-destructive" role="alert" data-testid="evt-error-horas">
          {errorHoras}
        </p>
      )}

      {avisos.map((aviso) => (
        <div
          key={aviso.id}
          className="flex items-start gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-[12px] leading-relaxed text-orange-200"
          role="status"
          data-testid="evt-aviso-horario"
        >
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-orange-500" />
          <span>{aviso.text}</span>
        </div>
      ))}

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
