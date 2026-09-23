import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, ShieldCheck, Ticket as TicketIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  formatEventDateShort,
  formatEventDateTime,
  formatEventTime,
  formatPriceCents,
  tierAvailability,
  type TierAvailability,
  type TierOption,
} from "@/components/tickets/ticketUtils";

/**
 * Pasify · selector de entradas.
 *
 * Bottom sheet que abre `useTicketCheckout` antes de mandar al usuario a
 * Stripe: lista los tipos activos del evento (nombre, descripción, precio y
 * estado de venta), deja elegir cantidad dentro de los límites del tipo y
 * enseña el total que se va a cobrar. Se abre SIEMPRE, aunque solo haya un
 * tipo, para que el usuario confirme precio y cantidad antes de pagar: el
 * precio anunciado en la tarjeta es un "Desde".
 */

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

export interface TierPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventTitle?: string | null;
  eventDateStart?: string | null;
  eventPlace?: string | null;
  tiers: TierOption[];
  /** Cantidad sugerida al abrir. Se ajusta a los límites del tipo elegido. */
  initialQty?: number;
  /** Creando la sesión de Stripe: bloquea el sheet. */
  submitting?: boolean;
  /** Recargando disponibilidad tras un rechazo del servidor. */
  refreshing?: boolean;
  onConfirm: (tier: TierOption, qty: number) => void;
}

const availabilityLabel = (a: TierAvailability): string | null => {
  switch (a.kind) {
    case "sold_out":
      return "Agotado";
    case "ended":
      return "Venta cerrada";
    case "not_started": {
      const when = [formatEventDateShort(a.startsAt), formatEventTime(a.startsAt)]
        .filter(Boolean)
        .join(", ");
      return when ? `Aún no a la venta · desde ${when}` : "Aún no a la venta";
    }
    default:
      return null;
  }
};

