import { eventTimeWindow } from "@/lib/pickActiveEvent";

/**
 * Pestañas de Mis eventos (WP2.4): «Próximos», «Borradores» y «Pasados».
 *
 *   - Borradores: todo lo que está en borrador (sin publicar, o retirado de la
 *     venta), con fecha pasada o futura: su estado es lo que manda.
 *   - Pasados: los terminados (fin = date_end o inicio + 12 h, como la puerta)
 *     y los que el cron ya ha pasado a 'past'. Un cancelado va por su fecha.
 *   - Próximos: el resto, también el que se está celebrando ahora.
 *
 * Orden: próximos y borradores por fecha (el más cercano primero); pasados,
 * el más reciente primero.
 */

export type EventTab = "proximos" | "borradores" | "pasados";

export const EVENT_TABS: ReadonlyArray<{ id: EventTab; label: string }> = [
  { id: "proximos", label: "Próximos" },
  { id: "borradores", label: "Borradores" },
  { id: "pasados", label: "Pasados" },
];

export const isEventTab = (v: unknown): v is EventTab =>
  v === "proximos" || v === "borradores" || v === "pasados";

interface TabbableEvent {
  title: string;
  status: string;
  date_start: string;
  date_end?: string | null;
}

export const eventTab = (e: TabbableEvent, now: number = Date.now()): EventTab => {
  if (e.status === "draft") return "borradores";
  if (e.status === "past") return "pasados";
  const span = eventTimeWindow(e);
  return span && span.end < now ? "pasados" : "proximos";
};

/** Sin mayúsculas ni tildes: «festival» encuentra «FESTIVAL de Otoño». */
export const normalizeSearch = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const matchesTitle = (title: string, query: string): boolean => {
  const q = normalizeSearch(query);
  return !q || normalizeSearch(title).includes(q);
};

const inicio = (e: TabbableEvent) => {
  const t = Date.parse(e.date_start);
  return Number.isFinite(t) ? t : 0;
};

/** Eventos repartidos por pestaña (y filtrados por título), ya ordenados. */
export function groupEventsByTab<T extends TabbableEvent>(
  events: ReadonlyArray<T>,
  query = "",
  now: number = Date.now()
): Record<EventTab, T[]> {
  const out: Record<EventTab, T[]> = { proximos: [], borradores: [], pasados: [] };
  for (const e of events) {
    if (!matchesTitle(e.title, query)) continue;
    out[eventTab(e, now)].push(e);
  }
  out.proximos.sort((a, b) => inicio(a) - inicio(b));
  out.borradores.sort((a, b) => inicio(a) - inicio(b));
  out.pasados.sort((a, b) => inicio(b) - inicio(a));
  return out;
}
