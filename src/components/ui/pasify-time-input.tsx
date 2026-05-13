import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * PasifyTimeInput — selector HH:mm dark premium.
 *
 * Drop-in replacement de `<input type="time">`. Popover con dos columnas
 * scrollables: horas (00–23) y minutos (step 5 por defecto). Sigue el
 * sistema de diseño Pasify (Geist Mono + terracota + warm dark).
 *
 * Valor: `HH:mm` (24h). Mismo formato que el `type="time"` original.
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_STEP = 5;
const MINUTES = Array.from(
  { length: Math.ceil(60 / MINUTE_STEP) },
  (_, i) => String(i * MINUTE_STEP).padStart(2, "0")
);

const splitValue = (v: string): { hh: string; mm: string } => {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(v ?? "");
  if (!m) return { hh: "", mm: "" };
  const hh = String(Math.min(23, Math.max(0, parseInt(m[1], 10)))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, parseInt(m[2], 10)))).padStart(2, "0");
  return { hh, mm };
};

interface Props {
  id?: string;
  value: string; // HH:mm
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const PasifyTimeInput = ({
  id,
  value,
  onChange,
  disabled,
  placeholder = "HH:mm",
}: Props) => {
  const [open, setOpen] = useState(false);
  const { hh, mm } = useMemo(() => splitValue(value), [value]);
  const hoursListRef = useRef<HTMLDivElement | null>(null);
  const minutesListRef = useRef<HTMLDivElement | null>(null);

  // Al abrir, autoscroll a la hora/minuto seleccionado para que se vea.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      hoursListRef.current
        ?.querySelector<HTMLElement>('[data-current="true"]')
        ?.scrollIntoView({ block: "center" });
      minutesListRef.current
        ?.querySelector<HTMLElement>('[data-current="true"]')
        ?.scrollIntoView({ block: "center" });
    }, 10);
    return () => window.clearTimeout(t);
  }, [open]);

  const setHour = (newHh: string) => {
    const next = `${newHh}:${mm || "00"}`;
    onChange(next);
  };
  const setMinute = (newMm: string) => {
    const next = `${hh || "00"}:${newMm}`;
    onChange(next);
    setOpen(false);
  };

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
            <Clock className="h-3.5 w-3.5 text-orange-500" />
            {hh && mm ? (
              <span className="font-semibold tracking-wide text-foreground" style={mono}>
                {hh}:{mm}h
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
        className="w-auto overflow-hidden border-border bg-card p-0"
        style={{
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.04) inset, 0 22px 50px -22px rgba(232,84,42,0.28)",
        }}
      >
        <div
          className="grid grid-cols-2"
          style={{ width: 192 }}
        >
          {/* Hours */}
          <div className="border-r border-border">
            <div
              className="border-b border-border bg-card/80 px-3 py-2 text-center text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              Hora
            </div>
            <div
              ref={hoursListRef}
              className="scrollbar-pasify h-56 overflow-y-auto py-1"
            >
              {HOURS.map((h) => {
                const current = h === hh;
                return (
                  <button
                    type="button"
                    key={h}
                    onClick={() => setHour(h)}
                    data-current={current ? "true" : "false"}
                    className={`block w-full px-3 py-1.5 text-center text-sm transition ${
                      current
                        ? "bg-orange-500/15 text-orange-300"
                        : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
                    }`}
                    style={mono}
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Minutes */}
          <div>
            <div
              className="border-b border-border bg-card/80 px-3 py-2 text-center text-[10px] uppercase text-muted-foreground"
              style={{ ...mono, letterSpacing: "0.2em" }}
            >
              Min · 5
            </div>
            <div
              ref={minutesListRef}
              className="scrollbar-pasify h-56 overflow-y-auto py-1"
            >
              {MINUTES.map((m) => {
                // Marcamos como current si coincide exactamente con mm, o si
                // mm cae en el bucket de 5 minutos correspondiente (e.g. mm=32
                // resalta el "30").
                const mmInt = parseInt(mm || "0", 10);
                const mInt = parseInt(m, 10);
                const current = mInt === mmInt - (mmInt % MINUTE_STEP);
                return (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMinute(m)}
                    data-current={current ? "true" : "false"}
                    className={`block w-full px-3 py-1.5 text-center text-sm transition ${
                      current
                        ? "bg-orange-500/15 text-orange-300"
                        : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
                    }`}
                    style={mono}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default PasifyTimeInput;