export const TierPickerSheet = ({
  open,
  onOpenChange,
  eventTitle,
  eventDateStart,
  eventPlace,
  tiers,
  initialQty = 1,
  submitting = false,
  refreshing = false,
  onConfirm,
}: TierPickerSheetProps) => {
  // Las ventanas de venta dependen de la hora: la fijamos al abrir.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);

  const options = useMemo(
    () => tiers.map((tier) => ({ tier, availability: tierAvailability(tier, now) })),
    [tiers, now]
  );
  const firstAvailableId =
    options.find((o) => o.availability.kind === "available")?.tier.id ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  // Al abrir, la cantidad vuelve a la sugerida.
  useEffect(() => {
    if (open) setQty(Math.max(1, Math.floor(initialQty || 1)));
  }, [open, initialQty]);

  // Preselección: el primer tipo comprable. Si el elegido deja de estarlo
  // (otro evento, o recarga tras "agotado"), saltamos al primero que sí.
  useEffect(() => {
    if (!open) return;
    const current = options.find((o) => o.tier.id === selectedId);
    if (!current || current.availability.kind !== "available") {
      setSelectedId(firstAvailableId);
    }
  }, [open, options, selectedId, firstAvailableId]);

  const selected = options.find((o) => o.tier.id === selectedId) ?? null;
  const selectedAvailability =
    selected && selected.availability.kind === "available" ? selected.availability : null;
  const maxQty = selectedAvailability?.maxQty ?? 0;
  const effectiveQty = maxQty > 0 ? Math.min(Math.max(1, qty), maxQty) : 0;
  const currency = selected?.tier.currency ?? tiers[0]?.currency ?? "EUR";
  const total = selected ? selected.tier.price_cents * effectiveQty : 0;
  const canConfirm = !!selected && maxQty > 0 && !submitting && !refreshing;

  const qtyHint = (() => {
    if (!selected || !selectedAvailability) return null;
    const { remaining } = selectedAvailability;
    if (remaining != null && remaining <= maxQty) {
      return remaining === 1 ? "Queda 1 entrada" : `Quedan ${remaining}`;
    }
    if (selected.tier.per_user_max === maxQty) return `Máx. ${maxQty} por persona`;
    return `Máx. ${maxQty} por compra`;
  })();

  const dateLabel = eventDateStart ? formatEventDateTime(eventDateStart) : "";
  const subtitle = [dateLabel, eventPlace].filter(Boolean).join(" · ");

  const handleOpenChange = (next: boolean) => {
    // Con la sesión de Stripe creándose no dejamos cerrar: el pedido ya existe.
    if (!next && submitting) return;
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="border-border bg-background text-foreground"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        {/* Cabecera */}
        <div className="shrink-0 px-5 pb-4 pt-2 sm:px-6">
          <div
            className="mb-2 inline-flex items-center gap-2 text-[10px] uppercase text-orange-500"
            style={{ ...mono, letterSpacing: "0.22em" }}
          >
            <span className="inline-block h-px w-5 bg-orange-500/70" />
            Entradas
          </div>
          <SheetTitle className="text-xl font-semibold leading-tight tracking-tight md:text-2xl">
            {eventTitle || "Elige tus entradas"}
          </SheetTitle>
          <SheetDescription className="mt-1 text-[13px] leading-relaxed">
            {subtitle || "Elige el tipo de entrada y la cantidad."}
          </SheetDescription>
        </div>

        {/* Tipos de entrada */}
        <div
          role="radiogroup"
          aria-label="Tipo de entrada"
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 pb-4 sm:px-6"
        >
          {options.map(({ tier, availability }) => {
            const available = availability.kind === "available";
            const isSelected = available && tier.id === selectedId;
            const statusLabel = availabilityLabel(availability);
            return (
              <button
                key={tier.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-disabled={!available}
                disabled={!available || submitting}
                onClick={() => available && setSelectedId(tier.id)}
                className={cn(
                  "w-full rounded-2xl border p-4 text-left transition",
                  isSelected
                    ? "border-orange-500/70 bg-orange-500/[0.08]"
                    : "border-border bg-card hover:border-orange-500/40",
                  !available && "cursor-not-allowed opacity-60 hover:border-border"
                )}
                style={
                  isSelected
                    ? { boxShadow: "0 12px 30px -16px rgba(232,84,42,0.6)" }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                        isSelected ? "border-orange-500" : "border-muted-foreground/40"
                      )}
                    >
                      {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight text-foreground">
                        {tier.name}
                      </div>
                      {tier.description && (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                          {tier.description}
                        </p>
                      )}
                      {statusLabel && (
                        <span
                          className="mt-2 inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                          style={{ ...mono, letterSpacing: "0.14em" }}
                        >
                          {statusLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "shrink-0 text-right text-base font-bold",
                      available ? "text-foreground" : "text-muted-foreground"
                    )}
                    style={mono}
                  >
                    {tier.price_cents <= 0
                      ? "Gratis"
                      : formatPriceCents(tier.price_cents, tier.currency)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Cantidad + total + CTA */}
        <div className="shrink-0 border-t border-border bg-card/60 px-5 pb-5 pt-4 sm:px-6">
          {selected && maxQty > 0 && (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.18em" }}
                >
                  Cantidad
                </div>
                {qtyHint && (
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{qtyHint}</div>
                )}
              </div>
              <div
                className="inline-flex items-center rounded-full border border-border bg-card"
                aria-label="Cantidad de entradas"
              >
                <button
                  type="button"
                  onClick={() => setQty(Math.max(1, effectiveQty - 1))}
                  disabled={effectiveQty <= 1 || submitting}
                  className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                  aria-label="Quitar una entrada"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span
                  className="min-w-[28px] text-center text-base font-semibold text-foreground"
                  style={mono}
                  aria-live="polite"
                >
                  {effectiveQty}
                </span>
                <button
                  type="button"
                  onClick={() => setQty(Math.min(maxQty, effectiveQty + 1))}
                  disabled={effectiveQty >= maxQty || submitting}
                  className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                  aria-label="Añadir una entrada"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="mb-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div
                className="text-[10px] uppercase text-muted-foreground"
                style={{ ...mono, letterSpacing: "0.18em" }}
              >
                Total
              </div>
              {selected && effectiveQty > 0 && (
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {effectiveQty} × {selected.tier.name}
                </div>
              )}
            </div>
            <div
              className="text-2xl font-bold leading-none tracking-tight text-foreground"
              style={mono}
            >
              {formatPriceCents(total, currency)}
            </div>
          </div>

          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (!selected || !canConfirm) return;
              onConfirm(selected.tier, effectiveQty);
            }}
            className="group/btn inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
            style={{
              background: canConfirm || submitting
                ? "linear-gradient(180deg, #FF7A4D 0%, #E8542A 55%, #B8381A 100%)"
                : "#3a3a3a",
              boxShadow: canConfirm
                ? "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(80,20,5,0.22), 0 12px 30px -10px rgba(232,84,42,0.55)"
                : "none",
              letterSpacing: "-0.005em",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Preparando el pago…
              </>
            ) : refreshing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Actualizando disponibilidad…
              </>
            ) : !firstAvailableId ? (
              "No hay entradas disponibles"
            ) : (
              <>
                <TicketIcon className="h-5 w-5" />
                Continuar al pago
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1"
                >
                  →
                </span>
              </>
            )}
          </button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] leading-snug text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Pago seguro con Stripe. Tus entradas con código QR aparecerán en Mis entradas.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TierPickerSheet;
