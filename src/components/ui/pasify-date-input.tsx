import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

/**
 * PasifyDateInput — selector de fecha dark premium.
 *
 * Drop-in replacement de `<input type="date">` que respeta el sistema de
 * diseño Pasify (terracota + Geist Mono + dark warm). Reusa el Calendar
 * de shadcn (react-day-picker) dentro de un Popover, con locale español.
 *
 * Valor: `YYYY-MM-DD` (mismo formato que aceptaba el `type="date"`).
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const parseIso = (iso: string): Date | undefined => {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt;
};

const toIso = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface Props {
  id?: string;
  value: string; // YYYY-MM-DD
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const PasifyDateInput = ({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Selecciona una fecha",
}: Props) => {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className="group inline-flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50 disabled:cursor-not-allowed disabled:opacity-50 hover:border-orange-500/40"
        >
          <span className="inline-flex items-center gap-2 truncate">
            <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
            {selected ? (
              <span className="truncate capitalize text-foreground">
                {format(selected, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}
              </span>
            ) : (
              <span className="text-muted-foreground" style={mono}>
                {placeholder}
              </span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-orange-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto border-border bg-card p-0"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.04) inset, 0 22px 50px -22px rgba(232,84,42,0.28)",
        }}
      >
        <Calendar
          mode="single"
          locale={es}
          weekStartsOn={1}
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(toIso(d));
              setOpen(false);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
};

export default PasifyDateInput;
