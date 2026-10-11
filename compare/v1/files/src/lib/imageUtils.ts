/**
 * Utility per ottimizzare le immagini da Supabase Storage
 * Usa le trasformazioni di Supabase per ridurre le dimensioni
 */

interface ImageOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'origin';
}

// Persistent URL cache: original URL → transformed URL
// Loaded from localStorage on module init, avoids recalculating Supabase transform URLs
const IMAGE_URL_CACHE_KEY = 'image-url-cache';
const IMAGE_URL_CACHE_VERSION = 3; // Bump to invalidate old cached URLs (v2: use /render/image/ endpoint)
const MAX_URL_CACHE_ENTRIES = 500;

interface UrlCacheEntry {
  url: string;
  ts: number; // timestamp for LRU eviction
}

let urlCache: Map<string, UrlCacheEntry> = new Map();

// Load cache from localStorage on module init — invalidate if version changed
try {
  const storedVersion = localStorage.getItem(IMAGE_URL_CACHE_KEY + '-v');
  if (storedVersion !== String(IMAGE_URL_CACHE_VERSION)) {
    // Cache version mismatch: clear old entries (they may contain broken URLs)
    localStorage.removeItem(IMAGE_URL_CACHE_KEY);
    localStorage.setItem(IMAGE_URL_CACHE_KEY + '-v', String(IMAGE_URL_CACHE_VERSION));
  } else {
    const stored = localStorage.getItem(IMAGE_URL_CACHE_KEY);
    if (stored) {
      const parsed: Record<string, UrlCacheEntry> = JSON.parse(stored);
      urlCache = new Map(Object.entries(parsed));
    }
  }
} catch {
  // Ignore parse errors
}

const persistUrlCache = () => {
  try {
    // LRU eviction: if over max, remove oldest entries
    if (urlCache.size > MAX_URL_CACHE_ENTRIES) {
      const sorted = [...urlCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
      const toRemove = sorted.slice(0, sorted.length - MAX_URL_CACHE_ENTRIES);
      for (const [key] of toRemove) {
        urlCache.delete(key);
      }
    }
    const obj = Object.fromEntries(urlCache);
    localStorage.setItem(IMAGE_URL_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

/**
 * Genera URL ottimizzata per immagini Supabase Storage
 * Supporta resize e conversione formato
 * Results are cached in localStorage to avoid recalculating
 */
export const getOptimizedImageUrl = (
  url: string | null | undefined,
  options: ImageOptions = {}
): string => {
  if (!url) return '';

  // Se non è un URL Supabase, ritorna l'originale
  if (!url.includes('supabase.co/storage')) {
    return url;
  }

  // Check persistent cache
  const cacheKey = `${url}|${JSON.stringify(options)}`;
  const cached = urlCache.get(cacheKey);
  if (cached) {
    cached.ts = Date.now();
    return cached.url;
  }

  // Image Transformation disabilitato — il piano Supabase non lo supporta
  // o cache stale del SW restituisce 400 sui /render/image/. Usiamo l'URL
  // originale e lasciamo al browser il resize via CSS (object-fit: cover).
  urlCache.set(cacheKey, { url, ts: Date.now() });
  persistUrlCache();
  return url;
};

/**
 * Presets per dimensioni comuni
 */
export const ImageSizes = {
  // Avatar piccolo (navbar, lista chat)
  avatarSmall: { width: 40, height: 40, quality: 75 },
  // Avatar medio (post, profilo)
  avatarMedium: { width: 80, height: 80, quality: 80 },
  // Avatar grande (profilo dettaglio)
  avatarLarge: { width: 150, height: 150, quality: 85 },
  // Thumbnail per lista (card partner, gallery preview)
  thumbnail: { width: 200, height: 200, quality: 75 },
  // Card immagine (post feed, eventi)
  card: { width: 400, height: 400, quality: 80 },
  // Immagine media (dettaglio post)
  medium: { width: 600, height: 600, quality: 85 },
  // Immagine grande (fullscreen)
  large: { width: 1200, height: 1200, quality: 90 },
};

/**
 * Helpers veloci
 */
export const getThumbnail = (url: string | null | undefined) =>
  getOptimizedImageUrl(url, ImageSizes.thumbnail);

export const getCardImage = (url: string | null | undefined) =>
  getOptimizedImageUrl(url, ImageSizes.card);

export const getAvatarUrl = (url: string | null | undefined, size: 'small' | 'medium' | 'large' = 'medium') => {
  const sizeMap = {
    small: ImageSizes.avatarSmall,
    medium: ImageSizes.avatarMedium,
    large: ImageSizes.avatarLarge,
  };
  return getOptimizedImageUrl(url, sizeMap[size]);
};

// Cache in memoria per immagini già caricate
const imageCache = new Set<string>();

/**
 * Comprimi un'immagine prima dell'upload
 * Ridimensiona e converte in JPEG per ridurre dimensioni
 */
export const compressImage = (
  file: File,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  } = {}
): Promise<Blob> => {
  const { maxWidth = 800, maxHeight = 800, quality = 0.8 } = options;

  return new Promise((resolve, reject) => {
    // Se non è un'immagine, ritorna il file originale
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }

    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    img.onload = () => {
      let { width, height } = img;

      // Calcola nuove dimensioni mantenendo aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      if (ctx) {
        // Sfondo bianco per trasparenza PNG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality
        );
      } else {
        reject(new Error('Canvas context not available'));
      }

      URL.revokeObjectURL(img.src);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(file);
  });
};

/**
 * Comprimi immagine per avatar (piccola, alta compressione)
 */
export const compressAvatar = (file: File): Promise<Blob> => {
  return compressImage(file, {
    maxWidth: 200,
    maxHeight: 200,
    quality: 0.85,
  });
};

/**
 * Comprimi immagine per post/gallery (media dimensione)
 */
export const compressPostImage = (file: File): Promise<Blob> => {
  return compressImage(file, {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 0.8,
  });
};

/**
 * Precarica un'immagine in background con cache
 */
export const preloadImage = (url: string): Promise<void> => {
  // Se già in cache, ritorna subito
  if (imageCache.has(url)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.add(url);
      resolve();
    };
    img.onerror = reject;
    img.src = url;
  });
};

/**
 * Precarica multiple immagini in background
 */
export const preloadImages = (urls: string[]): Promise<void[]> => {
  return Promise.all(urls.filter(Boolean).map(preloadImage));
};

/**
 * Verifica se immagine è in cache
 */
export const isImageCached = (url: string): boolean => {
  return imageCache.has(url);
};
