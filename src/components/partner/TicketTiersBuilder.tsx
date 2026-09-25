import { AlertTriangle, Copy, Info, Lock, Plus, ShieldCheck, Sparkles, Ticket, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasifyPriceInput } from "@/components/ui/pasify-price-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isBelowStripeMinimum } from "@/components/partner/tierPrice";
import {
  DEFAULT_REFUND_HOURS,
  MAX_REFUND_HOURS,
  parseRefundHours,
  type RefundMode,
} from "@/components/partner/tierPolicy";

/**
 * TicketTiersBuilder — constructor multi-tier reutilizable.
 *
 * Usado tanto en el dialog de "Nuevo evento" como en cada día del
 * "Festival multi-día". Genera filas de tipos de tickets con:
 *   - Nombre (requerido)
 *   - Descripción corta opcional
 *   - Precio EUR (0 o al menos 0,50: Stripe no cobra menos)
 *   - Capacidad opcional
 *   - Límite por usuario (default 10)
 *   - Activo on/off
 *   - Devoluciones (D-3): "Sin devolución (salvo cancelación)", por defecto,
 *     o "Hasta N horas antes del evento" (tierPolicy.ts)
 *   - Se puede transferir on/off
 *
 * Modo edición: si se pasa `salesByDbId` (mapa dbId → contadores reales),
 * los tiers con ventas se bloquean parcialmente:
 *   - Precio no editable (no se puede cambiar el precio que ya pagó alguien).
 *   - Capacity no puede bajar por debajo de las ventas ya hechas.
 *   - No se puede eliminar (sólo ocultar via switch active=false).
 *   - Muestra badge "X vendidas · Y dentro".
 *   - Las políticas sí se pueden cambiar, avisando de que afectan a las
 *     solicitudes nuevas (se leen al pedir la devolución o la transferencia).
 *
 * Maneja sus propios botones add / duplicate / remove. El partner DEBE
 * tener al menos un tier — el botón remove del último se desactiva.
 *
 * No persiste — el padre se encarga de insertar/actualizar en `ticket_tiers`.
 * Los tiers nuevos no tienen `dbId`; los existentes (edit) sí.
 */

export interface TierDraft {
  /** id interno para React key. No se persiste — Supabase asigna su uuid. */
  _key: string;
  /** id real de ticket_tiers cuando el tier viene de DB (modo edit). */
  dbId?: string;
  name: string;
  description: string;
  priceEur: string;
  capacity: string;
  perUserMax: string;
  active: boolean;
  /** Devoluciones: "none" = sin devolución (salvo cancelación); "hours" = hasta N horas antes. */
  refundMode: RefundMode;
  /** N de "hasta N horas antes del evento", tal como se escribe. */
  refundHours: string;
  /** El comprador puede pasar la entrada a otra persona. */
  transferAllowed: boolean;
}

export interface TierSales {
  /** Tickets vendidos (paid + used). */
  sold: number;
  /** Tickets ya escaneados / used. */
  used: number;
  /** Pendientes de entrar (paid no used). */
  pending: number;
  /** Si el tier tiene aunque sea 1 ticket vendido (paid/used/refunded). */
  hasSales: boolean;
}

const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

const PRESETS = [
  { name: "Entrada General", description: "Acceso general al evento", priceEur: "15.00", perUserMax: "4" },
  { name: "Early Bird", description: "Precio reducido por reserva temprana", priceEur: "10.00", perUserMax: "4" },
  { name: "VIP", description: "Acceso VIP · zona reservada · welcome drink", priceEur: "40.00", perUserMax: "2" },
  { name: "Backstage / Premium", description: "Acceso backstage y meet & greet", priceEur: "80.00", perUserMax: "2" },
  { name: "Invitación", description: "Acceso gratuito por invitación", priceEur: "0.00", perUserMax: "1" },
];

