import { Copy, Plus, Sparkles, Ticket, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * TicketTiersBuilder — constructor multi-tier reutilizable.
 *
 * Usado tanto en el dialog de "Nuevo evento" como en cada día del
 * "Festival multi-día". Genera filas de tipos de tickets con:
 *   - Nombre (requerido)
 *   - Descripción corta opcional
 *   - Precio EUR (>= 0)
 *   - Capacidad opcional
 *   - Límite por usuario (default 10)
 *   - Activo on/off
 *
 * Maneja sus propios botones add / duplicate / remove. El partner DEBE
 * tener al menos un tier — el botón remove del último se desactiva.
 *
 * No persiste — el padre se encarga de insertar en `ticket_tiers` tras
 * crear el evento. Cada tier expone una key `id` interna (uuid) que el
 * padre usa de React key — no es el id de DB.
 */

export interface TierDraft {
  /** id interno para React key. No se persiste — Supabase asigna su uuid. */
  _key: string;
  name: string;
  description: string;
  priceEur: string;
  capacity: string;
  perUserMax: string;
  active: boolean;
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
});

interface Props {
  tiers: TierDraft[];
  onChange: (tiers: TierDraft[]) => void;
  /** Si true, todos los inputs están disabled (estado submitting). */
  disabled?: boolean;
}

export const TicketTiersBuilder = ({ tiers, onChange, disabled }: Props) => {
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
    const copy = { ...tiers[idx], _key: createEmptyTier()._key };
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
      {tiers.map((tier, idx) => (
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
          <div className="mb-4 flex items-center justify-between gap-3">
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
                disabled={disabled || tiers.length <= 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-40"
                aria-label="Eliminar tier"
                title={tiers.length <= 1 ? "Necesitas al menos un tier" : "Eliminar"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

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
              <Label htmlFor={`tier-price-${tier._key}`} className="text-xs">
                Precio (€) *
              </Label>
              <Input
                id={`tier-price-${tier._key}`}
                type="number"
                step="0.01"
                min="0"
                value={tier.priceEur}
                onChange={(e) => updateTier(tier._key, { priceEur: e.target.value })}
                placeholder="15.00"
                disabled={disabled}
              />
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
              <Label htmlFor={`tier-cap-${tier._key}`} className="text-xs">
                Cupo
              </Label>
              <Input
                id={`tier-cap-${tier._key}`}
                type="number"
                min="1"
                value={tier.capacity}
                onChange={(e) => updateTier(tier._key, { capacity: e.target.value })}
                placeholder="Sin límite"
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
        </article>
      ))}

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

export default TicketTiersBuilder;
