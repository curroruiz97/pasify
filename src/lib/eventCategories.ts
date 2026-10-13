/**
 * Clasificación de los eventos (`events.category`).
 *
 * Hoy: Bar, Discoteca y Festival. El local ya tiene su propia categoría
 * (`business_category`: discoteca, club, sala, bar, rooftop, beachclub,
 * festival, restaurante, teatro, otro) y NO se toca; esto clasifica cada
 * evento, que puede ser de otra cosa que su local (un festival en una
 * discoteca).
 *
 * Los eventos que ya existen no tienen categoría (`null`) y no se reescriben:
 * hasta que el local los clasifique (al crear o al editar), se ven con la de
 * su local si esta coincide con una de aquí (`effectiveEventCategory`). Así los
 * filtros públicos dan resultados reales desde el primer día sin inventar datos.
 *
 * Para añadir una categoría: aquí y en el CHECK de `events.category`
 * (migración 20261013120000_eventos_categoria.sql).
 */

export const EVENT_CATEGORIES = [
  { value: "bar", label: "Bar", plural: "Bares" },
  { value: "discoteca", label: "Discoteca", plural: "Discotecas" },
  { value: "festival", label: "Festival", plural: "Festivales" },
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number]["value"];

export const isEventCategory = (value: unknown): value is EventCategory =>
  typeof value === "string" && EVENT_CATEGORIES.some((c) => c.value === value);

/** «Discoteca» (o null si no es una categoría de evento). */
export const eventCategoryLabel = (value: string | null | undefined): string | null =>
  EVENT_CATEGORIES.find((c) => c.value === value)?.label ?? null;

/**
 * Categoría de local → categoría de evento, solo donde coinciden. «Club» es
 * una discoteca; sala, rooftop, beach club, restaurante, teatro y otro no
 * dicen de qué es el evento y quedan sin clasificar.
 */
const DESDE_LOCAL: Record<string, EventCategory> = {
  bar: "bar",
  discoteca: "discoteca",
  club: "discoteca",
  festival: "festival",
};

export function eventCategoryFromVenue(venueCategory: string | null | undefined): EventCategory | null {
  const key = (venueCategory ?? "").trim().toLowerCase();
  return DESDE_LOCAL[key] ?? null;
}

/**
 * Con qué categoría se clasifica un evento en los filtros: la suya y, si no
 * tiene, la de su local cuando coincide con una de las de evento.
 */
export function effectiveEventCategory(
  category: string | null | undefined,
  venueCategory?: string | null,
): EventCategory | null {
  if (isEventCategory(category)) return category;
  return eventCategoryFromVenue(venueCategory);
}
