import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";

export type MonthGridEvent = {
  id: string;
  date_start: string;
  image_url: string | null;
};

interface Props<E extends MonthGridEvent> {
  cursor: Date;
  setCursor: (d: Date) => void;
  eventsByDay: Map<string, E[]>;
  selectedDay: Date | null;
  setSelectedDay: (d: Date | null) => void;
  /** Etiqueta opcional para el eyebrow (ej: "Favoritos · 04 eventos"). */
  eyebrowLabel?: string;
}

const monoStyle = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

export function MonthGrid<E extends MonthGridEvent>({
  cursor,
  setCursor,
  eventsByDay,
  selectedDay,
  setSelectedDay,
  eyebrowLabel,
}: Props<E>) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  const weekdayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const monthEventCount = Array.from(eventsByDay.entries()).reduce((acc, [k, list]) => {
    return isSameMonth(new Date(k), cursor) ? acc + list.length : acc;
  }, 0);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6"
      style={{
        boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px -8px rgba(0,0,0,0.4)",
      }}
    >
      {/* Soft terracota glow top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full"
        style={{ background: "rgba(232,84,42,0.18)", filter: "blur(80px)" }}
      />

      {/* Header */}
      <div className="relative mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div
            className="mb-1 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...monoStyle, letterSpacing: "0.2em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            {eyebrowLabel ?? `Agenda · ${monthEventCount.toString().padStart(2, "0")} eventos`}
          </div>
          <div className="truncate text-xl font-semibold capitalize tracking-tight text-foreground md:text-2xl">
            {format(cursor, "MMMM", { locale: es })}{" "}
            <span className="text-muted-foreground/80" style={monoStyle}>
              {format(cursor, "yyyy")}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="hidden rounded-full border border-border px-3 py-1.5 text-[10px] uppercase text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground sm:inline-flex"
            style={{ ...monoStyle, letterSpacing: "0.18em" }}
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-orange-500/60 hover:text-foreground"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div
        className="relative mb-2 grid grid-cols-7 gap-1.5 border-b border-border pb-2 text-center text-[10px] uppercase text-muted-foreground md:gap-2"
        style={{ ...monoStyle, letterSpacing: "0.18em" }}
      >
        {weekdayLabels.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      {/* Days grid */}
      <div className="relative mt-3 grid grid-cols-7 gap-1.5 md:gap-2">
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const hasEvents = dayEvents.length > 0;
          const isSelected = !!(selectedDay && isSameDay(selectedDay, day));
          const isToday = isSameDay(day, new Date());
          const previewImage = hasEvents ? dayEvents[0].image_url : null;

          let bg = "transparent";
          let borderColor = "transparent";
          let textColor = inMonth ? "#F4EEE2" : "rgba(244,238,226,0.25)";
          let shadow = "none";

          if (isSelected && !previewImage) {
            bg = "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)";
            textColor = "#fff";
            shadow = "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 24px -10px rgba(232,84,42,0.7)";
          } else if (hasEvents && !previewImage) {
            bg = "rgba(232,84,42,0.08)";
            borderColor = "rgba(232,84,42,0.35)";
          } else if (hasEvents && previewImage) {
            borderColor = isSelected ? "rgba(232,84,42,0.85)" : "rgba(232,84,42,0.35)";
            textColor = "#fff";
            if (isSelected) {
              shadow =
                "0 12px 30px -10px rgba(232,84,42,0.65), inset 0 1px 0 rgba(255,255,255,0.25)";
            }
          }

          return (
            <button
              key={key}
              onClick={() => setSelectedDay(isSelected ? null : day)}
              className="group/day relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl text-sm transition duration-200 hover:scale-[1.03] disabled:cursor-default"
              style={{
                background: bg,
                border: `1px solid ${borderColor}`,
                boxShadow: shadow,
                color: textColor,
              }}
              disabled={!inMonth}
            >
              {/* Event poster thumbnail */}
              {hasEvents && previewImage && (
                <>
                  <img
                    src={previewImage}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover/day:scale-110"
                    loading="lazy"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{
                      background: isSelected
                        ? "linear-gradient(165deg, rgba(255,122,77,0.78) 0%, rgba(232,84,42,0.82) 45%, rgba(184,56,26,0.88) 100%)"
                        : "linear-gradient(180deg, rgba(10,10,10,0.20) 0%, rgba(10,10,10,0.55) 55%, rgba(10,10,10,0.85) 100%)",
                    }}
                  />
                </>
              )}

              {/* Today amber dot */}
              {isToday && !isSelected && (
                <span
                  className="absolute right-1.5 top-1.5 z-10 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: "#E8B04C", boxShadow: "0 0 8px #E8B04C" }}
                  aria-label="Hoy"
                />
              )}

              {/* Day number */}
              <span
                className="relative z-[1] text-base font-semibold leading-none md:text-lg"
                style={{
                  ...monoStyle,
                  letterSpacing: isSelected ? "-0.02em" : undefined,
                  textShadow:
                    hasEvents && previewImage ? "0 1px 6px rgba(0,0,0,0.7)" : undefined,
                  color: textColor,
                }}
              >
                {format(day, "d")}
              </span>

              {/* Multi-event badge */}
              {hasEvents && dayEvents.length > 1 && (
                <span
                  className="absolute right-1.5 top-1.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
                  style={{
                    ...monoStyle,
                    background: isSelected ? "rgba(255,255,255,0.95)" : "rgba(232,84,42,0.95)",
                    color: isSelected ? "#B8381A" : "#fff",
                    boxShadow: "0 4px 10px -3px rgba(0,0,0,0.4)",
                  }}
                >
                  {dayEvents.length}
                </span>
              )}

              {/* Dots fallback for events without image */}
              {hasEvents && !previewImage && !isSelected && (
                <span
                  className="absolute bottom-1.5 inline-flex items-center gap-0.5"
                  aria-hidden="true"
                >
                  {Array.from({ length: Math.min(3, dayEvents.length) }).map((_, i) => (
                    <span
                      key={i}
                      className="inline-block h-1 w-1 rounded-full"
                      style={{
                        background: "#E8542A",
                        boxShadow: "0 0 6px rgba(232,84,42,0.65)",
                      }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MonthGrid;
