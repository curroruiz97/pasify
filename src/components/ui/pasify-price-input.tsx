import { Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * PasifyPriceInput — input numérico de precio con stepper +/- terracota.
 *
 * Reemplaza el `<input type="number">` con spin-buttons nativos (feos en
 * dark mode) por un input limpio + dos botones cuadrados a la derecha
 * que suben/bajan el precio en pasos configurables (default 0.10 €).
 *
 * Valor: string en formato "12.50" — mismo contract que `TierDraft.priceEur`
 * para que sea drop-in en los formularios existentes.
 *
 * Internamente sigue usando `<input type="number">` para tener teclado
 * numérico en móvil + soporte para flechas del teclado, pero esconde los
 * controles nativos con `.no-spinner` (definido en index.css).
 */

interface Props {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
  step?: number;
  /** Si false, permite valores negativos (no recomendado para precio). */
  clampToMin?: boolean;
}

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return "";
  // Redondeo a 2 decimales para evitar 25.0999999...
  return (Math.round(n * 100) / 100).toFixed(2);
};

export const PasifyPriceInput = ({
  id,
  value,
  onChange,
  disabled,
  placeholder = "0.00",
  min = 0,
  step = 0.1,
  clampToMin = true,
}: Props) => {
  const bump = (delta: number) => {
    const current = parseFloat(value || "0");
    const base = Number.isFinite(current) ? current : 0;
    let next = base + delta;
    if (clampToMin && next < min) next = min;
    onChange(fmt(next));
  };

  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={clampToMin ? min : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="no-spinner pr-16 tabular-nums"
      />
      <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-1">
        <button
          type="button"
          onClick={() => bump(-step)}
          disabled={disabled || (clampToMin && parseFloat(value || "0") <= min)}
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
          aria-label={`Restar ${step.toFixed(2)} €`}
          tabIndex={-1}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => bump(step)}
          disabled={disabled}
          className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition hover:border-orange-500/40 hover:text-orange-500 disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
          aria-label={`Sumar ${step.toFixed(2)} €`}
          tabIndex={-1}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default PasifyPriceInput;