export const createEmptyTier = (name = "Entrada General", priceEur = ""): TierDraft => ({
  _key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tier-${Math.random()}`,
  name,
  description: name === "Entrada General" ? "Acceso general al evento" : "",
  priceEur,
  capacity: "",
  perUserMax: "4",
  active: true,
  refundMode: "none",
  refundHours: DEFAULT_REFUND_HOURS,
  transferAllowed: true,
});

interface Props {
  tiers: TierDraft[];
  onChange: (tiers: TierDraft[]) => void;
  /** Si true, todos los inputs están disabled (estado submitting). */
  disabled?: boolean;
  /** Modo edición: mapa de dbId → contadores de ventas reales. */
  salesByDbId?: Record<string, TierSales>;
}

export const TicketTiersBuilder = ({
  tiers,
  onChange,
  disabled,
  salesByDbId,
}: Props) => {
  const updateTier = (key: string, patch: Partial<TierDraft>) => {
    onChange(tiers.map((t) => (t._key === key ? { ...t, ...patch } : t)));
  };

  const removeTier = (key: string) => {
    if (tiers.length <= 1) return; // siempre al menos 1
    onChange(tiers.filter((t) => t._key !== key));
  };

  const duplicateTier = (key: string) => {
    const idx = tiers.findIndex((t) => t._key === key);
    if (idx < 0) return;
    const src = tiers[idx];
    // Al duplicar: nuevo _key, sin dbId (es una nueva fila). Esto evita
    // que cambiar el clon afecte al tier vendido del que viene.
    const copy: TierDraft = {
      ...src,
      _key: createEmptyTier()._key,
      dbId: undefined,
    };
    const next = [...tiers];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };

  const addTier = (preset?: typeof PRESETS[number]) => {
    const base = createEmptyTier(preset?.name ?? "Personalizado", preset?.priceEur ?? "");
    if (preset) {
      base.description = preset.description;
      base.perUserMax = preset.perUserMax;
    }
    onChange([...tiers, base]);
  };

  return (
    <div className="space-y-3">
      {tiers.map((tier, idx) => {
        const sales = tier.dbId ? salesByDbId?.[tier.dbId] : undefined;
        const isLocked = !!sales?.hasSales;
        return (
          <article
            key={tier._key}
            className={`relative rounded-2xl border bg-card p-4 transition ${
              tier.active ? "border-border" : "border-border/40 opacity-70"
            }`}
            style={
              tier.active
                ? { boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset" }
                : undefined
            }
          >
            {/* Header tier */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(232,84,42,0.22) 0%, rgba(184,56,26,0.18) 100%)",
                    color: "#FFC9B0",
                  }}
                  aria-hidden="true"
                >
                  <Ticket className="h-4 w-4" />
                </div>
                <div
                  className="text-[10px] uppercase text-muted-foreground"
                  style={{ ...mono, letterSpacing: "0.18em" }}
                >
                  Tier {String(idx + 1).padStart(2, "0")}
                </div>
                {sales && (
                  <span
                    className={`ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      isLocked
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-500"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                    style={{ ...mono, letterSpacing: "0.14em" }}
                    title={`Vendidas ${sales.sold} · Han entrado ${sales.used} · Pendientes ${sales.pending}`}
                  >
                    {sales.sold} vendidas · {sales.used} dentro
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={tier.active}
                  onCheckedChange={(v) => updateTier(tier._key, { active: v })}
                  disabled={disabled}
                  aria-label="Activo"
                />
                <button
                  type="button"
                  onClick={() => duplicateTier(tier._key)}
                  disabled={disabled}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-orange-500/50 hover:text-foreground disabled:opacity-40"
                  aria-label="Duplicar tier"
                  title="Duplicar"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeTier(tier._key)}
                  disabled={disabled || tiers.length <= 1 || isLocked}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-40"
                  aria-label="Eliminar tier"
                  title={
                    isLocked
                      ? "Tiene ventas, sólo se puede ocultar"
                      : tiers.length <= 1
                      ? "Necesitas al menos un tier"
                      : "Eliminar"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Aviso de bloqueo si tiene ventas */}
            {isLocked && (
              <div
                className="mb-3 flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-[11px] leading-relaxed text-orange-200"
                role="status"
              >
                <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-orange-500" />
                <span>
                  Este tipo ya vendió{" "}
                  <strong className="font-semibold">
                    {sales?.sold ?? 0} entradas
                  </strong>
                  . No puedes cambiar el precio ni borrarlo. Puedes ocultarlo
                  (futuras ventas), ajustar el cupo siempre que sea ≥ vendidas y
                  cambiar sus devoluciones y transferencia.
                </span>
              </div>
            )}

            {/* Campos */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`tier-name-${tier._key}`} className="text-xs">
                  Nombre *
                </Label>
                <Input
                  id={`tier-name-${tier._key}`}
                  value={tier.name}
                  onChange={(e) => updateTier(tier._key, { name: e.target.value })}
                  placeholder="Entrada General"
                  disabled={disabled}
                />
              </div>
              <div>
                <Label
                  htmlFor={`tier-price-${tier._key}`}
                  className="flex items-center gap-1.5 text-xs"
                >
                  Precio (€) *
                  {isLocked && (
                    <Lock
                      className="h-3 w-3 text-orange-500"
                      aria-label="Bloqueado por ventas existentes"
                    />
                  )}
                </Label>
                <PasifyPriceInput
                  id={`tier-price-${tier._key}`}
                  value={tier.priceEur}
                  onChange={(v) => updateTier(tier._key, { priceEur: v })}
                  placeholder="15.00"
                  step={0.1}
                  min={0}
                  disabled={disabled || isLocked}
                />
                {!isLocked && isBelowStripeMinimum(tier.priceEur) && (
                  <p className="mt-1 text-[11px] text-destructive" role="alert">
                    El mínimo que se puede cobrar es 0,50 €.
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`tier-desc-${tier._key}`} className="text-xs">
                  Descripción
                </Label>
                <Textarea
                  id={`tier-desc-${tier._key}`}
                  rows={2}
                  value={tier.description}
                  onChange={(e) => updateTier(tier._key, { description: e.target.value })}
                  placeholder="Acceso VIP · barra libre · zona reservada"
                  disabled={disabled}
                />
              </div>
              <div>
                <Label
                  htmlFor={`tier-cap-${tier._key}`}
                  className="flex items-center gap-1.5 text-xs"
                >
                  Cupo
                  {sales && sales.sold > 0 && (
                    <span
                      className="text-[10px] uppercase text-muted-foreground"
                      style={{ ...mono, letterSpacing: "0.16em" }}
                    >
                      mín. {sales.sold}
                    </span>
                  )}
                </Label>
                <Input
                  id={`tier-cap-${tier._key}`}
                  type="number"
                  min={sales?.sold ?? 1}
                  value={tier.capacity}
                  onChange={(e) => updateTier(tier._key, { capacity: e.target.value })}
                  placeholder={sales ? `≥ ${sales.sold}` : "Sin límite"}
                  disabled={disabled}
                />
              </div>
              <div>
                <Label htmlFor={`tier-max-${tier._key}`} className="text-xs">
                  Máx. por usuario
                </Label>
                <Input
                  id={`tier-max-${tier._key}`}
                  type="number"
                  min="1"
                  max="10"
                  value={tier.perUserMax}
                  onChange={(e) => updateTier(tier._key, { perUserMax: e.target.value })}
                  placeholder="4"
                  disabled={disabled}
                />
              </div>
            </div>

            <TierPolicies
              tier={tier}
              hasSales={isLocked}
              disabled={disabled}
              onChange={(patch) => updateTier(tier._key, patch)}
            />
          </article>
        );
      })}

      {/* Add row con quick-presets */}
      <div className="rounded-2xl border border-dashed border-border bg-card/40 p-4">
        <div
          className="mb-3 flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
          style={{ ...mono, letterSpacing: "0.18em" }}
        >
          <Sparkles className="h-3 w-3 text-orange-500" />
          Añadir tipo de ticket
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => addTier(p)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-orange-500/50 hover:text-orange-500 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addTier()}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/50 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-500 transition hover:bg-orange-500/15 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            Personalizado
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Devoluciones y transferencia de un tipo (D-3). En un tipo con ventas se
 * pueden cambiar igual: se aplican a lo que se pida a partir de ahora.
 */
