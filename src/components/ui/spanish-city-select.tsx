import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SPANISH_CITIES, normalizeForSearch, type SpanishCity } from "@/data/spanish-cities";

/**
 * SpanishCitySelect — combobox searchable de municipios de España.
 *
 * Reemplaza el input free-text de "ciudad" en todo Pasify Partner. La
 * fuente de datos es `src/data/spanish-cities.ts` (~600 municipios) y la
 * búsqueda es accent/case-insensitive vía `normalizeForSearch`.
 *
 * Filosofía API:
 *   - El valor que se guarda es el `name` (string). Es lo que tiene
 *     sentido en columnas como `organizations.city`, `venues.city`,
 *     `events.city`. Permite que datasets externos sigan siendo
 *     compatibles si añadimos nuevas ciudades luego.
 *   - Cuando el partner empieza a escribir y ningún municipio coincide,
 *     ofrecemos "Usar 'X' como ciudad personalizada" — útil para casos
 *     raros (núcleos pequeños, urbanizaciones, etc.). Pasify no se
 *     bloquea por la cobertura del dataset.
 *   - Sin valor por defecto. `value=""` => placeholder visible.
 *
 * Estilo:
 *   - Dark theme con acentos terracota (Pasify tokens).
 *   - Etiqueta mono uppercase encima (opcional via `label`).
 *   - Popover ancho como el trigger; lista con max-height + scroll
 *     fino (matchea otros selects del proyecto).
 */

interface Props {
  value: string;
  onValueChange: (city: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  helperText?: string;
  /** Si true, oculta provincia/ccaa en la fila seleccionada (compact). */
  hideMetaInTrigger?: boolean;
  /** Ancho extra del popover, sobrescribe matchea-trigger si se necesita. */
  popoverClassName?: string;
  /** ClassName del botón trigger. */
  className?: string;
  /** id del input subyacente para asociar label externos. */
  id?: string;
}

const mono: React.CSSProperties = {
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  letterSpacing: "0.18em",
};

const MAX_VISIBLE = 60;

export const SpanishCitySelect = ({
  value,
  onValueChange,
  label,
  placeholder = "Selecciona o busca tu ciudad",
  disabled = false,
  required = false,
  invalid = false,
  helperText,
  hideMetaInTrigger = false,
  popoverClassName,
  className,
  id,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Si el valor existe en el dataset, podemos mostrar provincia · ccaa al lado.
  // Si no, mostramos sólo el valor literal (custom city que aceptamos).
  const selectedMeta: SpanishCity | null = useMemo(() => {
    if (!value) return null;
    const v = value.toLowerCase();
    return SPANISH_CITIES.find((c) => c.name.toLowerCase() === v) ?? null;
  }, [value]);

  const filtered: SpanishCity[] = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return SPANISH_CITIES.slice(0, MAX_VISIBLE);
    return SPANISH_CITIES.filter((c) => {
      const haystack = `${normalizeForSearch(c.name)} ${normalizeForSearch(c.province)} ${normalizeForSearch(c.ccaa)}`;
      return haystack.includes(q);
    }).slice(0, MAX_VISIBLE);
  }, [query]);

  // Cuando se abre, autofocus en el input de búsqueda.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  const handleSelect = (city: string) => {
    onValueChange(city.trim());
    setOpen(false);
    setQuery("");
  };

  const allowCustom =
    query.trim().length > 1 &&
    !filtered.some((c) => normalizeForSearch(c.name) === normalizeForSearch(query));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && (
        <span
          className={cn(
            "text-[10px] uppercase font-semibold",
            invalid ? "text-destructive" : "text-muted-foreground"
          )}
          style={mono}
        >
          {label}
          {required && <span className="ml-1 text-primary">*</span>}
        </span>
      )}

      <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              "group relative flex h-11 w-full items-center gap-2 rounded-xl border bg-card px-3 text-left text-sm transition-all",
              "hover:border-primary/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              disabled && "cursor-not-allowed opacity-60",
              invalid
                ? "border-destructive/70 ring-1 ring-destructive/30"
                : "border-border"
            )}
          >
            <MapPin className="h-4 w-4 flex-shrink-0 text-primary/80" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {value ? (
                <>
                  <span className="truncate text-foreground">{value}</span>
                  {!hideMetaInTrigger && selectedMeta && (
                    <span
                      className="hidden truncate text-[10px] uppercase text-muted-foreground sm:inline"
                      style={mono}
                    >
                      · {selectedMeta.province}
                    </span>
                  )}
                </>
              ) : (
                <span className="truncate text-muted-foreground">{placeholder}</span>
              )}
            </span>
            <ChevronsUpDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className={cn(
            "w-[var(--radix-popover-trigger-width)] min-w-[280px] max-w-[95vw] overflow-hidden p-0 border-border bg-popover shadow-[0_24px_60px_-24px_rgba(184,56,26,0.35)]",
            popoverClassName
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busca municipio, provincia o CCAA"
              className="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div
            role="listbox"
            className="max-h-[280px] overflow-y-auto overflow-x-hidden py-1.5 [scrollbar-width:thin] [scrollbar-color:hsl(var(--primary)/0.5)_transparent]"
          >
            {filtered.length === 0 && !allowCustom && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                Sin resultados. Prueba con otro nombre.
              </div>
            )}

            {filtered.map((city) => {
              const isSelected =
                value && value.toLowerCase() === city.name.toLowerCase();
              return (
                <button
                  key={`${city.name}-${city.province}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected || undefined}
                  onClick={() => handleSelect(city.name)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    "hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
                    isSelected && "bg-accent/40"
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0 text-primary transition-opacity",
                      isSelected ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-foreground">
                      {city.name}
                    </span>
                    <span
                      className="truncate text-[10px] uppercase text-muted-foreground"
                      style={mono}
                    >
                      {city.province} · {city.ccaa}
                    </span>
                  </span>
                </button>
              );
            })}

            {allowCustom && (
              <>
                {filtered.length > 0 && (
                  <div className="my-1 border-t border-border" />
                )}
                <button
                  type="button"
                  onClick={() => handleSelect(query.trim())}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-primary/10"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    +
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">
                      Usar "{query.trim()}"
                    </span>
                    <span
                      className="truncate text-[10px] uppercase text-muted-foreground"
                      style={mono}
                    >
                      Ciudad personalizada
                    </span>
                  </span>
                </button>
              </>
            )}
          </div>

          <div
            className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] uppercase text-muted-foreground"
            style={mono}
          >
            <span>{SPANISH_CITIES.length} municipios</span>
            <span>Pulsa <kbd className="rounded bg-muted px-1.5 py-0.5 normal-case">Esc</kbd> para cerrar</span>
          </div>
        </PopoverContent>
      </Popover>

      {helperText && (
        <span
          className={cn(
            "text-[11px]",
            invalid ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {helperText}
        </span>
      )}
    </div>
  );
};

export default SpanishCitySelect;
