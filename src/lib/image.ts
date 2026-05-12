/**
 * Helper per immagini Supabase Storage.
 *
 * NOTA: image transformations (`/render/image/`) sono disabilitate sul
 * progetto attuale (piano Supabase). Vedi `imageUtils.ts:85-90` per
 * lo storico. Quindi attualmente questo helper è un pass-through con
 * un'API pronta per il giorno in cui verranno riattivate — basterà
 * cambiare `TRANSFORMATIONS_ENABLED` a true.
 *
 * @example
 *   <img src={optimizedImage(url, "feed")} loading="lazy" />
 */

type Preset = "thumb" | "card" | "feed" | "avatar" | "hero";

interface ImageOpts {
  width?: number;
  quality?: number;
  resize?: "cover" | "contain";
}

const PRESETS: Record<Preset, ImageOpts> = {
  thumb: { width: 96, quality: 70 },
  avatar: { width: 128, quality: 80 },
  card: { width: 400, quality: 75 },
  feed: { width: 720, quality: 80 },
  hero: { width: 1080, quality: 85 },
};

const TRANSFORMATIONS_ENABLED = false;

const SUPABASE_STORAGE_MARKER = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";

export function optimizedImage(url: string | null | undefined, optsOrPreset: ImageOpts | Preset = "card"): string {
  if (!url) return "";
  if (!TRANSFORMATIONS_ENABLED) return url;
  if (!url.includes(SUPABASE_STORAGE_MARKER)) return url;

  const opts: ImageOpts = typeof optsOrPreset === "string" ? PRESETS[optsOrPreset] : optsOrPreset;
  const transformed = url.replace(SUPABASE_STORAGE_MARKER, SUPABASE_RENDER_PATH);
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.quality) params.set("quality", String(opts.quality));
  if (opts.resize) params.set("resize", opts.resize);

  const sep = transformed.includes("?") ? "&" : "?";
  return `${transformed}${sep}${params.toString()}`;
}
