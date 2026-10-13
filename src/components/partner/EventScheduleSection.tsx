import { useMemo, useState } from "react";
import { CalendarDays, CalendarRange, Repeat, X as XIcon } from "lucide-react";
import { es } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasifyDateInput } from "@/components/ui/pasify-date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EventDateTimeSection } from "@/components/partner/EventDateTimeSection";
import type { DateTimeValue } from "@/components/partner/eventSchedule";
import { addDaysToDate } from "@/components/partner/zonedTime";
import { ruleOf, type ScheduleKind, type ScheduleValue } from "@/components/partner/eventScheduleValue";
import {
  MAX_MULTI_DAY,
  MAX_SERIES_SESSIONS,
  WEEKDAY_LETTERS,
  WEEKDAY_NAMES,
  defaultRule,
  describeRule,
  expandRule,
  formatDayShort,
  isDate,
  planSeries,
  weekdayOf,
  type Frequency,
  type MonthlyMode,
  type RecurrenceRule,
} from "@/lib/recurrence";

/**
 * EventScheduleSection — «Cuándo»: una fecha, varios días seguidos o un evento
 * que se repite.
 *
 *   - Una fecha: el selector de siempre (EventDateTimeSection).
 *   - Varios días seguidos: primer y último día, con las mismas horas cada día.
 *   - Se repite: cada día, semana (con los días de la semana que se quieran) o
 *     mes, o fechas elegidas a mano; termina en una fecha o tras N sesiones.
 *
 * En una serie cada fecha es un evento de verdad, con sus propias entradas,
 * aforo y ventas (create_event_series). La vista previa enseña exactamente las
 * fechas que se van a crear y deja quitar las que no (un festivo, un cierre).
 *
 * No guarda nada: es un formulario controlado (`schedule` + `dateTime`).
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

interface Props {
  schedule: ScheduleValue;
  onScheduleChange: (next: ScheduleValue) => void;
  dateTime: DateTimeValue;
  onDateTimeChange: (next: DateTimeValue) => void;
  disabled?: boolean;
  /** Zona horaria del local (IANA). */
  timeZone?: string;
  /** Ciudad del local, para rotular «Hora de <ciudad>». */
  placeName?: string | null;
  /** Se va a publicar: las fechas que ya han terminado no se crean. */
  publishing?: boolean;
}

const KINDS: Array<{ kind: ScheduleKind; label: string; hint: string; icon: typeof CalendarDays }> = [
  { kind: "single", label: "Una fecha", hint: "Un solo día", icon: CalendarDays },
  { kind: "multi_day", label: "Varios días", hint: "Días seguidos, como un festival", icon: CalendarRange },
  { kind: "recurring", label: "Se repite", hint: "Cada semana, cada mes o fechas sueltas", icon: Repeat },
];

const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: "daily", label: "Cada día" },
  { value: "weekly", label: "Cada semana" },
  { value: "monthly", label: "Cada mes" },
  { value: "custom", label: "Fechas elegidas" },
];

const UNIT: Record<"daily" | "weekly" | "monthly", [string, string]> = {
  daily: ["día", "días"],
  weekly: ["semana", "semanas"],
  monthly: ["mes", "meses"],
};

const ORDINAL_MASC = ["primer", "segundo", "tercer", "cuarto", "último"] as const;

/** Fechas que se enseñan antes de «Ver todas». */
const CHIPS_VISIBLES = 12;

