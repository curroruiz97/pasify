import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Exportar ficheros (CSV, PDF…) desde la misma SPA en web, iOS y Android.
 *
 * - Web: Blob + `<a download>`, como siempre.
 * - App nativa: el WebView de iOS/Android ignora `<a download>`, así que el
 *   botón "CSV" de Asistentes no hacía nada en el móvil (P0). Aquí se escribe
 *   el fichero en la caché privada de la app (no pide permisos de
 *   almacenamiento: desde Android 11 la carpeta Download pública exige un
 *   permiso que Google Play restringe) y se abre la hoja de compartir del
 *   sistema, desde la que el usuario lo guarda en Archivos o lo envía.
 *
 * Si el usuario cierra la hoja de compartir sin elegir nada no es un error:
 * la promesa se resuelve igual. Cualquier otro fallo se propaga para que
 * quien llama muestre un aviso.
 */
export interface SaveOrShareFileOptions {
  /** Nombre del fichero con extensión, p. ej. "pasify-asistentes-2026-09-23.csv". */
  filename: string;
  /** Tipo MIME, p. ej. "text/csv;charset=utf-8" o "application/pdf". */
  mimeType: string;
  /** Contenido: texto (se guarda en UTF-8) o un Blob. */
  data: Blob | string;
  /** Título de la hoja de compartir (solo lo muestra Android). */
  dialogTitle?: string;
}

export async function saveOrShareFile({
  filename,
  mimeType,
  data,
  dialogTitle,
}: SaveOrShareFileOptions): Promise<void> {
  const name = sanitizeFilename(filename);
  const blob = typeof data === "string" ? new Blob([data], { type: mimeType }) : data;

  // Se decide por la plataforma real y no por isNativeApp(): el override de
  // pruebas de UI nativa en el navegador no tiene Filesystem ni Share.
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(blob, name);
    return;
  }

  const base64 = await blobToBase64(blob);
  await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  try {
    await Share.share({ title: name, url: uri, dialogTitle: dialogTitle ?? name });
  } catch (err) {
    if (isShareCancelled(err)) return;
    throw err;
  }
}

// ============================================================================
// CSV
// ============================================================================

export type CsvCell = string | number | boolean | Date | null | undefined;
export type CsvRow = ReadonlyArray<CsvCell> | Readonly<Record<string, CsvCell>>;

const CSV_SEPARATOR = ";";
const CSV_NEWLINE = "\r\n";
const CSV_BOM = "﻿";
/** Primer carácter con el que Excel/Sheets/LibreOffice interpretan una fórmula. */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * CSV listo para abrir con doble clic en un Excel en español:
 *   - separador `;` (la coma es el separador decimal en es-ES),
 *   - BOM UTF-8 para que las tildes no salgan rotas,
 *   - comillas escapadas (RFC 4180) y saltos de línea CRLF,
 *   - neutraliza la inyección de fórmulas: un texto que empieza por
 *     = + - @ tabulador o retorno se prefija con `'` (un nombre de comprador
 *     "=HYPERLINK(...)" no se ejecuta al abrir el fichero). Los `number` no se
 *     tocan: se escriben con coma decimal y un negativo no es una fórmula.
 *
 * `rows` acepta filas como arrays (la primera suele ser la cabecera) u objetos
 * planos (la cabecera sale de sus claves, en orden de aparición).
 * `boolean` se escribe "sí"/"no" y `Date` como fecha y hora de Madrid.
 */
export function toCsv(rows: ReadonlyArray<CsvRow>): string {
  const body = normalizeRows(rows)
    .map((row) => row.map(formatCsvCell).join(CSV_SEPARATOR))
    .join(CSV_NEWLINE);
  return CSV_BOM + body;
}

const normalizeRows = (rows: ReadonlyArray<CsvRow>): CsvCell[][] => {
  if (rows.length === 0) return [];
  if (rows.every((row) => Array.isArray(row))) {
    return rows.map((row) => [...(row as ReadonlyArray<CsvCell>)]);
  }
  const header: string[] = [];
  for (const row of rows) {
    if (Array.isArray(row)) continue;
    for (const key of Object.keys(row)) if (!header.includes(key)) header.push(key);
  }
  return [
    header,
    ...rows.map((row) =>
      Array.isArray(row)
        ? [...(row as ReadonlyArray<CsvCell>)]
        : header.map((key) => (row as Readonly<Record<string, CsvCell>>)[key])
    ),
  ];
};

const formatCsvCell = (value: CsvCell): string => {
  let text: string;
  if (value === null || value === undefined) {
    text = "";
  } else if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value).replace(".", ",") : "";
  } else if (typeof value === "boolean") {
    text = value ? "sí" : "no";
  } else if (value instanceof Date) {
    text = formatCsvDateTime(value);
  } else {
    text = String(value);
    if (text.length > 0 && FORMULA_TRIGGERS.has(text.charAt(0))) text = `'${text}`;
  }
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Céntimos → "12,50" (coma decimal, sin separador de miles). Vacío si no hay importe. */
export const formatEurosCsv = (cents: number | null | undefined): string =>
  typeof cents === "number" && Number.isFinite(cents) ? (cents / 100).toFixed(2).replace(".", ",") : "";

const MADRID_TZ = "Europe/Madrid";
const madridDateTime = new Intl.DateTimeFormat("es-ES", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const madridParts = (date: Date): Record<string, string> => {
  const parts: Record<string, string> = {};
  for (const p of madridDateTime.formatToParts(date)) parts[p.type] = p.value;
  // Algunos motores devuelven "24" a medianoche con hour12: false.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
};

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** ISO o Date → "23/09/2026 22:15" en hora de Madrid. Vacío si no hay fecha. */
export const formatCsvDateTime = (value: string | Date | null | undefined): string => {
  const date = toDate(value);
  if (!date) return "";
  const p = madridParts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};

/** "2026-09-23" (hoy en Madrid), para el nombre del fichero. */
export const fileDateStamp = (value: Date = new Date()): string => {
  const p = madridParts(value);
  return `${p.year}-${p.month}-${p.day}`;
};

/** "Fiesta de Año Nuevo" → "fiesta-de-ano-nuevo", para nombres de fichero. */
export const slugForFilename = (text: string | null | undefined, fallback = "pasify"): string => {
  const slug = (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
};

// ============================================================================
// Internos
// ============================================================================

const sanitizeFilename = (filename: string): string => {
  const printable = Array.from(filename.normalize("NFC"))
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("");
  const cleaned = printable
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return cleaned || "pasify-export";
};

const downloadInBrowser = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari necesita la URL viva un momento después del click.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo preparar el fichero"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

/** iOS y Android rechazan con "Share canceled" cuando se cierra la hoja sin elegir. */
const isShareCancelled = (err: unknown): boolean => {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : typeof (err as { message?: unknown } | null)?.message === "string"
      ? String((err as { message: string }).message)
      : "";
  return /cancel/i.test(message);
};
