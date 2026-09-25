import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { optimizedImage } from "@/lib/image";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CalendarEvent } from "@/hooks/useEvents";

interface MonthCalendarViewProps {
  events: CalendarEvent[];
  /**
   * Tarjeta de cada evento del día elegido, con sus botones (comprar, "Mi
   * entrada"…). Tocar un día ya no compra: enseña TODOS sus eventos para
   * elegir (antes un día con varios abría la compra del primero).
   */
  renderEvent: (event: CalendarEvent) => ReactNode;
}

// Month grid view inspired by club listing sites — each day cell shows
// the poster thumbnail of the first event of the day; days with multiple
// events overlay a "N eventos" pill, days without events render an
// empty "Sin eventos" placeholder so the grid stays uniform.
const MonthCalendarView = ({ events, renderEvent }: MonthCalendarViewProps) => {
  const { t } = useTranslation();
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const selectedKey = selectedDay ? format(selectedDay, "yyyy-MM-dd") : null;
  const dayListRef = useRef<HTMLElement | null>(null);

  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    // Spanish convention: week starts on Monday.
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = format(new Date(ev.start_date), "yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  }, [events]);

  const selectedEvents = selectedKey ? eventsByDay.get(selectedKey) ?? [] : [];

  // En el móvil la lista queda por debajo del calendario: la acercamos.
  useEffect(() => {
    if (!selectedKey) return;
    requestAnimationFrame(() => {
      dayListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedKey]);

  const changeMonth = (next: Date) => {
    setViewMonth(next);
    setSelectedDay(null);
  };

  const monthLabel = format(viewMonth, "MMMM yyyy", { locale: es }).toUpperCase();
  const weekDayLabels = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div className="space-y-3">
      {/* Month switcher */}
      <div className="flex items-center justify-between rounded-2xl border border-border/40 bg-card px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => changeMonth(subMonths(viewMonth, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
          aria-label={t("calendar.previousMonth", "Mes anterior")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold tracking-wider sm:text-base">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => changeMonth(addMonths(viewMonth, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
          aria-label={t("calendar.nextMonth", "Mes siguiente")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1.5 px-1 sm:gap-3">
        {weekDayLabels.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, viewMonth);
          const firstEvent = dayEvents[0];
          const extraCount = dayEvents.length - 1;
          const dayNum = format(day, "d");
          const isSelected = !!selectedDay && isSameDay(selectedDay, day);

          return (
            <div key={key} className="flex flex-col gap-1 sm:gap-1.5">
              <span
                className={`text-center text-xs font-bold tabular-nums sm:text-sm ${
                  inMonth ? "text-foreground" : "text-muted-foreground/40"
                }`}
              >
                {dayNum}
              </span>

              {firstEvent ? (
                <button
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  aria-pressed={isSelected}
                  aria-label={`${format(day, "EEEE d 'de' MMMM", { locale: es })}: ${
                    dayEvents.length === 1 ? firstEvent.title : `${dayEvents.length} eventos`
                  }`}
                  className={`group relative aspect-square w-full overflow-hidden rounded-xl border bg-black shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    isSelected ? "border-primary ring-2 ring-primary/70" : "border-border/40"
                  }`}
                >
                  {firstEvent.image_url ? (
                    <img
                      src={optimizedImage(firstEvent.image_url, "feed")}
                      alt={firstEvent.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/30 to-primary/5">
                      <CalendarIcon className="h-5 w-5 text-primary/40" />
                    </div>
                  )}

                  {/* Partner avatar overlay (bottom-left) — shows who organizes */}
                  {firstEvent.profiles && (
                    <Avatar className="absolute bottom-1 left-1 h-5 w-5 ring-2 ring-black/70 sm:h-7 sm:w-7">
                      <AvatarImage
                        src={
                          optimizedImage(
                            firstEvent.profiles.profile_image_url || null,
                            "avatar"
                          ) || undefined
                        }
                      />
                      <AvatarFallback className="bg-primary/30 text-[8px] font-bold text-white sm:text-[10px]">
                        {(firstEvent.profiles.business_name ||
                          firstEvent.profiles.first_name ||
                          "?")
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}

                  {extraCount > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[1px]">
                      <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-wider text-white sm:text-xs">
                        {extraCount + 1}
                        <br />
                        {t("calendar.eventsLabel", "eventos")}
                      </span>
                    </div>
                  )}
                </button>
              ) : (
                <div
                  className={`flex aspect-square w-full items-center justify-center rounded-xl border border-dashed text-[8px] font-semibold uppercase tracking-wider sm:text-[10px] ${
                    inMonth
                      ? "border-border/30 text-muted-foreground/50"
                      : "border-border/20 text-muted-foreground/25"
                  }`}
                >
                  {t("calendar.noEventsShort", "Sin eventos")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Eventos del día elegido: se elige cuál comprar */}
      {selectedDay && selectedEvents.length > 0 && (
        <section
          ref={dayListRef}
          aria-label={t("calendar.dayEvents", "Eventos del día")}
          className="scroll-mt-20 pt-5"
        >
          <h3 className="mb-3 text-lg font-bold capitalize tracking-tight sm:text-xl">
            {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            {selectedEvents.map((ev) => (
              <Fragment key={ev.id}>{renderEvent(ev)}</Fragment>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default MonthCalendarView;
