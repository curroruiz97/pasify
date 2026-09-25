import { format } from "date-fns";
import { es as esDate } from "date-fns/locale";

/** Formatos comunes de las secciones de dinero y pedidos del panel de admin. */

export const mono = { fontFamily: "'Geist Mono', ui-monospace, monospace" };

/** 123456 → "1.234,56 €". Con una moneda rara, sin romper. */
export function euros(cents: number, currency = "EUR"): string {
  const valor = (Number.isFinite(cents) ? cents : 0) / 100;
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: (currency || "EUR").toUpperCase() }).format(valor);
  } catch {
    return `${valor.toFixed(2)} ${currency}`;
  }
}

export const fecha = (iso: string | null | undefined): string =>
  iso ? format(new Date(iso), "d MMM yyyy", { locale: esDate }) : "—";

export const fechaHora = (iso: string | null | undefined): string =>
  iso ? format(new Date(iso), "d MMM yyyy · HH:mm", { locale: esDate }) : "—";

/**
 * "12,50" o "12.50" → 1250. null si no es un importe válido (negativo, más
 * de dos decimales, letras…).
 */
export function centimosDe(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|€/g, "");
  if (!limpio) return null;
  // Separador de miles con punto y decimales con coma ("1.234,56").
  const normal = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio)
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const cents = Math.round(Number(normal) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

const ESTADO_ENTRADA: Record<string, { label: string; color: string }> = {
  paid: { label: "Pagada", color: "#4DB87A" },
  used: { label: "Dentro", color: "#8FB8DE" },
  refunded: { label: "Reembolsada", color: "#8A8275" },
  cancelled: { label: "Anulada", color: "#8A8275" },
  pending: { label: "Sin pagar", color: "#E8B04C" },
};

/** Etiqueta y color del estado de una entrada. */
export const chipEntrada = (status: string) => ESTADO_ENTRADA[status] ?? { label: status, color: "#8A8275" };

/** Fecha de hoy (del dispositivo) como YYYY-MM-DD. */
export function hoyIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