const TierPolicies = ({
  tier,
  hasSales,
  disabled,
  onChange,
}: {
  tier: TierDraft;
  hasSales: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<TierDraft>) => void;
}) => {
  const id = tier._key;
  const hours = parseRefundHours(tier.refundHours);
  const hoursInvalid = tier.refundMode === "hours" && hours === null;
  const elegirHoras = () => {
    if (tier.refundMode !== "hours") {
      onChange({ refundMode: "hours", refundHours: tier.refundHours || DEFAULT_REFUND_HOURS });
    }
  };

  return (
    <section
      className="mt-4 rounded-xl border border-border/70 bg-muted/20 p-3"
      aria-label="Devoluciones y transferencia"
    >
      <div
        className="mb-3 flex items-center gap-2 text-[10px] uppercase text-muted-foreground"
        style={{ ...mono, letterSpacing: "0.18em" }}
      >
        <ShieldCheck className="h-3 w-3 text-orange-500" />
        Devoluciones y transferencia
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-medium text-foreground" id={`tier-refund-label-${id}`}>
            Devoluciones
          </div>
          <RadioGroup
            value={tier.refundMode}
            onValueChange={(v) =>
              v === "hours" ? elegirHoras() : onChange({ refundMode: "none" })
            }
            disabled={disabled}
            aria-labelledby={`tier-refund-label-${id}`}
            className="gap-2.5"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id={`tier-refund-none-${id}`} />
              <Label htmlFor={`tier-refund-none-${id}`} className="text-xs font-normal">
                Sin devolución (salvo cancelación)
              </Label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RadioGroupItem value="hours" id={`tier-refund-hours-${id}`} />
              <Label htmlFor={`tier-refund-hours-${id}`} className="text-xs font-normal">
                Hasta
              </Label>
              <Input
                id={`tier-refund-n-${id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_REFUND_HOURS}
                step={1}
                value={tier.refundHours}
                // Tocar el número (o escribirlo) elige "Hasta N horas"; pasar
                // por él con el tabulador no cambia la política.
                onPointerDown={elegirHoras}
                onChange={(e) => onChange({ refundMode: "hours", refundHours: e.target.value })}
                disabled={disabled}
                aria-label="Horas antes del evento"
                aria-invalid={hoursInvalid || undefined}
                className="h-8 w-20 px-2 text-sm"
              />
              <span className="text-xs text-foreground">horas antes del evento</span>
            </div>
          </RadioGroup>
          {hoursInvalid ? (
            <p className="mt-1.5 text-[11px] text-destructive" role="alert">
              Escribe un número entero de horas entre 1 y {MAX_REFUND_HOURS}.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {tier.refundMode === "hours"
                ? `El comprador puede pedirla hasta ${hours} ${hours === 1 ? "hora" : "horas"} antes de que empiece. Te llega a Reembolsos y tú decides.`
                : "Solo se devuelve el dinero si cancelas el evento."}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`tier-transfer-${id}`} className="text-xs font-medium">
              Se puede transferir
            </Label>
            <Switch
              id={`tier-transfer-${id}`}
              checked={tier.transferAllowed}
              onCheckedChange={(v) => onChange({ transferAllowed: v })}
              disabled={disabled}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {tier.transferAllowed
              ? "El comprador puede pasar su entrada a otra persona desde su cuenta."
              : "La entrada no se puede pasar a otra persona."}
          </p>
        </div>
      </div>

      {hasSales && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-orange-200" role="note">
          <Info className="mt-[1px] h-3.5 w-3.5 shrink-0 text-orange-500" />
          <span>
            <strong className="font-semibold">Afecta a las solicitudes nuevas.</strong> Este tipo ya tiene
            ventas: lo que ya se ha pedido o transferido no cambia.
          </span>
        </p>
      )}
    </section>
  );
};

export default TicketTiersBuilder;
