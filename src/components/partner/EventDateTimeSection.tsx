import { CalendarDays, Clock, Moon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
}

/**
 * Devuelve los ISO timestamps para insertar en `events.date_start` /
 * `events.date_end`. Si endTime < startTime se asume cross-midnight y se
 * suma 1 día a date_end. Si date o startTime están vacíos devuelve null.
 */
export const composeIsoStartEnd = (
  v: DateTimeValue
): { startIso: string | null; endIso: string | null; crossesMidnight: boolean } => {
  if (!v.date || !v.startTime) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }
  // Construimos como local time (timezone del usuario) y convertimos a ISO UTC.
  const [y, m, d] = v.date.split("-").map(Number);
  const [sh, sm] = v.startTime.split(":").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }
  const start = new Date(y, m - 1, d, sh, sm, 0, 0);
  if (Number.isNaN(start.getTime())) {
    return { startIso: null, endIso: null, crossesMidnight: false };
  }

  let endIso: string | null = null;
  let crossesMidnight = false;
  if (v.endTime) {
    const [eh, em] = v.endTime.split(":").map(Number);
    let end = new Date(y, m - 1, d, eh, em, 0, 0);
    if (!Number.isNaN(end.getTime())) {
      if (end <= start) {
        // Cross-midnight: nightclub style. Adelantar 1 día.
        end = new Date(y, m - 1, d + 1, eh, em, 0, 0);
        crossesMidnight = true;
      }
      endIso = end.toISOString();
    }
  }
  return { startIso: start.toISOString(), endIso, crossesMidnight };
};

/** Validación humana — devuelve mensaje de error o null si OK. */
export const validateDateTime = (v: DateTimeValue): string | null => {
  if (!v.date) return "Selecciona el día del evento";
  if (!v.startTime) return "Selecciona la hora de inicio";
  const { startIso } = composeIsoStartEnd(v);
  if (!startIso) return "La fecha o la hora no son válidas";
  // No bloqueamos por evento "en el pasado" — el partner puede crear
  // borradores históricos para gestión interna. Sólo valida la lógica.
  return null;
};

export const EventDateTimeSection = ({ value, onChange, disabled }: Props) => {
  const { crossesMidnight } = composeIsoStartEnd(value);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Label htmlFor="evt-date" className="flex items-center gap-2 text-xs">
            <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
            Día del evento *
          </Label>
          <Input
            id="evt-date"
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            disabled={disabled}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="evt-start" className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-orange-500" />
            Hora de inicio *
          </Label>
          <Input
            id="evt-start"
            type="time"
            value={value.startTime}
            onChange={(e) => onChange({ ...value, startTime: e.target.value })}
            disabled={disabled}
            className="mt-1.5"
            placeholder="23:30"
          />
        </div>
        <div>
          <Label htmlFor="evt-end" className="flex items-center gap-2 text-xs">
            <Clock className="h-3.5 w-3.5 text-orange-500" />
            Hora de finalización
          </Label>
          <Input
            id="evt-end"
            type="time"
            value={value.endTime}
            onChange={(e) => onChange({ ...value, endTime: e.target.value })}
            disabled={disabled}
            className="mt-1.5"
            placeholder="06:00"
          />
        </div>
        <div className="hidden sm:block">
          <Label className="text-xs invisible">spacer</Label>
          <div className="mt-1.5 flex h-10 items-center text-[11px] text-muted-foreground">
            <span style={mono}>Zona horaria local</span>
          </div>
        </div>
      </div>

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
