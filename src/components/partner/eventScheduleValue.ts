import { defaultRule, parseStoredRule, type RecurrenceRule, type SeriesKind } from "@/lib/recurrence";

/**
 * La programación de un evento nuevo en el editor: una fecha, varios días
 * seguidos o una serie, con la regla que la describe. Lo comparten el
 * selector (EventScheduleSection) y el asistente (EventEditorWizard).
 */

export type ScheduleKind = "single" | SeriesKind;

export interface ScheduleValue {
  kind: ScheduleKind;
  rule: RecurrenceRule;
}

export const SINGLE_SCHEDULE: ScheduleValue = { kind: "single", rule: defaultRule("recurring") };

export const isSeriesSchedule = (s: ScheduleValue): boolean => s.kind !== "single";

/**
 * Lo que trae un borrador guardado en el dispositivo, comprobado: lo que no
 * es una programación válida (borradores anteriores a las series, datos
 * estropeados) es «una fecha».
 */
export function normalizeSchedule(value: unknown): ScheduleValue {
  if (!value || typeof value !== "object") return SINGLE_SCHEDULE;
  const v = value as { kind?: unknown; rule?: unknown };
  if (v.kind !== "multi_day" && v.kind !== "recurring") return SINGLE_SCHEDULE;
  const rule = v.rule && typeof v.rule === "object" ? (v.rule as Record<string, unknown>) : {};
  const parsed = parseStoredRule({ ...rule, kind: v.kind });
  return parsed ? { kind: v.kind, rule: parsed.rule } : SINGLE_SCHEDULE;
}

/** La regla con el tipo que toca: una serie de varios días es siempre diaria. */
export const ruleOf = (s: ScheduleValue): RecurrenceRule =>
  s.kind === "multi_day"
    ? { ...s.rule, kind: "multi_day", frequency: "daily", interval: 1, endMode: "until" }
    : { ...s.rule, kind: "recurring" };
