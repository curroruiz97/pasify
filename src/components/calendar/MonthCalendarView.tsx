import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
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
import type { CalendarEvent } from "./EventListCard";

interface MonthCalendarViewProps {
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}

// Month grid view inspired by club listing sites — each day cell shows
// the poster thumbnail of the first event of the day; days with multiple
// events overlay a "+N eventos" pill, days without events render an
// empty "Sin eventos" placeholder so the grid stays uniform.
const MonthCalendarView = ({ events, onEventClick }: MonthCalendarViewProps) => {
  const { t } = useTranslation();
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date());

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

  const monthLabel = format(viewMonth, "MMMM yyyy", { locale: es }).toUpperCase();
  const weekDayLabels = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div className="space-y-3">
      {/* Month switcher */}
      <div className="flex items-center justify-between rounded-2xl border border-border/40 bg-card px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => setViewMonth((prev) => subMonths(prev, 1))}
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
          onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
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
                  onClick={() => onEventClick(firstEvent)}
                  className="group relative aspect-square w-full overflow-hidden rounded-xl border border-border/40 bg-black shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
    </div>
  );
};

export default MonthCalendarView;
