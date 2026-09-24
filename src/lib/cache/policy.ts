import type { Query, QueryKey } from "@tanstack/react-query";

/**
 * Qué se guarda en el dispositivo (IndexedDB) y cuánto tiempo vale.
 *
 * Por defecto NADA se guarda: cada consulta entra aquí a propósito. La caché
 * en memoria cubre volver a una sección; la del dispositivo cubre recargar
 * (pestaña descartada por el navegador, WebView cerrado por iOS…) y ver las
 * entradas sin conexión.
 *
 * Nunca se guardan datos personales de terceros (compradores): asistentes e
 * informes con emails y teléfonos viven solo en memoria.
 */
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Vigencia máxima de lo guardado: nada más antiguo se restaura. */
export const MAX_PERSIST_AGE_MS = 30 * DIA;

type Regla = { maxAgeMs: number } | null;

function reglaPara(key: QueryKey): Regla {
  const [ambito, , recurso] = key as readonly unknown[];
  if (ambito === "me") {
    switch (recurso) {
      case "roles":
      case "tickets": // la cartera se abre en la puerta, a menudo sin cobertura
        return { maxAgeMs: 30 * DIA };
      case "profile":
      case "favorites":
      case "refunds":
      case "loyalty":
        return { maxAgeMs: 7 * DIA };
      default:
        return null; // soporte: conversación privada, solo memoria
    }
  }
  if (ambito === "partner") {
    switch (recurso) {
      case "tenant":
      case "subscription":
      case "context":
      case "profile":
      case "events":
      case "showcase":
      case "balance":
        return { maxAgeMs: 7 * DIA };
      case "live":
        return { maxAgeMs: 12 * HORA };
      default:
        return null; // attendees, reports (datos de compradores), forecast
    }
  }
  if (ambito === "public") {
    const recursoPublico = (key as readonly unknown[])[1];
    if (recursoPublico === "cities" || recursoPublico === "partners") return { maxAgeMs: 7 * DIA };
    if (recursoPublico === "calendar-events") return { maxAgeMs: DIA };
    return null;
  }
  return null;
}

/** ¿Es una clave del usuario `userId` (o pública)? */
export function perteneceA(key: QueryKey, userId: string | null): boolean {
  const [ambito, uid] = key as readonly unknown[];
  if (ambito === "public") return true;
  if (ambito === "me" || ambito === "partner") return userId !== null && uid === userId;
  return false;
}

/** ¿Sigue vigente un dato de esta clave actualizado en `dataUpdatedAt`? */
export function vigente(key: QueryKey, dataUpdatedAt: number, ahora = Date.now()): boolean {
  const regla = reglaPara(key);
  return !!regla && dataUpdatedAt > 0 && ahora - dataUpdatedAt <= regla.maxAgeMs;
}

/** Decide si una consulta de la caché se escribe en el dispositivo. */
export function debePersistir(query: Query, userId: string | null): boolean {
  if (query.state.status !== "success" || query.state.data === undefined) return false;
  return perteneceA(query.queryKey, userId) && vigente(query.queryKey, query.state.dataUpdatedAt);
}
