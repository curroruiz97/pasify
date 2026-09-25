/**
 * Políticas de cada tipo de entrada (D-3): devoluciones y transferencia.
 *
 *   - Devoluciones (`ticket_tiers.refundable_until_hours_before`):
 *       NULL → "Sin devolución (salvo cancelación)": solo se devuelve el
 *              dinero si el local cancela el evento. Es la opción por defecto.
 *       N    → el comprador puede pedirla hasta N horas antes del evento y el
 *              local decide cada solicitud (Reembolsos).
 *   - Transferencia (`ticket_tiers.transfer_allowed`): si el comprador puede
 *     pasar la entrada a otra persona.
 *
 * La política se lee al pedir la devolución o la transferencia: cambiarla en
 * un tipo ya vendido afecta a las solicitudes nuevas, no a las ya hechas.
 */

/** Plazo máximo que se deja escribir: un año. */
export const MAX_REFUND_HOURS = 8760;

/** Plazo que se propone al pasar de "sin devolución" a "hasta N horas". */
export const DEFAULT_REFUND_HOURS = "48";

export type RefundMode = "none" | "hours";

/** Horas escritas → número válido (1…MAX_REFUND_HOURS) o null si no lo es. */
export const parseRefundHours = (raw: string): number | null => {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_REFUND_HOURS ? n : null;
};

/** Valor de la columna para lo elegido en el editor (null = sin devolución). */
export const refundHoursForDb = (mode: RefundMode, rawHours: string): number | null =>
  mode === "hours" ? parseRefundHours(rawHours) : null;

/** "24 horas" · "168 horas (7 días)": el plazo como se escribe en el editor. */
const plazo = (hours: number): string => {
  const base = `${hours} ${hours === 1 ? "hora" : "horas"}`;
  return hours >= 48 && hours % 24 === 0 ? `${base} (${hours / 24} días)` : base;
};

/** Política de devoluciones en una línea. */
export const describeRefundPolicy = (hours: number | null | undefined): string =>
  hours == null ? "Sin devolución (salvo cancelación)" : `Hasta ${plazo(hours)} antes del evento`;

/** Política de transferencia en una línea. */
export const describeTransferPolicy = (allowed: boolean): string =>
  allowed ? "Se puede transferir" : "No se puede transferir";

export interface TierPolicySummary {
  name: string;
  refundHours: number | null;
  transferAllowed: boolean;
}

/**
 * Resumen de las políticas de varios tipos: una sola línea si todos tienen la
 * misma; si no, una por tipo ("VIP: hasta 48 horas antes del evento").
 */
export const summarizePolicies = (
  tiers: TierPolicySummary[]
): { refunds: string[]; transfers: string[] } => {
  const agrupar = (texto: (t: TierPolicySummary) => string): string[] => {
    if (tiers.length === 0) return [];
    const textos = tiers.map(texto);
    if (textos.every((t) => t === textos[0])) return [textos[0]];
    return tiers.map((t, i) => `${t.name.trim() || `Tipo ${i + 1}`}: ${lowerFirst(textos[i])}`);
  };
  return {
    refunds: agrupar((t) => describeRefundPolicy(t.refundHours)),
    transfers: agrupar((t) => describeTransferPolicy(t.transferAllowed)),
  };
};

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