const hoy = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const EventScheduleSection = ({
  schedule,
  onScheduleChange,
  dateTime,
  onDateTimeChange,
  disabled,
  timeZone,
  placeName,
  publishing = false,
}: Props) => {
  const { kind } = schedule;
  const rule = ruleOf(schedule);
  const custom = kind === "recurring" && rule.frequency === "custom";

  const cambiarRegla = (cambios: Partial<RecurrenceRule>) => onScheduleChange({ ...schedule, rule: { ...schedule.rule, ...cambios } });

  const cambiarTipo = (nuevo: ScheduleKind) => {
    if (nuevo === kind) return;
    if (nuevo === "single") {
      onScheduleChange({ kind: "single", rule: schedule.rule });
      return;
    }
    if (nuevo === "multi_day") {
      const base = defaultRule("multi_day");
      onScheduleChange({
        kind: "multi_day",
        rule: { ...base, endMode: "until", endsOn: dateTime.date ? addDaysToDate(dateTime.date, 2) : "" },
      });
      return;
    }
    onScheduleChange({ kind: "recurring", rule: defaultRule("recurring") });
  };

  const cambiarPrimerDia = (date: string) => {
    onDateTimeChange({ ...dateTime, date });
    // Varios días: si el último día queda antes del primero (o sin poner), se acerca.
    if (kind === "multi_day" && date && (!isDate(rule.endsOn) || rule.endsOn <= date)) {
      cambiarRegla({ endsOn: addDaysToDate(date, 2) });
    }
  };

  const cambiarFrecuencia = (frequency: Frequency) => {
    cambiarRegla({ frequency, excluded: [] });
    // Fechas elegidas: la «primera fecha» es la primera de las elegidas.
    if (frequency === "custom") {
      const primera = [...schedule.rule.customDates].sort()[0];
      if (primera && primera !== dateTime.date) onDateTimeChange({ ...dateTime, date: primera });
    }
  };

  const cambiarFechasElegidas = (fechas: string[]) => {
    const ordenadas = [...new Set(fechas)].sort();
    cambiarRegla({ customDates: ordenadas, excluded: [] });
    const primera = ordenadas[0] ?? "";
    if (primera !== dateTime.date) onDateTimeChange({ ...dateTime, date: primera });
  };

  // Lo que se crearía: la misma cuenta que hace el envío (planSeries).
  const plan = useMemo(
    () =>
      kind === "single"
        ? null
        : planSeries({
            startsOn: dateTime.date,
            rule,
            startTime: dateTime.startTime,
            endTime: dateTime.endTime,
            timeZone,
            dropPast: publishing,
          }),
    // `rule` se rehace en cada render: sus partes son las dependencias de verdad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, dateTime.date, dateTime.startTime, dateTime.endTime, timeZone, publishing, schedule.rule, schedule.kind],
  );
  const expansion = useMemo(
    () => (kind === "single" ? null : expandRule(dateTime.date, rule)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, dateTime.date, schedule.rule, schedule.kind],
  );

  return (
    <div className="space-y-5" data-testid="evt-schedule">
      <div role="radiogroup" aria-label="Tipo de evento según sus fechas" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {KINDS.map(({ kind: k, label, hint, icon: Icon }) => {
          const activo = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={activo}
              disabled={disabled}
              onClick={() => cambiarTipo(k)}
              data-testid={`sched-kind-${k}`}
              className={`flex items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                activo ? "border-orange-500/60 bg-orange-500/10" : "border-border bg-card hover:border-orange-500/30"
              }`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${activo ? "text-orange-500" : "text-muted-foreground"}`} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {kind === "single" && (
        <EventDateTimeSection
          value={dateTime}
          onChange={onDateTimeChange}
          disabled={disabled}
          timeZone={timeZone}
          placeName={placeName}
        />
      )}

      {kind === "multi_day" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="evt-date" className="text-xs">
                Primer día *
              </Label>
              <div className="mt-1.5">
                <PasifyDateInput id="evt-date" value={dateTime.date} onChange={cambiarPrimerDia} disabled={disabled} />
              </div>
            </div>
            <div>
              <Label htmlFor="sched-last-day" className="text-xs">
                Último día *
              </Label>
              <div className="mt-1.5">
                <PasifyDateInput
                  id="sched-last-day"
                  value={rule.endsOn}
                  onChange={(d) => cambiarRegla({ endsOn: d, excluded: [] })}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Cada día es una fecha con sus propias entradas, aforo y ventas (hasta {MAX_MULTI_DAY} días). La hora de inicio y de fin es
            la misma todos los días.
          </p>
          <EventDateTimeSection
            value={dateTime}
            onChange={onDateTimeChange}
            disabled={disabled}
            timeZone={timeZone}
            placeName={placeName}
            hideDate
          />
        </div>
      )}

      {kind === "recurring" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sched-frequency" className="text-xs">
                Se repite *
              </Label>
              <Select value={rule.frequency} onValueChange={(v) => cambiarFrecuencia(v as Frequency)} disabled={disabled}>
                <SelectTrigger id="sched-frequency" className="mt-1.5" data-testid="sched-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!custom && (
              <div>
                <Label htmlFor="sched-interval" className="text-xs">
                  Cada
                </Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    id="sched-interval"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={52}
                    value={rule.interval}
                    disabled={disabled}
                    onChange={(e) => cambiarRegla({ interval: e.target.value === "" ? 0 : Number(e.target.value), excluded: [] })}
                    className="w-20"
                    data-testid="sched-interval"
                  />
                  <span className="text-sm text-muted-foreground">
                    {UNIT[rule.frequency as "daily" | "weekly" | "monthly"][rule.interval === 1 ? 0 : 1]}
                  </span>
                </div>
              </div>
            )}
          </div>

          {rule.frequency === "weekly" && (
            <WeekdayPicker
              value={rule.weekdays.length > 0 ? rule.weekdays : isDate(dateTime.date) ? [weekdayOf(dateTime.date)] : []}
              disabled={disabled}
              onChange={(weekdays) => cambiarRegla({ weekdays, excluded: [] })}
            />
          )}

          {rule.frequency === "monthly" && isDate(dateTime.date) && (
            <MonthlyModePicker
              value={rule.monthlyMode}
              date={dateTime.date}
              disabled={disabled}
              onChange={(monthlyMode) => cambiarRegla({ monthlyMode, excluded: [] })}
            />
          )}

          {custom ? (
            <CustomDates value={rule.customDates} disabled={disabled} onChange={cambiarFechasElegidas} />
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium">Termina</legend>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="sched-end-mode"
                      checked={rule.endMode === "count"}
                      disabled={disabled}
                      onChange={() => cambiarRegla({ endMode: "count", excluded: [] })}
                      data-testid="sched-end-count"
                    />
                    Después de
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_SERIES_SESSIONS}
                      aria-label="Número de fechas"
                      value={rule.count}
                      disabled={disabled || rule.endMode !== "count"}
                      onChange={(e) => cambiarRegla({ count: e.target.value === "" ? 0 : Number(e.target.value), excluded: [] })}
                      className="w-20"
                      data-testid="sched-count"
                    />
                    fechas
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="sched-end-mode"
                      checked={rule.endMode === "until"}
                      disabled={disabled}
                      onChange={() =>
                        cambiarRegla({
                          endMode: "until",
                          endsOn: isDate(rule.endsOn) ? rule.endsOn : dateTime.date ? addDaysToDate(dateTime.date, 56) : "",
                          excluded: [],
                        })
                      }
                      data-testid="sched-end-until"
                    />
                    El día
                  </label>
                  {rule.endMode === "until" && (
                    <div className="w-full sm:w-72">
                      <PasifyDateInput
                        id="sched-ends-on"
                        value={rule.endsOn}
                        onChange={(d) => cambiarRegla({ endsOn: d, excluded: [] })}
                        disabled={disabled}
                      />
                    </div>
                  )}
                </div>
              </fieldset>
              <EventDateTimeSection
                value={dateTime}
                onChange={onDateTimeChange}
                disabled={disabled}
                timeZone={timeZone}
                placeName={placeName}
                dateLabel="Empieza el"
              />
            </>
          )}

          {custom && (
            <EventDateTimeSection
              value={dateTime}
              onChange={onDateTimeChange}
              disabled={disabled}
              timeZone={timeZone}
              placeName={placeName}
              hideDate
            />
          )}
        </div>
      )}

      {kind !== "single" && plan && expansion && (
        <SeriesPreview
          startsOn={dateTime.date}
          rule={rule}
          plan={plan}
          all={expansion.all}
          excluded={rule.excluded}
          disabled={disabled}
          onExclude={(d) => cambiarRegla({ excluded: [...new Set([...schedule.rule.excluded, d])] })}
          onRestore={(d) => cambiarRegla({ excluded: schedule.rule.excluded.filter((x) => x !== d) })}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

const WeekdayPicker = ({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) => (
  <fieldset className="space-y-2">
    <legend className="text-xs font-medium">Los días</legend>
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_LETTERS.map((letra, i) => {
        const dia = i + 1;
        const activo = value.includes(dia);
        return (
          <button
            key={dia}
            type="button"
            aria-pressed={activo}
            aria-label={WEEKDAY_NAMES[i]}
            disabled={disabled}
            data-testid={`sched-weekday-${dia}`}
            onClick={() => {
              const siguiente = activo ? value.filter((d) => d !== dia) : [...value, dia].sort((a, b) => a - b);
              // Siempre queda algún día marcado: una serie sin días no tiene fechas.
              if (siguiente.length > 0) onChange(siguiente);
            }}
            className={`h-10 w-10 rounded-full border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:opacity-50 ${
              activo ? "border-orange-500 bg-orange-500 text-white" : "border-border bg-card text-muted-foreground hover:border-orange-500/40"
            }`}
          >
            {letra}
          </button>
        );
      })}
    </div>
  </fieldset>
);

const MonthlyModePicker = ({
  value,
  date,
  onChange,
  disabled,
}: {
  value: MonthlyMode;
  date: string;
  onChange: (next: MonthlyMode) => void;
  disabled?: boolean;
}) => {
  const dia = Number(date.slice(8));
  const ordinal = ORDINAL_MASC[Math.min(Math.ceil(dia / 7), 5) - 1];
  const nombre = WEEKDAY_NAMES[weekdayOf(date) - 1];
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium">Cada mes</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="sched-monthly-mode"
          checked={value === "day_of_month"}
          disabled={disabled}
          onChange={() => onChange("day_of_month")}
          data-testid="sched-monthly-day"
        />
        El día {dia} de cada mes
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="sched-monthly-mode"
          checked={value === "nth_weekday"}
          disabled={disabled}
          onChange={() => onChange("nth_weekday")}
          data-testid="sched-monthly-nth"
        />
        El {ordinal} {nombre} de cada mes
      </label>
    </fieldset>
  );
};

const CustomDates = ({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) => {
  const [mes, setMes] = useState<Date>(() => (value[0] && isDate(value[0]) ? toDate(value[0]) : new Date()));
  const seleccionadas = useMemo(() => value.filter(isDate).map(toDate), [value]);
  return (
    <div className="space-y-2" data-testid="sched-custom">
      <p className="text-xs font-medium">Elige las fechas en el calendario *</p>
      <div className="inline-block max-w-full overflow-x-auto rounded-xl border border-border bg-card">
        <Calendar
          mode="multiple"
          locale={es}
          weekStartsOn={1}
          month={mes}
          onMonthChange={setMes}
          selected={seleccionadas}
          disabled={disabled ? () => true : { before: toDate(hoy()) }}
          onSelect={(dias) => onChange((dias ?? []).map(toIso))}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value.length === 0
          ? "Pulsa los días en que habrá evento; vuelve a pulsar uno para quitarlo."
          : `${value.length} ${value.length === 1 ? "fecha elegida" : "fechas elegidas"} (hasta ${MAX_SERIES_SESSIONS}).`}
      </p>
    </div>
  );
};

const SeriesPreview = ({
  startsOn,
  rule,
  plan,
  all,
  excluded,
  disabled,
  onExclude,
  onRestore,
}: {
  startsOn: string;
  rule: RecurrenceRule;
  plan: ReturnType<typeof planSeries>;
  /** Todas las fechas que sale de la regla (también las quitadas). */
  all: string[];
  excluded: string[];
  disabled?: boolean;
  onExclude: (date: string) => void;
  onRestore: (date: string) => void;
}) => {
  const [verTodas, setVerTodas] = useState(false);
  const quitadas = all.filter((d) => excluded.includes(d));
  const fuera = new Set(plan.pastDates);
  const visibles = verTodas ? plan.dates : plan.dates.slice(0, CHIPS_VISIBLES);
  const resumen = useMemo(() => (plan.error ? null : describeRule(startsOn, { ...rule, excluded })), [plan.error, startsOn, rule, excluded]);

  if (plan.error) {
    // Sin fecha de partida no se regaña: se espera a que se elija.
    if (!isDate(startsOn)) return null;
    return (
      <p className="text-[12px] leading-relaxed text-destructive" role="alert" data-testid="sched-error">
        {plan.error}
      </p>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Fechas que se crearán" data-testid="sched-preview">
      <div>
        <p className="text-sm font-semibold" data-testid="sched-preview-count">
          Se crearán {plan.dates.length} {plan.dates.length === 1 ? "fecha" : "fechas"}
        </p>
        {resumen && (
          <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="sched-summary">
            {resumen}
          </p>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {visibles.map((d) => (
          <li key={d}>
            <span
              data-testid={`sched-date-${d}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-xs"
              style={mono}
            >
              <span className="capitalize">{formatDayShort(d)}</span>
              <button
                type="button"
                disabled={disabled || plan.dates.length <= 1}
                onClick={() => onExclude(d)}
                aria-label={`Quitar el ${formatDayShort(d)}`}
                data-testid={`sched-exclude-${d}`}
                className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground transition hover:bg-orange-500/15 hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:opacity-40"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {plan.dates.length > CHIPS_VISIBLES && (
        <button
          type="button"
          onClick={() => setVerTodas((v) => !v)}
          className="text-xs text-orange-500 underline underline-offset-4"
          data-testid="sched-toggle-all"
        >
          {verTodas ? "Ver menos" : `Ver las ${plan.dates.length} fechas`}
        </button>
      )}

      {plan.pastDates.length > 0 && (
        <p className="text-[11px] leading-relaxed text-orange-300" role="status" data-testid="sched-past">
          {plan.pastDates.length === 1 ? "1 fecha ya ha pasado" : `${plan.pastDates.length} fechas ya han pasado`} y no se{" "}
          {plan.pastDates.length === 1 ? "crea" : "crean"} al publicar ({[...fuera].slice(0, 3).map(formatDayShort).join(", ")}
          {fuera.size > 3 ? "…" : ""}). Guárdalo como borrador si las quieres.
        </p>
      )}

      {quitadas.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">Fechas quitadas:</p>
          <ul className="flex flex-wrap gap-1.5">
            {quitadas.map((d) => (
              <li key={d}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRestore(d)}
                  aria-label={`Volver a poner el ${formatDayShort(d)}`}
                  data-testid={`sched-restore-${d}`}
                  className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground line-through transition hover:border-orange-500/50 hover:text-foreground"
                  style={mono}
                >
                  {formatDayShort(d)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default EventScheduleSection;
